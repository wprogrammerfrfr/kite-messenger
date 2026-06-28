# Kite Studio — Audio Engine Sync Diagnostic

**Date:** 2026-06-27  
**Scope:** Post–UI-loading optimization drift in Grid/Free looper modes  
**Verdict:** Hypothesis **partially confirmed**. The worklet sample clock is not wrong, but **Grid/Free transport anchors cross the React bridge using main-thread timing**, and startup currently **overlaps heavy UI work with engine bootstrap and first transport commands**. Handsfree avoids this by keeping handoffs inside `process()`.

---

## Executive Summary

| Mode | Transport authority | Drift risk |
|------|---------------------|------------|
| **Handsfree** | Worklet-only (`beginHandsfreeRecordingAtBoundary`) | Low |
| **Grid** | Main → Worklet via `recordStartContextSec`, `targetLengthFrames`, pedal stop | **High at startup** |
| **Free** | Main → Worklet via `recordStartContextSec` (start) + `stopAtContextSec` (stop) | **High at start + stop** |

The worklet does **not** use `performance.now()` or `Date.now()`. Drift comes from **when** main thread posts messages and **what** `AudioContext.currentTime` values it stamps.

---

## When Does the Worklet Clock Start?

The looper uses the AudioWorklet global `currentFrame` inside `process()`. The clock starts on the **first render quantum** after:

1. `AudioContext` is `"running"`
2. `solo-looper-processor` is instantiated and connected in `buildSoloLooperEngine()`

From the first `process()` call, the worklet fills the 1 s stereo ring buffer and advances playback cursors sample-by-sample. There is **no explicit warmup gate** before the first `START_RECORDING`.

---

## Startup Sequence (Solo Path)

```
Page mount (studio-bridge)
  └─ useKiteStudioEngine mount effect (RAF-deferred)
       └─ getUserMedia, rebuildMixer, session bootstrap

User: Enter Solo Studio (handleEnterSoloStudio)
  ├─ ctx.resume()
  ├─ await rebuildMixerAndReplaceTrack()
  ├─ setStudioUiPhase("studio")              ⚠️ UI FIRST (pre-fix)
  └─ await ensureSoloLooperEngineBootstrapped()

User: Record (handleRecordFirstLoop)
  ├─ await startLooperRunway (metronome pump)
  ├─ GO beat → scheduleSoloCountInDownbeat (RAF poll)  ⚠️
  └─ onDownbeat → await startSoloLooper() → START_RECORDING
```

---

## Main-Thread Blocking During Startup

| Call site | Sync impact |
|-----------|-------------|
| `setStudioUiPhase("studio")` before bootstrap | KiteLoopV4Panel hydrate + RAF loops compete with engine init |
| `scheduleSoloCountInDownbeat` | RAF polling — late downbeat if main thread busy |
| `await startSoloLooper` on GO | START_RECORDING posted after anchor time |
| `commitActiveRecording` (Free) | `stopAtContextSec: ctx.currentTime` at pedal-up |

---

## Grid vs Free vs Handsfree

**Grid:** `recordStartContextSec` deferred start; auto-stop via `targetLengthFrames` in worklet (stable after arm).

**Free:** stop boundary = main-thread `ctx.currentTime` at pedal handler — sensitive to event-loop delay.

**Handsfree:** `beginHandsfreeRecordingAtBoundary` runs in same `process()` frame as finalize — no port round-trip for T2–T4.

---

## Proposed Fix Summary

1. Bootstrap engine before `setStudioUiPhase("studio")`
2. Prefetch idle engine during preflight lobby
3. `LOOP_WARMED` handshake in worklet + `awaitWarmup()` in bridge
4. Replace RAF downbeat with metronome pump callback
5. Split `startSoloLooper` — sync `fireSoloLooperRecording` on downbeat
6. Audio-aligned Free mode stop anchor (optional)
7. Throttle startup RAF/port traffic

See `.cursor/plans/audio_sync_startup_fix_7e4a8729.plan.md` for implementation batches.

---

## Verification Matrix (production build)

Run `npm run build && npm run start`.

| Check | Pass criteria |
|-------|---------------|
| Grid Track 1 start | Loop boundary aligns with metronome (±1 quantum) under CPU throttle |
| Grid overdub T2 | Locks to master downbeat |
| Free mode | Loop length stable across 3 pedal cycles |
| Handsfree T1→T4 | No regression |
| P2P/Kite Sync | Host/guest jam unchanged |

Test sequence: localhost Chrome 2 tabs → same WiFi 2 devices → cross-network → restrictive campus WiFi.
