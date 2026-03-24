/** Label shown in lists/headers: local alias wins over public profile nickname. */
export function contactDisplayLabel(
  publicNickname: string | null | undefined,
  localAlias: string | null | undefined,
  anonymousLabel: string
): string {
  const a = localAlias?.trim();
  if (a) return a;
  const n = publicNickname?.trim();
  if (n) return n;
  return anonymousLabel;
}
