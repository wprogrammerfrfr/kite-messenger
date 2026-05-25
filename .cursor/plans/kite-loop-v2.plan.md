# Boss-505 Style 4-Track Solo Looper Upgrade (Kite Loop v2)

**Canonical artifact location:** `.cursor/plans/kite-loop-v2.plan.md`

## Global Constraints

- **Rule of One:** Each execution ticket modifies exactly one file and delivers one logical change. If a change would require touching two files, split into two tickets in dependency order.
- **P2P / Live Isolation:** Do not modify WebRTC signaling, peer DataChannel message schemas/handlers, live voice streaming graphs, or shared bridge modules such as `lib/studio-bridge-webrtc.ts`. Solo work stays completely in UI composition (`app/studio-bridge/page.tsx`), new `components/kite-loop-v2/`, new `hooks/useLooperFootPedal.ts`, `lib/solo-looper-engine.ts`, and `public/worklets/solo-looper-processor.js`. Note: `broadcastWizardStudioParam` already no-ops unless `kiteSetupOrigin === "connected"`; preserve that pattern so solo never emits wizard patches.
- **RAM Cap:** Enforce ≤ 60 s recorded audio per track at the engine layer (sample-accurate frame budgets), on top of Track 1 master length authority.
- **Pedal Semantics:** Track 1 loop length = time from record start (after 4-beat runway) to spacebar release (pedal up). Tracks 2–4 snap stop positions to the nearest integer multiple of Track 1’s frame length.

## Mandatory Verification Block (Every Ticket)

After completing each logical step below, run this matrix in order (no skipping). Record pass/fail per row.

| Stage | Environment | Verification Target |
| :--- | :--- | :--- |
| **A** | Localhost, Chrome, 2 tabs | studio-bridge loads; verify the changed surface only (solo looper / lobby routing); P2P tab smoke test: connect path remains completely unchanged. |
| **B** | Same WiFi (2 devices) | Desktop + mobile, two browsers — repeat Stage A checks on real physical devices. |
| **C** | Different networks | One WiFi, one cellular — P2P sessions still establish cleanly; solo mode still never touches or depends on peer connectivity. |
| **D** | Restrictive Network | eduroam-style profiles — same checks; note NAT/TURN behavior for live mode only; solo remains completely local-audio-only. |

---

## Phase 1 — Aggressive Deletion & Fast-Track Routing (Clean Slate)

*Target file for all Phase 1 tickets: `app/studio-bridge/page.tsx`*

- **P1-01: Practice Solo Fast-Track**
  Change the lobby "Practice Solo" control (currently calls `handleStartKiteSetup("lobby")` near the button at ~6378–6383) so it directly sets `kiteMode` to `"solo"`, sets `studioUiPhase` to `"studio"`, applies any minimal solo defaults (reusing existing `metronomeBpm` ➔ BPM state), and completely bypasses `kite-setup`. Preserve the exact mic/studio initialization execution order used by "Enter Studio".

- **P1-02: Connected Wizard Untouched**
  Audit call sites of `setStudioUiPhase("kite-setup")` / `handleStartKiteSetup` — ensure only the lobby solo link used the removed path; the `"connected"` origin must still open the 5-step setup wizard (~6402–6844). Verify zero behavioral changes for the sync/jam setup branches.

- **P1-03a: Remove Solo “Invite Bandmate / Go Live” Column**
  Delete the second grid column (7038–7054: “Go Live” / “Invite Bandmate” card) inside the `{kiteMode === "solo" ? ( ... )}` rendering block (6853+). Change the parent layout wrapper from `lg:grid-cols-[1.2fr_0.8fr]` to a clean, single-column, mobile-first layout structure for solo mode.

- **P1-03b: Remove Solo Room Code Block**
  Locate the `largeRoomCodeCard` rendering call site or room code display block positioned immediately above or within the solo layout boundary (~6851). Conditionally hide or completely omit this card when `kiteMode === "solo"`, ensuring a solo workstation layout displays absolutely no session room codes or sharing infrastructure.

