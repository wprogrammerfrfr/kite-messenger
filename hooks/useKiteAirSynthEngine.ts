"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { createKiteThereminSynth, type KiteThereminSynth } from "@/lib/theremin/kite-theremin-synth";
import {
  degreeInKeyToFrequencies,
  rootAndTypeToFrequencies,
} from "@/lib/theremin/kite-theremin-theory";
import {
  AIR_SYNTH_HAND_LOST_HOLD_MS,
  KITE_AIR_SYNTH_DEVICE_ID,
  type AirSynthErrorCode,
  type AirSynthMode,
  type AirSynthStatus,
  type AirSynthZoneState,
  type ChordType,
  type DiatonicDegree,
  type MusicalKey,
  type RootNote,
} from "@/lib/theremin/kite-theremin-types";
import {
  createKiteThereminVision,
  EMPTY_AIR_SYNTH_POINTERS,
  type AirSynthFingerPointers,
  type KiteThereminVision,
} from "@/lib/theremin/kite-theremin-vision";

export type { AirSynthFingerPointers };

export type UseKiteAirSynthEngineConfig = {
  audioContext: AudioContext | null;
  videoElement: HTMLVideoElement | null;
  enabled: boolean;
  mode: AirSynthMode;
  key: MusicalKey;
  registerVirtualInput: (deviceId: string, stream: MediaStream) => Promise<void>;
  unregisterVirtualInput: (deviceId: string) => Promise<void>;
};

export type UseKiteAirSynthEngineResult = {
  status: AirSynthStatus;
  error: AirSynthErrorCode;
  activeZone: AirSynthZoneState | null;
  activeRoot: RootNote | null;
  activeType: ChordType | null;
  activeDegree: DiatonicDegree | null;
  fingerPointersRef: MutableRefObject<AirSynthFingerPointers>;
  volume: number;
  setVolume: (level: number) => void;
  waveform: OscillatorType;
  setWaveform: (type: OscillatorType) => void;
  isVisionReady: boolean;
  isAudioReady: boolean;
  retry: () => void;
};

const AIR_SYNTH_WAVEFORMS = new Set<OscillatorType>([
  "sine",
  "square",
  "sawtooth",
  "triangle",
]);

