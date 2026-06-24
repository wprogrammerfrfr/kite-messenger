export type IceCandidateRow = {
  id: string;
  from: "host" | "peer";
  candidate: unknown;
};

export function filterNewRemoteIceCandidates(
  incoming: IceCandidateRow[] | null | undefined,
  myRole: "host" | "peer",
  seenIds: Set<string>
): IceCandidateRow[] {
  if (!Array.isArray(incoming)) return [];
  const result: IceCandidateRow[] = [];
  for (const item of incoming) {
    if (!item || typeof item !== "object") continue;
    if (item.from === myRole) continue;
    if (!item.id || seenIds.has(item.id)) continue;
    if (!item.candidate || typeof item.candidate !== "object") continue;
    result.push(item);
  }
  return result;
}

export function isSignalCandidate(signalData: unknown): boolean {
  if (!signalData || typeof signalData !== "object") return false;
  return Boolean((signalData as { candidate?: unknown }).candidate);
}

export function isSignalOffer(signalData: unknown): boolean {
  if (!signalData || typeof signalData !== "object") return false;
  return (signalData as { type?: unknown }).type === "offer";
}

export function isSignalAnswer(signalData: unknown): boolean {
  if (!signalData || typeof signalData !== "object") return false;
  return (signalData as { type?: unknown }).type === "answer";
}
