"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  startTransition,
} from "react";

const DEFAULT_TUNED_THRESHOLD_CENTS = 5;
const RMS_GATE_LINEAR = 0.005;
const ACF_MIN_LAG_EXCLUSION = 3;
const ANALYSER_FFT_SIZE = 8192;
const PITCH_SMOOTHING_ALPHA = 0.35;
const READING_UPDATE_CENTS_THRESHOLD = 0.5;
const ACF_PEAK_MIN_CORRELATION = 0.3;
const ACF_FUNDAMENTAL_PEAK_RATIO = 0.88;

export type KiteTunerInstrumentId =
  | "guitar_standard"
  | "bass_standard"
  | "ukulele_standard"
  | "violin_standard"
  | "cello_standard";

export type KiteTunerStringTarget = {
  stringIndex: number;
  name: string;
  note: string;
  octave: number;
  targetHz: number;
};

export type KiteTunerInstrumentProfile = {
  id: KiteTunerInstrumentId;
  label: string;
  strings: readonly KiteTunerStringTarget[];
  minHz: number;
  maxHz: number;
};

export type KiteTunerReading = {
  currentHz: number | null;
  closestStringIndex: number | null;
  closestTargetNote: {
    name: string;
    note: string;
    octave: number;
    targetHz: number;
  } | null;
  centsOff: number | null;
  isTuned: boolean;
};

export type UseKiteTunerEngineConfig = {
  audioContext: AudioContext | null;
  inputStream: MediaStream | null;
  enabled: boolean;
  instrumentId?: KiteTunerInstrumentId;
  tunedThresholdCents?: number;
};

export type UseKiteTunerEngineResult = {
  isActive: boolean;
  isListening: boolean;
  reading: KiteTunerReading;
  instrumentId: KiteTunerInstrumentId;
  setInstrumentId: (id: KiteTunerInstrumentId) => void;
  profiles: typeof KITE_TUNER_INSTRUMENT_PROFILES;
  start: () => void;
  stop: () => void;
};

export const DEFAULT_INSTRUMENT_ID: KiteTunerInstrumentId = "guitar_standard";

const IDLE_READING: KiteTunerReading = {
  currentHz: null,
  closestStringIndex: null,
  closestTargetNote: null,
  centsOff: null,
  isTuned: false,
};

function buildProfile(
  id: KiteTunerInstrumentId,
  label: string,
  strings: readonly KiteTunerStringTarget[]
): KiteTunerInstrumentProfile {
  const lowest = Math.min(...strings.map((s) => s.targetHz));
  const highest = Math.max(...strings.map((s) => s.targetHz));
  return {
    id,
    label,
    strings,
    minHz: lowest * 0.95,
    maxHz: highest * 1.05,
  };
}

export const KITE_TUNER_INSTRUMENT_PROFILES: Record<
  KiteTunerInstrumentId,
  KiteTunerInstrumentProfile
> = {
  guitar_standard: buildProfile("guitar_standard", "Guitar (Standard)", [
    { stringIndex: 0, name: "E2", note: "E", octave: 2, targetHz: 82.407 },
    { stringIndex: 1, name: "A2", note: "A", octave: 2, targetHz: 110.0 },
    { stringIndex: 2, name: "D3", note: "D", octave: 3, targetHz: 146.832 },
    { stringIndex: 3, name: "G3", note: "G", octave: 3, targetHz: 195.998 },
    { stringIndex: 4, name: "B3", note: "B", octave: 3, targetHz: 246.942 },
    { stringIndex: 5, name: "E4", note: "E", octave: 4, targetHz: 329.628 },
  ]),
  bass_standard: buildProfile("bass_standard", "Bass / Double Bass (Standard)", [
    { stringIndex: 0, name: "E1", note: "E", octave: 1, targetHz: 41.203 },
    { stringIndex: 1, name: "A1", note: "A", octave: 1, targetHz: 55.0 },
    { stringIndex: 2, name: "D2", note: "D", octave: 2, targetHz: 73.416 },
    { stringIndex: 3, name: "G2", note: "G", octave: 2, targetHz: 98.0 },
  ]),
  ukulele_standard: buildProfile("ukulele_standard", "Ukulele (Standard)", [
    { stringIndex: 0, name: "C4", note: "C", octave: 4, targetHz: 261.626 },
    { stringIndex: 1, name: "E4", note: "E", octave: 4, targetHz: 329.628 },
    { stringIndex: 2, name: "G4", note: "G", octave: 4, targetHz: 392.0 },
    { stringIndex: 3, name: "A4", note: "A", octave: 4, targetHz: 440.0 },
  ]),
  violin_standard: buildProfile("violin_standard", "Violin", [
    { stringIndex: 0, name: "G3", note: "G", octave: 3, targetHz: 196.0 },
    { stringIndex: 1, name: "D4", note: "D", octave: 4, targetHz: 293.665 },
    { stringIndex: 2, name: "A4", note: "A", octave: 4, targetHz: 440.0 },
    { stringIndex: 3, name: "E5", note: "E", octave: 5, targetHz: 659.255 },
  ]),
  cello_standard: buildProfile("cello_standard", "Cello", [
    { stringIndex: 0, name: "C2", note: "C", octave: 2, targetHz: 65.406 },
    { stringIndex: 1, name: "G2", note: "G", octave: 2, targetHz: 98.0 },
    { stringIndex: 2, name: "D3", note: "D", octave: 3, targetHz: 146.832 },
    { stringIndex: 3, name: "A3", note: "A", octave: 3, targetHz: 220.0 },
  ]),
};

