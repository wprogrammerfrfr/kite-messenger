# Kite Studio Network QA Matrix (6×4)

**Gate:** Phase 6 exit only (24 signed runs). Phase 4 subset: localhost steps 1–3 + Grid Lock + Teardown + Drop.

## Environments (columns)

| Col | Environment | Proves |
|-----|-------------|--------|
| 1 | Localhost, two Chrome tabs | Signaling, graphs, sync without NAT |
| 2 | Same WiFi, two devices | LAN candidates |
| 3 | Different networks | Cross-NAT / STUN |
| 4 | Restrictive WiFi (relay) | TURN via `/api/turn-credentials` |

## Scenarios (rows)

| Row | Scenario | Pass criteria |
|-----|----------|---------------|
| 1 | Handshake | Connected, ping, raw remote VoIP audible |
| 2 | Buffer Prime | Buffering ON, worklet depth telemetry, auto-target vs RTT |
| 3 | Grid Lock | Count-in → guest align → Live → P2P chunks audible |
| 4 | Teardown | VoIP restore, graph rebuild, buffer flush |
| 5 | The Drop | WiFi off 3s, reconnect, no duplicate peers, audio recovers |
| 6 | The Exit | Guest leaves; host departed name correct |

## Global criteria (every cell)

- Zero console errors / unhandled rejections
- No sustained remote silence >500ms during Handshake, Grid Lock, or post-Drop recovery
- Console markers: `[P2P INTERVAL_READY] sent`, `[P2P TICK] loaded remote interval`, `[P2P HANDOFF]`

## Run log template

| Date | Tester | Row | Col | Pass | Notes | Relay proof |
|------|--------|-----|-----|------|-------|-------------|
| | | | | | | |

## Phase 4 quick checklist (localhost col 1 only)

- [ ] Handshake: remote room noise via metered-delay graph before Kite confirm
- [ ] Confirm Kite Sync (sync mode): auto count-in starts when remote stream present
- [ ] Grid Lock: dashboard shows Live; guest hears host via P2P after handoff log
- [ ] Teardown: Stop Kite Sync restores VoIP
- [ ] Drop: disable network 3s on guest; reconnect; `reigniteP2PEngine` restores jam
