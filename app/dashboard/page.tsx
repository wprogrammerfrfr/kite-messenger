"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { EmptyChatDashboard } from "@/components/EmptyChatDashboard";
import type { SafetyProfileOpenPayload } from "@/components/SafetyProfileModal";
import { SafetyProfileModal } from "@/components/SafetyProfileModal";
import { SkeletonChat } from "@/components/SkeletonChat";
import { t, type Language } from "@/lib/translations";

type ContactAliasRow = {
  contact_id: string;
  alias: string;
};

type PresenceMap = Record<string, boolean>;

function getStoredLanguage(): Language {
  if (typeof window === "undefined") return "en";
  try {
    const stored = localStorage.getItem("nexus-lang");
    if (stored === "fa" || stored === "ar" || stored === "en" || stored === "kr" || stored === "tr") {
      return stored;
    }
  } catch {
    // ignore
  }
  return "en";
}

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<Language>("en");
  const [appearance, setAppearance] = useState<"light" | "dark">("dark");

  const [onlineUserIds, setOnlineUserIds] = useState<PresenceMap>({});
  const [aliasByContactId, setAliasByContactId] = useState<Record<string, string>>({});

  const [safetyProfilePayload, setSafetyProfilePayload] =
    useState<SafetyProfileOpenPayload | null>(null);

  useEffect(() => {
    setLanguage(getStoredLanguage());
    if (typeof window !== "undefined") {
      try {
        setAppearance(localStorage.getItem("kite-appearance") === "light" ? "light" : "dark");
      } catch {
        setAppearance("dark");
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);

      const { data, error } = await supabase.auth.getSession();
      if (cancelled) return;
      if (error || !data?.session) {
        setSession(null);
        setLoading(false);
        return;
      }

      const s = data.session;
      setSession(s);

      const meId = s.user.id;

      const { data: meProfile, error: meErr } = await supabase
        .from("profiles")
        .select("preferred_locale")
        .eq("id", meId)
        .maybeSingle();

      if (!meErr) {
        const pl = meProfile?.preferred_locale as string | null | undefined;
        if (!cancelled && (pl === "fa" || pl === "ar" || pl === "en" || pl === "kr" || pl === "tr")) {
          setLanguage(pl);
        }
      }

      const { data: aliases } = await supabase
        .from("contact_aliases")
        .select("contact_id, alias")
        .eq("user_id", meId);

      if (!cancelled && Array.isArray(aliases)) {
        const map: Record<string, string> = {};
        (aliases as ContactAliasRow[]).forEach((r) => {
          map[r.contact_id] = r.alias;
        });
        setAliasByContactId(map);
      }

      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;

    const myId = session.user.id;
    const channel = supabase.channel("online-users", {
      config: { presence: { key: myId } },
    });

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const next: PresenceMap = {};
      Object.keys(state).forEach((id) => {
        next[id] = true;
      });
      setOnlineUserIds(next);
    });

    channel.subscribe(async (status) => {
      if (status !== "SUBSCRIBED") return;
      try {
        channel.track({ last_seen: new Date().toISOString() });
      } catch {
        // ignore
      }
    });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [session?.user?.id]);

  const viewerId = session?.user.id ?? "";

  if (loading || !session) {
    return (
      <div className="min-h-screen">
        <SkeletonChat />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-stone-950 text-white flex items-center justify-center">
        <div className="rounded-xl border border-white/20 px-6 py-4 text-sm font-semibold">
          {t(language, "authOfflineHint")}
        </div>
      </div>
    );
  }

  const isLight = appearance === "light";

  return (
    <div
      className="min-h-[calc(100dvh-var(--bottom-nav-height))]"
      style={{ background: isLight ? "#f5f5f4" : "#0c0a09", color: isLight ? "#1c1917" : "#ffffff" }}
    >
      <div className="mx-auto max-w-5xl px-3 pt-4 pb-10 sm:px-4">
        <div className="mb-3 rounded-xl bg-black/10 px-2 py-1 backdrop-blur-md">
          <h1 className="text-center text-xl font-bold">Discover</h1>
        </div>
        <div className="rounded-3xl p-2 sm:p-4" style={{ background: isLight ? "rgba(245,245,244,0.9)" : "rgba(0,0,0,0.35)" }}>
          <EmptyChatDashboard
            language={language}
            sessionUserId={session.user.id}
            appearance={appearance}
            onSelectRecipient={(id) => {
              router.push(`/chat?recipient=${encodeURIComponent(id)}`);
            }}
            onOpenContactProfile={(payload) => setSafetyProfilePayload(payload)}
            onlineUserIds={onlineUserIds}
            aliasByContactId={aliasByContactId}
          />
        </div>
      </div>

      {safetyProfilePayload ? (
        <SafetyProfileModal
          open
          onClose={() => setSafetyProfilePayload(null)}
          language={language}
          appearance={appearance}
          viewerId={viewerId}
          target={safetyProfilePayload.target}
          dmStatus={
            safetyProfilePayload.isSelf
              ? "accepted"
              : safetyProfilePayload.dmStatus
          }
          isSelf={safetyProfilePayload.isSelf}
          onContactAliasUpdated={(contactId, alias) => {
            setAliasByContactId((prev) => {
              const next = { ...prev };
              if (alias) next[contactId] = alias;
              else delete next[contactId];
              return next;
            });
          }}
        />
      ) : null}
    </div>
  );
}
