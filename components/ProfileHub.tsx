"use client";

import { useEffect, useRef, useState, memo } from "react";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { Sun, Moon, AlertTriangle, KeyRound, Smartphone } from "lucide-react";
import { E2eConnectPhoneModal } from "@/components/E2eConnectPhoneModal";
import {
  importPrivateKeyFromBase64,
  wrapPrivateKeyWithPin,
} from "@/lib/crypto";
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
import {
  hasStoredLanguageChoice,
  NEXUS_LANG_CHANGE_EVENT,
  parsePreferredLocale,
  persistClientLanguage,
  readStoredLanguage,
  t,
  type Language,
} from "@/lib/translations";
import { SkeletonProfile } from "@/components/SkeletonProfile";
import {
  readJsonCache,
  settingsProfileCacheKey,
  writeJsonCache,
} from "@/lib/kite-tab-cache";

/** Same storage key as chat (`app/chat/page.tsx`) for the local E2EE keypair. */
const E2E_KEY_STORAGE_KEY = "kite-e2e-v1";
const E2E_KEY_STORAGE_LEGACY = "nexus-e2e-keypair";

type Role = "musician" | "therapist" | "responder";

interface Profile {
  nickname: string | null;
  bio: string | null;
  emergency_contact: string | null;
  role: Role | null;
  profile_picture_url: string | null;
  preferred_locale: string | null;
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
  const [language, setLanguage] = useState<Language>(() => readStoredLanguage());
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [e2eConnectModalOpen, setE2eConnectModalOpen] = useState(false);
  /** True when server has both PIN backup fields populated (same rule as chat restore). */
  const [pinBackupActive, setPinBackupActive] = useState(false);
  const [e2eOverwriteBackupPromptOpen, setE2eOverwriteBackupPromptOpen] =
    useState(false);
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
    const sync = () => setLanguage(readStoredLanguage());
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(NEXUS_LANG_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(NEXUS_LANG_CHANGE_EVENT, sync);
    };
  }, []);

  // Fetch session and existing profile.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setError(null);

      await new Promise<void>((resolve) => {
        if (typeof window !== "undefined" && typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => resolve());
        } else {
          resolve();
        }
      });
      if (cancelled) return;

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
          .select(
            "nickname, bio, emergency_contact, role, profile_picture_url, preferred_locale, encrypted_private_key_backup, key_backup_salt"
          )
          .eq("id", userId)
          .maybeSingle();

        if (cancelled) return;

        if (profileError && profileError.code !== "PGRST116") {
          // PGRST116 = no rows found
          setError(profileError.message);
          setPinBackupActive(false);
        } else if (profile) {
          const row = profile as Profile & {
            encrypted_private_key_backup?: unknown;
            key_backup_salt?: unknown;
          };
          const encRaw =
            typeof row.encrypted_private_key_backup === "string"
              ? row.encrypted_private_key_backup.trim()
              : "";
          const saltRaw =
            typeof row.key_backup_salt === "string"
              ? row.key_backup_salt.trim()
              : "";
          setPinBackupActive(Boolean(encRaw && saltRaw));

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
          const plFromServer = parsePreferredLocale(typedProfile.preferred_locale ?? null);
          if (plFromServer && !hasStoredLanguageChoice()) {
            setLanguage(plFromServer);
            persistClientLanguage(plFromServer);
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
        } else {
          setPinBackupActive(false);
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
        setPinBackupActive(false);
        setError(t(readStoredLanguage(), "profileMustLoginSettings"));
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
          setError(t(language, "profileNicknameTaken"));
          setSaving(false);
          return;
        }
      }

      const { data, error: upsertError } = await supabase
        .from("profiles")
        .upsert(
          {
            id: session.user.id,
            nickname: trimmedNickname || null,
            bio: bio.trim() || null,
            emergency_contact: emergencyContact.trim() || null,
            profile_picture_url: profilePictureUrl.trim() || null,
            role,
            preferred_locale: language,
          },
          { onConflict: "id" }
        )
        .select();

      if (upsertError || !data || data.length === 0) {
        console.error("[Kite] Profile save silent failure:", {
          upsertError,
          rowsReturned: data?.length ?? 0,
        });
        setError(
          upsertError?.message ??
            "Save failed: Session blocked. Please log out and log back in."
        );
        return;
      }

      setSuccess(t(language, "profileUpdatedSuccess"));
      writeJsonCache(settingsProfileCacheKey(session.user.id), {
        nickname: trimmedNickname,
        bio: bio.trim(),
        emergencyContact: emergencyContact.trim(),
        profilePictureUrl: profilePictureUrl.trim(),
        role,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t(language, "profileUpdateFailedGeneric")
      );
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (file: File) => {
    if (!session) return;
    if (!file.type.startsWith("image/")) {
      setError(t(language, "profileChooseImageFile"));
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
        setError(t(language, "profileCouldNotGenerateImageUrl"));
        return;
      }
      setProfilePictureUrl(data.publicUrl);
      setSuccess(t(language, "profilePictureUpdatedSuccess"));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t(language, "profileUploadPictureFailed")
      );
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!session || deletingAccount) return;
    const ok =
      typeof window !== "undefined"
        ? window.confirm(t(language, "profileDeleteAccountConfirm"))
        : false;
    if (!ok) return;

    setDeletingAccount(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? t(language, "profileCouldNotDeleteAccount"));
        return;
      }
      if (typeof window !== "undefined") {
        window.location.href = "/";
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t(language, "profileDeleteFailed"));
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleE2ePinBackupConfirm = async (pin: string) => {
    if (!session) {
      throw new Error(t(language, "profileNotAuthenticated"));
    }
    let stored: string | null = null;
    try {
      stored =
        localStorage.getItem(E2E_KEY_STORAGE_KEY) ??
        localStorage.getItem(E2E_KEY_STORAGE_LEGACY);
    } catch {
      throw new Error(t(language, "e2ePinVaultErrorNoLocalKeys"));
    }
    if (!stored) {
      throw new Error(t(language, "e2ePinVaultErrorNoLocalKeys"));
    }
    let parsed: { privateKeyBase64?: unknown };
    try {
      parsed = JSON.parse(stored) as { privateKeyBase64?: unknown };
    } catch {
      throw new Error(t(language, "e2ePinVaultErrorGeneric"));
    }
    if (typeof parsed.privateKeyBase64 !== "string" || !parsed.privateKeyBase64.trim()) {
      throw new Error(t(language, "e2ePinVaultErrorNoLocalKeys"));
    }
    let privateKey: CryptoKey;
    try {
      privateKey = await importPrivateKeyFromBase64(parsed.privateKeyBase64);
    } catch {
      throw new Error(t(language, "e2ePinVaultErrorGeneric"));
    }
    const wrapped = await wrapPrivateKeyWithPin(privateKey, pin);
    const { error } = await supabase
      .from("profiles")
      .update({
        key_backup_salt: wrapped.saltBase64,
        encrypted_private_key_backup: wrapped.encryptedPrivateKeyBackupBase64,
      })
      .eq("id", session.user.id);
    if (error) {
      throw new Error(t(language, "e2ePinVaultErrorUploadFailed"));
    }
    setPinBackupActive(true);
    setError(null);
    setSuccess(t(language, "e2ePinVaultSuccess"));
  };

  const requestOpenE2eConnectModal = () => {
    if (pinBackupActive) {
      setE2eOverwriteBackupPromptOpen(true);
    } else {
      setE2eConnectModalOpen(true);
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
          language={language}
          variant="compact"
          className="mb-5"
        />

        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t(language, "profileHubTitle")}
          </h1>
          <p
            className="mt-1 text-xs sm:text-sm"
            style={{ color: theme.textSecondary }}
          >
            {t(language, "profileHubSubtitle")}
          </p>
        </div>

        {loading ? (
          <SkeletonProfile />
        ) : !session ? (
          <p className="text-sm text-red-500">
            {error ?? t(language, "profileNotAuthenticated")}
          </p>
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
                    alt={t(language, "profileYourAvatarAlt")}
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
                {avatarUploading
                  ? t(language, "profileUploadingPhoto")
                  : t(language, "profileUploadPhoto")}
              </button>
              <div className="mt-4 w-full">
                <div
                  className="text-xs uppercase tracking-[0.18em] font-medium"
                  style={{ color: theme.textSecondary }}
                >
                  {t(language, "profileCardYourProfile")}
                </div>
                <div className="mt-1 text-xl font-semibold" style={{ color: theme.textPrimary }}>
                  {nickname.trim() ? nickname.trim() : t(language, "profileCardNamePlaceholder")}
                </div>
                <div className="mx-auto mt-2 max-w-lg text-sm" style={{ color: theme.textSecondary, lineHeight: 1.5 }}>
                  {bio.trim() ? bio.trim() : t(language, "profileCardBioPlaceholder")}
                </div>
              </div>
              </div>
            </section>

            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-[0.18em]">
                {t(language, "profileNicknameLabel")}
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t(language, "profileNicknamePlaceholder")}
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
                {t(language, "profileBioLabel")}
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder={t(language, "profileBioPlaceholder")}
                className="w-full min-h-[96px] rounded-xl px-3 py-2.5 text-sm outline-none border resize-none"
                style={{
                  background: theme.inputBg,
                  borderColor: theme.border,
                  color: theme.textPrimary,
                }}
              />
            </div>

            <section
              className="rounded-2xl border p-4 sm:p-5"
              style={{ borderColor: theme.border }}
              aria-labelledby="security-heading"
            >
              <div className="mb-4 flex items-center gap-2">
                <KeyRound
                  className="h-4 w-4 shrink-0 text-emerald-500"
                  aria-hidden
                />
                <h2
                  id="security-heading"
                  className="text-sm font-semibold uppercase tracking-[0.16em]"
                  style={{ color: theme.textPrimary }}
                >
                  Security
                </h2>
              </div>
              <p className="mb-4 text-xs" style={{ color: theme.textSecondary }}>
                Choose a strong password. You’ll stay signed in on this device after updating.
              </p>
              <div className="mb-6 space-y-3">
                {pinBackupActive ? (
                  <p
                    className="flex items-center gap-2 text-xs font-medium"
                    style={{ color: theme.textSecondary }}
                  >
                    <span
                      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider"
                      style={{
                        background: "rgba(16, 185, 129, 0.18)",
                        color: "rgb(5, 150, 105)",
                      }}
                    >
                      {t(language, "e2eProfileBackupActiveLabel")}
                    </span>
                  </p>
                ) : null}
                {e2eOverwriteBackupPromptOpen ? (
                  <div
                    className="rounded-xl border p-4 space-y-3"
                    style={{ borderColor: theme.border, background: theme.inputBg }}
                    role="region"
                    aria-labelledby="e2e-overwrite-backup-title"
                  >
                    <p
                      id="e2e-overwrite-backup-title"
                      className="text-sm font-semibold"
                      style={{ color: theme.textPrimary }}
                    >
                      {t(language, "e2eProfileOverwriteBackupTitle")}
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: theme.textSecondary }}>
                      {t(language, "e2eProfileOverwriteBackupBody")}
                    </p>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <button
                        type="button"
                        onClick={() => setE2eOverwriteBackupPromptOpen(false)}
                        className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold border sm:w-auto"
                        style={{
                          borderColor: theme.border,
                          color: theme.textSecondary,
                        }}
                      >
                        {t(language, "e2eProfileOverwriteCancel")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setE2eOverwriteBackupPromptOpen(false);
                          setE2eConnectModalOpen(true);
                        }}
                        className="w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white sm:w-auto"
                        style={{ background: theme.accent }}
                      >
                        {t(language, "e2eProfileOverwriteConfirm")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={requestOpenE2eConnectModal}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition hover:opacity-95 active:scale-[0.99]"
                    style={{
                      borderColor: theme.border,
                      background: theme.inputBg,
                      color: theme.textPrimary,
                    }}
                    aria-label={t(language, "e2ePinVaultConnectAria")}
                  >
                    <Smartphone className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                    {t(language, "e2eSyncDevicesButton")}
                  </button>
                )}
              </div>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="profile-new-password"
                    className="text-xs font-medium uppercase tracking-[0.18em]"
                  >
                    New Password
                  </label>
                  <input
                    id="profile-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      setPasswordError(null);
                      setPasswordSuccess(null);
                    }}
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
                    htmlFor="profile-confirm-password"
                    className="text-xs font-medium uppercase tracking-[0.18em]"
                  >
                    Confirm Password
                  </label>
                  <input
                    id="profile-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setPasswordError(null);
                      setPasswordSuccess(null);
                    }}
                    className="w-full rounded-xl px-3 py-2.5 text-sm outline-none border"
                    style={{
                      background: theme.inputBg,
                      borderColor: theme.border,
                      color: theme.textPrimary,
                    }}
                  />
                </div>
                {passwordError ? (
                  <div className="rounded-xl border border-red-400/70 bg-red-500/5 px-3 py-2 text-xs text-red-600">
                    {passwordError}
                  </div>
                ) : null}
                {passwordSuccess && !passwordError ? (
                  <div className="rounded-xl border border-emerald-400/70 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700">
                    {passwordSuccess}
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={passwordSaving}
                  onClick={async () => {
                    setPasswordError(null);
                    setPasswordSuccess(null);
                    if (newPassword.length < 8) {
                      setPasswordError("Password must be at least 8 characters.");
                      return;
                    }
                    if (newPassword !== confirmPassword) {
                      setPasswordError("Passwords do not match.");
                      return;
                    }
                    setPasswordSaving(true);
                    try {
                      const { error: updateErr } = await supabase.auth.updateUser({
                        password: newPassword,
                      });
                      if (updateErr) {
                        setPasswordError(updateErr.message);
                      } else {
                        setPasswordSuccess("Your password was updated successfully.");
                        setNewPassword("");
                        setConfirmPassword("");
                      }
                    } catch (err) {
                      setPasswordError(
                        err instanceof Error ? err.message : "Could not update password."
                      );
                    } finally {
                      setPasswordSaving(false);
                    }
                  }}
                  className="inline-flex w-full items-center justify-center rounded-xl border border-stone-600/80 bg-stone-900/40 px-4 py-2.5 text-sm font-semibold text-stone-100 shadow-sm transition hover:border-emerald-500/50 hover:bg-stone-800/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {passwordSaving ? "Updating…" : "Update password"}
                </button>
              </div>
            </section>

            <section className="rounded-2xl border p-4 sm:p-5" style={{ borderColor: theme.border }}>
              <div className="mb-4">
                <h2 className="text-sm font-semibold uppercase tracking-[0.16em]" style={{ color: theme.textPrimary }}>
                  {t(language, "profilePreferencesTitle")}
                </h2>
                <p className="mt-1 text-xs" style={{ color: theme.textSecondary }}>
                  {t(language, "profilePreferencesSubtitle")}
                </p>
              </div>

              <div
                className="mb-4 flex items-center justify-between rounded-xl border px-3 py-2"
                style={{ borderColor: theme.border }}
              >
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.textSecondary }}>
                  {t(language, "appearance")}
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
                      ? t(language, "profileSwitchToLightMode")
                      : t(language, "profileSwitchToDarkMode")
                  }
                  aria-label={
                    appearance === "dark"
                      ? t(language, "profileSwitchToLightMode")
                      : t(language, "profileSwitchToDarkMode")
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
                  {t(language, "profileNotificationsLabel")}
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
                  {notificationsMuted
                    ? t(language, "sidebarNotificationsEnable")
                    : t(language, "sidebarNotificationsDisable")}
                </button>
              </div>

              <div
                className="mb-4 flex items-center justify-between rounded-xl border px-3 py-2"
                style={{ borderColor: theme.border }}
              >
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: theme.textSecondary }}>
                  {t(language, "language")}
                </span>
                <LanguageDropdown
                  value={language}
                  onChange={(next) => {
                    setLanguage(next);
                    persistClientLanguage(next);
                    void (async () => {
                      const { data } = await supabase.auth.getSession();
                      const uid = data?.session?.user?.id;
                      if (!uid) return;
                      await supabase
                        .from("profiles")
                        .update({ preferred_locale: next })
                        .eq("id", uid);
                    })();
                  }}
                  compact
                />
              </div>
            </section>

            <section className="rounded-2xl border p-4 sm:p-5" style={{ borderColor: theme.border }}>
              <div className="mb-4">
                <h2 className="text-sm font-semibold uppercase tracking-[0.16em]" style={{ color: theme.textPrimary }}>
                  {t(language, "profileContactSectionTitle")}
                </h2>
                <p className="mt-1 text-xs" style={{ color: theme.textSecondary }}>
                  {t(language, "profileContactSectionSubtitle")}
                </p>
              </div>

            <div className="space-y-1.5">
              <label
                htmlFor="emergency-contact-number"
                className="text-xs font-medium uppercase tracking-[0.18em]"
              >
                {t(language, "settingsEmergencyNumberLabel")}
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
                {t(language, "profileEmergencyContactHint")}
              </p>
            </div>

            {SHOW_PROFESSIONAL_AND_ROLE_UI && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-[0.18em]">
                  {t(language, "profileRoleLabel")}
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
                    {t(language, "roleMusician")}
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
                    {t(language, "roleTherapist")}
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
                    {t(language, "roleResponder")}
                  </button>
                </div>
                <p
                  className="text-xs"
                  style={{ color: theme.textSecondary }}
                >
                  {t(language, "profileRolePersonalizeHint")}
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
              {saving
                ? t(language, "profileSavingChanges")
                : t(language, "profileSaveChanges")}
            </button>

            <button
              type="button"
              onClick={async () => {
                await supabase.auth.signOut();
                if (typeof window !== "undefined") {
                  window.location.href = "/";
                }
              }}
              className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-red-600/90 border border-red-500/80 hover:bg-red-600 transition-colors"
            >
              {t(language, "profileLogOut")}
            </button>

            <button
              type="button"
              onClick={() => void handleDeleteAccount()}
              disabled={deletingAccount}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white bg-red-700 border border-red-600 hover:brightness-110 active:scale-95 transition-transform disabled:cursor-not-allowed"
            >
              <AlertTriangle className="h-4 w-4" aria-hidden />
              {deletingAccount
                ? t(language, "profileDeletingAccount")
                : t(language, "profileDeleteAccount")}
            </button>
          </form>
        )}
      </div>
      {avatarLightboxOpen && profilePictureUrl ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setAvatarLightboxOpen(false)}
          role="dialog"
          aria-label={t(language, "chatProfileImagePreviewAria")}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={profilePictureUrl}
            alt={t(language, "profileProfilePreviewAlt")}
            className="max-h-[90vh] max-w-[95vw] rounded-2xl object-contain"
          />
        </div>
      ) : null}
      <E2eConnectPhoneModal
        open={e2eConnectModalOpen && Boolean(session)}
        onOpenChange={(open) => {
          setE2eConnectModalOpen(open);
          if (!open) setE2eOverwriteBackupPromptOpen(false);
        }}
        language={language}
        theme={{
          panelBg: theme.panelBg,
          border: theme.border,
          accent: theme.accent,
          textPrimary: theme.textPrimary,
          textSecondary: theme.textSecondary,
          inputBg: theme.inputBg,
        }}
        onConfirm={handleE2ePinBackupConfirm}
      />
    </div>
  );
});
