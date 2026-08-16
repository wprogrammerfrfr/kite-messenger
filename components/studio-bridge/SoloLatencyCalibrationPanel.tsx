"use client";

import React, { useId } from "react";
import { SOLO_LATENCY_APPLIED_MAX_MS } from "@/lib/solo-latency-persistence";
import type { GuidedRtlWizardState } from "@/hooks/useKiteStudioEngine.types";

export type SoloLatencyCalibrationPanelProps = {
  variant: "lobby" | "settings" | "wizard";
  /** Committed applied RTL (for badge when wizard closed). */
  latencyMs: number;
  stale: boolean;
  staleMessage: string | null;
  disabled?: boolean;
  /**
   * True when any solo loop buffer already exists — recalibrate/confirm only affects new takes.
   */
  hasExistingLoops?: boolean;
  /** Guided wizard controller state from the engine. */
  wizard: GuidedRtlWizardState;
  onBeginWizard: () => void;
  onStartCapture: () => void;
  onPreviewLatencyMs: (ms: number) => void;
  /** Manual RTL without guided capture (lobby/settings when wizard closed). */
  onLatencyMsChange?: (ms: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRetryCapture: () => void;
};

function stepIndex(phase: GuidedRtlWizardState["phase"]): number {
  switch (phase) {
    case "metronome":
    case "countdown":
      return 1;
    case "capturing":
      return 2;
    case "transition":
      return 3;
    case "adjusting":
    case "confirming":
      return 4;
    case "error":
      return 0;
    default:
      return 0;
  }
}

function phaseTitle(phase: GuidedRtlWizardState["phase"]): string {
  switch (phase) {
    case "metronome":
    case "countdown":
      return "Step 1 — Count in";
    case "capturing":
      return "Step 2 — Record the click";
    case "transition":
      return "Step 3 — Ready to align";
    case "adjusting":
    case "confirming":
      return "Step 4 — Align with slider";
    case "error":
      return "Calibration needs a retry";
    default:
      return "RTL Calibration";
  }
}

/** Panel-owned status copy — ignore clap-oriented engine `wizard.message`. */
function phaseStatusMessage(
  wizard: GuidedRtlWizardState
): string | null {
  switch (wizard.phase) {
    case "metronome":
    case "countdown": {
      const remaining = wizard.countdownBeatRemaining;
      return remaining != null
        ? `Headphones off — wait for the click (${remaining})`
        : "Headphones off — wait for the click";
    }
    case "capturing": {
      const beat = wizard.captureBeatIndex;
      return beat != null
        ? `Keep headphones off — mic is recording the metronome (beat ${beat} of 4)`
        : "Keep headphones off — mic is recording the metronome";
    }
    case "transition":
      return "Clicks captured — drag until the two clicks become one.";
    case "adjusting":
    case "confirming":
      return "Drag until the two clicks become one, then confirm.";
    default:
      return null;
  }
}

export function SoloLatencyCalibrationPanel({
  variant,
  latencyMs,
  stale,
  staleMessage,
  disabled = false,
  hasExistingLoops = false,
  wizard,
  onBeginWizard,
  onStartCapture: _onStartCapture,
  onPreviewLatencyMs,
  onLatencyMsChange,
  onConfirm,
  onCancel,
  onRetryCapture,
}: SoloLatencyCalibrationPanelProps): React.JSX.Element {
  const sliderId = useId();
  const manualSliderId = useId();
  const isLobby = variant === "lobby";
  const isWizardOverlay = variant === "wizard";
  const busy =
    wizard.phase === "capturing" ||
    wizard.phase === "countdown" ||
    wizard.phase === "metronome" ||
    wizard.phase === "transition" ||
    wizard.phase === "confirming";
  const canInteract = !disabled && wizard.open;
  const showAdjust =
    wizard.open && (wizard.phase === "adjusting" || wizard.phase === "transition");
  const showConfirm =
    wizard.open && wizard.phase === "adjusting";
  const showCountdown =
    wizard.open &&
    (wizard.phase === "countdown" || wizard.phase === "metronome") &&
    wizard.countdownBeatRemaining != null;
  const showCaptureProgress = wizard.open && wizard.phase === "capturing";
  const progressPct = Math.round(Math.max(0, Math.min(1, wizard.captureProgress01)) * 100);
  const showManualSlider =
    !wizard.open &&
    !isWizardOverlay &&
    typeof onLatencyMsChange === "function";
  const showExistingLoopsWarning =
    hasExistingLoops &&
    (wizard.open || showManualSlider);

  const shellStyle: React.CSSProperties = isLobby
    ? {}
    : {
        borderTop: isWizardOverlay ? undefined : "1px solid rgba(255,255,255,0.05)",
        paddingTop: isWizardOverlay ? 0 : 12,
        marginTop: isWizardOverlay ? 0 : 4,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      };

  const cardClass = isLobby
    ? "mt-4 space-y-3 rounded-xl border border-white/[0.08] bg-stone-950/40 px-3 py-3.5"
    : undefined;

  const overlayClass = isWizardOverlay
    ? "fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
    : undefined;

  const warnStyle: React.CSSProperties | undefined = isLobby
    ? undefined
    : {
        borderRadius: 8,
        border: "1px solid rgba(251,191,36,0.35)",
        background: "rgba(251,191,36,0.08)",
        color: "#fbbf24",
        fontSize: 9,
        lineHeight: 1.5,
        padding: "7px 8px",
      };

  const inner = (
    <div className={cardClass} style={shellStyle}>
      <div
        className={isLobby ? "flex items-center justify-between gap-2" : undefined}
        style={
          isLobby
            ? undefined
            : { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }
        }
      >
        <p
          className={
            isLobby
              ? "text-[10px] font-semibold uppercase tracking-widest text-stone-500"
              : undefined
          }
          style={
            isLobby
              ? undefined
              : {
                  color: "rgba(255,255,255,0.22)",
                  fontSize: 8,
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                }
          }
        >
          {wizard.open ? phaseTitle(wizard.phase) : "Latency calibration"}
        </p>
        {!wizard.open && latencyMs > 0 ? (
          <span
            className={isLobby ? "font-mono text-[10px] text-stone-400" : undefined}
            style={isLobby ? undefined : { color: "rgba(255,255,255,0.35)", fontSize: 9 }}
          >
            {latencyMs} ms RTL
          </span>
        ) : wizard.open && stepIndex(wizard.phase) > 0 ? (
          <span
            className={isLobby ? "font-mono text-[10px] text-emerald-400" : undefined}
            style={isLobby ? undefined : { color: "#22c55e", fontSize: 9, fontFamily: "monospace" }}
          >
            {stepIndex(wizard.phase)} / 5
          </span>
        ) : null}
      </div>

      {stale && staleMessage ? (
        <div
          className={
            isLobby
              ? "rounded-lg border border-orange-500/35 bg-orange-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-orange-300"
              : undefined
          }
          style={
            isLobby
              ? undefined
              : {
                  borderRadius: 8,
                  border: "1px solid rgba(255,69,0,0.35)",
                  background: "rgba(255,69,0,0.08)",
                  color: "#ff4500",
                  fontSize: 9,
                  lineHeight: 1.5,
                  padding: "7px 8px",
                }
          }
          role="status"
        >
          {staleMessage}
        </div>
      ) : null}

      {showExistingLoopsWarning ? (
        <div
          className={
            isLobby
              ? "rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-200"
              : undefined
          }
          style={warnStyle}
          role="status"
        >
          Loops already recorded — a new RTL applies to new takes only. Use Stop &amp; Reset before
          re-aligning a long session.
        </div>
      ) : null}

      {!wizard.open ? (
        <div className={isLobby ? "flex flex-col gap-2" : undefined} style={isLobby ? undefined : { display: "flex", flexDirection: "column", gap: 8 }}>
          <p
            className={isLobby ? "text-[10px] leading-relaxed text-stone-400" : undefined}
            style={
              isLobby
                ? undefined
                : { color: "rgba(255,255,255,0.4)", fontSize: 9, lineHeight: 1.5 }
            }
          >
            Optional — set RTL on the slider and enter, or run guided click alignment (headphones
            off so the mic hears the metronome). Wear wired headphones after you confirm. Values
            persist for Solo Studio.
          </p>

          {showManualSlider ? (
            <div
              className={isLobby ? "space-y-2" : undefined}
              style={isLobby ? undefined : { display: "flex", flexDirection: "column", gap: 8 }}
            >
              <label
                htmlFor={manualSliderId}
                className={isLobby ? "text-[10px] text-stone-400" : undefined}
                style={isLobby ? undefined : { color: "rgba(255,255,255,0.4)", fontSize: 9 }}
              >
                Manual RTL compensation (0–{SOLO_LATENCY_APPLIED_MAX_MS} ms)
              </label>
              <div
                className={isLobby ? "flex items-center gap-2" : undefined}
                style={isLobby ? undefined : { display: "flex", alignItems: "center", gap: 8 }}
              >
                <input
                  id={manualSliderId}
                  type="range"
                  min={0}
                  max={SOLO_LATENCY_APPLIED_MAX_MS}
                  step={1}
                  value={latencyMs}
                  disabled={disabled}
                  aria-valuemin={0}
                  aria-valuemax={SOLO_LATENCY_APPLIED_MAX_MS}
                  aria-valuenow={latencyMs}
                  aria-label="Manual round-trip latency compensation in milliseconds"
                  onChange={(e) => onLatencyMsChange?.(Number(e.target.value))}
                  className={isLobby ? "flex-1 accent-emerald-500" : undefined}
                  style={
                    isLobby
                      ? undefined
                      : {
                          flex: 1,
                          accentColor: "#22c55e",
                          cursor: disabled ? "not-allowed" : "pointer",
                          height: 4,
                          appearance: "none",
                          WebkitAppearance: "none",
                          borderRadius: 9999,
                          outline: "none",
                          opacity: disabled ? 0.5 : 1,
                          background: `linear-gradient(to right,#22c55e ${(latencyMs / SOLO_LATENCY_APPLIED_MAX_MS) * 100}%,rgba(255,255,255,0.08) ${(latencyMs / SOLO_LATENCY_APPLIED_MAX_MS) * 100}%)`,
                        }
                  }
                />
                <span
                  className={
                    isLobby
                      ? "font-mono text-[10px] text-emerald-400 min-w-[38px] text-right"
                      : undefined
                  }
                  style={
                    isLobby
                      ? undefined
                      : {
                          color: "#22c55e",
                          fontSize: 10,
                          fontFamily: "monospace",
                          minWidth: 38,
                          textAlign: "right",
                        }
                  }
                >
                  {latencyMs}ms
                </span>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            disabled={disabled}
            onClick={onBeginWizard}
            className={
              isLobby
                ? `flex items-center justify-center rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-400 transition-all hover:border-emerald-500/50 ${disabled ? "cursor-not-allowed opacity-50" : ""}`
                : undefined
            }
            style={
              isLobby
                ? undefined
                : {
                    padding: "8px 14px",
                    border: "1px solid rgba(34,197,94,0.35)",
                    background: "rgba(34,197,94,0.1)",
                    color: "#22c55e",
                    fontSize: 11,
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.5 : 1,
                    borderRadius: 10,
                  }
            }
          >
            {stale ? "Re-calibrate RTL" : latencyMs > 0 ? "Recalibrate RTL" : "Start RTL calibration"}
          </button>
        </div>
      ) : (
        <div className={isLobby ? "space-y-3" : undefined} style={isLobby ? undefined : { display: "flex", flexDirection: "column", gap: 10 }}>
          {(() => {
            const status = phaseStatusMessage(wizard);
            if (!status) return null;
            return (
              <p
                className={isLobby ? "text-[11px] leading-relaxed text-stone-300" : undefined}
                style={
                  isLobby
                    ? undefined
                    : { color: "rgba(255,255,255,0.65)", fontSize: 10, lineHeight: 1.5 }
                }
                role="status"
              >
                {status}
              </p>
            );
          })()}

          {wizard.error ? (
            <div
              className={
                isLobby
                  ? "rounded-lg border border-orange-500/35 bg-orange-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-orange-300"
                  : undefined
              }
              style={
                isLobby
                  ? undefined
                  : {
                      borderRadius: 8,
                      border: "1px solid rgba(255,69,0,0.35)",
                      background: "rgba(255,69,0,0.08)",
                      color: "#ff4500",
                      fontSize: 9,
                      lineHeight: 1.5,
                      padding: "7px 8px",
                    }
              }
              role="alert"
            >
              {wizard.error}
            </div>
          ) : null}

          {showCountdown ? (
            <div
              className={isLobby ? "flex flex-col items-center gap-2 py-2" : undefined}
              style={
                isLobby
                  ? undefined
                  : {
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 0",
                    }
              }
            >
              <span
                className={isLobby ? "font-mono text-5xl font-bold text-emerald-400 tabular-nums" : undefined}
                style={
                  isLobby
                    ? undefined
                    : {
                        color: "#22c55e",
                        fontSize: 48,
                        fontWeight: 700,
                        fontFamily: "monospace",
                        lineHeight: 1,
                        fontVariantNumeric: "tabular-nums",
                      }
                }
                aria-live="polite"
              >
                {wizard.countdownBeatRemaining}
              </span>
              <p
                className={isLobby ? "text-[10px] text-stone-500" : undefined}
                style={isLobby ? undefined : { color: "rgba(255,255,255,0.35)", fontSize: 9 }}
              >
                Headphones off — wait for the click
              </p>
            </div>
          ) : null}

          {showCaptureProgress ? (
            <div
              className={isLobby ? "space-y-2" : undefined}
              style={isLobby ? undefined : { display: "flex", flexDirection: "column", gap: 8 }}
            >
              <p
                className={isLobby ? "text-[10px] font-medium text-emerald-400" : undefined}
                style={isLobby ? undefined : { color: "#22c55e", fontSize: 10, fontWeight: 600 }}
              >
                Recording the metronome
                {wizard.captureBeatIndex != null
                  ? ` — beat ${wizard.captureBeatIndex} of 4`
                  : " — four beats"}
              </p>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPct}
                aria-label="Metronome capture progress"
                className={isLobby ? "h-2 w-full overflow-hidden rounded-full bg-white/[0.08]" : undefined}
                style={
                  isLobby
                    ? undefined
                    : {
                        height: 8,
                        width: "100%",
                        overflow: "hidden",
                        borderRadius: 9999,
                        background: "rgba(255,255,255,0.08)",
                      }
                }
              >
                <div
                  className={isLobby ? "h-full rounded-full bg-emerald-500 transition-[width] duration-75" : undefined}
                  style={{
                    height: "100%",
                    width: `${progressPct}%`,
                    borderRadius: 9999,
                    background: "#22c55e",
                    transition: "width 75ms linear",
                  }}
                />
              </div>
              <p
                className={isLobby ? "text-[10px] text-stone-500 tabular-nums" : undefined}
                style={
                  isLobby
                    ? undefined
                    : {
                        color: "rgba(255,255,255,0.35)",
                        fontSize: 9,
                        fontVariantNumeric: "tabular-nums",
                      }
                }
              >
                {progressPct}%
              </p>
            </div>
          ) : null}

          {showAdjust ? (
            <div className={isLobby ? "space-y-2" : undefined} style={isLobby ? undefined : { display: "flex", flexDirection: "column", gap: 8 }}>
              <label
                htmlFor={sliderId}
                className={isLobby ? "text-[10px] text-stone-400" : undefined}
                style={isLobby ? undefined : { color: "rgba(255,255,255,0.4)", fontSize: 9 }}
              >
                RTL compensation (0–{SOLO_LATENCY_APPLIED_MAX_MS} ms)
              </label>
              <div
                className={isLobby ? "flex items-center gap-2" : undefined}
                style={isLobby ? undefined : { display: "flex", alignItems: "center", gap: 8 }}
              >
                <input
                  id={sliderId}
                  type="range"
                  min={0}
                  max={SOLO_LATENCY_APPLIED_MAX_MS}
                  step={1}
                  value={wizard.draftLatencyMs}
                  disabled={!canInteract || wizard.phase === "transition"}
                  aria-valuemin={0}
                  aria-valuemax={SOLO_LATENCY_APPLIED_MAX_MS}
                  aria-valuenow={wizard.draftLatencyMs}
                  aria-label="Round-trip latency compensation in milliseconds"
                  onChange={(e) => onPreviewLatencyMs(Number(e.target.value))}
                  className={isLobby ? "flex-1 accent-emerald-500" : undefined}
                  style={
                    isLobby
                      ? undefined
                      : {
                          flex: 1,
                          accentColor: "#22c55e",
                          cursor: "pointer",
                          height: 4,
                          appearance: "none",
                          WebkitAppearance: "none",
                          borderRadius: 9999,
                          outline: "none",
                          background: `linear-gradient(to right,#22c55e ${(wizard.draftLatencyMs / SOLO_LATENCY_APPLIED_MAX_MS) * 100}%,rgba(255,255,255,0.08) ${(wizard.draftLatencyMs / SOLO_LATENCY_APPLIED_MAX_MS) * 100}%)`,
                        }
                  }
                />
                <span
                  className={
                    isLobby
                      ? "font-mono text-[10px] text-emerald-400 min-w-[38px] text-right"
                      : undefined
                  }
                  style={
                    isLobby
                      ? undefined
                      : {
                          color: "#22c55e",
                          fontSize: 10,
                          fontFamily: "monospace",
                          minWidth: 38,
                          textAlign: "right",
                        }
                  }
                >
                  {wizard.draftLatencyMs}ms
                </span>
              </div>
              <p
                className={isLobby ? "text-[10px] text-stone-500" : undefined}
                style={isLobby ? undefined : { color: "rgba(255,255,255,0.35)", fontSize: 9 }}
              >
                Step 5 — Confirm when the two clicks become one. Cancel restores your previous value.
              </p>
            </div>
          ) : null}

          <div
            className={isLobby ? "flex flex-wrap gap-2" : undefined}
            style={isLobby ? undefined : { display: "flex", flexWrap: "wrap", gap: 8 }}
          >
            {wizard.phase === "error" || wizard.phase === "adjusting" ? (
              <button
                type="button"
                disabled={disabled}
                onClick={onRetryCapture}
                className={
                  isLobby
                    ? "rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 py-2 text-[10px] font-medium text-stone-300"
                    : undefined
                }
                style={
                  isLobby
                    ? undefined
                    : {
                        padding: "7px 12px",
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(255,255,255,0.04)",
                        color: "rgba(255,255,255,0.55)",
                        fontSize: 10,
                        borderRadius: 10,
                        cursor: "pointer",
                      }
                }
              >
                Retry capture
              </button>
            ) : null}

            {showConfirm ? (
              <button
                type="button"
                disabled={disabled || busy}
                onClick={onConfirm}
                className={
                  isLobby
                    ? "rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-[10px] font-semibold text-emerald-400"
                    : undefined
                }
                style={
                  isLobby
                    ? undefined
                    : {
                        padding: "7px 12px",
                        border: "1px solid rgba(34,197,94,0.4)",
                        background: "rgba(34,197,94,0.15)",
                        color: "#22c55e",
                        fontSize: 10,
                        fontWeight: 600,
                        borderRadius: 10,
                        cursor: "pointer",
                      }
                }
              >
                Confirm &amp; save
              </button>
            ) : null}

            <button
              type="button"
              disabled={disabled}
              onClick={onCancel}
              className={
                isLobby
                  ? "rounded-lg border border-white/[0.1] bg-transparent px-3 py-2 text-[10px] font-medium text-stone-500"
                  : undefined
              }
              style={
                isLobby
                  ? undefined
                  : {
                      padding: "7px 12px",
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "transparent",
                      color: "rgba(255,255,255,0.4)",
                      fontSize: 10,
                      borderRadius: 10,
                      cursor: "pointer",
                    }
              }
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (isWizardOverlay) {
    if (!wizard.open) {
      return inner;
    }
    return (
      <div className={overlayClass} role="dialog" aria-modal="true" aria-label="RTL calibration wizard">
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(12,12,12,0.96)",
            padding: 16,
            boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
          }}
        >
          {inner}
        </div>
      </div>
    );
  }

  return inner;
}
