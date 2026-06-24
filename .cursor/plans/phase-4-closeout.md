# Phase 4 Closeout — Kite Sync Engine Extraction

**Date:** 2026-06-05  
**Reference:** [Kite P2P Blueprint v3](file:///C:/Users/cjeon/.cursor/plans/kite_p2p_blueprint_v3_eab242b1.plan.md)

## Phase 4 batch status (4.1–4.11)

| Batch | Status |
|-------|--------|
| 4.1 Scaffold `useKiteSyncEngine` | Complete |
| 4.2 `handleKiteSyncMessage` | Complete |
| 4.3 `SET_INTERVAL` + chunk RX/send | Complete |
| 4.4 Grid scheduler + `advanceP2PGridBoundaries` | Complete |
| 4.5 `startP2PEngine` + VoIP mute | Complete |
| 4.6 `applyPacketLoss` | Complete |
| 4.7 Count-in + `onMetronomePumpTick` | Complete |
| 4.8 `cleanup()` P2P block | Complete |
| 4.9–4.10 Page wiring + collab subscriber split | Complete |
| 4.11 Encoding hygiene | Opportunistic |

## Ad-hoc recovery batches

| Batch | Status | Notes |
|-------|--------|-------|
| 4.15 Delayed VoIP takedown + chunk auto-ignite | Superseded by 4.17 | Concept retained; wiring fixed |
| 4.16 Reconnect resilience | Partial | ICE reconnect VoIP preserve kept; harmful gates reverted in 4.17 |
| **4.17 Audio handoff recovery** | **Complete** | `isP2PPlaybackActive`, `reigniteP2PEngine`, FIFO catch-up, VoIP teardown on grid pop |

## `subscribeTransport` decision

`KiteSyncEngineApi.subscribeTransport` remains a **noop** (`() => noopUnsubscribe`).

**Rationale (intentional page-owned subscriber):**

- Collab messages (`LEAVE`, `JAM_SETUP_LOCK`, `STUDIO_PARAM`, `presence`) stay in [`app/studio-bridge/page.tsx`](../app/studio-bridge/page.tsx) until Phase 5 LEAVE unify.
- Binary chunk + `KITE_SYNC` + `SET_INTERVAL` dispatch live in a page `useEffect` on `transportPort.subscribe` (~4146).
- Moving the subscriber into the hook would require passing collab delegate callbacks or splitting the subscriber twice — deferred to Phase 5 `useKiteP2PEngine` facade.

## Phase 4 exit gate

Run localhost gauntlet subset before Phase 5 sign-off:

1. Handshake — VoIP audible before count-in
2. Grid Lock — Count-in → Live → P2P intervals audible
3. Teardown — Stop sync → VoIP restores
4. The Drop — 3s WiFi off → reconnect → audio recovers

See [network-qa-matrix.md](./network-qa-matrix.md) for full 6×4 matrix (Phase 6).

## Phase 5 entry

[`hooks/useKiteP2PEngine.ts`](../hooks/useKiteP2PEngine.ts) composes transport + metered + sync with ordered session teardown and unified `handleCollaboratorLeave`.
