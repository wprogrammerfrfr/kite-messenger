"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Loader2,
  Radio,
  User as UserIcon,
  Users,
} from "lucide-react";
import type { StudioProfile } from "@/components/studio/ProfileDrawer";
import { StudioLobbySkeleton } from "@/components/studio/StudioLobbySkeleton";
import "@/components/studio/studio-lobby.css";
import {
  readJsonCache,
  settingsProfileCacheKey,
} from "@/lib/kite-tab-cache";
import { supabase } from "@/lib/supabase";

const ProfileDrawer = dynamic(
  () =>
    import("@/components/studio/ProfileDrawer").then((mod) => mod.ProfileDrawer),
  { ssr: false }
);

// ---------------------------------------------------------------------------
// Decorative primitives
// ---------------------------------------------------------------------------

function Screw({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 10 10"
      className={`absolute h-2.5 w-2.5 text-zinc-600 ${className}`}
      aria-hidden="true"
    >
      <circle cx="5" cy="5" r="4" fill="currentColor" opacity="0.5" />
      <line x1="2.5" y1="5" x2="7.5" y2="5" stroke="black" strokeOpacity="0.5" strokeWidth="0.8" />
    </svg>
  );
}

function RackScrews() {
  return (
    <>
      <Screw className="left-3 top-3" />
      <Screw className="right-3 top-3" />
      <Screw className="bottom-3 left-3" />
      <Screw className="bottom-3 right-3" />
    </>
  );
}

function LEDStatus({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-zinc-500">
      <span className={`h-1.5 w-1.5 rounded-full ${color} animate-pulse`} />
      {label}
    </span>
  );
}

function ModulePlate({
  index,
  label,
  dotColor,
}: {
  index: string;
  label: string;
  dotColor: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-700/50 bg-zinc-950/50 px-5 py-2.5">
      <span className="font-mono text-xs uppercase tracking-widest text-zinc-500">
        Channel {index}
      </span>
      <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-zinc-400">
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
        {label}
      </span>
    </div>
  );
}

function AmbientMeter() {
  const bars = [0.5, 0.8, 1, 0.6, 0.9, 0.4, 0.7];
  return (
    <div className="flex items-end gap-1" aria-hidden="true">
      {bars.map((peak, i) => (
        <span
          key={i}
          className={`studio-lobby-animated w-1 rounded-full ${i % 2 === 0 ? "bg-orange-500" : "bg-emerald-500"}`}
          style={{
            height: "14px",
            animation: `kite-meter 1.4s ease-in-out ${i * 0.09}s infinite`,
            transformOrigin: "bottom",
            opacity: 0.35 + peak * 0.5,
          }}
        />
      ))}
    </div>
  );
}

function VUMeter({ active }: { active: boolean }) {
  const bars = 14;
  return (
    <div className="flex items-end gap-1" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => {
        const color = i < 8 ? "bg-emerald-500" : i < 12 ? "bg-orange-400" : "bg-orange-500";
        return (
          <span
            key={i}
            className={`studio-lobby-animated w-1 rounded-sm ${color}`}
            style={{
              height: `${10 + i * 1.6}px`,
              animation: `kite-vu ${1.2 + (i % 4) * 0.2}s ease-in-out ${i * 0.05}s infinite`,
              opacity: active ? 0.9 : 0.3,
            }}
          />
        );
      })}
    </div>
  );
}

