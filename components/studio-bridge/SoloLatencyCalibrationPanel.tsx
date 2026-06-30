"use client";

import React, { useState } from "react";
import { Zap } from "lucide-react";
import { getSoloLatencyQualityFeedback } from "@/lib/solo-latency-persistence";

export type SoloLatencyCalibrationPanelProps = {
  variant: "lobby" | "settings";
  latencyMs: number;
  entryLatencyMs: number;
  stale: boolean;
  staleMessage: string | null;
  status: "idle" | "warning" | "listening" | "success" | "error";
  message: string | null;
  disabled?: boolean;
  onCalibrate: (mode: "acoustic" | "interface") => void;
};

const ACOUSTIC_WARNING =
  "RTL CALIBRATION\n\n1. Keep your wired headphones plugged in.\n2. Find your laptop's built-in mic (usually a tiny hole next to the webcam or near the keyboard).\n3. Hold one headphone earcup directly against the mic.\n4. Hold it steady, then click OK to fire the ping.";

const INTERFACE_WARNING =
  "Unplug your instrument. Plug a standard audio cable directly from your interface's Output into its Input. Turn the input gain up.";

function calibrationStatusColor(
  status: SoloLatencyCalibrationPanelProps["status"]
): string {
  if (status === "success") return "text-emerald-400";
  if (status === "warning" || status === "error") return "text-orange-400";
  return "text-stone-400";
}

function qualityToneClass(tone: "error" | "good" | "fair"): string {
  if (tone === "error") return "text-red-400 border-red-500/35 bg-red-500/10";
  if (tone === "fair") return "text-amber-300 border-amber-500/35 bg-amber-500/10";
  return "text-emerald-400 border-emerald-500/35 bg-emerald-500/10";
}

