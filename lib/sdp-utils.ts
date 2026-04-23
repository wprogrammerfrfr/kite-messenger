export type ForceMusicModeOpusOptions = {
  isSafariWebKit?: boolean;
};

/**
 * Remove any stereo-related fmtp keys, then append mono/stereo-off params (Safari-only caller).
 */
function applySafariOpusStereoOffToFmtpParams(fmtpParams: string): string {
  const parts = fmtpParams
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const filtered = parts.filter((p) => {
    const key = p.split("=")[0]?.trim().toLowerCase();
    return key !== "stereo" && key !== "sprop-stereo";
  });
  filtered.push("stereo=0", "sprop-stereo=0");
  return filtered.join(";");
}

/**
 * Remove any stereo-related fmtp keys, then append stereo-on params for music mode.
 */
function applyOpusStereoOnToFmtpParams(fmtpParams: string): string {
  const parts = fmtpParams
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const filtered = parts.filter((p) => {
    const key = p.split("=")[0]?.trim().toLowerCase();
    return key !== "stereo" && key !== "sprop-stereo";
  });
  filtered.push("stereo=1", "sprop-stereo=1");
  return filtered.join(";");
}

export function forceMusicModeOpus(
  sdp: string,
  options?: ForceMusicModeOpusOptions
): string {
  try {
    const rtpMatch = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000(?:\/\d+)?/i);
    if (!rtpMatch) return sdp;

    const id = rtpMatch[1];
    const fmtpRegex = new RegExp(`(a=fmtp:${id} )([^\\r\\n]*)`, "i");
    const fmtpMatch = sdp.match(fmtpRegex);
    const safariStereo = Boolean(options?.isSafariWebKit);

    if (fmtpMatch) {
      const existingParams = fmtpMatch[2];

      // Replace useinbandfec value directly in the string
      let updated = existingParams.replace(/useinbandfec=\d/i, "useinbandfec=1");

      // Add maxaveragebitrate if not present
      if (!/maxaveragebitrate/i.test(updated)) {
        updated += ";maxaveragebitrate=510000";
      }

      if (!/maxplaybackrate/i.test(updated)) {
        updated += ";maxplaybackrate=48000";
      }

      if (/usedtx=/i.test(updated)) {
        updated = updated.replace(/usedtx=\d+/i, "usedtx=0");
      } else {
        updated += ";usedtx=0";
      }

      updated = safariStereo
        ? applySafariOpusStereoOffToFmtpParams(updated)
        : applyOpusStereoOnToFmtpParams(updated);

      return sdp.replace(fmtpMatch[0], fmtpMatch[1] + updated);
    }

    // No fmtp line exists — insert one after rtpmap line
    const rtpLine = sdp.match(new RegExp(`a=rtpmap:${id}[^\\r\\n]*\\r?\\n`, "i"))?.[0];
    if (!rtpLine) return sdp;
    let newLine =
      `a=fmtp:${id} useinbandfec=1;maxaveragebitrate=510000;maxplaybackrate=48000;usedtx=0`;
    newLine += safariStereo ? ";stereo=0;sprop-stereo=0" : ";stereo=1;sprop-stereo=1";
    newLine += "\r\n";
    return sdp.replace(rtpLine, rtpLine + newLine);
  } catch (error) {
    console.warn("[Kite] SDP modification failed:", error);
    return sdp;
  }
}