type StringMatchResult = {
  closestStringIndex: number;
  closestTargetNote: KiteTunerReading["closestTargetNote"];
  centsOff: number;
};

function computeRms(buf: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = buf[i] ?? 0;
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / buf.length);
}

export function hzToCents(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return 1200 * Math.log2(ratio);
}

function normalizedAutocorrelationAtLag(buf: Float32Array, tau: number): number {
  let sum = 0;
  let energy0 = 0;
  let energyTau = 0;
  const limit = buf.length - tau;
  if (limit <= 0) return 0;

  for (let i = 0; i < limit; i += 1) {
    const x0 = buf[i] ?? 0;
    const xT = buf[i + tau] ?? 0;
    sum += x0 * xT;
    energy0 += x0 * x0;
    energyTau += xT * xT;
  }

  const denom = Math.sqrt(energy0 * energyTau);
  return denom > 0 ? sum / denom : 0;
}

function parabolicPeakLag(lag: number, yPrev: number, yMid: number, yNext: number): number {
  const denominator = yPrev - 2 * yMid + yNext;
  if (Math.abs(denominator) < 1e-12) return lag;
  const offset = 0.5 * (yPrev - yNext) / denominator;
  return lag + Math.max(-0.5, Math.min(0.5, offset));
}

export function detectPitchHz(
  buf: Float32Array,
  sampleRate: number,
  minHz: number,
  maxHz: number
): number | null {
  if (sampleRate <= 0 || minHz <= 0 || maxHz <= minHz) return null;

  const minPeriod = Math.max(ACF_MIN_LAG_EXCLUSION + 1, Math.floor(sampleRate / maxHz));
  const maxPeriod = Math.min(buf.length - 1, Math.ceil(sampleRate / minHz));
  if (minPeriod >= maxPeriod) return null;

  let bestLag = 0;
  let bestCorr = -Infinity;

  for (let tau = minPeriod; tau <= maxPeriod; tau += 1) {
    const corr = normalizedAutocorrelationAtLag(buf, tau);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = tau;
    }
  }

  if (bestLag <= 0 || bestCorr < ACF_PEAK_MIN_CORRELATION) return null;

  const peakThreshold = bestCorr * ACF_FUNDAMENTAL_PEAK_RATIO;
  let fundamentalLag = bestLag;
  for (let factor = 2; factor <= 4; factor += 1) {
    const candidateLag = bestLag / factor;
    if (candidateLag < minPeriod) continue;
    const candidateLagRounded = Math.round(candidateLag);
    const candidateCorr = normalizedAutocorrelationAtLag(buf, candidateLagRounded);
    if (candidateCorr >= peakThreshold && candidateLag < fundamentalLag) {
      fundamentalLag = candidateLag;
    }
  }

  const lagForRefine = Math.round(fundamentalLag);
  let refinedLag = fundamentalLag;
  if (lagForRefine > minPeriod && lagForRefine < maxPeriod) {
    const yPrev = normalizedAutocorrelationAtLag(buf, lagForRefine - 1);
    const yMid = normalizedAutocorrelationAtLag(buf, lagForRefine);
    const yNext = normalizedAutocorrelationAtLag(buf, lagForRefine + 1);
    refinedLag = parabolicPeakLag(lagForRefine, yPrev, yMid, yNext);
  }

  const detectedHz = sampleRate / refinedLag;

  if (!Number.isFinite(detectedHz) || detectedHz < minHz || detectedHz > maxHz) {
    return null;
  }

  return detectedHz;
}