- **P1-04: Dead Code Pruning (handleInviteBandmate)**
  Verify if `handleInviteBandmate` has zero remaining active references following the UI deletions. If clean, completely remove the callback and any specialized imports/types used exclusively by it. If still referenced elsewhere, document the reference site in the ticket notes and skip.

- **P1-05 to P1-12: Prune Solo-Only Wizard State Components**
  Remove or narrow `useState` hooks, references, and types tied to the legacy 5-step wizard once they are confirmed completely unused on the solo path (e.g., `kiteSetupStep`, `kiteSetupChordCount`, `kiteSetupUsesCustomChords`, time-signature / swing parameters if no longer bound to solo engine operations).
  *Dependency Note: Do not alter `deriveKiteTimingMetadata` or shared variables still required by the active `connected` setup flow; keep updates strictly limited to solo-specific scope.*

---

## Phase 2 — Component Extraction & Scaffolding

*New directory target: `components/kite-loop-v2/`*

- **P2-01: `components/kite-loop-v2/KiteLoopV2Panel.tsx`**
  Create the main shell layout component with a typed props stub definition; containing no business logic. Do not replace any code inside `page.tsx` yet.

- **P2-02: `components/kite-loop-v2/LooperCountdownConfig.tsx`**
  Scaffold the configuration interface stub for the BPM slider and Tap Tempo layout (props structure only).

- **P2-03: `components/kite-loop-v2/LooperCountdownRunway.tsx`**
  Scaffold the visual overlay component for the 4-beat flash runway UI (props: active beat index, phase tracking, `visualOnly` configuration flag).

- **P2-04: `components/kite-loop-v2/LooperTrackLane.tsx`**
  Scaffold the individual track row rendering block (props: track index, playback level fader, mute state, solo state, recording state layout).

- **P2-05: `components/kite-loop-v2/FourTrackLooperLanes.tsx`**
  Scaffold the multi-lane mixer container layout composing four distinct instances of `LooperTrackLane`.

- **P2-06: `app/studio-bridge/page.tsx` Integration**
  Excise the legacy solo rendering block (~6852–7037 region) and swap it to render `<KiteLoopV2Panel ... />`, cleanly piping down passthrough props from existing state handles/drivers. No new audio scheduling or worklet updates are introduced in this step.

---

## Phase 3 — Spacebar Pedal Hook & Input Safeguards

- **P3-01: `hooks/useLooperFootPedal.ts` Creation**
  Implement a custom hook attaching clean window `keydown`/`keyup` event listeners targeting the physical 'Space' key. Expose clear imperative callback handles: `onPedalDown`, `onPedalUp`, and `armContext`.

- **P3-02: `hooks/useLooperFootPedal.ts` Focus Guards**
  Implement ironclad input focus checking. If `document.activeElement` or the raw `event.target` matches an editable element container (`INPUT`, `TEXTAREA`, `SELECT`, or `contenteditable=true`), completely abort execution to allow normal spacebar character entry.

- **P3-03: `hooks/useLooperFootPedal.ts` Scroll Prevention**
  Inject `event.preventDefault()` handling targeting successfully matched spacebar pedal strikes outside of input focus boundaries, preventing erratic browser window layout scrolling during live performances.

- **P3-04: `app/studio-bridge/page.tsx` Hook Wiring**
  Wire the custom pedal hook to the dashboard state layer. Map physical pedal down/up actions directly to active transport handlers. No AudioWorklet code is changed yet.

---

## Phase 4 — Synchronous 4-Beat Runway Scheduler

- **P4-01: Legacy Timer Demolition**
  Identify and strip out legacy solo count-in components driven by non-AudioContext-locked intervals (e.g., tracking `setRecordingArmedCountdown`, `setVisualBeatState`, and old `scheduledMetronomeTimeoutsRef` calls on the solo execution paths).

- **P4-02: `lib/looper-runway-scheduler.ts` Implementation**
  Create a clock-isolated scheduler utility. Given the active `audioContext`, a target BPM, and a fixed count configuration of 4 beats, compute precise sample-accurate step timelines starting at `ctx.currentTime + ε`. Emitting beat steps via high-precision callbacks.

