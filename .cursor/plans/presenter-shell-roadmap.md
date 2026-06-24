# Phase 6 — Presenter Shell Roadmap

## Completed in this pass

- [`hooks/useKiteP2PEngine.ts`](../hooks/useKiteP2PEngine.ts) — facade composes transport, metered delay, and sync engine
- [`hooks/useKiteStudioHost.ts`](../hooks/useKiteStudioHost.ts) — AudioContext factory, master destination, stream maps, VoIP clone refs, synchronous hardware kill-switch
- [`hooks/useKiteSyncMetronome.ts`](../hooks/useKiteSyncMetronome.ts) — Kite Sync metronome scheduler/pump (getContext only; no context resurrection)
- [`app/studio-bridge/page.tsx`](../app/studio-bridge/page.tsx) — wired through host + metronome hooks; bridge cleanup uses kill-switch before disconnect

## Remaining presenter slim-down (batch 6C)

| Batch | Target | Action |
|-------|--------|--------|
| 6C.1 | `page.tsx` | Collapse remaining ref bridges now owned by host/metronome hooks |
| 6C.2 | `page.tsx` | Move transport subscriber collab handlers behind facade callbacks |
| 6C.3 | `page.tsx` | Presenter-only state; aspirational ~4k–5k lines (currently ~8.8k) |

## Page responsibilities (presenter contract)

**Stays in page:**

- JSX / lobby / kite-setup UI
- Mixer, solo looper, metronome DOM
- `ensureStudioAudioContext`, device maps
- Collab subscriber (`LEAVE`, `JAM_SETUP_LOCK`, `STUDIO_PARAM`, `presence`)
- `performFullTeardown` body (solo, mixer, AudioContext)

**Owned by facade/hooks:**

- WebRTC transport lifecycle
- Metered-delay graph + stats
- Kite sync engine, grid FIFO, P2P capture/playback handoff

## Phase 6 exit

Execute all 24 cells in [network-qa-matrix.md](./network-qa-matrix.md) before production-ready tag.
