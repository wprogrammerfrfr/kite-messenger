export type ShareOrDownloadResult = "shared" | "downloaded" | "cancelled" | "failed";

/**
 * Prefer native share sheet on mobile; fall back to programmatic download.
 */
export async function shareOrDownloadBlob(
  blob: Blob,
  filename: string
): Promise<ShareOrDownloadResult> {
  if (typeof window === "undefined") return "failed";

  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title: filename });
      return "shared";
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "AbortError") return "cancelled";
    }
  }

  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return "downloaded";
  } catch {
    return "failed";
  }
}

export async function shareOrCopyText(text: string, title = "Share"): Promise<boolean> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, text, url: text.startsWith("http") ? text : undefined });
      return true;
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "AbortError") return false;
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
