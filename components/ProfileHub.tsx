"use client";

import { useEffect, useRef, useState, memo } from "react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { Sun, Moon, AlertTriangle } from "lucide-react";
import { SHOW_PROFESSIONAL_AND_ROLE_UI } from "@/lib/feature-flags";
import { getStoredAppearance, setAppearanceMode } from "@/components/theme-provider";
import { InstallKiteButton } from "@/components/InstallKiteButton";
import { LanguageDropdown } from "@/components/LanguageDropdown";
import {
  areNotificationsGloballyDisabled,
  setNotificationsGloballyDisabled,
} from "@/lib/kite-notifications";
import {
  removeKitePushFromServer,
  unsubscribeKitePushOnDevice,
} from "@/lib/kite-push-client";
import type { Language } from "@/lib/translations";
import { SkeletonProfile } from "@/components/SkeletonProfile";
import {
  readJsonCache,
  settingsProfileCacheKey,
  writeJsonCache,
} from "@/lib/kite-tab-cache";

type Role = "musician" | "therapist" | "responder";

interface Profile {
  nickname: string | null;
  bio: string | null;
  emergency_contact: string | null;
  role: Role | null;
  profile_picture_url: string | null;
}

const MUSICIAN_THEME = {
  pageBg: "#000000",
  panelBg: "rgba(14, 14, 18, 0.96)",
  border: "rgba(255, 69, 0, 0.35)",
  accent: "#FF4500",
  textPrimary: "rgba(255, 255, 255, 0.95)",
  textSecondary: "rgba(255, 255, 255, 0.6)",
  inputBg: "rgba(20, 20, 24, 0.95)",
};

const THERAPIST_THEME = {
  pageBg: "#e8efe6",
  panelBg: "rgba(255, 255, 255, 0.98)",
  border: "rgba(100, 120, 95, 0.4)",
  accent: "#4a6348",
  textPrimary: "#1a2a1a",
  textSecondary: "#2d3d2d",
  inputBg: "rgba(255, 255, 255, 0.98)",
};

/** Light mode shell for settings (matches chat light musician palette). */
const LIGHT_SETTINGS_THEME = {
  pageBg: "#f5f5f4",
  panelBg: "#ffffff",
  border: "rgba(255, 69, 0, 0.28)",
  accent: "#FF4500",
  textPrimary: "#1c1917",
  textSecondary: "#57534e",
  inputBg: "#fafaf9",
};

