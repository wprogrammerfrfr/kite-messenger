/** Compare auth/DB/realtime user ids (UUIDs may differ by case or formatting). */
export function isSameUserId(a: unknown, b: unknown): boolean {
  if (a == null || b == null) {
    console.log("[Kite Debug] ID Check:", { a, b, match: false });
    return false;
  }
  const result =
    String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  console.log("[Kite Debug] ID Check:", { a, b, match: result });
  return result;
}
