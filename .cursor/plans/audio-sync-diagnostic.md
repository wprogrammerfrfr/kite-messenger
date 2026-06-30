# Kite Studio — Audio Engine Sync Diagnostic

**Date:** 2026-06-27 (updated 2026-06-29)  
**Scope:** Post–UI-loading optimization drift in Grid/Free looper modes  
**Verdict:** Hypothesis **confirmed**. The worklet sample clock is not wrong, but **Grid/Free transport anchors cross the React bridge using main-thread timing**, and startup **overlapped heavy UI work with engine bootstrap and first transport commands**. Handsfree avoids this by keeping handoffs inside `process()`.

---

## Historical regression audit

| Item | Value |
|------|-------|
| Stable Vercel deployment | `dpl_8cMJxfbo1EQfUhnmERxA9dcFK1si` |
| Stable git commit | **`6ff1722`** (handsfree mode, 2026-06-27 18:46:44 +0300) |
| Regression commit | **`e31a944`** (new landing ui, 2026-06-29) — `useKiteStudioEngine` + `KiteLoopV4Panel` diffs |
| Worklet | **`solo-looper-processor.js` identical** stable → HEAD — not the drift source |

**Fix status (2026-06-29):** Engine bootstrap before studio UI phase; PLAYBACK_UI_STATE cursor isolation + ref-driven lane fills; panel perf without visual rollback; hardened Free stop anchor.

---

## Executive Summary

| Mode | Transport authority | Drift risk |
|------|---------------------|------------|
| **Handsfree** | Worklet-only (`beginHandsfreeRecordingAtBoundary`) | Low |
| **Grid** | Main → Worklet via `recordStartContextSec`, `targetLengthFrames`, pedal stop | **High at startup** (pre-fix) |
| **Free** | Main → Worklet via `recordStartContextSec` (start) + `stopAtContextSec` (stop) | **High at start + stop** (pre-fix) |

The worklet does **not** use `performance.now()` or `Date.now()`. Drift comes from **when** main thread posts messages and **what** `AudioContext.currentTime` values it stamps.

---

## UI preservation contract (do not regress)

New loopstation UI from `e31a944` must remain intact when fixing timing:

- Studio glow letterbox (`STUDIO_GLOW_*`), webcam aspect frame + shadow
- Red idle Record Session button (`SESSION_COLORS.idle` `#ef4444`)
- Handsfree Mode toggle, calibration under BPM column
- Grid T1 metronome after auto-stop; Free T1 commit skips metronome stop
- `computeGridTargetLengthFrames`, `freePedalStopContextSecRef`, PLAYBACK_UI_STATE throttle fallback

**Out of scope:** landing page, auth, chat shell, worklet, P2P/Kite Sync.

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
  ├─ await ensureSoloLooperEngineBootstrapped()   ✅ post-fix
  └─ setStudioUiPhase("studio")

User: Record (handleRecordFirstLoop)
  ├─ await startLooperRunway (metronome pump)
  ├─ GO beat → scheduleSoloCountInDownbeat (RAF poll)  ⚠️
  └─ onDownbeat → await startSoloLooper() → START_RECORDING
```

---

## Main-Thread Blocking During Startup

| Call site | Sync impact |
|-----------|-------------|
| `setStudioUiPhase("studio")` before bootstrap (pre-fix) | KiteLoopV4Panel hydrate + RAF loops compete with engine init |
| `scheduleSoloCountInDownbeat` | RAF polling — late downbeat if main thread busy |
| `await startSoloLooper` on GO | START_RECORDING posted after anchor time |
| `commitActiveRecording` (Free) | `stopAtContextSec` from `freePedalStopContextSecRef` at pedal keydown |

---

## Grid vs Free vs Handsfree

**Grid:** `recordStartContextSec` deferred start; auto-stop via `targetLengthFrames` in worklet (stable after arm).

**Free:** stop boundary = `freePedalStopContextSecRef` sampled at earliest pedal keydown — sensitive to event-loop delay before sample.

**Handsfree:** `beginHandsfreeRecordingAtBoundary` runs in same `process()` frame as finalize — no port round-trip for T2–T4.

---

## React bridge (post-fix)

| Path | Behavior |
|------|----------|
| `PLAYBACK_UI_STATE` | `soloTrackSlotUiLatestRef` always updated; `setSoloTrackSlotUi` only on mode / interval / gain change |
| Lane fill animation | Ref-driven `scaleY` in panel rAF (reads latest ref snapshot) |
| `loopProgress` state | Secondary; lane UI does not depend on it |

---

## Proposed Fix Summary (implemented / remaining)

1. ✅ Bootstrap engine before `setStudioUiPhase("studio")`
2. ✅ PLAYBACK_UI_STATE structural isolation + ref-driven lane fills
3. ✅ Panel perf without glow rollback (resize ref layout, camera-only frame DOM)
4. ✅ Harden Free stop anchor (`onPedalDownPrepare` capture sampling)
5. Prefetch idle engine during preflight lobby (future)
6. `LOOP_WARMED` handshake (future)
7. Replace RAF downbeat with metronome pump callback (future)

---

## Verification Matrix (production build)

Run `npm run build && npm run start`.

### Audio

| Check | Pass criteria |
|-------|---------------|
| Grid Track 1 start | Loop boundary aligns with metronome (±1 quantum) under CPU throttle |
| Grid overdub T2 | Locks to master downbeat |
| Free mode | Loop length stable across 3 pedal cycles |
| Handsfree T1→T4 | No regression |
| Grid metronome | Audible after T1 auto-stop |
| P2P/Kite Sync | Host/guest jam unchanged |

### UI (no regressions)

| Check | Pass criteria |
|-------|---------------|
| Studio enter | Glow letterbox visible |
| Webcam toggle | Frame + shadow on picture; glow remains when off |
| Record Session idle | Red text/border |
| Settings Grid/Handsfree | Mutual exclusivity, Bar Count |
| Lane progress | Smooth fill during record/play |

Test sequence: localhost Chrome 2 tabs → same WiFi 2 devices → cross-network → restrictive campus WiFi.