export const ProfileHub = memo(function ProfileHub() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarLightboxOpen, setAvatarLightboxOpen] = useState(false);
  const [draggingAvatar, setDraggingAvatar] = useState(false);

  const [nickname, setNickname] = useState("");
  const [bio, setBio] = useState("");
  const [emergencyContact, setEmergencyContact] = useState<string>("");
  const [profilePictureUrl, setProfilePictureUrl] = useState<string>("");
  const [role, setRole] = useState<Role>("musician");

  const [vibe, setVibe] = useState<Role>("musician");
  const [appearance, setAppearance] = useState<"light" | "dark">("dark");
  const [notificationsMuted, setNotificationsMuted] = useState(false);
  const [language, setLanguage] = useState<Language>("en");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const theme =
    appearance === "light"
      ? vibe === "therapist"
        ? THERAPIST_THEME
        : LIGHT_SETTINGS_THEME
      : vibe === "therapist"
        ? THERAPIST_THEME
        : MUSICIAN_THEME;

  // Load current vibe from localStorage so this page matches the chat UI.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem("nexus-professional-mode");
      if (stored === "therapist") {
        setVibe("therapist");
      } else if (stored === "musician") {
        setVibe("musician");
      }
      setAppearance(getStoredAppearance());
    } catch {
      // Ignore storage errors and keep default.
    }
  }, []);

  useEffect(() => {
    const syncNotifications = () =>
      setNotificationsMuted(areNotificationsGloballyDisabled());
    syncNotifications();
    window.addEventListener("kite-notifications-setting", syncNotifications);
    window.addEventListener("storage", syncNotifications);
    return () => {
      window.removeEventListener("kite-notifications-setting", syncNotifications);
      window.removeEventListener("storage", syncNotifications);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("nexus-lang");
    if (stored === "fa" || stored === "ar" || stored === "en" || stored === "kr" || stored === "tr") {
      setLanguage(stored);
    }
  }, []);

  // Fetch session and existing profile.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setError(null);

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (cancelled) return;

      if (sessionData?.session) {
        setSession(sessionData.session);

        const userId = sessionData.session.user.id;
        const cached = readJsonCache<{
          nickname: string;
          bio: string;
          emergencyContact: string;
          profilePictureUrl: string;
          role: Role;
        }>(settingsProfileCacheKey(userId));
        if (cached) {
          setNickname(cached.nickname ?? "");
          setBio(cached.bio ?? "");
          setEmergencyContact(cached.emergencyContact ?? "");
          setProfilePictureUrl(cached.profilePictureUrl ?? "");
          if (
            cached.role === "therapist" ||
            cached.role === "musician" ||
            cached.role === "responder"
          ) {
            setRole(cached.role);
          }
          setLoading(false);
        } else {
          setLoading(true);
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("nickname, bio, emergency_contact, role, profile_picture_url")
          .eq("id", userId)
          .maybeSingle();

        if (cancelled) return;

        if (profileError && profileError.code !== "PGRST116") {
          // PGRST116 = no rows found
          setError(profileError.message);
        } else if (profile) {
          const typedProfile = profile as Profile;
          setNickname(typedProfile.nickname ?? "");
          setBio(typedProfile.bio ?? "");
          setEmergencyContact(typedProfile.emergency_contact ?? "");
          setProfilePictureUrl(typedProfile.profile_picture_url ?? "");
          if (
            typedProfile.role === "therapist" ||
            typedProfile.role === "musician" ||
            typedProfile.role === "responder"
          ) {
            setRole(typedProfile.role);
          }
          writeJsonCache(settingsProfileCacheKey(userId), {
            nickname: typedProfile.nickname ?? "",
            bio: typedProfile.bio ?? "",
            emergencyContact: typedProfile.emergency_contact ?? "",
            profilePictureUrl: typedProfile.profile_picture_url ?? "",
            role:
              typedProfile.role === "therapist" ||
              typedProfile.role === "musician" ||
              typedProfile.role === "responder"
                ? typedProfile.role
                : "musician",
          });
        }

        setLoading(false);
        return;
      }

      if (sessionError) {
        console.error(sessionError);
      }
      const offline =
        typeof navigator !== "undefined" && !navigator.onLine;
      if (!offline) {
        setSession(null);
        setError("You must be logged in to view settings.");
      }
      setLoading(false);
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const trimmedNickname = nickname.trim();

      if (trimmedNickname) {
        const { data: existing, error: nickError } = await supabase
          .from("profiles")
          .select("id")
          .eq("nickname", trimmedNickname)
          .neq("id", session.user.id)
          .maybeSingle();

        if (nickError && nickError.code !== "PGRST116") {
          setError(nickError.message);
          setSaving(false);
          return;
        }

        if (existing) {
          setError("Nickname already taken.");
          setSaving(false);
          return;
        }
      }

      const { error: upsertError } = await supabase.from("profiles").upsert(
        {
          id: session.user.id,
          nickname: trimmedNickname || null,
          bio: bio.trim() || null,
          emergency_contact: emergencyContact.trim() || null,
          profile_picture_url: profilePictureUrl.trim() || null,
          role,
        },
        { onConflict: "id" }
      );

      if (upsertError) {
        setError(upsertError.message);
      } else {
        setSuccess("Profile updated successfully.");
        writeJsonCache(settingsProfileCacheKey(session.user.id), {
          nickname: trimmedNickname,
          bio: bio.trim(),
          emergencyContact: emergencyContact.trim(),
          profilePictureUrl: profilePictureUrl.trim(),
          role,
        });
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update profile. Try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (file: File) => {
    if (!session) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    setAvatarUploading(true);
    setError(null);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${session.user.id}/profile-${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("chat-images")
        .upload(path, file, {
          cacheControl: "3600",
          upsert: true,
          contentType: file.type || "image/jpeg",
        });
      if (uploadError) {
        setError(uploadError.message);
        return;
      }
      const { data } = supabase.storage.from("chat-images").getPublicUrl(path);
      if (!data?.publicUrl) {
        setError("Could not generate image URL.");
        return;
      }
      setProfilePictureUrl(data.publicUrl);
      setSuccess("Profile picture updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload profile picture.");
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!session || deletingAccount) return;
    const ok =
      typeof window !== "undefined"
        ? window.confirm("Are you sure? This cannot be undone.")
        : false;
    if (!ok) return;

    setDeletingAccount(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not delete account.");
        return;
      }
      if (typeof window !== "undefined") {
        window.location.href = "/";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <div
      className="min-h-[calc(100dvh-var(--bottom-nav-height))] px-4 py-6 sm:py-8"
      style={{ background: theme.pageBg, color: theme.textPrimary }}
    >
      <div
        className="mx-auto w-full max-w-2xl rounded-3xl border shadow-xl backdrop-blur-xl p-6 sm:p-8"
        style={{
          background: theme.panelBg,
          borderColor: theme.border,
        }}
      >
        <InstallKiteButton
          language="en"
          variant="compact"
          className="mb-5"
        />

        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Profile Hub
          </h1>
          <p
            className="mt-1 text-xs sm:text-sm"
            style={{ color: theme.textSecondary }}
          >
            Manage your identity and account preferences.
          </p>
        </div>

        {loading ? (
          <SkeletonProfile />
        ) : !session ? (
          <p className="text-sm text-red-500">{error ?? "Not authenticated."}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <section className="rounded-2xl border px-4 py-5 sm:px-6" style={{ borderColor: theme.border }}>
              <div className="flex flex-col items-center text-center">
              <div
                className={`h-24 w-24 rounded-full overflow-hidden ${draggingAvatar ? "ring-2 ring-amber-400" : ""}`}
                style={{ borderColor: theme.border }}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (profilePictureUrl) {
                    setAvatarLightboxOpen(true);
                    return;
                  }
                  fileInputRef.current?.click();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (profilePictureUrl) {
                      setAvatarLightboxOpen(true);
                    } else {
                      fileInputRef.current?.click();
                    }
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDraggingAvatar(true);
                }}
                onDragLeave={() => setDraggingAvatar(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDraggingAvatar(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleAvatarUpload(file);
                }}
              >
                {profilePictureUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profilePictureUrl}
                    alt="Your avatar"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div
                    className="h-full w-full flex items-center justify-center bg-black/10"
                    style={{ background: "rgba(255,255,255,0.03)" }}
                  >
                    <span className="text-2xl" style={{ color: theme.textSecondary, fontWeight: 700 }}>
                      {(nickname.trim()[0] ?? "").toUpperCase()}
                    </span>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleAvatarUpload(file);
                  e.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className="mt-3 rounded-xl px-3 py-1.5 text-xs font-semibold"
                style={{ background: "rgba(255,255,255,0.12)", color: theme.textPrimary }}
              >
                {avatarUploading ? "Uploading..." : "Upload Photo"}
              </button>
              <div className="mt-4 w-full">
                <div
                  className="text-xs uppercase tracking-[0.18em] font-medium"
                  style={{ color: theme.textSecondary }}
                >
                  Your Profile
                </div>
                <div className="mt-1 text-xl font-semibold" style={{ color: theme.textPrimary }}>
                  {nickname.trim() ? nickname.trim() : "Your name"}
                </div>
                <div className="mx-auto mt-2 max-w-lg text-sm" style={{ color: theme.textSecondary, lineHeight: 1.5 }}>
                  {bio.trim() ? bio.trim() : "Add a bio to show your vibe."}
                </div>
              </div>
              </div>
            </section>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-[0.18em]">
                Nickname
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="How should Kite address you?"
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none border"
                style={{
                  background: theme.inputBg,
                  borderColor: theme.border,
                  color: theme.textPrimary,
                }}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-[0.18em]">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="A short line about you (optional)."
                className="w-full min-h-[96px] rounded-xl px-3 py-2.5 text-sm outline-none border resize-none"
                style={{
                  background: theme.inputBg,
                  borderColor: theme.border,
                  color: theme.textPrimary,
                }}
              />
            </div>

            <section className="rounded-2xl border p-4 sm:p-5" style={{ borderColor: theme.border }}>
              <div className="mb-4">
                <h2 className="text-sm font-semibold uppercase tracking-[0.16em]" style={{ color: theme.textPrimary }}>
                  Preferences
                </h2>
                <p className="mt-1 text-xs" style={{ color: theme.textSecondary }}>
                  Appearance and account controls.
                </p>
              </div>

              <div
                className="mb-4 flex items-center justify-between rounded-xl border px-3 py-2"
                style={{ borderColor: theme.border }}
              >
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.textSecondary }}>
                  Appearance
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const next = appearance === "dark" ? "light" : "dark";
                    setAppearance(next);
                    setAppearanceMode(next);
                  }}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg transition hover:opacity-90"
                  style={{
                    background: theme.accent,
                    color: appearance === "dark" ? "#fff" : "#000",
                  }}
                  title={
                    appearance === "dark"
                      ? "Switch to light mode"
                      : "Switch to dark mode"
                  }
                  aria-label={
                    appearance === "dark"
                      ? "Switch to light mode"
                      : "Switch to dark mode"
                  }
                >
                  {appearance === "dark" ? (
                    <Sun className="h-4 w-4" aria-hidden />
                  ) : (
                    <Moon className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </div>

              <div
                className="mb-4 flex items-center justify-between rounded-xl border px-3 py-2"
                style={{ borderColor: theme.border }}
              >
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.textSecondary }}>
                  Notifications
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    const next = !notificationsMuted;
                    setNotificationsMuted(next);
                    setNotificationsGloballyDisabled(next);
                    if (next) {
                      const {
                        data: { session: s },
                      } = await supabase.auth.getSession();
                      if (s?.access_token) await removeKitePushFromServer(s.access_token);
                      await unsubscribeKitePushOnDevice();
                    }
                  }}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold hover:brightness-110 active:scale-95 transition-transform"
                  style={{
                    background: notificationsMuted ? "rgba(255,255,255,0.08)" : theme.accent,
                    color: notificationsMuted ? theme.textSecondary : vibe === "therapist" ? "#fff" : "#000",
                  }}
                >
                  {notificationsMuted ? "Enable" : "Disable"}
                </button>
              </div>

              <div
                className="mb-4 flex items-center justify-between rounded-xl border px-3 py-2"
                style={{ borderColor: theme.border }}
              >
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.textSecondary }}>
                  Language
                </span>
                <LanguageDropdown
                  value={language}
                  onChange={(next) => {
                    setLanguage(next);
                    try {
                      localStorage.setItem("nexus-lang", next);
                      document.cookie = `nexus-lang=${next}; path=/; max-age=${60 * 60 * 24 * 365}`;
                    } catch {
                      // ignore
                    }
                  }}
                  compact
                />
              </div>

              <button
                type="button"
                onClick={async () => {
                  await supabase.auth.signOut();
                  if (typeof window !== "undefined") {
                    window.location.href = "/";
                  }
                }}
                className="w-full rounded-xl px-3 py-2 text-sm font-bold text-white bg-red-600 border border-red-500 hover:brightness-110 active:scale-95 transition-transform"
              >
                Log Out
              </button>

            <div className="space-y-1.5">
              <label
                htmlFor="emergency-contact-number"
                className="text-xs font-medium uppercase tracking-[0.18em]"
              >
                Emergency Contact Number
              </label>
              <input
                id="emergency-contact-number"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={emergencyContact}
                onChange={(e) => setEmergencyContact(e.target.value)}
                placeholder="+1 555 0100"
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none border"
                style={{
                  background: theme.inputBg,
                  borderColor: theme.border,
                  color: theme.textPrimary,
                }}
                aria-describedby="emergency-contact-hint"
              />
              <p
                id="emergency-contact-hint"
                className="text-xs leading-relaxed"
                style={{ color: theme.textSecondary }}
              >
                Visible only to your approved contacts in emergency workflows.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-[0.18em]">
                Profile Picture URL
              </label>
              <input
                type="url"
                value={profilePictureUrl}
                onChange={(e) => setProfilePictureUrl(e.target.value)}
                placeholder="Optional image URL"
                className="w-full rounded-xl px-3 py-2.5 text-sm outline-none border"
                style={{
                  background: theme.inputBg,
                  borderColor: theme.border,
                  color: theme.textPrimary,
                }}
              />
            </div>

            {SHOW_PROFESSIONAL_AND_ROLE_UI && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-[0.18em]">
                  Role
                </label>
                <div className="grid grid-cols-3 gap-2 rounded-xl border p-1">
                  <button
                    type="button"
                    onClick={() => setRole("musician")}
                    className="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                    style={{
                      background:
                        role === "musician" ? theme.accent : "transparent",
                      color:
                        role === "musician"
                          ? vibe === "therapist"
                            ? "#fff"
                            : "rgba(12, 10, 18, 0.95)"
                          : theme.textSecondary,
                    }}
                  >
                    Musician
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole("therapist")}
                    className="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                    style={{
                      background:
                        role === "therapist" ? theme.accent : "transparent",
                      color:
                        role === "therapist"
                          ? "#fff"
                          : theme.textSecondary,
                    }}
                  >
                    Therapist
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole("responder")}
                    className="rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                    style={{
                      background:
                        role === "responder" ? theme.accent : "transparent",
                      color:
                        role === "responder"
                          ? "#fff"
                          : theme.textSecondary,
                    }}
                  >
                    Responder
                  </button>
                </div>
                <p
                  className="text-xs"
                  style={{ color: theme.textSecondary }}
                >
                  This helps us personalize your workspace and recommendations.
                </p>
              </div>
            )}
            </section>

            {error && (
              <div className="rounded-xl border px-3 py-2 text-xs text-red-500 border-red-400/70 bg-red-500/5">
                {error}
              </div>
            )}

            {success && !error && (
              <div className="rounded-xl border px-3 py-2 text-xs border-emerald-400/70 bg-emerald-500/5 text-emerald-700">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="inline-flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold shadow-md transition disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                background: theme.accent,
                color: vibe === "therapist" ? "#fff" : "#000",
              }}
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>

            <button
              type="button"
              onClick={() => void handleDeleteAccount()}
              disabled={deletingAccount}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white bg-red-700 border border-red-600 hover:brightness-110 active:scale-95 transition-transform disabled:cursor-not-allowed"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {deletingAccount ? "Deleting account…" : "Delete account"}
            </button>
          </form>
        )}
      </div>
      {avatarLightboxOpen && profilePictureUrl ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setAvatarLightboxOpen(false)}
          role="dialog"
          aria-label="Profile image preview"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={profilePictureUrl}
            alt="Profile preview"
            className="max-h-[90vh] max-w-[95vw] rounded-2xl object-contain"
          />
        </div>
      ) : null}
    </div>
  );
});
