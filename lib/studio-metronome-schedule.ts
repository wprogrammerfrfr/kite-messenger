export type MetronomeSubdivision = 1 | 2 | 4 | 8;

export type MetronomeScheduleConfig = {
  bpm: number;
  beatsPerInterval: number;
  subdivision?: MetronomeSubdivision;
  lookaheadMs?: number;
  scheduleAheadSec?: number;
  startAtSec?: number;
};

export type MetronomeTick = {
  atSec: number;
  beatIndex: number;
  intervalIndex: number;
  subdivisionIndex: number;
  isAccent: boolean;
};

type SchedulerState = {
  nextTickSec: number;
  beatIndex: number;
  intervalIndex: number;
  subdivisionIndex: number;
};

const DEFAULT_SUBDIVISION: MetronomeSubdivision = 1;
const DEFAULT_LOOKAHEAD_MS = 25;
const DEFAULT_SCHEDULE_AHEAD_SEC = 0.1;
const MAX_SCHEDULE_AHEAD_SEC = 1.0;
const MIN_BPM = 20;
const MAX_BPM = 320;
const MIN_BPI = 1;
const MAX_BPI = 64;

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitizeConfig(config: MetronomeScheduleConfig): Required<MetronomeScheduleConfig> {
  const subdivision = config.subdivision ?? DEFAULT_SUBDIVISION;
  const lookaheadMs = clampNumber(
    config.lookaheadMs ?? DEFAULT_LOOKAHEAD_MS,
    5,
    250
  );
  const scheduleAheadSec = clampNumber(
    config.scheduleAheadSec ?? DEFAULT_SCHEDULE_AHEAD_SEC,
    0.01,
    MAX_SCHEDULE_AHEAD_SEC
  );

  return {
    bpm: clampNumber(config.bpm, MIN_BPM, MAX_BPM),
    beatsPerInterval: clampNumber(config.beatsPerInterval, MIN_BPI, MAX_BPI),
    subdivision,
    lookaheadMs,
    scheduleAheadSec,
    startAtSec: config.startAtSec ?? 0,
  };
}

export function getSecondsPerSubdivision(
  bpm: number,
  subdivision: MetronomeSubdivision = DEFAULT_SUBDIVISION
): number {
  const safeBpm = clampNumber(bpm, MIN_BPM, MAX_BPM);
  return 60 / safeBpm / subdivision;
}

export function planMetronomeWindow(
  fromSec: number,
  toSec: number,
  state: SchedulerState,
  config: MetronomeScheduleConfig
): { ticks: MetronomeTick[]; nextState: SchedulerState } {
  const safeConfig = sanitizeConfig(config);
  const secondsPerTick = getSecondsPerSubdivision(
    safeConfig.bpm,
    safeConfig.subdivision
  );

  const ticks: MetronomeTick[] = [];
  const nextState: SchedulerState = {
    ...state,
  };

  while (nextState.nextTickSec < fromSec) {
    nextState.nextTickSec += secondsPerTick;
    nextState.subdivisionIndex = (nextState.subdivisionIndex + 1) % safeConfig.subdivision;
    if (nextState.subdivisionIndex === 0) {
      nextState.beatIndex = (nextState.beatIndex + 1) % safeConfig.beatsPerInterval;
      if (nextState.beatIndex === 0) {
        nextState.intervalIndex += 1;
      }
    }
  }

  while (nextState.nextTickSec <= toSec) {
    ticks.push({
      atSec: nextState.nextTickSec,
      beatIndex: nextState.beatIndex,
      intervalIndex: nextState.intervalIndex,
      subdivisionIndex: nextState.subdivisionIndex,
      isAccent: nextState.beatIndex === 0 && nextState.subdivisionIndex === 0,
    });

    nextState.nextTickSec += secondsPerTick;
    nextState.subdivisionIndex = (nextState.subdivisionIndex + 1) % safeConfig.subdivision;
    if (nextState.subdivisionIndex === 0) {
      nextState.beatIndex = (nextState.beatIndex + 1) % safeConfig.beatsPerInterval;
      if (nextState.beatIndex === 0) {
        nextState.intervalIndex += 1;
      }
    }
  }

  return { ticks, nextState };
}

export function createMetronomeScheduler(
  audioContext: BaseAudioContext,
  initialConfig: MetronomeScheduleConfig
): {
  start(startAtSec?: number): void;
  stop(): void;
  setConfig(patch: Partial<MetronomeScheduleConfig>): void;
  consumeDueTicks(nowSec?: number): MetronomeTick[];
  getNextNoteTime(): number;
  getLookaheadMs(): number;
  getScheduleAheadSec(): number;
  isRunning(): boolean;
} {
  let config = sanitizeConfig(initialConfig);
  let running = false;
  let state: SchedulerState = {
    nextTickSec: config.startAtSec,
    beatIndex: 0,
    intervalIndex: 0,
    subdivisionIndex: 0,
  };

  const alignStart = (startAtSec?: number): number => {
    const now = audioContext.currentTime;
    if (typeof startAtSec === "number" && Number.isFinite(startAtSec)) {
      return Math.max(now, startAtSec);
    }
    return now;
  };

  return {
    start(startAtSec?: number): void {
      const aligned = alignStart(startAtSec);
      state = {
        nextTickSec: aligned,
        beatIndex: 0,
        intervalIndex: 0,
        subdivisionIndex: 0,
      };
      running = true;
    },
    stop(): void {
      running = false;
    },
    setConfig(patch: Partial<MetronomeScheduleConfig>): void {
      config = sanitizeConfig({ ...config, ...patch });
    },
    consumeDueTicks(nowSec?: number): MetronomeTick[] {
      if (!running) return [];
      const fromSec =
        typeof nowSec === "number" && Number.isFinite(nowSec)
          ? nowSec
          : audioContext.currentTime;
      const toSec = fromSec + config.scheduleAheadSec;
      const planned = planMetronomeWindow(fromSec, toSec, state, config);
      // Keep scheduler state advancing explicitly after each consume cycle.
      state.nextTickSec = planned.nextState.nextTickSec;
      state.beatIndex = planned.nextState.beatIndex;
      state.intervalIndex = planned.nextState.intervalIndex;
      state.subdivisionIndex = planned.nextState.subdivisionIndex;
      return planned.ticks.map((tick) => {
        const stepInInterval = tick.beatIndex * config.subdivision + tick.subdivisionIndex;
        const beatIndex =
          Math.floor(stepInInterval / config.subdivision) % config.beatsPerInterval;
        return {
          ...tick,
          beatIndex,
        };
      });
    },
    getNextNoteTime(): number {
      return state.nextTickSec;
    },
    getLookaheadMs(): number {
      return config.lookaheadMs;
    },
    getScheduleAheadSec(): number {
      return config.scheduleAheadSec;
    },
    isRunning(): boolean {
      return running;
    },
  };
}
