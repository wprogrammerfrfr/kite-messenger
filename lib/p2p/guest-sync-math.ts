export type GuestTargetInput = {
  hostTimeSec: number;
  serverTimestampMs: number;
  receivedAtMs: number;
  calculatedDelayMs: number | null;
  targetLeadFrames: number;
  sampleRate: number;
};

/** hostTime + clockOffset + rttDelay + bufferDelay — exact page formula. */
export function computeGuestTargetSec(input: GuestTargetInput): number {
  const rttDelaySec = (input.calculatedDelayMs || 0) / 1000;
  const offsetSec = (input.receivedAtMs - input.serverTimestampMs) / 1000;
  const bufferDelaySec = input.targetLeadFrames / input.sampleRate;
  return input.hostTimeSec + offsetSec + rttDelaySec + bufferDelaySec;
}

export type GridSnapInput = {
  guestTargetSec: number;
  ctxCurrentTimeSec: number;
  bpm: number;
};

/** Snap forward on 16th-note grid if target is in the past. */
export function snapGuestTargetToGrid(input: GridSnapInput): number {
  const sixteenthSec = 60 / input.bpm / 4;
  let nextGridSec = input.guestTargetSec;
  if (
    Number.isFinite(sixteenthSec) &&
    sixteenthSec > 0 &&
    input.guestTargetSec < input.ctxCurrentTimeSec
  ) {
    nextGridSec =
      input.guestTargetSec +
      Math.ceil((input.ctxCurrentTimeSec - input.guestTargetSec) / sixteenthSec) *
        sixteenthSec;
  }
  return nextGridSec;
}

/** One-bar count-in duration for metronome mute window. */
export function computeCountInOneBarSec(bpm: number, beatsPerBar: number): number {
  return (60 / bpm) * beatsPerBar;
}