export function findClosestString(
  detectedHz: number,
  profile: KiteTunerInstrumentProfile
): StringMatchResult {
  let bestString = profile.strings[0];
  let bestCentsDistance = Infinity;

  for (const stringTarget of profile.strings) {
    const centsDistance = Math.abs(hzToCents(detectedHz / stringTarget.targetHz));
    if (centsDistance < bestCentsDistance) {
      bestCentsDistance = centsDistance;
      bestString = stringTarget;
    }
  }

  return {
    closestStringIndex: bestString.stringIndex,
    closestTargetNote: {
      name: bestString.name,
      note: bestString.note,
      octave: bestString.octave,
      targetHz: bestString.targetHz,
    },
    centsOff: hzToCents(detectedHz / bestString.targetHz),
  };
}

function hasLiveAudioTrack(stream: MediaStream | null): boolean {
  if (!stream) return false;
  return stream.getAudioTracks().some((track) => track.readyState === "live");
}

function disconnectNode(node: AudioNode | null | undefined): void {
  if (!node) return;
  try {
    node.disconnect();
  } catch {
    /* ignore */
  }
}

function shouldPublishReading(
  prev: KiteTunerReading,
  next: KiteTunerReading,
  prevListening: boolean,
  nextListening: boolean
): boolean {
  if (prevListening !== nextListening) return true;
  if (prev.closestStringIndex !== next.closestStringIndex) return true;
  if (prev.isTuned !== next.isTuned) return true;
  if (prev.currentHz === null || next.currentHz === null) {
    return prev.currentHz !== next.currentHz;
  }
  if (prev.centsOff === null || next.centsOff === null) {
    return prev.centsOff !== next.centsOff;
  }
  return Math.abs(next.centsOff - prev.centsOff) >= READING_UPDATE_CENTS_THRESHOLD;
}