export function useKiteAirSynthEngine({
  audioContext,
  videoElement,
  enabled,
  mode,
  key,
  registerVirtualInput,
  unregisterVirtualInput,
}: UseKiteAirSynthEngineConfig): UseKiteAirSynthEngineResult {
  const [status, setStatus] = useState<AirSynthStatus>("idle");
  const [error, setError] = useState<AirSynthErrorCode>("none");
  const [activeZone, setActiveZone] = useState<AirSynthZoneState | null>(null);
  const [isVisionReady, setIsVisionReady] = useState(false);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [volume, setVolumeState] = useState(0.8);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const [waveform, setWaveformState] = useState<OscillatorType>("triangle");
  const waveformRef = useRef(waveform);
  waveformRef.current = waveform;

  const synthRef = useRef<KiteThereminSynth | null>(null);
  const visionRef = useRef<KiteThereminVision | null>(null);
  const handLostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const registeredRef = useRef(false);
  const unsubZoneRef = useRef<(() => void) | null>(null);
  const unsubPointersRef = useRef<(() => void) | null>(null);
  const fingerPointersRef = useRef<AirSynthFingerPointers>({ ...EMPTY_AIR_SYNTH_POINTERS });

  const retry = useCallback(() => {
    setRetryTick((t) => t + 1);
    setError("none");
  }, []);

  const setVolume = useCallback((level: number) => {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
    setVolumeState(clamped);
  }, []);

  const setWaveform = useCallback((type: OscillatorType) => {
    if (!AIR_SYNTH_WAVEFORMS.has(type)) return;
    setWaveformState(type);
  }, []);

  const applyZone = useCallback(
    (zone: AirSynthZoneState | null) => {
      setActiveZone(zone);
      const synth = synthRef.current;
      if (!synth) return;

      if (!zone) {
        if (handLostTimerRef.current) clearTimeout(handLostTimerRef.current);
        handLostTimerRef.current = setTimeout(() => {
          synth.silence();
        }, AIR_SYNTH_HAND_LOST_HOLD_MS);
        return;
      }

      if (handLostTimerRef.current) {
        clearTimeout(handLostTimerRef.current);
        handLostTimerRef.current = null;
      }

      let freqs: number[];
      if (zone.mode === "two-hand") {
        freqs = rootAndTypeToFrequencies(zone.root, zone.chordType);
      } else {
        freqs = degreeInKeyToFrequencies(key, zone.degree);
      }
      synth.setChordFrequencies(freqs);
    },
    [key]
  );

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setIsVisionReady(false);
      setIsAudioReady(false);
      setActiveZone(null);
      fingerPointersRef.current = { ...EMPTY_AIR_SYNTH_POINTERS };

      if (handLostTimerRef.current) {
        clearTimeout(handLostTimerRef.current);
        handLostTimerRef.current = null;
      }

      visionRef.current?.stop();
      synthRef.current?.silence();

      if (registeredRef.current) {
        registeredRef.current = false;
        void unregisterVirtualInput(KITE_AIR_SYNTH_DEVICE_ID);
      }
      return;
    }

    if (!audioContext) {
      setError("audio_context_missing");
      setStatus("error");
      return;
    }

    if (!videoElement) {
      setError("webcam_missing");
      setStatus("error");
      return;
    }

    let cancelled = false;

    const boot = async (): Promise<void> => {
      setStatus("booting");
      setError("none");

      try {
        if (!synthRef.current) {
          synthRef.current = createKiteThereminSynth(audioContext);
        }
        synthRef.current.setVolume(volumeRef.current);
        synthRef.current.setWaveform(waveformRef.current);
        await synthRef.current.resumeIfSuspended();
        if (cancelled) return;

        if (audioContext.state === "suspended") {
          setError("audio_suspended");
          setStatus("error");
          return;
        }

        setIsAudioReady(true);

        if (!visionRef.current) {
          visionRef.current = await createKiteThereminVision();
        }
        if (cancelled) return;

        visionRef.current.setMode(mode);
        visionRef.current.setKey(key);
        unsubZoneRef.current?.();
        unsubZoneRef.current = visionRef.current.onZoneChange(applyZone);
        unsubPointersRef.current?.();
        unsubPointersRef.current = visionRef.current.onPointersChange((pointers) => {
          fingerPointersRef.current = pointers;
        });
        visionRef.current.start(videoElement);
        setIsVisionReady(true);

        const stream = synthRef.current.getOutputStream();
        await registerVirtualInput(KITE_AIR_SYNTH_DEVICE_ID, stream);
        registeredRef.current = true;

        setStatus("ready");
      } catch {
        if (!cancelled) {
          setError("vision_load_failed");
          setStatus("error");
        }
      }
    };

    void boot();

    return () => {
      cancelled = true;
      unsubZoneRef.current?.();
      unsubZoneRef.current = null;
      unsubPointersRef.current?.();
      unsubPointersRef.current = null;
      fingerPointersRef.current = { ...EMPTY_AIR_SYNTH_POINTERS };
      visionRef.current?.stop();
    };
  }, [
    enabled,
    audioContext,
    videoElement,
    mode,
    retryTick,
    registerVirtualInput,
    unregisterVirtualInput,
    applyZone,
  ]);

  useEffect(() => {
    visionRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    visionRef.current?.setKey(key);
  }, [key]);

  useEffect(() => {
    synthRef.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    synthRef.current?.setWaveform(waveform);
  }, [waveform]);

  useEffect(() => {
    return () => {
      if (handLostTimerRef.current) clearTimeout(handLostTimerRef.current);
      visionRef.current?.dispose();
      visionRef.current = null;
      synthRef.current?.dispose();
      synthRef.current = null;
      if (registeredRef.current) {
        registeredRef.current = false;
        void unregisterVirtualInput(KITE_AIR_SYNTH_DEVICE_ID);
      }
    };
  }, [unregisterVirtualInput]);

  const activeRoot = activeZone?.mode === "two-hand" ? activeZone.root : null;
  const activeType = activeZone?.mode === "two-hand" ? activeZone.chordType : null;
  const activeDegree = activeZone?.mode === "single-hand" ? activeZone.degree : null;

  return {
    status,
    error,
    activeZone,
    activeRoot,
    activeType,
    activeDegree,
    fingerPointersRef,
    volume,
    setVolume,
    waveform,
    setWaveform,
    isVisionReady,
    isAudioReady,
    retry,
  };
}
