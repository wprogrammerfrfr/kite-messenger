"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { createMetronomeScheduler, type MetronomeTick } from "@/lib/studio-metronome-schedule";
import {
  createMetronomePump,
  type MetronomePumpHandle,
} from "@/lib/studio-metronome-pump";
import type { KiteIntervalTiming } from "@/lib/kite-interval-math";
import type { KiteP2PEngineApi } from "@/hooks/useKiteP2PEngine";

type BroadcastStatus = "idle" | "connecting" | "syncing" | "live";
type Role = "host" | "peer";

export type UseKiteSyncMetronomeConfig = {
  kiteSyncEnabled: boolean;
  broadcastStatus: BroadcastStatus;
  audioContextReady: boolean;
  kiteSyncNetworkMetronomePaused: boolean;
  kiteSyncMetronomeResumeNonce: number;
  metronomeBpm: number;
  beatsPerInterval: number;
  role: Role | null;
  kiteSetupTimeSignatureTop: number;
  getContext: () => AudioContext | null;
  hardwareKillSwitchActiveRef: RefObject<boolean>;
  audioBaseLatencySecRef: RefObject<number>;
  audioOutputLatencySecRef: RefObject<number>;
  metronomeVolumeRef: RefObject<number>;
  broadcastStatusRef: RefObject<BroadcastStatus>;
  kiteSyncCountInActiveRef: RefObject<boolean>;
  isVisualMetronomeOnlyRef: RefObject<boolean>;
  kiteIntervalTimingRef: RefObject<KiteIntervalTiming | null>;
  p2pEngineRef: RefObject<KiteP2PEngineApi | null>;
  metronomeBlinkElementRef: RefObject<HTMLDivElement | null>;
};

export type KiteSyncMetronomeApi = {
  stop: () => void;
  ensureGainNode: (ctx: AudioContext) => GainNode;
  metronomeGainRef: RefObject<GainNode | null>;
};