export function SoloLatencyCalibrationPanel({
  variant,
  latencyMs,
  entryLatencyMs,
  stale,
  staleMessage,
  status,
  message,
  disabled = false,
  onCalibrate,
}: SoloLatencyCalibrationPanelProps): React.JSX.Element {
  const [calibrationMode, setCalibrationMode] = useState<"acoustic" | "interface">("acoustic");
  const calibrationBusy = status === "listening";
  const isLobby = variant === "lobby";

  const triggerCalibration = (mode: "acoustic" | "interface"): void => {
    const warningText = mode === "acoustic" ? ACOUSTIC_WARNING : INTERFACE_WARNING;
    if (!window.confirm(`${warningText}\n\nStart calibration now?`)) {
      return;
    }
    setCalibrationMode(mode);
    onCalibrate(mode);
  };

  const showLobbyQuality =
    isLobby && status === "success" && entryLatencyMs > 0;
  const qualityFeedback = showLobbyQuality
    ? getSoloLatencyQualityFeedback(entryLatencyMs)
    : null;

  if (isLobby) {
    return (
      <div className="mt-4 space-y-3 rounded-xl border border-white/[0.08] bg-stone-950/40 px-3 py-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
            Latency calibration
          </p>
          {latencyMs > 0 ? (
            <span className="font-mono text-[10px] text-stone-400">{latencyMs} ms RTL</span>
          ) : null}
        </div>

        {stale && staleMessage ? (
          <div
            className="rounded-lg border border-orange-500/35 bg-orange-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-orange-300"
            role="status"
          >
            {staleMessage}
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={disabled || calibrationBusy}
            onClick={() => triggerCalibration("acoustic")}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all ${
              calibrationMode === "acoustic"
                ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-400"
                : "border-emerald-500/25 bg-emerald-500/7 text-emerald-400/90 hover:border-emerald-500/40"
            } ${calibrationBusy ? "cursor-wait opacity-60" : ""}`}
          >
            <Zap size={12} />
            {calibrationBusy && calibrationMode === "acoustic"
              ? "Listening..."
              : "Calibrate Laptop/Mic (Acoustic)"}
          </button>
          <button
            type="button"
            disabled={disabled || calibrationBusy}
            onClick={() => triggerCalibration("interface")}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all ${
              calibrationMode === "interface"
                ? "border-emerald-500/40 bg-emerald-500/12 text-emerald-400"
                : "border-emerald-500/25 bg-emerald-500/7 text-emerald-400/90 hover:border-emerald-500/40"
            } ${calibrationBusy ? "cursor-wait opacity-60" : ""}`}
          >
            <Zap size={12} />
            {calibrationBusy && calibrationMode === "interface"
              ? "Listening..."
              : "Calibrate Interface (Cable Loopback)"}
          </button>
        </div>

        <p className="text-[10px] leading-relaxed text-orange-400/90">
          Hold wired headphones against the built-in mic, or loop interface out → in before calibrating.
        </p>

        {message ? (
          <div
            className={`rounded-lg border border-white/[0.12] bg-white/[0.03] px-2.5 py-2 text-[11px] leading-relaxed ${calibrationStatusColor(status)}`}
            role="status"
          >
            {message}
          </div>
        ) : null}

        {qualityFeedback ? (
          <div
            className={`rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed ${qualityToneClass(qualityFeedback.tone)}`}
            role="status"
          >
            {qualityFeedback.message}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      style={{
        borderTop: "1px solid rgba(255,255,255,0.05)",
        paddingTop: 12,
        marginTop: 4,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span
        style={{
          color: "rgba(255,255,255,0.22)",
          fontSize: 8,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
        }}
      >
        Latency Calibration
      </span>

      {stale && staleMessage ? (
        <div
          style={{
            borderRadius: 8,
            border: "1px solid rgba(255,69,0,0.35)",
            background: "rgba(255,69,0,0.08)",
            color: "#ff4500",
            fontSize: 9,
            lineHeight: 1.5,
            padding: "7px 8px",
          }}
          role="status"
        >
          {staleMessage}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          type="button"
          disabled={disabled || calibrationBusy}
          onClick={() => triggerCalibration("acoustic")}
          title={calibrationBusy ? "Calibration in progress" : "Calibrate over laptop speaker/mic path"}
          style={{
            padding: "8px 14px",
            border: "1px solid rgba(34,197,94,0.35)",
            background:
              calibrationMode === "acoustic" ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.07)",
            color: "#22c55e",
            fontSize: 11,
            cursor: calibrationBusy ? "wait" : "pointer",
            opacity: calibrationBusy ? 0.6 : 1,
            display: "flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 10,
            justifyContent: "center",
          }}
        >
          <Zap size={12} color="#22c55e" />{" "}
          {calibrationBusy && calibrationMode === "acoustic"
            ? "Listening..."
            : "Calibrate Laptop/Mic (Acoustic)"}
        </button>
        <button
          type="button"
          disabled={disabled || calibrationBusy}
          onClick={() => triggerCalibration("interface")}
          title={calibrationBusy ? "Calibration in progress" : "Calibrate with interface cable loopback"}
          style={{
            padding: "8px 14px",
            border: "1px solid rgba(34,197,94,0.35)",
            background:
              calibrationMode === "interface" ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.07)",
            color: "#22c55e",
            fontSize: 11,
            cursor: calibrationBusy ? "wait" : "pointer",
            opacity: calibrationBusy ? 0.6 : 1,
            display: "flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 10,
            justifyContent: "center",
          }}
        >
          <Zap size={12} color="#22c55e" />{" "}
          {calibrationBusy && calibrationMode === "interface"
            ? "Listening..."
            : "Calibrate Interface (Cable Loopback)"}
        </button>
      </div>

      {message ? (
        <div
          style={{
            borderRadius: 8,
            border: `1px solid ${
              status === "success"
                ? "rgba(34,197,94,0.4)"
                : status === "warning" || status === "error"
                  ? "rgba(255,69,0,0.35)"
                  : "rgba(255,255,255,0.12)"
            }`,
            background:
              status === "success"
                ? "rgba(34,197,94,0.08)"
                : status === "warning" || status === "error"
                  ? "rgba(255,69,0,0.08)"
                  : "rgba(255,255,255,0.04)",
            color:
              status === "success"
                ? "#22c55e"
                : status === "warning" || status === "error"
                  ? "#ff4500"
                  : "rgba(255,255,255,0.5)",
            fontSize: 9,
            lineHeight: 1.5,
            padding: "7px 8px",
          }}
          role="status"
        >
          {message}
        </div>
      ) : null}

      {latencyMs > 0 ? (
        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 9 }}>
          Applied RTL: {latencyMs} ms
        </span>
      ) : null}
    </div>
  );
}
