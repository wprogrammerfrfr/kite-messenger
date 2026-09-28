/**
 * Main-thread latency drift sampler for the solo looper.
 * Reads HAL values only — never posts to the worklet and never drives transport.
 * Enable console logs with localStorage `kite_debug_latency = "1"`.
 */

export const SOLO_LATENCY_DRIFT_DEBUG_KEY = "kite_debug_latency";

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_NOTIFY_THRESHOLD_MS = 3;
const MAX_SAMPLES = 240;
const SMOOTHING_WINDOW = 3;

export type SoloLatencyDriftSample = {
  /** Wall-clock ms since monitor start (diagnostic only). */
  elapsedMs: number;
  contextTimeSec: number;
  outputLatencyMs: number | null;
  baseLatencyMs: number | null;
  /** Change of (contextTime − performanceTime) since baseline; positive = audio clock ahead. */
  clockDriftMs: number | null;
  inputLatencyMs: number | null;
  inputSampleRate: number | null;
};

export type SoloLatencyDriftMonitorOptions = {
  getContext: () => AudioContext | null;
  getInputTrack: () => MediaStreamTrack | null;
  intervalMs?: number;
  notifyThresholdMs?: number;
  /** Fired when the smoothed output-latency delta moves by ≥ notifyThresholdMs. */
  onDeltaChange?: (deltaMs: number) => void;
};

export type SoloLatencyDriftMonitor = {
  start: () => void;
  stop: () => void;
  /** Re-anchor baseline to the current HAL reading (call after RTL calibration confirm). */
  resetBaseline: () => void;
  getOutputLatencyDeltaMs: () => number;
  getBaselineOutputLatencyMs: () => number | null;
  getSamples: () => readonly SoloLatencyDriftSample[];
};

function isDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SOLO_LATENCY_DRIFT_DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

function finiteMs(sec: number | undefined): number | null {
  return typeof sec === "number" && Number.isFinite(sec) ? sec * 1000 : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function createSoloLatencyDriftMonitor(
  options: SoloLatencyDriftMonitorOptions
): SoloLatencyDriftMonitor {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const notifyThresholdMs = options.notifyThresholdMs ?? DEFAULT_NOTIFY_THRESHOLD_MS;

  let timerId: ReturnType<typeof setInterval> | null = null;
  let startedAtMs = 0;
  let samples: SoloLatencyDriftSample[] = [];
  let recentOutputMs: number[] = [];
  let baselineOutputMs: number | null = null;
  let baselineClockOffsetMs: number | null = null;
  let smoothedDeltaMs = 0;
  let lastNotifiedDeltaMs = 0;

  const readClockOffsetMs = (ctx: AudioContext): number | null => {
    if (typeof ctx.getOutputTimestamp !== "function") return null;
    const ts = ctx.getOutputTimestamp();
    if (
      typeof ts.contextTime !== "number" ||
      typeof ts.performanceTime !== "number" ||
      ts.performanceTime <= 0
    ) {
      return null;
    }
    return ts.contextTime * 1000 - ts.performanceTime;
  };

  const sample = (): void => {
    const ctx = options.getContext();
    if (!ctx || ctx.state !== "running") return;

    const outputLatencyMs = finiteMs(ctx.outputLatency);
    const baseLatencyMs = finiteMs(ctx.baseLatency);
    const clockOffsetMs = readClockOffsetMs(ctx);

    if (baselineOutputMs === null && outputLatencyMs !== null && outputLatencyMs > 0) {
      baselineOutputMs = outputLatencyMs;
    }
    if (baselineClockOffsetMs === null && clockOffsetMs !== null) {
      baselineClockOffsetMs = clockOffsetMs;
    }

    const settings = options.getInputTrack()?.getSettings() as
      | (MediaTrackSettings & { latency?: number })
      | undefined;

    const entry: SoloLatencyDriftSample = {
      elapsedMs: Math.round(performance.now() - startedAtMs),
      contextTimeSec: ctx.currentTime,
      outputLatencyMs,
      baseLatencyMs,
      clockDriftMs:
        clockOffsetMs !== null && baselineClockOffsetMs !== null
          ? clockOffsetMs - baselineClockOffsetMs
          : null,
      inputLatencyMs: finiteMs(settings?.latency),
      inputSampleRate:
        typeof settings?.sampleRate === "number" ? settings.sampleRate : null,
    };
    samples.push(entry);
    if (samples.length > MAX_SAMPLES) samples.shift();

    if (outputLatencyMs !== null && outputLatencyMs > 0 && baselineOutputMs !== null) {
      recentOutputMs.push(outputLatencyMs);
      if (recentOutputMs.length > SMOOTHING_WINDOW) recentOutputMs.shift();
      smoothedDeltaMs = Math.max(0, median(recentOutputMs) - baselineOutputMs);
    }

    if (isDebugEnabled()) {
      console.info("[LatencyDrift]", {
        ...entry,
        baselineOutputMs,
        deltaMs: Math.round(smoothedDeltaMs * 10) / 10,
      });
    }

    if (Math.abs(smoothedDeltaMs - lastNotifiedDeltaMs) >= notifyThresholdMs) {
      lastNotifiedDeltaMs = smoothedDeltaMs;
      options.onDeltaChange?.(smoothedDeltaMs);
    }
  };

  const resetBaseline = (): void => {
    baselineOutputMs = null;
    baselineClockOffsetMs = null;
    recentOutputMs = [];
    const hadDelta = lastNotifiedDeltaMs !== 0;
    smoothedDeltaMs = 0;
    lastNotifiedDeltaMs = 0;
    if (hadDelta) options.onDeltaChange?.(0);
    sample();
  };

  const monitor: SoloLatencyDriftMonitor = {
    start() {
      if (timerId !== null) return;
      startedAtMs = performance.now();
      samples = [];
      sample();
      timerId = setInterval(sample, intervalMs);
      if (typeof window !== "undefined") {
        (window as Window & { __kiteLatencyDrift?: SoloLatencyDriftMonitor }).__kiteLatencyDrift =
          monitor;
      }
    },
    stop() {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    },
    resetBaseline,
    getOutputLatencyDeltaMs: () => smoothedDeltaMs,
    getBaselineOutputLatencyMs: () => baselineOutputMs,
    getSamples: () => samples,
  };
  return monitor;
}
