"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { Sun, Moon } from "lucide-react";
import { SHOW_PROFESSIONAL_AND_ROLE_UI } from "@/lib/feature-flags";
import { getStoredAppearance, setAppearanceMode } from "@/components/theme-provider";
import { t, type Language } from "@/lib/translations";
import { useResilience } from "@/components/resilience-provider";

type Role = "musician" | "therapist" | "responder";

interface Profile {
  nickname: string | null;
  emergency_contact: string | null;
  preferred_locale: string | null;
  role: Role | null;
  profile_picture_url: string | null;
}

const E2E_KEY_STORAGE_KEY = "kite-e2e-v1";

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

export default function SettingsPage() {
  const {
    isLowBandwidthMode,
    manualLowBandwidth,
    setManualLowBandwidth,
  } = useResilience();

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resettingKeys, setResettingKeys] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const [nickname, setNickname] = useState("");
  const [emergencyContact, setEmergencyContact] = useState<string>("");
  const [profilePictureUrl, setProfilePictureUrl] = useState<string>("");
  const [role, setRole] = useState<Role>("musician");

  const [vibe, setVibe] = useState<Role>("musician");
  const [appearance, setAppearance] = useState<"light" | "dark">("dark");
  const [uiLang, setUiLang] = useState<Language>("en");

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
      const lng = localStorage.getItem("nexus-lang");
      if (lng === "en" || lng === "fa" || lng === "ar") {
        setUiLang(lng);
      }
    } catch {
      // Ignore storage errors and keep default.
    }
  }, []);

  // Fetch session and existing profile.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (cancelled) return;

      if (sessionData?.session) {
        setSession(sessionData.session);

        const userId = sessionData.session.user.id;
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select(
            "nickname, emergency_contact, preferred_locale, role, profile_picture_url"
          )
          .eq("id", userId)
          .maybeSingle();

        if (cancelled) return;

        if (profileError && profileError.code !== "PGRST116") {
          // PGRST116 = no rows found
          setError(profileError.message);
        } else if (profile) {
          const typedProfile = profile as Profile;
          setNickname(typedProfile.nickname ?? "");
          setEmergencyContact(typedProfile.emergency_contact ?? "");
          setProfilePictureUrl(typedProfile.profile_picture_url ?? "");
          if (
            typedProfile.preferred_locale === "en" ||
            typedProfile.preferred_locale === "fa" ||
            typedProfile.preferred_locale === "ar"
          ) {
            setUiLang(typedProfile.preferred_locale);
          }
          if (
            typedProfile.role === "therapist" ||
            typedProfile.role === "musician" ||
            typedProfile.role === "responder"
          ) {
            setRole(typedProfile.role);
          }
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
          emergency_contact: emergencyContact.trim() || null,
          preferred_locale: uiLang,
          profile_picture_url: profilePictureUrl.trim() || null,
          role,
        },
        { onConflict: "id" }
      );

      if (upsertError) {
        setError(upsertError.message);
      } else {
        setSuccess("Profile updated successfully.");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update profile. Try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleResetKeys = async () => {
    if (!session || resettingKeys) return;
    const confirmed =
      typeof window !== "undefined"
        ? window.confirm(
            "Reset your encryption keys? This clears local key storage and your uploaded public key."
          )
        : false;
    if (!confirmed) return;

    setResettingKeys(true);
    setError(null);
    setSuccess(null);

    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem(E2E_KEY_STORAGE_KEY);
        localStorage.removeItem("nexus-e2e-keypair");
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .update({ public_key: null })
        .eq("id", session.user.id);

      if (profileError) {
        setError(profileError.message);
      } else {
        setSuccess("Encryption keys reset. Reopen chat to generate and sync a new key.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset keys.");
    } finally {
      setResettingKeys(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!session || deletingAccount) return;
    const ok =
      typeof window !== "undefined"
        ? window.confirm(
            "Permanently delete your account? This removes your profile, all messages, and your login. This cannot be undone."
          )
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
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: theme.pageBg, color: theme.textPrimary }}
    >
      <div
        className="w-full max-w-xl rounded-2xl border shadow-xl backdrop-blur-xl p-6 sm:p-8"
        style={{
          background: theme.panelBg,
          borderColor: theme.border,
        }}
      >
        <div className="flex flex-col gap-4 mb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
              Settings
            </h1>
            <p
              className="text-xs sm:text-sm mt-1"
              style={{ color: theme.textSecondary }}
            >
              Update how Kite knows you.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div
              className="flex items-center gap-2 rounded-xl border px-2 py-1.5"
              style={{ borderColor: theme.border }}
            >
              <span
                className="text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: theme.textSecondary }}
              >
                {t(uiLang, "settingsAppearanceLabel")}
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
                    ? t(uiLang, "settingsThemeLight")
                    : t(uiLang, "settingsThemeDark")
                }
                aria-label={
                  appearance === "dark"
                    ? t(uiLang, "settingsThemeLight")
                    : t(uiLang, "settingsThemeDark")
                }
              >
                {appearance === "dark" ? (
                  <Sun className="h-4 w-4" aria-hidden />
                ) : (
                  <Moon className="h-4 w-4" aria-hidden />
                )}
              </button>
            </div>

            <Link
              href="/chat"
              className="inline-flex items-center rounded-xl px-3 py-2 text-xs sm:text-sm font-medium border transition-colors"
              style={{
                borderColor: theme.border,
                color: theme.textPrimary,
                background: "transparent",
              }}
            >
              ← Back to Chat
            </Link>
          </div>
        </div>

        {loading ? (
          <p
            className="text-sm"
            style={{ color: theme.textSecondary }}
          >
            Loading your profile…
          </p>
        ) : !session ? (
          <p className="text-sm text-red-500">{error ?? "Not authenticated."}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div
              className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderColor: theme.border }}
            >
              <div className="min-w-0 pr-2">
                <label
                  htmlFor="data-saver"
                  className="text-sm font-medium"
                  style={{ color: theme.textPrimary }}
                >
                  {t(uiLang, "settingsDataSaverLabel")}
                </label>
                <p
                  className="mt-1 text-xs"
                  style={{ color: theme.textSecondary }}
                >
                  {t(uiLang, "settingsDataSaverHint")}
                  {isLowBandwidthMode && !manualLowBandwidth ? (
                    <span className="mt-1 block">
                      {t(uiLang, "settingsDataSaverAutoActive")}
                    </span>
                  ) : null}
                </p>
              </div>
              <input
                id="data-saver"
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-orange-500"
                checked={manualLowBandwidth}
                onChange={(e) => setManualLowBandwidth(e.target.checked)}
              />
            </div>

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
              <label
                htmlFor="emergency-contact-number"
                className="text-xs font-medium uppercase tracking-[0.18em]"
              >
                {t(uiLang, "settingsEmergencyNumberLabel")}
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
                {t(uiLang, "settingsEmergencyNumberSubtext")}
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

            <p
              className="text-xs leading-relaxed rounded-xl border px-3 py-2.5"
              style={{
                borderColor: "rgba(255, 69, 0, 0.35)",
                color: theme.textSecondary,
                background: "rgba(255, 69, 0, 0.06)",
              }}
            >
              Resetting keys will generate a new set of End-to-End Encryption (E2EE) keys.{" "}
              <strong className="text-red-400">
                Warning: You will lose access to previous message history encrypted with your old keys.
              </strong>{" "}
              Use only if you suspect your current keys are compromised.
            </p>
            <button
              type="button"
              onClick={handleResetKeys}
              disabled={resettingKeys}
              className="inline-flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold border transition disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                borderColor: theme.border,
                color: theme.textPrimary,
                background: "transparent",
              }}
            >
              {resettingKeys ? "Resetting Keys…" : "Reset Keys"}
            </button>

            <button
              type="button"
              onClick={() => void handleDeleteAccount()}
              disabled={deletingAccount}
              className="inline-flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 disabled:cursor-not-allowed border border-red-500/60 bg-red-950/40 text-red-200 hover:bg-red-950/70"
            >
              {deletingAccount ? "Deleting account…" : "Delete account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

