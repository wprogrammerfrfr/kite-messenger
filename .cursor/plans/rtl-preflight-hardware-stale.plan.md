---
name: RTL Preflight + Hardware Stale
overview: Extract shared RTL persistence and hardware fingerprinting, add a Hardware Change Detector, inject calibration controls into StudioPreflightLobby (keeping KiteLoopV4Panel controls), gate solo entry on valid non-stale calibration within 15–200ms, and show lobby-only quality feedback.
todos:
  - id: persistence-lib
    content: Create lib/solo-latency-persistence.ts (clamp 0–200, entry range 15–200, quality tier helper)
    status: pending
  - id: hardware-lib
    content: Create lib/solo-latency-hardware.ts (fingerprint build + stale compare)
    status: pending
  - id: hook-persistence
    content: "useKiteStudioEngine: import persistence; replace inline constants"
    status: pending
  - id: types-export
    content: "useKiteStudioEngine.types.ts: export stale + lastRawMeasuredMs fields"
    status: pending
  - id: hook-stale-state
    content: "useKiteStudioEngine: stale state, mount hydration, CALIBRATION_RESULT fingerprint + raw measured"
    status: pending
  - id: hook-detectors
    content: "useKiteStudioEngine: devicechange + toggleAudioDevice + track onended stale marking"
    status: pending
  - id: shared-panel
    content: Create SoloLatencyCalibrationPanel.tsx (lobby quality feedback; settings minimal)
    status: pending
  - id: preflight-inject
    content: "StudioPreflightLobby: inject panel below Before you enter checklist"
    status: pending
  - id: page-gating
    content: "page.tsx: wire props + canPracticeAlone stale + 15–200ms entry gate + button copy"
    status: pending
  - id: loopstation-panel
    content: "KiteLoopV4Panel: swap Settings calibration block for shared panel (settings variant)"
    status: pending
  - id: loopstation-slider
    content: "KiteLoopV4Panel: advanced RTL slider max 200 (was 120)"
    status: pending
isProject: false
---

# RTL Preflight + Hardware Stale Calibration Plan (v2)

See full plan: sync with `rtl_preflight_+_hardware_stale_3dbdb4a4.plan.md` in Cursor plans, or read sections below.

## v2 additions (summary)

1. **Max limits:** `clampSoloLatencyMs` and advanced slider both cap at **200 ms** (slider currently `max={120}` at KiteLoopV4Panel ~1305).
2. **Lobby-only quality feedback** in `SoloLatencyCalibrationPanel` when `variant === "lobby"` via `getSoloLatencyQualityFeedback(ms)` with tiers <15, 15–65, 66–150, 151–200, >200.
3. **Settings variant:** no quality tier text — calibrate controls + status only.
4. **Hard block:** `canPracticeAlone` requires `15 <= entryLatencyMs <= 200` plus calibrated + non-stale. Button copy: "Latency out of bounds. Re-calibrate" when out of range.
5. **Raw measured ms:** `soloLatencyLastRawMeasuredMs` on calibration success so >200 ms measurements block entry even though applied offset is clamped to 200.

## Execution phases (12 total, 1 file = 1 logical change)

| Phase | File | Change |
|-------|------|--------|
| 1 | `lib/solo-latency-persistence.ts` (new) | clamp 0–200, entry 15–200, quality helper, localStorage |
| 2 | `lib/solo-latency-hardware.ts` (new) | fingerprint + stale |
| 3 | `hooks/useKiteStudioEngine.ts` | import persistence |
| 4 | `hooks/useKiteStudioEngine.types.ts` | stale + lastRawMeasuredMs types |
| 5 | `hooks/useKiteStudioEngine.ts` | stale state, CALIBRATION_RESULT raw+fingerprint |
| 6 | `hooks/useKiteStudioEngine.ts` | devicechange stale |
| 7 | `hooks/useKiteStudioEngine.ts` | toggleAudioDevice + onended stale |
| 8 | `components/studio-bridge/SoloLatencyCalibrationPanel.tsx` (new) | lobby quality / settings minimal |
| 9 | `components/studio-bridge/StudioPreflightLobby.tsx` | inject panel |
| 10 | `app/studio-bridge/page.tsx` | gating + button copy |
| 11 | `components/kite-loop-v2/KiteLoopV4Panel.tsx` | shared settings panel |
| 12 | `components/kite-loop-v2/KiteLoopV4Panel.tsx` | slider max 200 |

Test order after each phase: localhost Chrome → same WiFi 2-device → cross-network → eduroam.