- **P4-03: `components/kite-loop-v2/LooperCountdownRunway.tsx` Sync**
  Subscribe the runway interface overlay directly to the new scheduler's beat emissions, executing a full-bleed layout flash synchronized with the underlying audio clock.

- **P4-04: Audio vs. Visual-Only Bleed Protection**
  Plumb a selectable `visualOnly` / "No Click Bleed" state flag directly into the runway scheduler path, completely silencing metronome audio outputs while running speaker-mode capture sessions to eliminate acoustic mic bleed.

- **P4-05: Transport Gate Integration**
  Enforce a hard state lock that arms active track recording streams *only* upon the successful firing of the final 4th-beat callback frame, rejecting overlapping arm requests.

---

## Phase 5 — Multitrack AudioWorklet Matrix (Core Math & Hardware Isolation)

- **P5-01: `public/worklets/solo-looper-processor.js` Extension**
  Expand the low-level processing message protocol contract to support targeted arrays: tracking parameters for track index parsing (1–4), `SELECT_TRACK` commands, individual track `intervalFrames` boundaries, and enforcement of the strict 60 s maximum layout buffer guard during initialization.

- **P5-02: Multi-Channel Interface Downmixing & Summing Bus**
  Upgrade the processor processing block to run a 4-slot independent memory buffer matrix.
  *INTERFACE SAFEGUARD:* Read all active physical input channels passed down from the streaming device hardware interface. Sum them sample-accurately down to a solid, centered dual-mono signal layout before writing into the active RAM recording buffer, guaranteeing instruments connected to Input 2+ are never lost or hard-panned. Sum active track playback channels into a single master output channel bus.

- **P5-03: `lib/solo-looper-engine.ts` Update**
  Mirror the multi-track structures inside the TypeScript wrapper engine layers. Ensure that the primary `MediaStreamAudioSourceNode` configures pass-through settings to stream raw, unconstrained native channel arrays directly from the interface hardware straight to the worklet thread processor.

- **P5-04: Track 1 Master Length Lock**
  Implement the "First Loop Authority" calculation engine side. On Track 1 pedal release up, compute the exact recorded frame delta; pass the `CONFIGURE_LOOP` layout parameters to fix Track 1's duration, rejecting inputs exceeding the 60 s RAM threshold.

- **P5-05: `lib/looper-multitrack-math.ts` Quantization Utility**
  Create a standalone math module providing `snapToMasterMultiple(partialFrames, masterFrames) ➔ integerMultiple`. Enforce strict rounding logic snapping manual spacebar turnaround stop frames cleanly to the closest absolute whole integer multiple ($N \ge 1$) of Track 1's clock footprint.

- **P5-06: Tracks 2–4 Quantized Clamping**
  Apply the quantization module calculations on manual spacebar stop events across Tracks 2 through 4. Execute a re-`CONFIGURE_LOOP` parameters adjustment to snap tracking buffers tightly to the master boundaries before completing the track recording state transaction.

- **P5-07: Mixer Dashboard Wiring & UI Feedback**
  Connect the full multitrack state architecture arrays directly to the `<FourTrackLooperLanes />` visual component grid, feeding live progress bars, independent track volume attenuation sliders, and mute parameters.

---

## Risk Register & Mitigations

- **BPM / Chord Coupling:** Track 1 manual pedal length completely supersedes historical grid frame calculations for solo mode. Keep regular P2P synchronization types completely separate and unedited.
- **Mobile Memory Conservation:** Enforce the hard 60 s maximum buffer ceiling both inside the React state validation blocks and directly within the Web Audio processing loop allocations to protect older client platforms.
- **Multi-Channel Hardware Verification:** Ensure that during **Matrix B** verification on Phase 5 execution, a multi-input interface is explicitly used to confirm that audio data hitting secondary input rails folds centered into the track buffer without dropping signal or adding asymmetric panning anomalies.
