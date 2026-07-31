"use client";

/**
 * P2P Jam Session — Dummy UI sandbox (visual only).
 * Layout replicates the rough sketch: split-screen host/guest, header stats,
 * footer control bar, settings modal with old P2P controls.
 *
 * Preview: /sandbox/p2p-jam (route already exists).
 * NO audio engine, WebRTC, Supabase, or signaling wiring — dummy state only.
 */

import { useEffect, useRef, useState } from "react";
import {
  Settings,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  Circle,
  MessageSquare,
  X,
  Zap,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Brand tokens (mirrored from Kite Studio UI — charcoal, vibrant orange, emerald)

const ORANGE = "#ff4500";
const EMERALD = "#22c55e";

// Glow + glass tokens copied 1:1 from the Looper UI (KiteLoopV4Panel)
const STUDIO_GLOW_ROOT_BG =
  "radial-gradient(ellipse 140% 120% at 50% 38%, rgba(34, 197, 94, 0.32) 0%, rgba(255, 69, 0, 0.26) 28%, rgba(34, 197, 94, 0.14) 48%, rgba(0, 0, 0, 0.72) 78%, #000 100%)";
const STUDIO_GLOW_STAGE_BG =
  "radial-gradient(ellipse 115% 100% at 50% 50%, rgba(34, 197, 94, 0.30) 0%, rgba(255, 69, 0, 0.24) 38%, rgba(34, 197, 94, 0.12) 58%, rgba(0, 0, 0, 0.55) 82%, #000 100%)";
const STUDIO_GLOW_FRAME_SHADOW =
  "0 0 0 1px rgba(255,255,255,0.14), 0 0 48px rgba(34,197,94,0.55), 0 0 96px rgba(34,197,94,0.30), 0 0 140px rgba(255,69,0,0.35), 0 12px 48px rgba(0,0,0,0.55)";
const STUDIO_GLOW_VIGNETTE_BG =
  "radial-gradient(ellipse 85% 70% at 50% 45%, transparent 0%, rgba(0, 0, 0, 0.35) 72%, rgba(0, 0, 0, 0.65) 100%)";

/** Looper `glass` token as Tailwind classes: rgba(10,10,10,0.75) + blur(18px) + 1px white/8 border. */
const GLASS = "border border-white/[0.08] bg-[rgba(10,10,10,0.75)] backdrop-blur-[18px]";
/** Looper `glass` radius 18 / `glassSharp` radius 12. */
const GLASS_PANEL = `${GLASS} rounded-[18px]`;
const GLASS_SHARP = `${GLASS} rounded-xl`;

function logAction(actionName: string, value?: unknown): void {
  // Sandbox-only: nothing is wired to the real engine.
  console.log("[P2P_DUMMY_UI] Action: ", actionName, value ?? "");
}

// Dummy device lists — real enumeration arrives with engine wiring.
const DUMMY_INPUT_DEVICES = [
  { id: "default", label: "Default — Microphone Array" },
  { id: "usb-2ch", label: "USB Audio Interface (2ch)" },
  { id: "bt-headset", label: "Bluetooth Headset Mic" },
];
const DUMMY_OUTPUT_DEVICES = [
  { id: "default", label: "Default — Speakers" },
  { id: "usb-out", label: "USB Interface Out" },
  { id: "headphones", label: "Wired Headphones" },
];

type P2PSettingsState = {
  inputDeviceId: string;
  outputDeviceId: string;
  micMuted: boolean;
  speakerMuted: boolean;
  peerVolume: number; // 0–200 (%), mirrors remote playback volume 0–2
  autoBuffer: boolean;
  targetLeadFrames: number; // sync buffer lead, 480–19200
  liveMonitor: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Settings panel primitives (Tailwind)

function ToggleRow({
  label,
  sublabel,
  checked,
  onChange,
}: {
  label: string;
  sublabel?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[11px] text-white/65">{label}</div>
        {sublabel ? (
          <div className="mt-0.5 text-[9px] leading-relaxed text-white/30">{sublabel}</div>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full border-0 transition-colors ${
          checked ? "bg-[#22c55e]" : "bg-white/10"
        }`}
      >
        <span
          className="absolute top-[3px] block h-3.5 w-3.5 rounded-full bg-white transition-[left] duration-150"
          style={{ left: checked ? 19 : 3 }}
        />
      </button>
    </div>
  );
}

function DeviceSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] text-white/40">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full cursor-pointer rounded-lg border border-white/10 bg-black/45 px-2.5 py-2 text-[11px] text-white/80 outline-none"
      >
        {options.map((d) => (
          <option key={d.id} value={d.id} className="bg-stone-950">
            {d.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function P2PSettingsPanel({
  state,
  onUpdate,
  onClose,
}: {
  state: P2PSettingsState;
  onUpdate: (patch: Partial<P2PSettingsState>) => void;
  onClose: () => void;
}): React.JSX.Element {
  const leadMs = Math.round(state.targetLeadFrames / 48); // display-only, assumes 48kHz
  const leadPct = ((state.targetLeadFrames - 480) / (19200 - 480)) * 100;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="P2P Jam settings"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={`${GLASS_PANEL} pointer-events-auto relative z-10 flex max-h-[min(78vh,640px)] w-[360px] max-w-[calc(100vw-32px)] flex-col gap-4 overflow-y-auto p-4`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-bold text-white/85">Jam Settings</span>
        <button
          type="button"
          aria-label="Close settings"
          onClick={onClose}
          className="flex cursor-pointer border-0 bg-transparent p-1 text-white/50 hover:text-white/80"
        >
          <X size={14} />
        </button>
      </div>

      {/* Audio devices */}
      <div className="flex flex-col gap-2.5">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
          Audio Devices
        </span>
        <DeviceSelect
          label="Input device"
          value={state.inputDeviceId}
          options={DUMMY_INPUT_DEVICES}
          onChange={(id) => {
            logAction("select input device", id);
            onUpdate({ inputDeviceId: id });
          }}
        />
        <DeviceSelect
          label="Output device"
          value={state.outputDeviceId}
          options={DUMMY_OUTPUT_DEVICES}
          onChange={(id) => {
            logAction("select output device", id);
            onUpdate({ outputDeviceId: id });
          }}
        />
        <ToggleRow
          label="Interface live monitor"
          sublabel="Hear your own input through the interface (dummy)."
          checked={state.liveMonitor}
          onChange={(next) => {
            logAction("toggle live monitor", next);
            onUpdate({ liveMonitor: next });
          }}
        />
      </div>

      <div className="h-px bg-white/[0.06]" />

      {/* Peer mix */}
      <div className="flex flex-col gap-2.5">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
          Peer Mix
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={state.micMuted}
            onClick={() => {
              logAction("toggle mic mute", !state.micMuted);
              onUpdate({ micMuted: !state.micMuted });
            }}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border py-2 text-[11px] font-semibold transition-all ${
              state.micMuted
                ? "border-[#ff4500]/45 bg-[#ff4500]/10 text-[#ff4500]"
                : "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e]"
            }`}
          >
            {state.micMuted ? <MicOff size={12} /> : <Mic size={12} />}
            Mic
          </button>
          <button
            type="button"
            aria-pressed={state.speakerMuted}
            onClick={() => {
              logAction("toggle speaker mute", !state.speakerMuted);
              onUpdate({ speakerMuted: !state.speakerMuted });
            }}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border py-2 text-[11px] font-semibold transition-all ${
              state.speakerMuted
                ? "border-white/15 bg-white/[0.04] text-white/50"
                : "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e]"
            }`}
          >
            {state.speakerMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
            Speaker
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="min-w-[68px] text-[10px] text-white/40">Peer volume</span>
          <input
            type="range"
            className="kite-p2p-jam-slider h-1 flex-1 cursor-pointer appearance-none rounded-full outline-none"
            min={0}
            max={200}
            step={10}
            value={state.peerVolume}
            aria-label="Peer playback volume"
            onChange={(e) => {
              const next = Number(e.target.value);
              logAction("peer volume", `${next}%`);
              onUpdate({ peerVolume: next });
            }}
            style={{
              background: `linear-gradient(to right,${EMERALD} ${state.peerVolume / 2}%,rgba(255,255,255,0.08) ${state.peerVolume / 2}%)`,
            }}
          />
          <span className="min-w-[34px] text-right font-mono text-[10px] text-white/50">
            {state.peerVolume}%
          </span>
        </div>
      </div>

      <div className="h-px bg-white/[0.06]" />

      {/* Sync buffer */}
      <div className="flex flex-col gap-2.5">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
          Sync Buffer
        </span>
        <div className="flex items-center gap-3 font-mono text-[10px] text-white/50">
          <span>
            STATUS <span className="text-[#22c55e]">PRIMED</span>
          </span>
          <span>
            DEPTH <span className="text-white/80">{leadMs}</span>ms
          </span>
        </div>
        <ToggleRow
          label="Auto safety buffer"
          sublabel="Let the engine size the jitter buffer automatically."
          checked={state.autoBuffer}
          onChange={(next) => {
            logAction("toggle auto buffer", next ? "auto" : "manual");
            onUpdate({ autoBuffer: next });
          }}
        />
        <div
          className={`flex items-center gap-2 transition-opacity ${
            state.autoBuffer ? "opacity-45" : "opacity-100"
          }`}
        >
          <span className="min-w-[68px] text-[10px] text-white/40">Target lead</span>
          <input
            type="range"
            className="kite-p2p-jam-slider h-1 flex-1 appearance-none rounded-full outline-none"
            min={480}
            max={19200}
            step={120}
            value={state.targetLeadFrames}
            disabled={state.autoBuffer}
            aria-label="Sync buffer target lead frames"
            onChange={(e) => {
              const next = Number(e.target.value);
              logAction("target lead frames", next);
              onUpdate({ targetLeadFrames: next });
            }}
            style={{
              cursor: state.autoBuffer ? "not-allowed" : "pointer",
              background: `linear-gradient(to right,${ORANGE} ${leadPct}%,rgba(255,255,255,0.08) ${leadPct}%)`,
            }}
          />
          <span className="min-w-[44px] text-right font-mono text-[10px] text-white/50">
            {state.targetLeadFrames}f
          </span>
        </div>
      </div>

      <p className="m-0 text-[9px] leading-relaxed text-white/25">
        Dummy controls — interactions log to console only. No engine, WebRTC, or signaling
        is wired in this sandbox.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Live sound bar rail — exact Looper LIVE meter look: 18-segment stack
// (emerald → yellow → orange), bottom-anchored reveal mask, glass capsule pill.
// Dummy level is a random walk writing one style property via ref (no re-renders).

const LIVE_METER_SEGMENTS = Array.from({ length: 18 }, (_, i) => i);

function liveSegmentColor(i: number): string {
  return i >= 15 ? ORANGE : i >= 11 ? "#eab308" : EMERALD;
}

function LiveSoundBarRail(): React.JSX.Element {
  const maskRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let level = 42;
    const id = window.setInterval(() => {
      level = Math.max(12, Math.min(82, level + (Math.random() - 0.5) * 26));
      if (maskRef.current) maskRef.current.style.height = `${Math.round(level)}%`;
    }, 150);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className={`${GLASS} pointer-events-none absolute left-3 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-full px-[11px] py-[18px]`}>
      <div className="relative h-[231px] w-[10px]">
        {/* Dim background segments */}
        <div className="flex flex-col-reverse gap-[3px]">
          {LIVE_METER_SEGMENTS.map((i) => (
            <div
              key={i}
              className="h-[10px] w-[10px] rounded-[3px]"
              style={{ background: liveSegmentColor(i), opacity: 0.15 }}
            />
          ))}
        </div>
        {/* Bottom-anchored reveal mask — same mechanism as the Looper meter */}
        <div
          ref={maskRef}
          className="pointer-events-none absolute bottom-0 left-0 right-0 overflow-hidden"
          style={{ height: "0%", transition: "height 0.15s linear" }}
        >
          <div className="absolute bottom-0 left-0 right-0 flex flex-col-reverse gap-[3px]">
            {LIVE_METER_SEGMENTS.map((i) => (
              <div
                key={`fg-${i}`}
                className="h-[10px] w-[10px] rounded-[3px]"
                style={{ background: liveSegmentColor(i) }}
              />
            ))}
          </div>
        </div>
      </div>
      <span className="mt-1 rotate-180 font-mono text-[7px] tracking-[0.14em] text-white/15 [writing-mode:vertical-rl]">
        LIVE
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera placeholder — icon-free audio wave pulse when camera is off.
// Symmetric 13-bar waveform (scaleY keyframes), breathing halo, and slow
// expanding ripple rings signal "connected + audio flowing". GPU-only CSS.

const WAVE_BAR_HEIGHTS = [10, 18, 28, 40, 52, 62, 68, 62, 52, 40, 28, 18, 10] as const;

function CameraPane({
  role,
  accent,
  cameraOn,
}: {
  role: "Host" | "Guest";
  accent: "emerald" | "orange";
  cameraOn: boolean;
}): React.JSX.Element {
  const accentHex = accent === "emerald" ? EMERALD : ORANGE;
  const accentSoft =
    accent === "emerald" ? "rgba(34,197,94,0.14)" : "rgba(255,69,0,0.14)";
  const accentRing =
    accent === "emerald" ? "rgba(34,197,94,0.32)" : "rgba(255,69,0,0.32)";
  // Guest wave runs phase-shifted so the two panes never move in lockstep
  const waveOffsetMs = accent === "emerald" ? 0 : 320;
  return (
    <div className="relative flex min-w-0 flex-1 p-4">
      {/* Glass video frame — Looper webcam frame treatment (radius 14 + glow shadow) */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden rounded-[14px] bg-black/70"
        style={{ boxShadow: STUDIO_GLOW_FRAME_SHADOW }}
      >
        {cameraOn ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">
            Awaiting video…
          </span>
        ) : (
          <div className="relative flex flex-col items-center justify-center gap-6">
            {/* Breathing halo behind the waveform */}
            <div
              aria-hidden
              className="absolute h-56 w-56 rounded-full will-change-transform"
              style={{
                background: `radial-gradient(circle, ${accentSoft} 0%, transparent 68%)`,
                animation: "kiteP2pJamHalo 3.4s ease-in-out infinite alternate",
              }}
            />
            {/* Slow expanding ripple rings — "signal is transmitting" */}
            {[0, 1].map((r) => (
              <div
                key={r}
                aria-hidden
                className="absolute h-44 w-44 rounded-full border will-change-transform"
                style={{
                  borderColor: accentRing,
                  animation: `kiteP2pJamRipple 3.2s ease-out ${r * 1600 + waveOffsetMs}ms infinite`,
                }}
              />
            ))}
            {/* Symmetric audio waveform */}
            <div className="relative flex items-center gap-[5px]">
              {WAVE_BAR_HEIGHTS.map((h, i) => (
                <div
                  key={i}
                  aria-hidden
                  className="w-[5px] origin-center rounded-full will-change-transform"
                  style={{
                    height: h,
                    background: `linear-gradient(to top, ${accentHex}55, ${accentHex}d9)`,
                    boxShadow: `0 0 10px ${accentSoft}`,
                    animation: `kiteP2pJamWave ${0.8 + (i % 5) * 0.14}s ease-in-out ${i * 64 + waveOffsetMs}ms infinite alternate`,
                  }}
                />
              ))}
            </div>
            {/* Connection status — LED dot + copy, no icons */}
            <div className="relative flex items-center gap-2">
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: EMERALD,
                  boxShadow: "0 0 6px rgba(34,197,94,0.6)",
                  animation: "kiteP2pJamLed 2s ease-in-out infinite",
                }}
              />
              <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-white/45">
                {role === "Host" ? "Mic live · camera off" : "Peer connected · camera off"}
              </span>
            </div>
          </div>
        )}

        {/* Pane label — glassSharp chip */}
        <div className={`${GLASS_SHARP} absolute bottom-3 left-3 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/70`}>
          {role} Camera
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer pill toggle

function PillToggle({
  active,
  onClick,
  iconOn,
  iconOff,
  label,
}: {
  active: boolean;
  onClick: () => void;
  iconOn: React.ReactNode;
  iconOff: React.ReactNode;
  label: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-[11px] font-semibold backdrop-blur-[18px] transition-all ${
        active
          ? "border-[#22c55e]/45 bg-[#22c55e]/10 text-[#22c55e]"
          : "border-white/[0.08] bg-[rgba(10,10,10,0.75)] text-white/45"
      }`}
    >
      {active ? iconOn : iconOff}
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main sandbox component

export function P2PJamSandbox(): React.JSX.Element {
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<P2PSettingsState>({
    inputDeviceId: "default",
    outputDeviceId: "default",
    micMuted: false,
    speakerMuted: false,
    peerVolume: 100,
    autoBuffer: true,
    targetLeadFrames: 1920,
    liveMonitor: false,
  });

  const pingRef = useRef<HTMLSpanElement | null>(null);
  const delayRef = useRef<HTMLSpanElement | null>(null);

  // Mock header stats — single interval, ref textContent writes, no re-renders
  useEffect(() => {
    const id = window.setInterval(() => {
      const ping = 15 + Math.floor(Math.random() * 11); // 15–25
      const delay = 2 + Math.floor(Math.random() * 4); // 2–5
      if (pingRef.current) pingRef.current.textContent = String(ping);
      if (delayRef.current) delayRef.current.textContent = String(delay);
    }, 800);
    return () => window.clearInterval(id);
  }, []);

  // Escape closes settings — listener only while open
  useEffect(() => {
    if (!isSettingsOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setIsSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSettingsOpen]);

  const updateSettings = (patch: Partial<P2PSettingsState>): void => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex flex-col overflow-hidden font-sans text-white"
        style={{ background: STUDIO_GLOW_ROOT_BG }}
      >
        {/* Stage glow layer — Looper token, behind everything */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background: STUDIO_GLOW_STAGE_BG }}
        />
        {/* Vignette layer — Looper token */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{ background: STUDIO_GLOW_VIGNETTE_BG }}
        />

        {/* ── TOP HEADER ─────────────────────────────────────────────── */}
        <header className="relative z-30 flex items-start justify-between px-4 py-3">
          {/* Left — End Session (Looper red glassSharp) */}
          <button
            type="button"
            onClick={() => logAction("end session")}
            className="cursor-pointer rounded-xl border border-[rgba(248,113,113,0.7)] bg-[rgba(153,27,27,0.8)] px-4 py-1.5 text-[11px] font-bold text-red-100 backdrop-blur-[18px] transition-colors hover:bg-[rgba(153,27,27,0.95)]"
          >
            End Session
          </button>

          {/* Center — logo + live LED */}
          <div className="pointer-events-none absolute left-1/2 top-2 flex -translate-x-1/2 flex-col items-center">
            <h1
              className="m-0 text-[28px] font-extrabold tracking-tight"
              style={{
                backgroundImage: "linear-gradient(to right, #fb923c, #f5f5f4, #34d399)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Kite Studio
            </h1>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold lowercase tracking-[0.18em] text-red-500">
                live
              </span>
              <span
                className="h-2.5 w-2.5 rounded-full bg-red-500"
                style={{
                  boxShadow: "0 0 8px rgba(239,68,68,0.9)",
                  animation: "kiteP2pJamLed 2.2s infinite",
                }}
              />
            </div>
          </div>

          {/* Right — stats block + Record Jam */}
          <div className="flex items-center gap-3">
            <div className={`${GLASS} flex items-center divide-x divide-white/[0.08] rounded-full font-mono text-[10px] text-white/70`}>
              <span className="px-3 py-1.5">
                Ping: <span ref={pingRef} className="text-[#22c55e]">18</span>ms
              </span>
              <span className="px-3 py-1.5">
                Delay: <span ref={delayRef} className="text-[#22c55e]">3</span>ms
              </span>
            </div>
            <button
              type="button"
              aria-pressed={isRecording}
              onClick={() => {
                logAction("toggle record jam", !isRecording);
                setIsRecording((v) => !v);
              }}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-1.5 text-[11px] font-bold backdrop-blur-[18px] transition-colors ${
                isRecording
                  ? "border-[#ff4500]/45 bg-[#ff4500]/10 text-[#ff4500]"
                  : "border-red-500/50 bg-red-500/[0.06] text-red-200/90 hover:bg-red-500/10"
              }`}
            >
              {isRecording ? "Recording…" : "Record Jam"}
              <Circle
                size={11}
                className={isRecording ? "animate-pulse" : ""}
                style={{
                  color: isRecording ? "#ef4444" : ORANGE,
                  fill: isRecording ? "#ef4444" : "transparent",
                }}
              />
            </button>
          </div>
        </header>

        {/* ── MAIN BODY — 50/50 split screen ─────────────────────────── */}
        <main className="relative z-10 flex min-h-0 flex-1">
          <LiveSoundBarRail />

          <CameraPane role="Host" accent="emerald" cameraOn={cameraOn} />

          {/* Center dividing line */}
          <div aria-hidden className="w-px shrink-0 self-stretch bg-white/[0.14]" />

          <CameraPane role="Guest" accent="orange" cameraOn={cameraOn} />
        </main>

        {/* ── BOTTOM FOOTER — control panel (Looper glass bar) ─────────── */}
        <footer className="relative z-30 flex items-center gap-3 border-t border-white/[0.08] bg-[rgba(10,10,10,0.75)] px-4 py-3 backdrop-blur-[18px]">
          {/* Left — square Settings (glassSharp) */}
          <button
            type="button"
            aria-expanded={isSettingsOpen}
            onClick={() => setIsSettingsOpen(true)}
            className={`flex h-12 w-12 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border text-[8px] font-semibold uppercase tracking-wider backdrop-blur-[18px] transition-colors ${
              isSettingsOpen
                ? "border-[#ff4500]/40 bg-[#ff4500]/10 text-[#ff4500]"
                : "border-white/[0.08] bg-[rgba(10,10,10,0.75)] text-white/60 hover:bg-white/[0.06]"
            }`}
          >
            <Settings size={16} />
            Settings
          </button>

          {/* Center — pill toggles */}
          <div className="flex flex-1 items-center justify-center gap-3">
            <PillToggle
              active={micOn}
              onClick={() => {
                logAction("toggle mic", !micOn);
                setMicOn((v) => !v);
              }}
              iconOn={<Mic size={13} />}
              iconOff={<MicOff size={13} />}
              label={micOn ? "Mic on" : "Mic off"}
            />
            <PillToggle
              active={cameraOn}
              onClick={() => {
                logAction("toggle camera", !cameraOn);
                setCameraOn((v) => !v);
              }}
              iconOn={<Video size={13} />}
              iconOff={<VideoOff size={13} />}
              label={cameraOn ? "Camera on" : "Camera off"}
            />
            <PillToggle
              active={speakerOn}
              onClick={() => {
                logAction("toggle speaker", !speakerOn);
                setSpeakerOn((v) => !v);
              }}
              iconOn={<Volume2 size={13} />}
              iconOff={<VolumeX size={13} />}
              label={speakerOn ? "Speaker on" : "Speaker off"}
            />
          </div>

          {/* Right — square Chat (glassSharp) */}
          <button
            type="button"
            onClick={() => logAction("open chat")}
            className={`${GLASS_SHARP} flex h-12 w-12 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 text-[8px] font-semibold uppercase tracking-wider text-white/60 transition-colors hover:bg-white/[0.06]`}
          >
            <MessageSquare size={16} />
            Chat
          </button>

          {/* Far right — Start Kite Sync */}
          <button
            type="button"
            aria-pressed={isSyncing}
            onClick={() => {
              logAction("toggle kite sync", !isSyncing);
              setIsSyncing((v) => !v);
            }}
            className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border-2 px-5 py-3 text-[12px] font-extrabold uppercase tracking-wide backdrop-blur-[18px] transition-colors ${
              isSyncing
                ? "border-[#22c55e] bg-[#22c55e]/12 text-[#22c55e]"
                : "border-[#ff4500] bg-[#ff4500]/[0.06] text-[#ff4500] hover:bg-[#ff4500]/15"
            }`}
            style={{
              boxShadow: isSyncing
                ? "0 0 18px rgba(34,197,94,0.3)"
                : "0 0 18px rgba(255,69,0,0.25)",
            }}
          >
            <Zap size={14} />
            {isSyncing ? "Sync Active" : "Start Kite Sync"}
          </button>
        </footer>

        <style>{`
          @keyframes kiteP2pJamLed { 0%,100%{opacity:1} 50%{opacity:0.35} }
          @keyframes kiteP2pJamWave {
            0% { transform: scaleY(0.22); }
            100% { transform: scaleY(1); }
          }
          @keyframes kiteP2pJamRipple {
            0% { transform: scale(0.72); opacity: 0.45; }
            100% { transform: scale(1.48); opacity: 0; }
          }
          @keyframes kiteP2pJamHalo {
            0% { transform: scale(0.9); opacity: 0.55; }
            100% { transform: scale(1.1); opacity: 0.95; }
          }
          input[type=range].kite-p2p-jam-slider::-webkit-slider-thumb {
            -webkit-appearance:none; width:14px; height:14px; border-radius:50%;
            background:#22c55e; border:1px solid rgba(255,255,255,0.35); cursor:pointer;
            box-shadow:0 0 6px rgba(34,197,94,0.55);
          }
          input[type=range].kite-p2p-jam-slider::-moz-range-thumb {
            width:14px; height:14px; border-radius:50%; background:#22c55e;
            border:1px solid rgba(255,255,255,0.35); cursor:pointer;
            box-shadow:0 0 6px rgba(34,197,94,0.55);
          }
        `}</style>
      </div>

      {/* Settings overlay — sibling of root, last in return, escapes stacking contexts */}
      {isSettingsOpen ? (
        <div
          role="presentation"
          onClick={() => setIsSettingsOpen(false)}
          className="pointer-events-auto fixed inset-0 z-[9999] flex items-center justify-center bg-black/20 backdrop-blur-[3px]"
        >
          <P2PSettingsPanel
            state={settings}
            onUpdate={updateSettings}
            onClose={() => setIsSettingsOpen(false)}
          />
        </div>
      ) : null}
    </>
  );
}

export default P2PJamSandbox;