export function useKiteSyncMetronome(config: UseKiteSyncMetronomeConfig): KiteSyncMetronomeApi {
  const configRef = useRef(config);
  configRef.current = config;

  const metronomeGainRef = useRef<GainNode | null>(null);
  const metronomeSchedulerRef = useRef<ReturnType<typeof createMetronomeScheduler> | null>(null);
  const metronomePumpRef = useRef<MetronomePumpHandle | null>(null);
  const metronomeBlinkQueueRef = useRef<{ startAt: number; isAccent: boolean }[]>([]);
  const metronomeBlinkRafIdRef = useRef<number | null>(null);

  const ensureGainNode = useCallback((ctx: AudioContext): GainNode => {
    let node = metronomeGainRef.current;
    if (!node) {
      node = ctx.createGain();
      node.gain.value = configRef.current.metronomeVolumeRef.current ?? 0.85;
      node.connect(ctx.destination);
      metronomeGainRef.current = node;
    }
    return node;
  }, []);

  const playMetronomeClick = useCallback(
    (
      ctx: AudioContext,
      time: number,
      tick: MetronomeTick,
      masterGainNode?: GainNode | null,
      forceAudio?: boolean
    ) => {
      const cfg = configRef.current;
      if (!ctx || ctx.state === "closed") return;
      if (ctx.state !== "running") return;
      const halSec =
        (cfg.audioBaseLatencySecRef.current ?? 0) + (cfg.audioOutputLatencySecRef.current ?? 0);
      const compensated = time - halSec;
      const startAt = Math.max(compensated, ctx.currentTime);
      metronomeBlinkQueueRef.current.push({ startAt, isAccent: tick.isAccent });
      if (metronomeBlinkQueueRef.current.length > 20) metronomeBlinkQueueRef.current.shift();
      const shouldPlayAudio = forceAudio || !(cfg.isVisualMetronomeOnlyRef.current ?? false);
      if (shouldPlayAudio) {
        const osc = ctx.createOscillator();
        const durationSec = 0.1;
        const stopAt = startAt + durationSec;
        osc.type = "sine";
        const beatsPerBar = Math.max(1, Math.min(16, Math.round(cfg.kiteSetupTimeSignatureTop)));
        const frequency =
          tick.beatIndex === 0 ? 1760 : tick.beatIndex % beatsPerBar === 0 ? 880 : 440;
        osc.frequency.setValueAtTime(frequency, startAt);
        const targetNode = masterGainNode || ctx.destination;
        osc.connect(targetNode);
        osc.start(startAt);
        osc.stop(stopAt);
        osc.addEventListener("ended", () => {
          try {
            osc.disconnect();
          } catch {
            /* ignore */
          }
        });
      }
    },
    []
  );

  const stop = useCallback(() => {
    if (metronomeBlinkRafIdRef.current !== null) {
      cancelAnimationFrame(metronomeBlinkRafIdRef.current);
    }
    metronomeBlinkRafIdRef.current = null;
    metronomeBlinkQueueRef.current = [];
    metronomePumpRef.current?.teardown();
    metronomePumpRef.current = null;
    metronomeSchedulerRef.current?.stop();
    metronomeSchedulerRef.current = null;
    const gain = metronomeGainRef.current;
    const ctx = configRef.current.getContext();
    if (gain && ctx && ctx.state !== "closed") {
      try {
        gain.gain.cancelScheduledValues(ctx.currentTime);
      } catch {
        /* ignore */
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cfg = configRef.current;

    if (!cfg.kiteSyncEnabled || (cfg.broadcastStatus !== "syncing" && cfg.broadcastStatus !== "live")) {
      stop();
      return undefined;
    }
    if (cfg.kiteSyncNetworkMetronomePaused) {
      stop();
      return undefined;
    }
    if (!cfg.audioContextReady) {
      stop();
      return undefined;
    }

    const ctx = cfg.getContext();
    if (!ctx || ctx.state === "closed") return undefined;
    if (!metronomeGainRef.current) {
      ensureGainNode(ctx);
    }
    if (!metronomeGainRef.current) return undefined;
    if (ctx.state !== "running") {
      stop();
      return undefined;
    }
    if (metronomePumpRef.current !== null && metronomeSchedulerRef.current) return undefined;

    const localStartAtSec = ctx.currentTime + 0.01;
    let startAtSec = localStartAtSec;
    if (cfg.role !== "host") {
      const target = cfg.p2pEngineRef.current?.sync?.getLastAppliedGuestStartSec() ?? null;
      if (typeof target === "number" && Number.isFinite(target)) {
        const sixteenthSec = (60 / cfg.metronomeBpm) / 4;
        if (Number.isFinite(sixteenthSec) && sixteenthSec > 0 && target < ctx.currentTime) {
          startAtSec =
            target + Math.ceil((ctx.currentTime - target) / sixteenthSec) * sixteenthSec;
        } else {
          startAtSec = target;
        }
      }
    }

    const timing =
      cfg.p2pEngineRef.current?.sync.getActiveKiteIntervalTiming() ??
      cfg.kiteIntervalTimingRef.current;
    const schedulerBpi = Math.max(1, Math.round(timing?.bpi ?? cfg.beatsPerInterval));

    const scheduler = createMetronomeScheduler(ctx, {
      bpm: cfg.metronomeBpm,
      beatsPerInterval: schedulerBpi,
      subdivision: 1,
      lookaheadMs: 25,
      scheduleAheadSec: 0.12,
      startAtSec,
      isExternalSync: cfg.role !== "host",
    });
    scheduler.start();

    const blinkTick = () => {
      const blinkCtx = configRef.current.getContext();
      if (!blinkCtx || blinkCtx.state === "closed") return;
      const now = blinkCtx.currentTime;
      const queue = metronomeBlinkQueueRef.current;

      while (queue.length > 0 && queue[0].startAt <= now) {
        const beat = queue.shift();
        const el = configRef.current.metronomeBlinkElementRef.current;
        if (beat && el) {
          el.classList.remove(
            "bg-emerald-400",
            "scale-125",
            "bg-emerald-600/60",
            "scale-110",
            "shadow-[0_0_8px_rgba(52,211,153,0.8)]"
          );
          void el.offsetWidth;
          if (beat.isAccent) {
            el.classList.add(
              "bg-emerald-400",
              "scale-125",
              "shadow-[0_0_8px_rgba(52,211,153,0.8)]"
            );
          } else {
            el.classList.add("bg-emerald-600/60", "scale-110");
          }
          window.setTimeout(() => {
            if (configRef.current.metronomeBlinkElementRef.current) {
              configRef.current.metronomeBlinkElementRef.current.classList.remove(
                "bg-emerald-400",
                "scale-125",
                "bg-emerald-600/60",
                "scale-110",
                "shadow-[0_0_8px_rgba(52,211,153,0.8)]"
              );
            }
          }, 100);
        }
      }
      metronomeBlinkRafIdRef.current = requestAnimationFrame(blinkTick);
    };
    metronomeBlinkRafIdRef.current = requestAnimationFrame(blinkTick);
    metronomeSchedulerRef.current = scheduler;
    if (metronomeGainRef.current) {
      metronomeGainRef.current.gain.value = cfg.metronomeVolumeRef.current ?? 0.85;
    }

    const pumpScheduler = () => {
      if (configRef.current.hardwareKillSwitchActiveRef.current) return;
      const activeScheduler = metronomeSchedulerRef.current;
      const activeCtx = configRef.current.getContext();
      if (!activeScheduler || !activeCtx || activeCtx.state !== "running") return;
      const nowSec = activeCtx.currentTime;
      const ticks = activeScheduler.consumeDueTicks(nowSec);
      const isCountIn =
        configRef.current.broadcastStatusRef.current === "syncing" ||
        (configRef.current.kiteSyncCountInActiveRef.current ?? false);
      for (const tick of ticks) {
        playMetronomeClick(activeCtx, tick.atSec, tick, metronomeGainRef.current, isCountIn);
      }
      configRef.current.p2pEngineRef.current?.sync?.onMetronomePumpTick(activeCtx, nowSec);
    };

    pumpScheduler();

    void (async () => {
      try {
        if (cancelled || ctx.state !== "running") return;
        const pump = await createMetronomePump(ctx, {
          pumpIntervalSec: scheduler.getLookaheadMs() / 1000,
        });
        const activeCtx = configRef.current.getContext();
        if (cancelled || !activeCtx || activeCtx.state !== "running") {
          pump.teardown();
          return;
        }
        metronomePumpRef.current = pump;
        pump.start(() => {
          pumpScheduler();
        });
      } catch (err) {
        console.error("[Metronome] AudioWorklet pump failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [
    config.kiteSyncEnabled,
    config.broadcastStatus,
    config.audioContextReady,
    config.kiteSyncNetworkMetronomePaused,
    config.kiteSyncMetronomeResumeNonce,
    config.metronomeBpm,
    config.beatsPerInterval,
    config.role,
    ensureGainNode,
    playMetronomeClick,
    stop,
  ]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    stop,
    ensureGainNode,
    metronomeGainRef,
  };
}
