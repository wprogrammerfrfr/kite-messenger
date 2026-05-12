# Phase 5: Kite Sync Resiliency (Jitter Buffer & Audio Clock)

## Prime directive — strict boundaries

No modifications under any circumstances to:

- Local microphone acquisition or `activeStreamsMapRef` / `localMicStreamRef`
- Mixer routing (`rebuildMixerAndReplaceTrack`, `createLaneGraph`, lane graphs)
- Solo Looper (`startSoloLooper`, `solo-looper-processor.js`)
- Initial Data Channel connection setup
- Phase 1–4 signaling / routing semantics

**In scope:** Network-induced issues for **incoming remote intervals** only: jitter, packet loss handling at the consumer, and clock/grid alignment for remote playback.

---

## Architecture overview

| Step | Name | Intent |
|------|------|--------|
| **5.1** | Jitter buffer (FIFO) | Absorb early/late arrival of reassembled live intervals; **do not** treat `loadInterval` as a worklet-side queue. |
| **5.2** | Audio clock | Drive grid boundaries with `AudioContext.currentTime` (and existing timing math); schedule **when** to commit the next FIFO item to the engine. |
| **5.3** | Catch-up / safe drop | If FIFO depth exceeds policy (e.g. several intervals behind), **drop whole intervals** from the head until depth is safe — never violate the worklet’s single `pendingPlaybackBuffer`. |

---

## Step 5.1 — Jitter buffer (architectural approach)

### What the worklet actually guarantees (`kite-interval-processor.js`)

The processor maintains:

- **`playbackBuffer`** — PCM actively read in `readPlaybackSample` during the current interval cycle.
- **`pendingPlaybackBuffer`** — PCM loaded via `LOAD_INTERVAL` / `loadInterval()`; **not** output until `finishInterval()` runs.

**Failsafe semantics:** Remote audio must **not** replace buffers that are currently driving the speakers mid-interval. `loadInterval` only writes **`pendingPlaybackBuffer`** (overwrite). At each interval boundary, `finishInterval()` promotes `pendingPlaybackBuffer` → `playbackBuffer` (or leaves playback unchanged if pending is null).

**Critical constraint:** `pendingPlaybackBuffer` is a **single slot**. Each `loadInterval` **overwrites** it (lines 109–110). If the main thread posts **two** `LOAD_INTERVAL` messages before the worklet’s `finishInterval` promotes the first, or the browser delivers two handler runs in one quantum before audio advances, **only the last payload survives** — the same “packet massacre” class as the old single ref, but **inside the worklet**.

Therefore the jitter buffer FIFO **lives on the main thread** (page logic), and `kiteP2PEngineRef.current.loadInterval(...)` remains a **just-in-time** handoff: **at most one** `loadInterval` per **audio-grid boundary** (one promotion cycle in `finishInterval`), feeding the FIFO item that is **due** for that boundary.

### `loadInterval` path today (`lib/kite-interval-graph.ts`)

`KiteIntervalGraph.loadInterval` is a thin `postMessage` to the worklet with optional buffer transfer. It does not queue. Ordering and rate are entirely **caller** responsibility.

### Mapping network → buffer → engine

1. **Receive / reassemble (unchanged shape):** Data channel completes a live `ReassembledLoadInterval` → **push** to FIFO (never overwrite older assembled payloads).
2. **Grid tick (5.2):** When the audio clock says a boundary fires → **shift** at most **one** interval from the front of the FIFO (ordering: strict FIFO by completion unless a later step adds sequence-aware matching).
3. **Commit:** Call `loadInterval` **once** with that payload so `pendingPlaybackBuffer` holds exactly the next PCM to swap in at the next `finishInterval`.

### Preserving `pendingPlaybackBuffer` failsafe

- **Do not** “pipeline” multiple `loadInterval` calls for the **same upcoming** worklet boundary; that breaks the single pending slot.
- **Do not** add multi-deep remote buffering inside the worklet in 5.1 without a dedicated processor design (out of scope here).
- **Do** use FIFO **depth** to absorb **network** jitter (early arrivals wait; late arrivals show up as temporary depth / warns) and to feed **5.3** when depth explodes.

### Relationship to watchdog / “late” detection

Reframe any “queue empty before next tick” check: use **FIFO depth at boundary** vs **expected** steady-state depth, not a single nullable ref.

---

## Step 5.2 — Audio clock (summary)

- Replace timer-authoritative grid with **`AudioContext.currentTime`** on the session `AudioContext` already used by the Kite graph.
- Worker or pulse is **wake-only** if retained; **boundary decisions** on the main thread only.
- Each **confirmed** boundary schedules **one** FIFO shift + **one** `loadInterval` (subject to 5.3 dropping first).

Implementation file discipline (no forbidden areas): `public/worklets/kite-scheduler-worker.js`, [`lib/kite-scheduler-worker.ts`](c:\Users\cjeon\Desktop\INNER CIRCLE\lib\kite-scheduler-worker.ts), scheduler wiring in [`app/studio-bridge/page.tsx`](c:\Users\cjeon\Desktop\INNER CIRCLE\app\studio-bridge\page.tsx).

---

## Step 5.3 — Catch-up (summary)

- When FIFO length exceeds policy (e.g. “more than N intervals behind”): **drop from head** (discard whole old intervals) with logging/metrics until depth is acceptable.
- **Catch-up is not “send K `loadInterval`s in one main-thread turn.”** The worklet only buffers **one** pending interval ahead of playback. Being “K intervals late” means **skipping** K−1 (or more) queued intervals so the **single** next `loadInterval` aligns with the **next real** audio boundary you are playing.
- Prefer **whole-interval** drops so `intervalId` / grid expectations stay interpretable.

---

## Race / interaction notes (5.1 + 5.2 + 5.3)

- **Burst `loadInterval`:** Violates single `pendingPlaybackBuffer`; treat as a bug.
- **Audio thread vs main thread:** `finishInterval()` runs on the audio render cadence (`process`). Main thread must complete **one** `loadInterval` **early enough** that `pendingPlaybackBuffer` is set **before** the boundary that consumes it (classic **one-interval-ahead** pipeline). The FIFO ensures you have **payload ready** when that boundary approaches; it does not increase worklet depth.
- **Catch-up:** Advance logical grid / `nextGridTime` (5.2) and **drop** fifo head items in lockstep until one dequeue matches the next played slot — do not try to push multiple intervals through one pending slot.
