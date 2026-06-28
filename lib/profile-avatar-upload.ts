import {
  readJsonCache,
  settingsProfileCacheKey,
  writeJsonCache,
} from "@/lib/kite-tab-cache";
import { supabase } from "@/lib/supabase";

const AVATAR_BUCKET = "avatars";

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
};

export class ProfileAvatarUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileAvatarUploadError";
  }
}

function isHeicFile(file: File): boolean {
  return (
    /\.heic$/i.test(file.name) ||
    /\.heif$/i.test(file.name) ||
    file.type === "image/heic" ||
    file.type === "image/heif"
  );
}

async function convertHeicToJpeg(file: File): Promise<File> {
  if (typeof window === "undefined") {
    throw new ProfileAvatarUploadError("HEIC conversion requires a browser.");
  }

  const heic2any = (await import("heic2any")).default;
  const convertedBlob = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: 0.8,
  });

  const jpegBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
  const jpegName = file.name.replace(/\.hei[cf]$/i, ".jpg");

  return new File([jpegBlob], jpegName, { type: "image/jpeg" });
}

export function resolveImageContentType(file: File): string {
  if (file.type.startsWith("image/")) {
    return file.type;
  }

  const ext =
    file.name.includes(".") ? (file.name.split(".").pop()?.toLowerCase() ?? "") : "";
  const inferred = EXT_TO_MIME[ext];
  if (inferred) {
    return inferred;
  }

  throw new ProfileAvatarUploadError("Please choose an image file.");
}

async function persistProfilePictureUrl(
  userId: string,
  publicUrl: string
): Promise<void> {
  try {
    const { data, error: updateError } = await supabase
      .from("profiles")
      .update({ profile_picture_url: publicUrl })
      .eq("id", userId)
      .select("id");

    if (updateError) {
      console.error("DB Avatar Persist Error:", updateError);
      return;
    }

    if (data && data.length > 0) {
      return;
    }

    const { error: upsertError } = await supabase.from("profiles").upsert(
      { id: userId, profile_picture_url: publicUrl },
      { onConflict: "id" }
    );

    if (upsertError) {
      console.error("DB Avatar Persist Error:", upsertError);
    }
  } catch (err) {
    console.error("DB Avatar Persist Error:", err);
  }
}

export async function uploadProfileAvatar(
  userId: string,
  file: File
): Promise<{ publicUrl: string }> {
  if (isHeicFile(file)) {
    file = await convertHeicToJpeg(file);
  }

  const contentType = resolveImageContentType(file);

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const path = `${userId}/profile-${Date.now()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      contentType,
    });

  if (uploadError) {
    throw new ProfileAvatarUploadError(uploadError.message);
  }

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const publicUrl = data?.publicUrl?.trim();
  if (!publicUrl) {
    throw new ProfileAvatarUploadError("Could not generate image URL.");
  }

  await persistProfilePictureUrl(userId, publicUrl);

  const cacheKey = settingsProfileCacheKey(userId);
  const existing = readJsonCache<Record<string, unknown>>(cacheKey) ?? {};
  writeJsonCache(cacheKey, {
    ...existing,
    profilePictureUrl: publicUrl,
  });

  return { publicUrl };
}

export async function removeProfileAvatar(userId: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ profile_picture_url: null })
    .eq("id", userId);

  if (error) {
    throw new ProfileAvatarUploadError(error.message);
  }

  const cacheKey = settingsProfileCacheKey(userId);
  const existing = readJsonCache<Record<string, unknown>>(cacheKey) ?? {};
  writeJsonCache(cacheKey, {
    ...existing,
    profilePictureUrl: null,
  });
}
