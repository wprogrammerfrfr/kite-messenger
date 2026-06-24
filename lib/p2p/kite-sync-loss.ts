/** Pause Kite metronome when inbound loss exceeds this; resume only after hysteresis. */
export const KITE_SYNC_LOSS_PAUSE_PCT = 5;
export const KITE_SYNC_LOSS_RESUME_PCT = 3;
/** With 2s getStats cadence, 4s ~= two consecutive samples below resume threshold. */
export const KITE_SYNC_LOSS_STABLE_MS = 4000;
