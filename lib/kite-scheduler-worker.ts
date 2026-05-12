import type { KiteIntervalTiming } from "@/lib/kite-interval-math";

export type KiteSchedulerWorkerConfig = Pick<
  KiteIntervalTiming,
  "loopDurationSeconds" | "localIntervalFrames" | "localSampleRate"
> & {
  sequenceNumber?: number;
  startAtPerformanceMs?: number;
  tickLookaheadMs?: number;
};

/**
 * Wake-up tick emitted at a fixed interval from the worker; grid boundaries are computed on the
 * main thread using {@link AudioContext} time (Phase 5B-3).
 */
export type KiteSchedulerWorkerPulse = {
  type: "KITE_SCHEDULER_PULSE";
  sequenceNumber: number;
  postedAtPerformanceMs: number;
};

/**
 * Legacy shape no longer emitted by `kite-scheduler-worker.js` after Phase 5B-1; kept for
 * callers that still narrow on this type during migration.
 */
export type KiteSchedulerWorkerTick = {
  type: "KITE_INTERVAL_TICK";
  sequenceNumber: number;
  intervalIndex: number;
  scheduledAtPerformanceMs: number;
  postedAtPerformanceMs: number;
  loopDurationSeconds: number;
  localIntervalFrames: number;
  localSampleRate: number;
};

export type KiteSchedulerWorkerStatus = {
  type: "KITE_SCHEDULER_STATUS";
  state: "started" | "stopped" | "updated";
  sequenceNumber: number;
  postedAtPerformanceMs: number;
};

export type KiteSchedulerWorkerMessage =
  | KiteSchedulerWorkerPulse
  | KiteSchedulerWorkerTick
  | KiteSchedulerWorkerStatus
  | {
      type: "KITE_SCHEDULER_ERROR";
      message: string;
      postedAtPerformanceMs: number;
    };

export type KiteSchedulerWorkerHandle = {
  start(config: KiteSchedulerWorkerConfig): void;
  update(config: Partial<KiteSchedulerWorkerConfig>): void;
  stop(): void;
  terminate(): void;
};

type WorkerCommand =
  | ({ type: "START"; commandPostedAtPerformanceMs: number } & Required<KiteSchedulerWorkerConfig>)
  | {
      type: "UPDATE";
      patch: Partial<KiteSchedulerWorkerConfig>;
      commandPostedAtPerformanceMs: number;
    }
  | { type: "STOP" };

const DEFAULT_TICK_LOOKAHEAD_MS = 50;
const MIN_LOOP_DURATION_SECONDS = 0.05;
const MAX_LOOP_DURATION_SECONDS = 60 * 10;
const MIN_SAMPLE_RATE = 8000;
const MAX_SAMPLE_RATE = 384000;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeConfig(config: KiteSchedulerWorkerConfig): Required<KiteSchedulerWorkerConfig> {
  const localSampleRate = Math.round(
    clampNumber(Number(config.localSampleRate), MIN_SAMPLE_RATE, MAX_SAMPLE_RATE)
  );
  const loopDurationSeconds = clampNumber(
    Number(config.loopDurationSeconds),
    MIN_LOOP_DURATION_SECONDS,
    MAX_LOOP_DURATION_SECONDS
  );
  const localIntervalFrames = Math.max(
    1,
    Math.round(Number(config.localIntervalFrames) || loopDurationSeconds * localSampleRate)
  );
  const startAtPerformanceMs =
    typeof config.startAtPerformanceMs === "number" && Number.isFinite(config.startAtPerformanceMs)
      ? config.startAtPerformanceMs
      : performance.now();
  const tickLookaheadMs = Math.max(
    5,
    Math.round(Number(config.tickLookaheadMs) || DEFAULT_TICK_LOOKAHEAD_MS)
  );

  if (!Number.isFinite(loopDurationSeconds) || !Number.isFinite(localSampleRate)) {
    throw new Error("Kite scheduler worker requires finite timing values.");
  }

  return {
    loopDurationSeconds,
    localIntervalFrames,
    localSampleRate,
    sequenceNumber: Math.max(0, Math.round(Number(config.sequenceNumber) || 0)),
    startAtPerformanceMs,
    tickLookaheadMs,
  };
}

export function createKiteSchedulerWorker(
  onMessage: (message: KiteSchedulerWorkerMessage) => void
): KiteSchedulerWorkerHandle {
  if (typeof Worker === "undefined") {
    throw new Error("Web Worker is not available in this browser.");
  }

  const worker = new Worker("/worklets/kite-scheduler-worker.js");
  let terminated = false;
  let lastConfig: Required<KiteSchedulerWorkerConfig> | null = null;

  worker.onmessage = (event: MessageEvent<KiteSchedulerWorkerMessage>) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    onMessage(data);
  };

  const post = (command: WorkerCommand): void => {
    if (terminated) return;
    worker.postMessage(command);
  };

  return {
    start(config: KiteSchedulerWorkerConfig): void {
      lastConfig = sanitizeConfig(config);
      post({ type: "START", ...lastConfig, commandPostedAtPerformanceMs: performance.now() });
    },
    update(config: Partial<KiteSchedulerWorkerConfig>): void {
      if (!lastConfig) return;
      lastConfig = sanitizeConfig({ ...lastConfig, ...config });
      post({
        type: "UPDATE",
        patch: lastConfig,
        commandPostedAtPerformanceMs: performance.now(),
      });
    },
    stop(): void {
      if (!terminated) {
        post({ type: "STOP" });
      }
      lastConfig = null;
    },
    terminate(): void {
      if (terminated) return;
      terminated = true;
      lastConfig = null;
      worker.onmessage = null;
      worker.terminate();
    },
  };
}
