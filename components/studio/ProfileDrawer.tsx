"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Camera,
  Check,
  Globe,
  Loader2,
  Lock,
  LogOut,
  X,
} from "lucide-react";
import {
  ProfileAvatarUploadError,
  removeProfileAvatar,
  uploadProfileAvatar,
} from "@/lib/profile-avatar-upload";
import { supabase } from "@/lib/supabase";

export type StudioProfile = {
  nickname: string;
  email: string;
  bio: string;
  profilePictureUrl?: string | null;
};

export type ProfileDrawerProps = {
  open: boolean;
  onClose: () => void;
  profile: StudioProfile;
  userId: string;
  onSignOut: () => void | Promise<void>;
  onProfilePictureUpdated?: (url: string | null) => void;
};

type DrawerTab = "profile" | "prefs" | "security";

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="block text-xs font-medium uppercase tracking-widest text-zinc-500 mb-2">
      {children}
    </label>
  );
}

function DrawerTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
        active
          ? "bg-emerald-500/10 text-emerald-400"
          : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

export function ProfileDrawer({
  open,
  onClose,
  profile,
  userId,
  onSignOut,
  onProfilePictureUpdated,
}: ProfileDrawerProps) {
  const [tab, setTab] = useState<DrawerTab>("profile");
  const [nickname, setNickname] = useState(profile.nickname);
  const [bio, setBio] = useState(profile.bio);
  const [profilePictureUrl, setProfilePictureUrl] = useState(
    profile.profilePictureUrl ?? ""
  );
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarRemoving, setAvatarRemoving] = useState(false);
  const [avatarNote, setAvatarNote] = useState("");
  const [avatarNoteKind, setAvatarNoteKind] = useState<"success" | "error">(
    "success"
  );
  const [language, setLanguage] = useState("en");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const [saving, setSaving] = useState(false);
  const flashTimeoutRef = useRef<number | null>(null);
  const avatarFlashTimeoutRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickingFileRef = useRef(false);

  useEffect(() => {
    setNickname(profile.nickname);
    setBio(profile.bio);
    setProfilePictureUrl(profile.profilePictureUrl ?? "");
  }, [profile.nickname, profile.bio, profile.profilePictureUrl]);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current !== null) {
        window.clearTimeout(flashTimeoutRef.current);
      }
      if (avatarFlashTimeoutRef.current !== null) {
        window.clearTimeout(avatarFlashTimeoutRef.current);
      }
    };
  }, []);

  const flashSaved = (msg: string) => {
    setSavedNote(msg);
    if (flashTimeoutRef.current !== null) {
      window.clearTimeout(flashTimeoutRef.current);
    }
    flashTimeoutRef.current = window.setTimeout(() => setSavedNote(""), 2200);
  };

  const flashAvatar = (msg: string, kind: "success" | "error") => {
    setAvatarNote(msg);
    setAvatarNoteKind(kind);
    if (avatarFlashTimeoutRef.current !== null) {
      window.clearTimeout(avatarFlashTimeoutRef.current);
    }
    avatarFlashTimeoutRef.current = window.setTimeout(() => setAvatarNote(""), 3200);
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          nickname: nickname.trim() || null,
          bio: bio.trim() || null,
        })
        .eq("id", userId);

      if (error) {
        flashSaved("Could not save profile");
        return;
      }
      flashSaved("Profile saved");
    } catch {
      flashSaved("Could not save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    const trimmed = newPw.trim();
    if (!trimmed) return;

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: trimmed });
      if (error) {
        flashSaved(error.message);
        return;
      }
      setCurrentPw("");
      setNewPw("");
      flashSaved("Password updated");
    } catch {
      flashSaved("Could not update password");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!profilePictureUrl || avatarRemoving || avatarUploading) return;
    setAvatarRemoving(true);
    setAvatarNote("");
    try {
      await removeProfileAvatar(userId);
      setProfilePictureUrl("");
      onProfilePictureUpdated?.(null);
      flashAvatar("Profile picture removed", "success");
    } catch (err) {
      const message =
        err instanceof ProfileAvatarUploadError
          ? err.message
          : "Could not remove photo";
      flashAvatar(message, "error");
    } finally {
      setAvatarRemoving(false);
    }
  };

  const handleAvatarUpload = async (file: File) => {
    setAvatarUploading(true);
    setAvatarNote("");
    try {
      const { publicUrl } = await uploadProfileAvatar(userId, file);
      setProfilePictureUrl(publicUrl);
      onProfilePictureUpdated?.(publicUrl);
      flashAvatar("Profile picture updated", "success");
    } catch (err) {
      const message =
        err instanceof ProfileAvatarUploadError
          ? err.message
          : "Could not upload photo";
      flashAvatar(message, "error");
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleBackdropClose = () => {
    if (pickingFileRef.current) return;
    onClose();
  };

  return (
    <>
      <div
        onClick={handleBackdropClose}
        className={`fixed inset-0 z-40 bg-zinc-950/70 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden={!open}
      />

      <aside
        role="dialog"
        aria-label="Profile and settings"
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-zinc-700/50 bg-zinc-900/95 shadow-xl backdrop-blur-md transition-transform duration-300 ease-out sm:w-96 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="h-1 w-full bg-gradient-to-r from-orange-500 via-zinc-700 to-emerald-500" />

        <div className="flex items-center justify-between border-b border-zinc-700/50 px-6 py-5">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-300">
            Your profile
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            aria-label="Close profile"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-3 border-b border-zinc-700/50 px-6 py-6">
          <div className="relative">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-orange-500 to-emerald-500 text-xl font-semibold text-zinc-950">
              {profilePictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profilePictureUrl}
                  alt="Your avatar"
                  className="h-full w-full object-cover"
                />
              ) : (
                nickname.slice(0, 2).toUpperCase()
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const target = e.currentTarget;
                const file = target.files?.[0];
                void (async () => {
                  try {
                    if (file) await handleAvatarUpload(file);
                  } finally {
                    pickingFileRef.current = false;
                    target.value = "";
                  }
                })();
              }}
            />
            <button
              type="button"
              disabled={avatarUploading || avatarRemoving}
              className="absolute bottom-0 right-0 rounded-full border border-zinc-700/50 bg-zinc-800 p-1.5 text-zinc-300 hover:text-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60"
              aria-label="Change avatar"
              onClick={() => {
                pickingFileRef.current = true;
                fileInputRef.current?.click();
              }}
            >
              {avatarUploading || avatarRemoving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-100">{nickname || "Unnamed"}</p>
            <p className="text-xs text-zinc-500">{profile.email}</p>
            {(avatarUploading || avatarRemoving) && (
              <p className="mt-2 text-xs text-zinc-400">
                {avatarUploading ? "Uploading photo…" : "Removing photo…"}
              </p>
            )}
            {!avatarUploading && !avatarRemoving && avatarNote && (
              <p
                className={`mt-2 text-xs font-medium ${
                  avatarNoteKind === "error" ? "text-red-400" : "text-emerald-400"
                }`}
                role="status"
              >
                {avatarNote}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-1 px-6 pt-4">
          <DrawerTabButton active={tab === "profile"} onClick={() => setTab("profile")}>
            Profile
          </DrawerTabButton>
          <DrawerTabButton active={tab === "prefs"} onClick={() => setTab("prefs")}>
            Preferences
          </DrawerTabButton>
          <DrawerTabButton active={tab === "security"} onClick={() => setTab("security")}>
            Security
          </DrawerTabButton>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "profile" && (
            <div className="space-y-5">
              <div>
                <FieldLabel>Nickname</FieldLabel>
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  placeholder="What should we call you?"
                />
              </div>
              <div>
                <FieldLabel>Bio</FieldLabel>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-zinc-700/50 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  placeholder="A line about how you play."
                />
              </div>
              <button
                onClick={() => void handleSaveProfile()}
                disabled={saving}
                className="w-full rounded-lg bg-emerald-500 py-2 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-400 disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              >
                Save changes
              </button>
            </div>
          )}

          {tab === "prefs" && (
            <div className="space-y-6">
              {profilePictureUrl ? (
                <div>
                  <FieldLabel>Profile picture</FieldLabel>
                  <button
                    type="button"
                    onClick={() => void handleRemoveAvatar()}
                    disabled={avatarRemoving || avatarUploading}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 py-2 text-sm font-medium text-red-400 transition-colors hover:border-red-500/50 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                  >
                    {avatarRemoving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Remove profile picture
                  </button>
                  <p className="mt-2 text-xs text-zinc-500">
                    Reverts to your initials avatar across Kite Studio.
                  </p>
                </div>
              ) : null}
              <div>
                <FieldLabel>Language</FieldLabel>
                <div className="relative">
                  <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-zinc-700/50 bg-zinc-800/50 py-2 pl-9 pr-3 text-sm text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  >
                    <option value="en">English</option>
                    <option value="tr">Türkçe</option>
                    <option value="es">Español</option>
                    <option value="de">Deutsch</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {tab === "security" && (
            <div className="space-y-5">
              <div>
                <FieldLabel>Current password</FieldLabel>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700/50 bg-zinc-800/50 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <div>
                <FieldLabel>New password</FieldLabel>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <input
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700/50 bg-zinc-800/50 py-2 pl-9 pr-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <button
                onClick={() => void handleChangePassword()}
                disabled={!currentPw || !newPw || saving}
                className="w-full rounded-lg bg-zinc-800 py-2 text-sm font-semibold text-zinc-100 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                Update password
              </button>
            </div>
          )}

          <div
            className={`mt-4 flex items-center gap-2 text-sm text-emerald-400 transition-opacity ${
              savedNote ? "opacity-100" : "opacity-0"
            }`}
          >
            <Check className="h-4 w-4" />
            {savedNote || "placeholder"}
          </div>
        </div>

        <div className="border-t border-zinc-700/50 px-6 py-4">
          <button
            onClick={onSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700/50 py-2 text-sm font-medium text-zinc-400 transition-colors hover:border-red-500/30 hover:text-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  );
}