function FooterWaveform() {
  const bars = 28;
  return (
    <div className="flex h-6 w-full max-w-md items-end justify-between gap-0.5" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="studio-lobby-animated w-1 rounded-sm bg-zinc-700"
          style={{
            height: `${20 + Math.abs(Math.sin(i)) * 60}%`,
            animation: `kite-vu ${1.4 + (i % 5) * 0.15}s ease-in-out ${i * 0.04}s infinite`,
            opacity: 0.4,
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Join code input
// ---------------------------------------------------------------------------

function JoinCodeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const setChar = (i: number, char: string) => {
    const chars = value.split("");
    while (chars.length < 6) chars.push("");
    chars[i] = char.slice(-1).toUpperCase();
    onChange(chars.join("").slice(0, 6));
    if (char && refs.current[i + 1]) refs.current[i + 1]?.focus();
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !value[i] && refs.current[i - 1]) {
      refs.current[i - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const cleaned = e.clipboardData
      .getData("text")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 6)
      .toUpperCase();
    if (!cleaned) return;
    onChange(cleaned);
    const focusIndex = cleaned.length === 6 ? 5 : cleaned.length;
    requestAnimationFrame(() => refs.current[focusIndex]?.focus());
  };

  return (
    <div className="flex justify-center gap-2" onPaste={handlePaste}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={value[i] || ""}
          onChange={(e) => setChar(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          maxLength={1}
          inputMode="text"
          style={{ textShadow: "0 0 8px rgba(52, 211, 153, 0.65)" }}
          className="h-12 w-9 rounded-md border border-zinc-800 bg-black/60 text-center font-mono text-lg font-semibold text-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:h-14 sm:w-11"
          aria-label={`Room code character ${i + 1}`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main lobby
// ---------------------------------------------------------------------------

function resolveFallbackName(user: {
  id?: string;
  email?: string | null;
  user_metadata?: unknown;
}) {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const nameFromMeta =
    (meta.display_name as string | undefined) ||
    (meta.full_name as string | undefined) ||
    (meta.name as string | undefined) ||
    (meta.username as string | undefined);

  const emailPrefix =
    typeof user.email === "string" && user.email.includes("@")
      ? user.email.split("@")[0]
      : undefined;

  const idPrefix = typeof user.id === "string" ? user.id.slice(0, 8) : undefined;

  return nameFromMeta || emailPrefix || idPrefix || "Kite Member";
}

function buildInitialProfile(
  user: {
    id: string;
    email?: string | null;
    user_metadata?: unknown;
  }
): StudioProfile {
  const fallback = resolveFallbackName(user);
  const cached = readJsonCache<{
    nickname?: string;
    bio?: string;
    profilePictureUrl?: string;
  }>(settingsProfileCacheKey(user.id));
  const cachedNickname = cached?.nickname?.trim();
  const cachedAvatar =
    typeof cached?.profilePictureUrl === "string" &&
    cached.profilePictureUrl.trim().length > 0
      ? cached.profilePictureUrl.trim()
      : null;
  return {
    nickname: cachedNickname && cachedNickname.length > 0 ? cachedNickname : fallback,
    email: user.email ?? "",
    bio: cached?.bio ?? "",
    profilePictureUrl: cachedAvatar,
  };
}

const LOBBY_HANDOFF_STORAGE_KEY = "kite-studio:lobby-handoff:v1";

type LobbyHandoffPayload = {
  userId: string;
  email: string;
  user_metadata: unknown;
  profilePrefetched: boolean;
};

function clearLobbyHandoff(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(LOBBY_HANDOFF_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function readLobbyHandoff(): {
  userId: string;
  profile: StudioProfile;
  profilePrefetched: boolean;
} | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(LOBBY_HANDOFF_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LobbyHandoffPayload;
    if (typeof parsed?.userId !== "string" || parsed.userId.length === 0) {
      return null;
    }
    return {
      userId: parsed.userId,
      profile: buildInitialProfile({
        id: parsed.userId,
        email: typeof parsed.email === "string" ? parsed.email : "",
        user_metadata: parsed.user_metadata,
      }),
      profilePrefetched: parsed.profilePrefetched === true,
    };
  } catch {
    return null;
  }
}

function hasLobbyFields(cached: {
  nickname?: string;
  bio?: string;
  profilePictureUrl?: string;
}): boolean {
  return typeof cached.nickname === "string";
}

export default function StudioLobbyPage() {
  const router = useRouter();
  const [profileOpen, setProfileOpen] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [hostLoading, setHostLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [profile, setProfile] = useState<StudioProfile | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    try {
      sessionStorage.removeItem("is_auth_redirecting");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let callId = 0;
    let profileUserId: string | null = null;

    const handoff = readLobbyHandoff();
    if (handoff) {
      setUserId(handoff.userId);
      setProfile(handoff.profile);
    }

    type SessionUser = {
      id: string;
      email?: string | null;
      user_metadata?: unknown;
    };

    const fetchProfileDetails = async (user: SessionUser) => {
      const myCall = ++callId;
      if (!mounted) return;

      let nickname: string | null = null;
      let bio = "";
      let profilePictureUrl: string | null = null;
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("nickname, bio, profile_picture_url")
          .eq("id", user.id)
          .maybeSingle();

        if (!mounted || myCall !== callId) return;

        if (!error && data) {
          if (data.nickname) {
            const n = String(data.nickname).trim();
            nickname = n.length > 0 ? n : null;
          }
          bio = data.bio ? String(data.bio) : "";
          profilePictureUrl =
            typeof data.profile_picture_url === "string" &&
            data.profile_picture_url.trim().length > 0
              ? data.profile_picture_url.trim()
              : null;
        }
      } catch {
        // Best-effort: keep fallback nickname/bio already shown in lobby.
      }

      if (!mounted || myCall !== callId) return;

      setProfile((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          nickname: nickname ?? prev.nickname,
          bio: bio || prev.bio,
          profilePictureUrl: profilePictureUrl ?? prev.profilePictureUrl ?? null,
        };
      });
    };

    const handleSession = (session: unknown) => {
      if (!mounted) return;

      const s = session as { user?: SessionUser } | null;

      if (!s?.user?.id) {
        profileUserId = null;
        clearLobbyHandoff();
        setProfile(null);
        setUserId(null);
        return;
      }

      const user = s.user;
      const handoff = readLobbyHandoff();

      if (handoff && handoff.userId !== user.id) {
        clearLobbyHandoff();
      }

      if (profileUserId === user.id) {
        clearLobbyHandoff();
        return;
      }

      profileUserId = user.id;
      setUserId(user.id);
      setProfile(buildInitialProfile(user));

      const cached = readJsonCache<{
        nickname?: string;
        bio?: string;
        profilePictureUrl?: string;
      }>(settingsProfileCacheKey(user.id));

      const activeHandoff =
        handoff && handoff.userId === user.id ? handoff : null;
      const skipFetch =
        cached !== null &&
        (activeHandoff?.profilePrefetched === true || hasLobbyFields(cached));

      clearLobbyHandoff();

      if (!skipFetch) {
        void fetchProfileDetails(user);
      }
    };

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted) handleSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      handleSession(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!profile || !userId) return;
    router.prefetch("/studio-bridge");
  }, [profile, userId, router]);

  const handleHost = useCallback(() => {
    if (hostLoading) return;
    setHostLoading(true);
    router.push("/studio-bridge");
  }, [hostLoading, router]);

  const handleJoin = useCallback(() => {
    if (joinLoading) return;

    const code = joinCode.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase();
    if (code.length !== 6 || !/^[a-zA-Z0-9]{6}$/.test(code)) {
      setJoinError("Enter the full 6-character code.");
      return;
    }

    setJoinError("");
    setJoinLoading(true);

    void (async () => {
      try {
        const { data, error } = await supabase
          .from("studio_sessions")
          .select("session_id")
          .eq("session_id", code)
          .maybeSingle();

        if (error || !data?.session_id) {
          setJoinError("Room not found or inactive.");
          return;
        }

        const sessionIdUpper = String(data.session_id).toUpperCase();
        router.push(`/studio-bridge?room=${encodeURIComponent(sessionIdUpper)}`);
      } catch (err) {
        console.error("[Studio Lobby] Join request exception", err);
        setJoinError("Room not found or inactive.");
      } finally {
        setJoinLoading(false);
      }
    })();
  }, [joinCode, joinLoading, router]);

  const handleSignOut = useCallback(async () => {
    setProfileOpen(false);
    await supabase.auth.signOut();
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  }, []);

  const handleProfilePictureUpdated = useCallback((url: string | null) => {
    setProfile((prev) => (prev ? { ...prev, profilePictureUrl: url } : prev));
  }, []);

  const telemetry = [
    { label: "Active jams", value: "12" },
    { label: "Avg latency", value: "18ms" },
    { label: "Sample rate", value: "48kHz" },
    { label: "Uptime", value: "99.98%" },
  ];

  if (!profile || !userId) {
    return <StudioLobbySkeleton />;
  }

  return (
    <div
      className="studio-lobby-root relative min-h-screen overflow-hidden bg-zinc-950 font-sans text-zinc-100"
      data-lobby-ready="true"
    >
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          className="studio-lobby-animated absolute -left-32 -top-32 h-96 w-96 rounded-full bg-orange-500/10 blur-3xl"
          style={{ animation: "kite-drift 14s ease-in-out infinite" }}
        />
        <div
          className="studio-lobby-animated absolute -bottom-40 -right-20 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl"
          style={{ animation: "kite-drift 18s ease-in-out infinite reverse" }}
        />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
        {/* Fascia / header */}
        <header className="relative overflow-hidden rounded-2xl border border-zinc-700/50 bg-zinc-900/60 px-6 py-8 shadow-xl backdrop-blur-md sm:px-12 sm:py-12">
          <RackScrews />

          <div className="flex items-center justify-between">
            <LEDStatus color="bg-emerald-500" label="System online" />
            <button
              onClick={() => setProfileOpen(true)}
              className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-orange-500 to-emerald-500 text-xs font-semibold text-zinc-950 ring-2 ring-zinc-700/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              aria-label="Open profile"
            >
              {profile.profilePictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.profilePictureUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                profile.nickname.slice(0, 2).toUpperCase()
              )}
            </button>
          </div>

          <h1 className="mt-6 text-center text-4xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-orange-400 via-zinc-100 to-emerald-400 sm:text-6xl">
            Kite Studio Pro
          </h1>

          <div className="mt-6 flex flex-col items-center gap-2">
            <span className="font-mono text-xs uppercase tracking-widest text-zinc-500">
              Studio monitor
            </span>
            <AmbientMeter />
          </div>
        </header>

        {/* Channel modules */}
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {/* Host module */}
          <div className="relative overflow-hidden rounded-2xl border border-zinc-700/50 bg-zinc-900/80 shadow-xl backdrop-blur-md">
            <RackScrews />
            <ModulePlate index="01" label="Host" dotColor="bg-orange-500" />

            <div className="p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-orange-500/30 bg-orange-500/10 text-orange-400">
                  <Radio className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-zinc-50">Start a Jam</h2>
                  <p className="text-sm text-zinc-500">Open a room and invite collaborators</p>
                </div>
              </div>

              <div className="mt-6 rounded-lg border border-zinc-700/50 bg-zinc-950/50 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs uppercase tracking-widest text-zinc-500">
                    Input level
                  </span>
                  <LEDStatus
                    color={hostLoading ? "bg-orange-500" : "bg-zinc-600"}
                    label={hostLoading ? "Connecting" : "Idle"}
                  />
                </div>
                <div className="mt-3">
                  <VUMeter active={hostLoading} />
                </div>
              </div>

              <button
                onClick={handleHost}
                disabled={hostLoading}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-orange-500 to-emerald-500 py-2.5 text-sm font-semibold text-zinc-950 shadow-lg shadow-orange-500/10 transition-opacity hover:opacity-90 disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
              >
                {hostLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Start Looping <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Join module */}
          <div className="relative overflow-hidden rounded-2xl border border-zinc-700/50 bg-zinc-900/80 shadow-xl backdrop-blur-md">
            <RackScrews />
            <ModulePlate index="02" label="Join" dotColor="bg-emerald-500" />

            <div className="p-6">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700/50 bg-zinc-800 text-zinc-300">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-zinc-50">Join a Jam</h2>
                  <p className="text-sm text-zinc-500">Enter the code your host shared</p>
                </div>
              </div>

              <div className="mt-6 rounded-lg border border-zinc-800 bg-black/40 p-4 shadow-inner">
                <p className="mb-3 text-center font-mono text-xs uppercase tracking-widest text-zinc-500">
                  Room frequency
                </p>
                <JoinCodeInput
                  value={joinCode}
                  onChange={(v) => {
                    setJoinCode(v);
                    if (joinError) setJoinError("");
                  }}
                />
                {joinError && (
                  <p className="mt-3 text-center text-xs font-medium text-red-400">{joinError}</p>
                )}
              </div>

              <button
                onClick={handleJoin}
                disabled={joinLoading}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/50 py-2.5 text-sm font-semibold text-zinc-100 transition-colors hover:border-emerald-500/30 hover:text-emerald-400 disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                {joinLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Join Jam <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Telemetry strip */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {telemetry.map((item, i) => (
            <div
              key={item.label}
              className="rounded-lg border border-zinc-700/50 bg-zinc-900/60 px-4 py-3 text-center"
            >
              <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">
                {item.label}
              </p>
              <p
                className={`mt-1 font-mono text-lg font-bold ${
                  i % 2 === 0 ? "text-orange-400" : "text-emerald-400"
                }`}
              >
                {item.value}
              </p>
            </div>
          ))}
        </div>

        {/* Footer monitor */}
        <div className="mt-10 flex flex-col items-center gap-4 pb-4">
          <FooterWaveform />
          <button
            onClick={() => setProfileOpen(true)}
            className="flex items-center gap-2 text-xs font-medium text-zinc-500 transition-colors hover:text-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <UserIcon className="h-3.5 w-3.5" />
            Manage profile and preferences
          </button>
        </div>
      </div>

      <ProfileDrawer
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        profile={profile}
        userId={userId}
        onSignOut={handleSignOut}
        onProfilePictureUpdated={handleProfilePictureUpdated}
      />
    </div>
  );
}