export function useKiteTunerEngine(config: UseKiteTunerEngineConfig): UseKiteTunerEngineResult {
  const {
    audioContext,
    inputStream,
    enabled: configEnabled,
    instrumentId: controlledInstrumentId,
    tunedThresholdCents = DEFAULT_TUNED_THRESHOLD_CENTS,
  } = config;

  const [internalEnabled, setInternalEnabled] = useState(false);
  const [uncontrolledInstrumentId, setUncontrolledInstrumentId] =
    useState<KiteTunerInstrumentId>(DEFAULT_INSTRUMENT_ID);
  const [isActive, setIsActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [reading, setReading] = useState<KiteTunerReading>(IDLE_READING);

  const instrumentId = controlledInstrumentId ?? uncontrolledInstrumentId;
  const effectiveEnabled = configEnabled || internalEnabled;

  const mountedRef = useRef(true);
  const graphMountedRef = useRef(false);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const timeDomainBufRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const rafIdRef = useRef(0);
  const smoothedHzRef = useRef<number | null>(null);
  const readingRef = useRef<KiteTunerReading>(IDLE_READING);
  const isListeningRef = useRef(false);
  const instrumentIdRef = useRef(instrumentId);
  const tunedThresholdRef = useRef(tunedThresholdCents);

  instrumentIdRef.current = instrumentId;
  tunedThresholdRef.current = tunedThresholdCents;
  readingRef.current = reading;
  isListeningRef.current = isListening;

  const setInstrumentId = useCallback(
    (id: KiteTunerInstrumentId) => {
      if (controlledInstrumentId !== undefined) return;
      setUncontrolledInstrumentId(id);
    },
    [controlledInstrumentId]
  );

  const start = useCallback(() => {
    setInternalEnabled(true);
  }, []);

  const stop = useCallback(() => {
    setInternalEnabled(false);
  }, []);

  const publishReading = useCallback((nextReading: KiteTunerReading, nextListening: boolean) => {
    const prevReading = readingRef.current;
    const prevListening = isListeningRef.current;
    if (!shouldPublishReading(prevReading, nextReading, prevListening, nextListening)) {
      return;
    }

    startTransition(() => {
      if (!mountedRef.current) return;
      setReading(nextReading);
      setIsListening(nextListening);
    });
    readingRef.current = nextReading;
    isListeningRef.current = nextListening;
  }, []);

  const resetReading = useCallback(() => {
    smoothedHzRef.current = null;
    readingRef.current = IDLE_READING;
    isListeningRef.current = false;
    startTransition(() => {
      if (!mountedRef.current) return;
      setReading(IDLE_READING);
      setIsListening(false);
    });
  }, []);

  const teardownGraph = useCallback(() => {
    if (rafIdRef.current !== 0) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }

    disconnectNode(sourceRef.current);
    disconnectNode(analyserRef.current);
    disconnectNode(silentGainRef.current);

    sourceRef.current = null;
    analyserRef.current = null;
    silentGainRef.current = null;
    timeDomainBufRef.current = null;
    graphMountedRef.current = false;

    if (mountedRef.current) {
      setIsActive(false);
    }
    resetReading();
  }, [resetReading]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardownGraph();
    };
  }, [teardownGraph]);

  useEffect(() => {
    if (!effectiveEnabled) {
      teardownGraph();
      return;
    }

    const ctx = audioContext;
    if (!ctx || ctx.state === "closed" || !hasLiveAudioTrack(inputStream)) {
      teardownGraph();
      return;
    }

    let cancelled = false;

    const mountGraph = (): void => {
      if (cancelled || !mountedRef.current || !inputStream) return;

      teardownGraph();

      const sourceNode = ctx.createMediaStreamSource(inputStream);
      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = ANALYSER_FFT_SIZE;
      analyserNode.smoothingTimeConstant = 0;

      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;

      sourceNode.connect(analyserNode);
      analyserNode.connect(silentGain);
      silentGain.connect(ctx.destination);

      sourceRef.current = sourceNode;
      analyserRef.current = analyserNode;
      silentGainRef.current = silentGain;
      timeDomainBufRef.current = new Float32Array(analyserNode.fftSize);
      graphMountedRef.current = true;
      setIsActive(true);

      const tick = (): void => {
        if (!graphMountedRef.current || cancelled) return;

        const analyser = analyserRef.current;
        const buf = timeDomainBufRef.current;
        if (!analyser || !buf) {
          rafIdRef.current = requestAnimationFrame(tick);
          return;
        }

        analyser.getFloatTimeDomainData(buf);
        const rms = computeRms(buf);
        if (rms < RMS_GATE_LINEAR) {
          smoothedHzRef.current = null;
          publishReading(IDLE_READING, false);
          rafIdRef.current = requestAnimationFrame(tick);
          return;
        }

        const profile = KITE_TUNER_INSTRUMENT_PROFILES[instrumentIdRef.current];
        const rawHz = detectPitchHz(buf, ctx.sampleRate, profile.minHz, profile.maxHz);
        if (rawHz === null) {
          smoothedHzRef.current = null;
          publishReading(IDLE_READING, false);
          rafIdRef.current = requestAnimationFrame(tick);
          return;
        }

        const prevSmoothed = smoothedHzRef.current;
        const smoothedHz =
          prevSmoothed === null
            ? rawHz
            : prevSmoothed + PITCH_SMOOTHING_ALPHA * (rawHz - prevSmoothed);
        smoothedHzRef.current = smoothedHz;

        const match = findClosestString(smoothedHz, profile);
        const nextReading: KiteTunerReading = {
          currentHz: smoothedHz,
          closestStringIndex: match.closestStringIndex,
          closestTargetNote: match.closestTargetNote,
          centsOff: match.centsOff,
          isTuned: Math.abs(match.centsOff) <= tunedThresholdRef.current,
        };
        publishReading(nextReading, true);
        rafIdRef.current = requestAnimationFrame(tick);
      };

      rafIdRef.current = requestAnimationFrame(tick);
    };

    if (ctx.state === "suspended") {
      void ctx.resume().then(() => {
        if (!cancelled) mountGraph();
      });
    } else {
      mountGraph();
    }

    return () => {
      cancelled = true;
      teardownGraph();
    };
  }, [audioContext, effectiveEnabled, inputStream, teardownGraph, publishReading]);

  useEffect(() => {
    if (!graphMountedRef.current) return;
    smoothedHzRef.current = null;
    resetReading();
  }, [instrumentId, resetReading]);

  return {
    isActive,
    isListening,
    reading,
    instrumentId,
    setInstrumentId,
    profiles: KITE_TUNER_INSTRUMENT_PROFILES,
    start,
    stop,
  };
}
