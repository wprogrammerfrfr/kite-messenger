"use client";

/**
 * P2P Jam Session — port-driven presenter.
 * Split-screen host/guest, Looper-style input device panel, multi-step
 * Kite Sync setup wizard, settings modal, session chat.
 *
 * Zero engine imports. Every piece of data and every action comes from the
 * `port` prop (see P2PJamPresenter.types.ts). Local state is limited to
 * transient UI-only concerns: which overlay is open and the chat draft text.
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
  Send,
  Copy,
  X,
  Zap,
  ChevronRight,
} from "lucide-react";
import type {
  P2PJamPresenterPort,
  P2PJamWizardState,
  P2PJamChatMessage,
} from "@/components/studio-bridge/P2PJamPresenter.types";
import { KiteSyncTaskbarHelper } from "@/components/studio-bridge/KiteSyncTaskbarHelper";

// ─────────────────────────────────────────────────────────────────────────────
// Brand tokens (mirrored from Kite Studio UI — charcoal, vibrant orange, emerald)

const ORANGE = "#ff4500";
const EMERALD = "#22c55e";

// Glow tokens derived from the Looper UI (KiteLoopV4Panel), dialed down to a
// quiet studio ambience — near-black charcoal with a whisper of brand tint.
const STUDIO_GLOW_ROOT_BG =
  "radial-gradient(ellipse 140% 120% at 50% 38%, rgba(34, 197, 94, 0.10) 0%, rgba(255, 69, 0, 0.07) 28%, rgba(34, 197, 94, 0.04) 48%, rgba(0, 0, 0, 0.86) 78%, #000 100%)";
const STUDIO_GLOW_STAGE_BG =
  "radial-gradient(ellipse 115% 100% at 50% 50%, rgba(34, 197, 94, 0.08) 0%, rgba(255, 69, 0, 0.06) 38%, rgba(34, 197, 94, 0.03) 58%, rgba(0, 0, 0, 0.72) 82%, #000 100%)";
const STUDIO_GLOW_FRAME_SHADOW =
  "0 0 0 1px rgba(255,255,255,0.09), 0 18px 48px rgba(0,0,0,0.55), 0 0 40px rgba(34,197,94,0.08)";
const STUDIO_GLOW_VIGNETTE_BG =
  "radial-gradient(ellipse 85% 70% at 50% 45%, transparent 0%, rgba(0, 0, 0, 0.35) 72%, rgba(0, 0, 0, 0.65) 100%)";

/** Looper `glass` token as Tailwind classes: rgba(10,10,10,0.75) + blur(18px) + 1px white/8 border. */
const GLASS = "border border-white/[0.08] bg-[rgba(10,10,10,0.75)] backdrop-blur-[18px]";
/** Looper `glass` radius 18 / `glassSharp` radius 12. */
const GLASS_PANEL = `${GLASS} rounded-[18px]`;
const GLASS_SHARP = `${GLASS} rounded-xl`;

function formatRecordingTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function resolveTimeSignatureLabel(w: P2PJamWizardState): string {
  if (w.timeSignature === "custom") return `${w.customTop}/${w.customBottom}`;
  return w.timeSignature;
}

function resolveBarCount(w: P2PJamWizardState): number {
  return w.barCount === "custom" ? w.customBars : w.barCount;
}

function resolveBeatsPerBar(w: P2PJamWizardState): number {
  if (w.timeSignature === "custom") return Math.max(1, w.customTop);
  if (w.timeSignature === "3/4") return 3;
  if (w.timeSignature === "6/8") return 6;
  return 4;
}

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
  disabled,
  hint,
}: {
  label: string;
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
  disabled?: boolean;
  hint?: string;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] text-white/40">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-black/45 px-2.5 py-2 text-[11px] text-white/80 outline-none disabled:cursor-not-allowed disabled:opacity-40"
      >
        {options.map((d) => (
          <option key={d.id} value={d.id} className="bg-stone-950">
            {d.label}
          </option>
        ))}
      </select>
      {hint ? <span className="text-[9px] text-white/30">{hint}</span> : null}
    </label>
  );
}

function P2PSettingsPanel({
  port,
  onClose,
}: {
  port: P2PJamPresenterPort;
  onClose: () => void;
}): React.JSX.Element {
  const { settings, onSettingsUpdate } = port;
  const leadMs = Math.round(settings.targetLeadFrames / 48); // display-only, assumes 48kHz
  const leadPct = ((settings.targetLeadFrames - 480) / (19200 - 480)) * 100;
  const bpmPct = ((settings.metronomeBpm - 40) / (240 - 40)) * 100;
  const peerControlsDisabled = port.syncCountInBlocksLive;
  const bufferControlsDisabled = settings.autoBuffer || !settings.bufferingEnabled;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="P2P Jam settings"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={`${GLASS_PANEL} pointer-events-auto relative z-10 flex max-h-[min(78dvh,640px)] w-[360px] max-w-[calc(100vw-32px)] flex-col gap-4 overflow-y-auto p-4`}
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

      {/* Output only — input routing lives in the Input Device panel */}
      <div className="flex flex-col gap-2.5">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
          Output
        </span>
        <DeviceSelect
          label="Output device"
          value={settings.outputDeviceId}
          options={port.outputDeviceOptions}
          disabled={!port.outputDeviceSelectable}
          hint={
            port.outputDeviceSelectable
              ? undefined
              : "Coming soon — output routing arrives with device enumeration."
          }
          onChange={(id) => onSettingsUpdate({ outputDeviceId: id })}
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
            aria-pressed={!port.micOn}
            disabled={peerControlsDisabled}
            onClick={port.onToggleMic}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-[11px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
              peerControlsDisabled ? "" : "cursor-pointer"
            } ${
              !port.micOn
                ? "border-[#ff4500]/45 bg-[#ff4500]/10 text-[#ff4500]"
                : "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e]"
            }`}
          >
            {port.micOn ? <Mic size={12} /> : <MicOff size={12} />}
            Mic
          </button>
          <button
            type="button"
            aria-pressed={!port.speakerOn}
            disabled={peerControlsDisabled}
            onClick={port.onToggleSpeaker}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-[11px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
              peerControlsDisabled ? "" : "cursor-pointer"
            } ${
              !port.speakerOn
                ? "border-white/15 bg-white/[0.04] text-white/50"
                : "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e]"
            }`}
          >
            {port.speakerOn ? <Volume2 size={12} /> : <VolumeX size={12} />}
            Speaker
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="min-w-[68px] text-[10px] text-white/40">Peer volume</span>
          <input
            type="range"
            className="kite-p2p-jam-slider h-1 flex-1 cursor-pointer appearance-none rounded-full outline-none disabled:cursor-not-allowed disabled:opacity-40"
            min={0}
            max={200}
            step={10}
            value={port.peerVolumePercent}
            disabled={peerControlsDisabled}
            aria-label="Peer playback volume"
            onChange={(e) => port.onPeerVolumeChange(Number(e.target.value))}
            style={{
              background: `linear-gradient(to right,${EMERALD} ${port.peerVolumePercent / 2}%,rgba(255,255,255,0.08) ${port.peerVolumePercent / 2}%)`,
            }}
          />
          <span className="min-w-[34px] text-right font-mono text-[10px] text-white/50">
            {port.peerVolumePercent}%
          </span>
        </div>
      </div>

      <div className="h-px bg-white/[0.06]" />

      {/* Sync buffer */}
      <div className="flex flex-col gap-2.5">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
          Sync Buffer
        </span>
        <ToggleRow
          label="Buffering enabled"
          sublabel="Applies the jitter buffer to incoming peer audio."
          checked={settings.bufferingEnabled}
          onChange={(next) => onSettingsUpdate({ bufferingEnabled: next })}
        />
        <ToggleRow
          label="Echo safety mode"
          sublabel="Reduces gain automatically when feedback risk is detected."
          checked={settings.echoSafetyMode}
          onChange={(next) => onSettingsUpdate({ echoSafetyMode: next })}
        />
        <div className="flex items-center gap-3 font-mono text-[10px] text-white/50">
          <span>
            STATUS{" "}
            <span className={port.isBufferPrimed ? "text-[#22c55e]" : "text-[#ff4500]"}>
              {port.isBufferPrimed ? "PRIMED" : "PRIMING"}
            </span>
          </span>
          <span>
            DEPTH <span className="text-white/80">{Math.round(port.bufferDepthFrames / 48)}</span>ms
          </span>
        </div>
        <ToggleRow
          label="Auto safety buffer"
          sublabel="Let the engine size the jitter buffer automatically."
          checked={settings.autoBuffer}
          onChange={(next) => onSettingsUpdate({ autoBuffer: next })}
        />
        <div
          className={`flex items-center gap-2 transition-opacity ${
            bufferControlsDisabled ? "opacity-45" : "opacity-100"
          }`}
        >
          <span className="min-w-[68px] text-[10px] text-white/40">Target lead</span>
          <input
            type="range"
            className="kite-p2p-jam-slider h-1 flex-1 appearance-none rounded-full outline-none"
            min={480}
            max={19200}
            step={120}
            value={settings.targetLeadFrames}
            disabled={bufferControlsDisabled}
            aria-label="Sync buffer target lead frames"
            onChange={(e) => onSettingsUpdate({ targetLeadFrames: Number(e.target.value) })}
            style={{
              cursor: bufferControlsDisabled ? "not-allowed" : "pointer",
              background: `linear-gradient(to right,${ORANGE} ${leadPct}%,rgba(255,255,255,0.08) ${leadPct}%)`,
            }}
          />
          <span className="min-w-[44px] text-right font-mono text-[10px] text-white/50">
            {settings.targetLeadFrames}f
          </span>
        </div>
        {port.lastCorrectionEvent ? (
          <p className="m-0 text-[9px] leading-relaxed text-white/30">
            Last correction: {port.lastCorrectionEvent}
          </p>
        ) : null}
      </div>

      <div className="h-px bg-white/[0.06]" />

      {/* Metronome */}
      <div className="flex flex-col gap-2.5">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
          Metronome
        </span>
        <ToggleRow
          label="Visual metronome only"
          sublabel="Mute the click and rely on the blink indicator."
          checked={settings.visualMetronomeOnly}
          onChange={(next) => onSettingsUpdate({ visualMetronomeOnly: next })}
        />
        <div className="flex items-center gap-2">
          <span className="min-w-[68px] text-[10px] text-white/40">Volume</span>
          <input
            type="range"
            className="kite-p2p-jam-slider h-1 flex-1 cursor-pointer appearance-none rounded-full outline-none"
            min={0}
            max={100}
            value={settings.metronomeVolume}
            aria-label="Metronome volume"
            onChange={(e) => onSettingsUpdate({ metronomeVolume: Number(e.target.value) })}
            style={{
              background: `linear-gradient(to right,${EMERALD} ${settings.metronomeVolume}%,rgba(255,255,255,0.08) ${settings.metronomeVolume}%)`,
            }}
          />
          <span className="min-w-[34px] text-right font-mono text-[10px] text-white/50">
            {settings.metronomeVolume}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="min-w-[68px] text-[10px] text-white/40">Tempo</span>
          <input
            type="range"
            className="kite-p2p-jam-slider h-1 flex-1 cursor-pointer appearance-none rounded-full outline-none"
            min={40}
            max={240}
            value={settings.metronomeBpm}
            aria-label="Metronome tempo"
            onChange={(e) => onSettingsUpdate({ metronomeBpm: Number(e.target.value) })}
            style={{
              background: `linear-gradient(to right,${ORANGE} ${bpmPct}%,rgba(255,255,255,0.08) ${bpmPct}%)`,
            }}
          />
          <span className="min-w-[40px] text-right font-mono text-[10px] text-white/50">
            {settings.metronomeBpm}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Device panel — Looper InputModal visual structure

/** Dense Looper-style level meter segments (bottom green → top orange/red). */
const MINI_METER_COLORS = [
  "#22c55e",
  "#22c55e",
  "#22c55e",
  "#22c55e",
  "#22c55e",
  "#22c55e",
  "#22c55e",
  "#22c55e",
  "#eab308",
  "#f97316",
  "#ff4500",
  "#ef4444",
] as const;

function MiniMeter({
  id,
  active,
  isDummyMode,
  registerMixerMeterElement,
}: {
  id: string;
  active: boolean;
  isDummyMode: boolean;
  registerMixerMeterElement: (laneKey: string, el: HTMLDivElement | null) => void;
}): React.JSX.Element {
  const maskRef = useRef<HTMLDivElement | null>(null);
  const proxyRef = useRef<HTMLDivElement | null>(null);
  const laneKey = `${id}:ch0`;

  useEffect(() => {
    // Live: engine writes width% on the hidden proxy; mirror to vertical mask height.
    if (!isDummyMode) {
      if (!active && maskRef.current) maskRef.current.style.height = "8%";
      let raf = 0;
      let last = 0;
      const tick = (now: number) => {
        if (now - last >= 66) {
          last = now;
          if (active && proxyRef.current && maskRef.current) {
            const pct = parseFloat(proxyRef.current.style.width || "0");
            if (Number.isFinite(pct)) {
              maskRef.current.style.height = `${Math.max(8, Math.min(100, pct))}%`;
            }
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    if (!active) {
      if (maskRef.current) maskRef.current.style.height = "8%";
      return;
    }
    // Dummy / no-signal motion only
    let level = 36;
    const intervalId = window.setInterval(() => {
      level = Math.max(12, Math.min(92, level + (Math.random() - 0.5) * 30));
      if (maskRef.current) maskRef.current.style.height = `${Math.round(level)}%`;
    }, 140);
    return () => window.clearInterval(intervalId);
  }, [active, isDummyMode]);

  return (
    <div className="relative h-[72px] w-[8px] shrink-0">
      {/* Hidden proxy — engine writes style.width; we mirror to mask height. */}
      <div
        ref={(el) => {
          proxyRef.current = el;
          if (!isDummyMode) registerMixerMeterElement(laneKey, el);
        }}
        aria-hidden
        className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
        style={{ width: "0%" }}
      />
      <div className="absolute inset-0 flex flex-col-reverse justify-between opacity-15">
        {MINI_METER_COLORS.map((c, i) => (
          <div key={i} className="h-[4px] w-full shrink-0 rounded-[2px]" style={{ background: c }} />
        ))}
      </div>
      <div
        ref={maskRef}
        className="absolute bottom-0 left-0 right-0 overflow-hidden"
        style={{ height: "8%", transition: "height 0.1s linear" }}
      >
        <div className="absolute bottom-0 left-0 right-0 flex h-[72px] flex-col-reverse justify-between">
          {MINI_METER_COLORS.map((c, i) => (
            <div key={`fg-${i}`} className="h-[4px] w-full shrink-0 rounded-[2px]" style={{ background: c }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function P2PInputDevicePanel({
  port,
  onClose,
}: {
  port: P2PJamPresenterPort;
  onClose: () => void;
}): React.JSX.Element {
  const {
    inputPanel,
    maxActiveInputs,
    onToggleInputDevice,
    onFocusInputDevice,
    onSetInputGain,
    onSetInterfaceFlag,
    onSetLiveMonitorFlag,
    registerMixerMeterElement,
    isDummyMode,
  } = port;
  const atCap = inputPanel.activeIds.length >= maxActiveInputs;
  const focused = inputPanel.devices.find((d) => d.id === inputPanel.focusedId) ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Input device"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={`${GLASS_PANEL} pointer-events-auto relative z-10 flex h-[min(80dvh,550px)] w-[min(600px,calc(100vw-32px))] flex-col overflow-hidden`}
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-[18px] pb-3.5 pt-4">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-white/75">
          <Mic size={12} color={EMERALD} /> Input Device
        </span>
        <button
          type="button"
          aria-label="Close input panel"
          onClick={onClose}
          className="cursor-pointer border-0 bg-transparent text-[20px] leading-none text-white/30 hover:text-white/60"
        >
          ×
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-row overflow-hidden pt-3.5">
        {/* Left — Available Sources */}
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-4 pb-4 pl-[18px]">
          <span className="mb-0.5 font-mono text-[8px] uppercase tracking-[0.22em] text-white/22">
            Available Sources
          </span>
          {inputPanel.devices.map((d) => {
            const active = inputPanel.activeIds.includes(d.id);
            const blocked = !active && atCap;
            return (
              <button
                key={d.id}
                type="button"
                title={blocked ? `Maximum ${maxActiveInputs} active inputs` : undefined}
                disabled={blocked}
                onClick={() => onToggleInputDevice(d.id)}
                className={`flex w-full cursor-pointer items-center gap-2.5 rounded-[11px] border px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-45 ${
                  active
                    ? "border-[#22c55e]/50 bg-[#22c55e]/[0.08]"
                    : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]"
                }`}
              >
                <input
                  type="checkbox"
                  readOnly
                  checked={active}
                  tabIndex={-1}
                  className="h-3.5 w-3.5 shrink-0"
                  style={{ accentColor: EMERALD }}
                />
                <span
                  className={`flex-1 truncate text-[12px] ${
                    active ? "text-[#22c55e]" : "text-white/52"
                  }`}
                >
                  {d.label}
                </span>
                <MiniMeter
                  id={d.id}
                  active={active}
                  isDummyMode={isDummyMode}
                  registerMixerMeterElement={registerMixerMeterElement}
                />
              </button>
            );
          })}
          <p className="mt-1 text-[9px] leading-relaxed text-white/18">
            Use your own monitor if you have an interface.
          </p>
        </div>

        <div aria-hidden className="w-px shrink-0 self-stretch bg-white/[0.06]" />

        {/* Right — Focused Input */}
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-[18px] pb-4 pl-4">
          <div>
            <span className="font-mono text-[8px] uppercase tracking-[0.22em] text-white/22">
              Focused Input
            </span>
            {focused == null ? (
              <div className="mt-2.5 text-[12px] leading-relaxed text-white/35">
                Activate an input on the left to edit routing and gains.
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onFocusInputDevice(focused.id)}
                className="mt-1 block cursor-default border-0 bg-transparent p-0 text-left text-[13px] font-semibold text-[#22c55e]"
              >
                {focused.label}
              </button>
            )}
          </div>

          {focused != null ? (
            <>
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-medium uppercase tracking-widest text-emerald-500">
                  Gain
                </span>
                <label className="flex items-center gap-2">
                  <span className="min-w-[56px] text-[10px] text-white/40">
                    {focused.channels >= 2 ? "Ch 1 (L)" : "Ch 1"}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={inputPanel.gains[`${focused.id}:ch0`] ?? 75}
                    onChange={(e) => onSetInputGain(focused.id, 0, Number(e.target.value))}
                    className="kite-p2p-jam-slider h-1 flex-1 cursor-pointer appearance-none rounded-full outline-none"
                    style={{
                      background: `linear-gradient(to right,${EMERALD} ${inputPanel.gains[`${focused.id}:ch0`] ?? 75}%,rgba(255,255,255,0.08) ${inputPanel.gains[`${focused.id}:ch0`] ?? 75}%)`,
                    }}
                  />
                  <span className="min-w-[28px] text-right font-mono text-[10px] text-white/50">
                    {inputPanel.gains[`${focused.id}:ch0`] ?? 75}
                  </span>
                </label>
                {focused.channels >= 2 ? (
                  <label className="flex items-center gap-2">
                    <span className="min-w-[56px] text-[10px] text-white/40">Ch 2 (R)</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={inputPanel.gains[`${focused.id}:ch1`] ?? 75}
                      onChange={(e) => onSetInputGain(focused.id, 1, Number(e.target.value))}
                      className="kite-p2p-jam-slider h-1 flex-1 cursor-pointer appearance-none rounded-full outline-none"
                      style={{
                        background: `linear-gradient(to right,${EMERALD} ${inputPanel.gains[`${focused.id}:ch1`] ?? 75}%,rgba(255,255,255,0.08) ${inputPanel.gains[`${focused.id}:ch1`] ?? 75}%)`,
                      }}
                    />
                    <span className="min-w-[28px] text-right font-mono text-[10px] text-white/50">
                      {inputPanel.gains[`${focused.id}:ch1`] ?? 75}
                    </span>
                  </label>
                ) : null}
              </div>

              <div className="flex flex-col gap-2.5 border-t border-white/[0.05] pt-3">
                <ToggleRow
                  label="Interface / line-in source"
                  checked={inputPanel.interfaceFlags[focused.id] === true}
                  onChange={(on) => onSetInterfaceFlag(focused.id, on)}
                />
                <ToggleRow
                  label="Live monitor enabled"
                  sublabel="Use headphones to prevent feedback."
                  checked={inputPanel.liveMonitorFlags[focused.id] === true}
                  onChange={(on) => onSetLiveMonitorFlag(focused.id, on)}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Kite Sync setup wizard — multi-step

function WizardChoiceButton({
  selected,
  onClick,
  children,
  className = "",
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-xl border px-3 py-3 text-left transition-colors ${
        selected
          ? "border-[#22c55e]/45 bg-[#22c55e]/[0.1] text-white"
          : "border-white/[0.08] bg-white/[0.02] text-white/60 hover:bg-white/[0.05]"
      } ${className}`}
    >
      {children}
    </button>
  );
}

function KiteSyncSetupWizard({
  state,
  onChange,
  onClose,
  onConfirm,
  error,
  audibleSyncCountIn,
  onAudibleSyncCountInChange,
}: {
  state: P2PJamWizardState;
  onChange: (next: P2PJamWizardState) => void;
  onClose: () => void;
  onConfirm: () => void;
  error: string | null;
  audibleSyncCountIn: boolean;
  onAudibleSyncCountInChange: (enabled: boolean) => void;
}): React.JSX.Element {
  const tapTimesRef = useRef<number[]>([]);
  const bpmPct = ((state.bpm - 40) / (240 - 40)) * 100;
  const metroPct = state.metronomeVolume;
  const bars = resolveBarCount(state);
  const beats = resolveBeatsPerBar(state);
  const loopSec = Math.round((60 / state.bpm) * beats * bars);

  const goPrev = (): void => {
    if (state.step <= 1) return;
    onChange({ ...state, step: (state.step - 1) as P2PJamWizardState["step"] });
  };

  const goNext = (): void => {
    if (state.step >= 5) return;
    onChange({ ...state, step: (state.step + 1) as P2PJamWizardState["step"] });
  };

  const handleTap = (): void => {
    const now = performance.now();
    const taps = tapTimesRef.current.filter((t) => now - t < 2000);
    taps.push(now);
    tapTimesRef.current = taps;
    if (taps.length < 2) return;
    const intervals: number[] = [];
    for (let i = 1; i < taps.length; i++) intervals.push(taps[i]! - taps[i - 1]!);
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const nextBpm = Math.max(40, Math.min(240, Math.round(60000 / avg)));
    onChange({ ...state, bpm: nextBpm });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Kite Sync setup wizard"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={`${GLASS_PANEL} pointer-events-auto relative z-10 flex max-h-[min(86dvh,680px)] w-[min(720px,calc(100vw-32px))] flex-col overflow-hidden`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div>
          <p className="m-0 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-[#22c55e]/80">
            Set up wizard
          </p>
          <h2 className="m-0 mt-1 text-[17px] font-bold tracking-tight text-white/90">
            Kite Sync · Step {state.step} of 5
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`${GLASS_SHARP} cursor-pointer px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/50 hover:text-white/80`}
        >
          Cancel
        </button>
      </div>

      {error ? (
        <div className="mx-5 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
          {error}
        </div>
      ) : null}

      {/* Step body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {state.step === 1 ? (
          <div className="flex flex-col gap-5">
            <div>
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
                BPM
              </span>
              <p className="mt-1 text-[12px] text-white/40">
                Tap the beat or drag the slider to set tempo.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleTap}
                className={`${GLASS_SHARP} cursor-pointer px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#ff4500] hover:bg-[#ff4500]/10`}
              >
                Tap!
              </button>
              <div className="flex items-baseline gap-1.5 rounded-xl border border-white/[0.08] bg-black/40 px-4 py-2">
                <span className="font-mono text-[32px] font-bold leading-none text-[#ff4500]">
                  {state.bpm}
                </span>
                <span className="text-[10px] uppercase tracking-[0.14em] text-white/30">BPM</span>
              </div>
            </div>
            <input
              type="range"
              min={40}
              max={240}
              step={1}
              value={state.bpm}
              aria-label="Tempo BPM"
              onChange={(e) => onChange({ ...state, bpm: Number(e.target.value) })}
              className="kite-p2p-jam-slider h-1 w-full cursor-pointer appearance-none rounded-full outline-none"
              style={{
                background: `linear-gradient(to right,${ORANGE} ${bpmPct}%,rgba(255,255,255,0.08) ${bpmPct}%)`,
              }}
            />
            <div className="h-px bg-white/[0.06]" />
            <div>
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
                Metronome Volume
              </span>
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={state.metronomeVolume}
                  aria-label="Metronome volume"
                  onChange={(e) => onChange({ ...state, metronomeVolume: Number(e.target.value) })}
                  className="kite-p2p-jam-slider h-1 flex-1 cursor-pointer appearance-none rounded-full outline-none"
                  style={{
                    background: `linear-gradient(to right,${EMERALD} ${metroPct}%,rgba(255,255,255,0.08) ${metroPct}%)`,
                  }}
                />
                <span className="min-w-[40px] text-right font-mono text-[11px] text-white/50">
                  {state.metronomeVolume}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {state.step === 2 ? (
          <div className="flex flex-col gap-4">
            <div>
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
                Time Signature
              </span>
              <p className="mt-1 text-[12px] text-white/40">
                How does the beat group? Pick the closest match.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { id: "4/4" as const, title: "4/4", sub: "Most pop, rock, jazz" },
                  { id: "3/4" as const, title: "3/4", sub: "Waltz, folk ballad" },
                  { id: "6/8" as const, title: "6/8", sub: "Compound feel, jig" },
                  { id: "custom" as const, title: "Custom", sub: "Odd meters" },
                ] as const
              ).map((opt) => (
                <WizardChoiceButton
                  key={opt.id}
                  selected={state.timeSignature === opt.id}
                  onClick={() => onChange({ ...state, timeSignature: opt.id })}
                >
                  <span className="block text-[16px] font-bold text-white/90">{opt.title}</span>
                  <span className="mt-0.5 block text-[10px] text-white/40">{opt.sub}</span>
                </WizardChoiceButton>
              ))}
            </div>
            {state.timeSignature === "custom" ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={state.customTop}
                  onChange={(e) => {
                    const customTop = Math.max(1, Math.min(16, Number(e.target.value) || 1));
                    onChange({ ...state, customTop });
                  }}
                  className="w-16 rounded-lg border border-white/10 bg-black/45 px-2.5 py-2 text-center font-mono text-[13px] text-white/80 outline-none"
                />
                <span className="text-white/30">/</span>
                <input
                  type="number"
                  min={1}
                  max={16}
                  value={state.customBottom}
                  onChange={(e) => {
                    const customBottom = Math.max(1, Math.min(16, Number(e.target.value) || 1));
                    onChange({ ...state, customBottom });
                  }}
                  className="w-16 rounded-lg border border-white/10 bg-black/45 px-2.5 py-2 text-center font-mono text-[13px] text-white/80 outline-none"
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {state.step === 3 ? (
          <div className="flex flex-col gap-4">
            <div>
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
                Bar Count
              </span>
              <p className="mt-1 text-[12px] text-white/40">
                How many bars before the phrase repeats? Match your chord cycle (e.g.{" "}
                <span className="text-white/70">8</span> for Canon,{" "}
                <span className="text-white/70">4</span> for a short loop).
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-white/45">
                You will hear each other one full loop behind. Pick loop length to match your
                chord cycle.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([1, 2, 4, 8] as const).map((n) => (
                <WizardChoiceButton
                  key={n}
                  selected={state.barCount === n}
                  onClick={() => onChange({ ...state, barCount: n })}
                  className={`text-center ${n === 4 || n === 8 ? "ring-1 ring-[#22c55e]/25" : ""}`}
                >
                  <span className="block text-[22px] font-bold text-white/90">{n}</span>
                  {n === 8 ? (
                    <span className="mt-0.5 block font-mono text-[8px] uppercase tracking-[0.1em] text-[#22c55e]/70">
                      Song cycle
                    </span>
                  ) : n === 4 ? (
                    <span className="mt-0.5 block font-mono text-[8px] uppercase tracking-[0.1em] text-white/35">
                      Short
                    </span>
                  ) : null}
                </WizardChoiceButton>
              ))}
            </div>
            <WizardChoiceButton
              selected={state.barCount === "custom"}
              onClick={() => onChange({ ...state, barCount: "custom" })}
              className="text-center"
            >
              <span className="block text-[13px] font-bold uppercase tracking-[0.1em]">
                Customize
              </span>
            </WizardChoiceButton>
            {state.barCount === "custom" ? (
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={state.customBars}
                  onChange={(e) => {
                    const customBars = Math.max(1, Math.min(64, Number(e.target.value) || 1));
                    onChange({ ...state, customBars });
                  }}
                  className="w-24 rounded-lg border border-white/10 bg-black/45 px-3 py-2.5 text-center font-mono text-[14px] text-white/80 outline-none"
                />
                <span className="text-[11px] text-white/40">bars per cycle</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {state.step === 4 ? (
          <div className="flex flex-col gap-5">
            <div>
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
                Info
              </span>
              <p className="mt-2 text-[12px] leading-relaxed text-white/45">
                Metered delay keeps both peers on a shared musical grid. Audio is buffered to the
                next safe bar boundary so phrases land cleanly — never mid-chord. A one-bar count-in
                (visual, and optionally audible) lines both players up before go.
              </p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.08] bg-black/35 px-4 py-3.5">
              <input
                type="checkbox"
                checked={audibleSyncCountIn}
                onChange={(e) => onAudibleSyncCountInChange(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#ff4500]"
              />
              <span className="flex flex-col gap-1">
                <span className="text-[12px] font-semibold text-white/80">
                  Audible count-in beats
                </span>
                <span className="text-[11px] leading-relaxed text-white/40">
                  Hear metronome clicks during the one-bar count-in. Turn off for visual-only cue.
                </span>
              </span>
            </label>
            <div className="rounded-xl border border-white/[0.08] bg-black/35 px-4 py-3.5">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#ff4500]/80">
                Before starting
              </span>
              <ul className="mt-3 list-none space-y-2 p-0 text-[12px] text-white/55">
                <li className="flex gap-2">
                  <span className="text-[#22c55e]">·</span>
                  Must use wired headphones
                </li>
                <li className="flex gap-2">
                  <span className="text-[#22c55e]">·</span>
                  Double-check all devices are connected
                </li>
                <li className="flex gap-2">
                  <span className="text-[#22c55e]">·</span>
                  Use the metronome to lock feel before going live
                </li>
                <li className="flex gap-2">
                  <span className="text-[#22c55e]">·</span>
                  Use ethernet for best performance
                </li>
              </ul>
            </div>
          </div>
        ) : null}

        {state.step === 5 ? (
          <div className="flex flex-col gap-4">
            <div>
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-white/35">
                Review
              </span>
              <p className="mt-1 text-[12px] text-white/40">
                Confirm your sync setup before launching.
              </p>
              <p className="mt-2 text-[11px] leading-relaxed text-[#22c55e]/75">
                Starts count-in, then jam one loop behind.
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-black/40 px-4 py-2">
              {(
                [
                  { label: "Tempo", value: `${state.bpm} BPM` },
                  { label: "Metronome", value: `${state.metronomeVolume}%` },
                  { label: "Time signature", value: resolveTimeSignatureLabel(state) },
                  { label: "Bar count", value: `${bars} bars` },
                  { label: "Loop length", value: `~${loopSec}s` },
                ] as const
              ).map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-3 border-b border-white/[0.05] py-2.5 last:border-0"
                >
                  <span className="text-[11px] text-white/40">{row.label}</span>
                  <span className="font-mono text-[12px] font-semibold text-white/85">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={onConfirm}
              className="w-full cursor-pointer rounded-xl border border-[#22c55e]/40 bg-[#22c55e]/15 px-4 py-3 text-[12px] font-bold uppercase tracking-[0.1em] text-[#22c55e] transition-colors hover:bg-[#22c55e]/22"
            >
              Confirm & Launch
            </button>
          </div>
        ) : null}
      </div>

      {/* Footer nav */}
      <div className="flex items-center gap-3 border-t border-white/[0.06] px-5 py-3.5">
        <button
          type="button"
          disabled={state.step === 1}
          onClick={goPrev}
          className={`flex-1 rounded-xl border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors ${
            state.step === 1
              ? "cursor-not-allowed border-white/[0.04] bg-white/[0.02] text-white/25"
              : "cursor-pointer border-white/[0.08] bg-white/[0.03] text-white/70 hover:bg-white/[0.06]"
          }`}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={state.step === 5}
          onClick={goNext}
          className={`flex-1 rounded-xl border px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors ${
            state.step === 5
              ? "cursor-not-allowed border-white/[0.04] bg-white/[0.02] text-white/25"
              : "cursor-pointer border-[#ff4500]/35 bg-[#ff4500]/[0.1] text-[#ff4500] hover:bg-[#ff4500]/18"
          }`}
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Live sound bar rail — exact Looper LIVE meter look: 18-segment stack
// (emerald → yellow → orange), bottom-anchored reveal mask, glass capsule pill.

const LIVE_METER_SEGMENTS = Array.from({ length: 18 }, (_, i) => i);

function liveSegmentColor(i: number): string {
  return i >= 15 ? ORANGE : i >= 11 ? "#eab308" : EMERALD;
}

function LiveSoundBarRail({
  isDummyMode,
  masterLiveLevelPercent,
  remoteLevel,
  remoteMeterHeights,
  registerMasterLiveMeterElement,
}: {
  isDummyMode: boolean;
  masterLiveLevelPercent: number | null;
  remoteLevel: number;
  remoteMeterHeights: number[];
  registerMasterLiveMeterElement: (el: HTMLDivElement | null) => void;
}): React.JSX.Element {
  const maskRef = useRef<HTMLDivElement | null>(null);
  const proxyRef = useRef<HTMLDivElement | null>(null);
  const smoothRef = useRef(12);
  const derivedRef = useRef<number | null>(null);

  const derivedPercent = (() => {
    if (masterLiveLevelPercent !== null && Number.isFinite(masterLiveLevelPercent)) {
      return Math.max(0, Math.min(100, masterLiveLevelPercent));
    }
    if (remoteLevel > 0.02) {
      return Math.max(0, Math.min(100, remoteLevel * 100));
    }
    if (remoteMeterHeights.length > 0) {
      let peak = 0;
      const n = remoteMeterHeights.length;
      for (let i = 0; i < n; i += 1) {
        const w = 0.55 + (i / Math.max(1, n - 1)) * 0.45;
        peak = Math.max(peak, (remoteMeterHeights[i] ?? 0) * w);
      }
      if (peak > 0.02) return Math.max(0, Math.min(100, peak * 100));
    }
    return null;
  })();
  derivedRef.current = derivedPercent;

  // Prefer remote-derived levels; else mirror engine width% on the hidden proxy → height.
  useEffect(() => {
    if (isDummyMode && derivedPercent === null) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last >= 66) {
        last = now;
        let target = derivedRef.current;
        if (target === null && proxyRef.current) {
          const pct = parseFloat(proxyRef.current.style.width || "0");
          target = Number.isFinite(pct) ? pct : null;
        }
        if (target !== null && maskRef.current) {
          smoothRef.current = smoothRef.current * 0.55 + target * 0.45;
          maskRef.current.style.height = `${Math.round(smoothRef.current)}%`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isDummyMode, derivedPercent]);

  // Dummy fallback — random walk only when dummy mode and no real level.
  useEffect(() => {
    if (!isDummyMode || derivedPercent !== null) return;
    let level = 42;
    const id = window.setInterval(() => {
      level = Math.max(12, Math.min(82, level + (Math.random() - 0.5) * 26));
      if (maskRef.current) maskRef.current.style.height = `${Math.round(level)}%`;
    }, 150);
    return () => window.clearInterval(id);
  }, [isDummyMode, derivedPercent]);

  return (
    <div className={`${GLASS} pointer-events-none absolute left-3 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1.5 rounded-full px-[11px] py-[18px]`}>
      {/* Hidden proxy — engine writes style.width; we mirror to mask height when no remote level. */}
      <div
        ref={(el) => {
          proxyRef.current = el;
          if (!isDummyMode) registerMasterLiveMeterElement(el);
        }}
        aria-hidden
        className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
        style={{ width: "0%" }}
      />
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
          style={{ height: "0%", transition: "height 0.12s linear" }}
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
// Camera placeholder — minimalist audio visualizer (audio-only engine — no
// real video is ever rendered here regardless of the camera toggle state).

const WAVE_BAR_HEIGHTS = [12, 20, 32, 44, 56, 44, 32, 20, 12] as const;

const WAVE_BAR_COUNT = WAVE_BAR_HEIGHTS.length;

/** Expand sparse remote meter bins across all wave bars (independent targets). */
function expandMeterBinsToBars(remoteLevel: number, remoteMeterHeights: number[]): number[] {
  const out = new Array<number>(WAVE_BAR_COUNT);
  const src = remoteMeterHeights.length > 0 ? remoteMeterHeights : [remoteLevel];
  const n = src.length;
  for (let i = 0; i < WAVE_BAR_COUNT; i += 1) {
    const t = (i / Math.max(1, WAVE_BAR_COUNT - 1)) * (n - 1);
    const lo = Math.floor(t);
    const hi = Math.min(n - 1, lo + 1);
    const f = t - lo;
    const a = src[lo] ?? 0;
    const b = src[hi] ?? a;
    // Mild per-bar jitter so adjacent bars never lock-step after interpolate.
    const jitter = ((i * 17) % 7) * 0.01 - 0.03;
    out[i] = Math.max(0.06, Math.min(1, a * (1 - f) + b * f + jitter * remoteLevel));
  }
  return out;
}

function CameraPane({
  role,
  accent,
  cameraOn,
  remoteLevel,
  remoteMeterHeights,
  localMicStream,
  isDummyMode,
}: {
  role: "Host" | "Guest";
  accent: "emerald" | "orange";
  cameraOn: boolean;
  remoteLevel: number;
  remoteMeterHeights: number[];
  localMicStream: MediaStream | null;
  isDummyMode: boolean;
}): React.JSX.Element {
  const accentHex = accent === "emerald" ? EMERALD : ORANGE;
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  /** Per-bar target levels 0–1 — each bar moves independently. */
  const barLevelsRef = useRef<Float32Array>(new Float32Array(WAVE_BAR_COUNT).fill(0.12));
  const barSmoothRef = useRef<Float32Array>(new Float32Array(WAVE_BAR_COUNT).fill(0.12));

  // Host: UI-only local mic analyser — map frequency bands → individual bars.
  useEffect(() => {
    if (role === "Guest") return;

    if (isDummyMode) {
      const levels = Array.from({ length: WAVE_BAR_COUNT }, () => 0.28 + Math.random() * 0.25);
      const id = window.setInterval(() => {
        for (let i = 0; i < WAVE_BAR_COUNT; i += 1) {
          levels[i] = Math.max(
            0.08,
            Math.min(0.95, (levels[i] ?? 0.3) + (Math.random() - 0.5) * 0.35)
          );
          barLevelsRef.current[i] = levels[i] ?? 0.12;
        }
      }, 90);
      return () => window.clearInterval(id);
    }

    const stream = localMicStream ?? null;
    if (!stream) {
      barLevelsRef.current.fill(0.1);
      return;
    }

    let ctx: AudioContext | undefined;
    let raf = 0;
    let stopped = false;
    let src: MediaStreamAudioSourceNode | undefined;
    const buf = new Uint8Array(128);

    const run = async () => {
      try {
        ctx = new AudioContext();
        await ctx.resume().catch(() => {});
        if (stopped) return;
        src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        an.smoothingTimeConstant = 0.55;
        src.connect(an);
        const tick = () => {
          if (stopped) return;
          an.getByteFrequencyData(buf);
          const usable = Math.max(8, Math.floor(buf.length * 0.55));
          const band = Math.max(1, Math.floor(usable / WAVE_BAR_COUNT));
          for (let i = 0; i < WAVE_BAR_COUNT; i += 1) {
            let sum = 0;
            const start = i * band;
            for (let j = 0; j < band; j += 1) sum += buf[start + j] ?? 0;
            const next = Math.min(1, (sum / band / 255) * 1.55);
            barLevelsRef.current[i] = next;
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        barLevelsRef.current.fill(0.1);
      }
    };
    void run();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      try {
        src?.disconnect();
      } catch {
        /* ignore */
      }
      void ctx?.close().catch(() => {});
    };
  }, [role, localMicStream, isDummyMode]);

  // Guest: expand remote meter bins into per-bar targets (or dummy walk).
  useEffect(() => {
    if (role !== "Guest") return;
    if (isDummyMode) {
      const levels = Array.from({ length: WAVE_BAR_COUNT }, () => 0.3 + Math.random() * 0.2);
      const id = window.setInterval(() => {
        for (let i = 0; i < WAVE_BAR_COUNT; i += 1) {
          levels[i] = Math.max(
            0.08,
            Math.min(0.95, (levels[i] ?? 0.3) + (Math.random() - 0.5) * 0.32)
          );
          barLevelsRef.current[i] = levels[i] ?? 0.12;
        }
      }, 90);
      return () => window.clearInterval(id);
    }
    const expanded = expandMeterBinsToBars(remoteLevel, remoteMeterHeights);
    for (let i = 0; i < WAVE_BAR_COUNT; i += 1) {
      barLevelsRef.current[i] = expanded[i] ?? 0.12;
    }
  }, [role, isDummyMode, remoteLevel, remoteMeterHeights]);

  // Ref-driven per-bar scaleY — each bar smooths independently (no shared graph envelope).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (let i = 0; i < WAVE_BAR_COUNT; i += 1) {
        const el = barRefs.current[i];
        if (!el) continue;
        const target = barLevelsRef.current[i] ?? 0.12;
        const prev = barSmoothRef.current[i] ?? 0.12;
        // Slightly different settle rate per bar so motion never looks locked.
        const alpha = 0.22 + (i % 3) * 0.06;
        const next = prev * (1 - alpha) + target * alpha;
        barSmoothRef.current[i] = next;
        const scale = 0.12 + Math.max(0.06, Math.min(1, next)) * 0.88;
        el.style.transform = `scaleY(${scale})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative flex min-w-0 flex-1 p-4">
      {/* Glass video frame — Looper webcam frame treatment (radius 14 + glow shadow) */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden rounded-[14px] bg-[#0a0a0a]"
        style={{ boxShadow: STUDIO_GLOW_FRAME_SHADOW }}
      >
        {cameraOn ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">
            Awaiting video…
          </span>
        ) : (
          <div className="relative flex flex-col items-center justify-center gap-4">
            <div
              aria-hidden
              className="absolute left-1/2 top-1/2 h-px w-[220px] -translate-x-1/2 -translate-y-1/2 bg-white/[0.06]"
            />
            {/* Independent per-bar levels — not a shared envelope */}
            <div className="relative flex items-end gap-[4px] px-2">
              {WAVE_BAR_HEIGHTS.map((h, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    barRefs.current[i] = el;
                  }}
                  aria-hidden
                  className="w-[4px] origin-bottom rounded-full will-change-transform"
                  style={{
                    height: h,
                    background: accentHex,
                    opacity: 0.82,
                    transform: "scaleY(0.35)",
                  }}
                />
              ))}
            </div>
            <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-white/30">
              {role === "Host" ? "Host connected · camera off" : "Guest connected · camera off"}
            </span>
          </div>
        )}

        {/* Pane label — glassSharp chip with accent dot */}
        <div className={`${GLASS_SHARP} absolute bottom-3 left-3 flex items-center gap-1.5 px-2.5 py-1.5`}>
          <span aria-hidden className="h-1 w-1 rounded-full" style={{ background: accentHex }} />
          <span className="font-mono text-[8px] font-semibold uppercase tracking-[0.18em] text-white/60">
            {role} Camera
          </span>
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
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  iconOn: React.ReactNode;
  iconOff: React.ReactNode;
  label: string;
  disabled?: boolean;
  title?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] backdrop-blur-[18px] transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
        disabled ? "" : "cursor-pointer"
      } ${
        active
          ? "border-[#22c55e]/40 bg-[#22c55e]/[0.08] text-[#22c55e]"
          : "border-white/[0.08] bg-[rgba(10,10,10,0.75)] text-white/40 hover:text-white/60"
      }`}
    >
      {active ? iconOn : iconOff}
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Session chat panel

function ChatPanel({
  messages,
  draft,
  onDraftChange,
  onSend,
  chatReady,
  onClose,
}: {
  messages: P2PJamChatMessage[];
  draft: string;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  chatReady: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Session chat"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={`${GLASS_PANEL} pointer-events-auto relative z-10 flex h-[min(70vh,520px)] w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden`}
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 pb-3 pt-3.5">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-white/75">
          <MessageSquare size={12} color={EMERALD} /> Chat
        </span>
        <button
          type="button"
          aria-label="Close chat"
          onClick={onClose}
          className="cursor-pointer border-0 bg-transparent text-[20px] leading-none text-white/30 hover:text-white/60"
        >
          ×
        </button>
      </div>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="m-0 text-center text-[11px] text-white/25">
            {chatReady ? "No messages yet — say hi!" : "Chat is unavailable right now."}
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.isLocal ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-xl px-3 py-2 text-[12px] leading-relaxed ${
                  m.isLocal ? "bg-[#22c55e]/15 text-[#22c55e]" : "bg-white/[0.06] text-white/75"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-3">
        <input
          type="text"
          value={draft}
          disabled={!chatReady}
          placeholder={chatReady ? "Type a message…" : "Chat unavailable"}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSend();
          }}
          className="flex-1 rounded-lg border border-white/10 bg-black/45 px-3 py-2 text-[12px] text-white/85 outline-none disabled:cursor-not-allowed disabled:opacity-40"
        />
        <button
          type="button"
          disabled={!chatReady || draft.trim().length === 0}
          onClick={onSend}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e] transition-colors hover:bg-[#22c55e]/20 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main presenter component

const LOOP_BEHIND_TIP_KEY = "kite-sync-loop-behind-tip-v1";

export function P2PJamPresenter({ port }: { port: P2PJamPresenterPort }): React.JSX.Element {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isInputPanelOpen, setIsInputPanelOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [syncStartErrorDismissed, setSyncStartErrorDismissed] = useState(false);
  const [showLoopBehindTip, setShowLoopBehindTip] = useState(false);
  const seenChatMessageIdsRef = useRef<Set<string>>(new Set());

  // Escape closes topmost overlay — chat > wizard > input > settings
  useEffect(() => {
    if (!isChatOpen && !port.wizardOpen && !isInputPanelOpen && !isSettingsOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (isChatOpen) {
        setIsChatOpen(false);
        return;
      }
      if (port.wizardOpen) {
        port.onWizardCancel();
        return;
      }
      if (isInputPanelOpen) {
        setIsInputPanelOpen(false);
        return;
      }
      if (isSettingsOpen) setIsSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isChatOpen, port.wizardOpen, isInputPanelOpen, isSettingsOpen, port.onWizardCancel]);

  // Unread chat badge: count remote messages arrived while chat is closed
  useEffect(() => {
    const messages = port.chatMessages;
    if (messages.length === 0) {
      seenChatMessageIdsRef.current.clear();
      setUnreadChatCount(0);
      return;
    }
    if (isChatOpen) {
      for (const m of messages) {
        seenChatMessageIdsRef.current.add(m.id);
      }
      return;
    }
    let added = 0;
    for (const m of messages) {
      if (seenChatMessageIdsRef.current.has(m.id)) continue;
      seenChatMessageIdsRef.current.add(m.id);
      if (!m.isLocal) added += 1;
    }
    if (added > 0) {
      setUnreadChatCount((prev) => prev + added);
    }
  }, [port.chatMessages, isChatOpen]);

  // Sync start error callout: re-show when engine sets a new error or wizard reopens.
  useEffect(() => {
    setSyncStartErrorDismissed(false);
  }, [port.wizardError]);

  useEffect(() => {
    if (port.wizardOpen) setSyncStartErrorDismissed(false);
  }, [port.wizardOpen]);

  // First-run Sync tip — Sync UI only; never mounts in live mode.
  useEffect(() => {
    if (!port.kiteSyncEnabled) {
      setShowLoopBehindTip(false);
      return;
    }
    try {
      if (window.localStorage.getItem(LOOP_BEHIND_TIP_KEY) === "1") {
        setShowLoopBehindTip(false);
        return;
      }
    } catch {
      // localStorage unavailable — still show tip once this session
    }
    setShowLoopBehindTip(true);
  }, [port.kiteSyncEnabled]);

  // Sync-active lock: force-close any open local overlays
  useEffect(() => {
    if (!port.kiteSyncEnabled) return;
    setIsSettingsOpen(false);
    setIsInputPanelOpen(false);
    setIsChatOpen(false);
  }, [port.kiteSyncEnabled]);

  const dismissLoopBehindTip = (): void => {
    setShowLoopBehindTip(false);
    try {
      window.localStorage.setItem(LOOP_BEHIND_TIP_KEY, "1");
    } catch {
      // ignore
    }
  };

  const openSettings = (): void => {
    if (port.kiteSyncEnabled) return;
    setIsChatOpen(false);
    setIsInputPanelOpen(false);
    setIsSettingsOpen(true);
  };

  const openInputPanel = (): void => {
    if (port.kiteSyncEnabled) return;
    setIsChatOpen(false);
    setIsSettingsOpen(false);
    setIsInputPanelOpen(true);
  };

  const openChat = (): void => {
    setIsSettingsOpen(false);
    setIsInputPanelOpen(false);
    setIsChatOpen(true);
    setUnreadChatCount(0);
  };

  const handleSendChat = (): void => {
    const trimmed = chatDraft.trim();
    if (!trimmed || !port.chatReady) return;
    port.onSendChat(trimmed);
    setChatDraft("");
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

        {/* Hidden audio — dummy mode only. Live mode uses page-level engineRefs mounts. */}
        {port.isDummyMode ? (
          <>
            <audio ref={port.remoteAudioRef as React.Ref<HTMLAudioElement>} autoPlay playsInline className="hidden" />
            <audio
              ref={port.localMonitorAudioRef as React.Ref<HTMLAudioElement>}
              autoPlay
              playsInline
              muted
              className="hidden"
            />
          </>
        ) : null}
        {/* ── TOP HEADER ─────────────────────────────────────────────── */}
        <header className="relative z-30 grid grid-cols-[1fr_auto_1fr] items-start gap-3 px-4 py-3">
          <div className="justify-self-start">
          {port.kiteSyncEnabled && port.activeJam ? (
            /* Sync-active: read-only jam info (top-left) */
            <div className={`${GLASS} pointer-events-none rounded-xl px-3.5 py-2.5`}>
              <div className="flex items-baseline gap-2 font-mono">
                <span className="text-[15px] font-bold text-[#ff4500]">{port.activeJam.bpm}</span>
                <span className="text-[9px] uppercase tracking-[0.12em] text-white/30">BPM</span>
                <span className="text-white/15">·</span>
                <span className="text-[13px] font-semibold text-white/80">{port.activeJam.bars}</span>
                <span className="text-[9px] uppercase tracking-[0.12em] text-white/30">Bars</span>
                <span className="text-white/15">·</span>
                <span className="text-[13px] font-semibold text-white/80">{port.activeJam.timeSignature}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full bg-[#22c55e]"
                  style={{
                    boxShadow: "0 0 6px rgba(34,197,94,0.65)",
                    animation: "kiteP2pJamLed 2.2s infinite",
                  }}
                />
                <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-[#22c55e]/85">
                  Kite Sync Enabled
                </span>
                <span className="font-mono text-[8px] text-white/25">
                  · ~{port.activeJam.loopSec}s loop
                </span>
                <span className="rounded-full border border-[#22c55e]/30 bg-[#22c55e]/10 px-1.5 py-0.5 font-mono text-[7px] uppercase tracking-[0.12em] text-[#22c55e]/90">
                  1 loop behind
                </span>
              </div>
            </div>
          ) : (
            /* Live mode: End Session */
            <button
              type="button"
              onClick={port.onEndSession}
              className="cursor-pointer rounded-xl border border-red-500/30 bg-[rgba(10,10,10,0.75)] px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-red-300/90 backdrop-blur-[18px] transition-colors hover:border-red-400/50 hover:bg-red-500/10 hover:text-red-200"
            >
              End Session
            </button>
          )}
          </div>

          {/* Center — logo + status (in-flow, never under ping cluster) */}
          <div className="pointer-events-none flex flex-col items-center justify-self-center pt-0.5">
            <h1
              className="m-0 text-[21px] font-bold tracking-tight"
              style={{
                backgroundImage: "linear-gradient(to right, #fb923c, #f5f5f4, #34d399)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Kite Studio
            </h1>
            <div className="mt-1 flex items-center gap-1.5">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full ${port.kiteSyncEnabled ? "bg-[#22c55e]" : "bg-red-500"}`}
                style={{
                  boxShadow: port.kiteSyncEnabled
                    ? "0 0 6px rgba(34,197,94,0.7)"
                    : "0 0 6px rgba(239,68,68,0.7)",
                  animation: "kiteP2pJamLed 2.2s infinite",
                }}
              />
              <span className="font-mono text-[8px] uppercase tracking-[0.28em] text-white/40">
                {port.kiteSyncEnabled ? "Kite Sync Enabled" : "Session live"}
              </span>
            </div>
          </div>

          {/* Right — stats (+ room code + Record Jam only in live mode) */}
          <div className="flex flex-wrap items-center justify-end gap-3 justify-self-end">
            <div className="relative">
              <div className={`${GLASS} pointer-events-none flex items-center divide-x divide-white/[0.08] rounded-full font-mono text-[9px] uppercase tracking-[0.08em]`}>
                <span className="px-3 py-2">
                  <span className="text-white/30">Ping </span>
                  <span className="text-[#22c55e]">{port.pingMs ?? "--"}</span>
                  <span className="text-white/30"> ms</span>
                </span>
                <span className="px-3 py-2">
                  <span className="text-white/30">Delay </span>
                  <span className="text-[#22c55e]">{port.delayMs ?? "--"}</span>
                  <span className="text-white/30"> ms</span>
                </span>
                {port.packetLossPercent !== null ? (
                  <span className="px-3 py-2">
                    <span className="text-white/30">Loss </span>
                    <span className={port.packetLossPercent > 2 ? "text-[#ff4500]" : "text-[#22c55e]"}>
                      {port.packetLossPercent.toFixed(1)}
                    </span>
                    <span className="text-white/30">%</span>
                  </span>
                ) : null}
              </div>
              {port.highPingTipOpen ? (
                <div className={`${GLASS_SHARP} pointer-events-auto absolute right-0 top-[calc(100%+6px)] z-20 flex w-[220px] flex-col gap-1.5 p-3`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-[#ff4500]/85">
                      High ping
                    </span>
                    <button
                      type="button"
                      aria-label="Dismiss high ping tip"
                      onClick={port.onDismissHighPingTip}
                      className="cursor-pointer border-0 bg-transparent p-0.5 text-white/40 hover:text-white/70"
                    >
                      <X size={11} />
                    </button>
                  </div>
                  <p className="m-0 text-[10px] leading-relaxed text-white/55">
                    Ping is high — a wired connection or ethernet can help keep timing tight.
                  </p>
                </div>
              ) : null}
            </div>

            {port.sessionId ? (
              <button
                type="button"
                onClick={port.onCopyRoomCode}
                title="Copy room code"
                className={`${GLASS} flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-white/55 hover:text-white/80`}
              >
                <Copy size={11} /> {port.sessionId}
              </button>
            ) : null}

            {!port.kiteSyncEnabled ? (
              <button
                type="button"
                aria-pressed={port.isRecording}
                onClick={port.onToggleRecord}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] backdrop-blur-[18px] transition-colors ${
                  port.isRecording
                    ? "border-red-500/50 bg-red-500/10 text-red-300"
                    : "border-white/[0.08] bg-[rgba(10,10,10,0.75)] text-white/60 hover:border-red-500/40 hover:text-red-200"
                }`}
              >
                {port.isRecording ? `Recording ${formatRecordingTime(port.recordingTimeMs)}` : "Record Jam"}
                <Circle
                  size={10}
                  className={port.isRecording ? "animate-pulse" : ""}
                  style={{
                    color: "#ef4444",
                    fill: port.isRecording ? "#ef4444" : "transparent",
                  }}
                />
              </button>
            ) : null}
          </div>
        </header>

        {/* ── STATUS / ERROR SURFACES ───────────────────────────────── */}
        {port.statusNote || port.bridgeInitError ? (
          <div className="relative z-20 flex justify-center px-4">
            <div
              className={`${GLASS_SHARP} pointer-events-none px-3 py-1.5 text-[10px] ${
                port.bridgeInitError ? "text-red-300" : "text-white/50"
              }`}
            >
              {port.bridgeInitError ?? port.statusNote}
            </div>
          </div>
        ) : null}

        {port.collaboratorLeft ? (
          <div className="relative z-20 flex justify-center px-4 pt-1.5">
            <div className="rounded-xl border border-white/[0.1] bg-black/50 px-4 py-2 text-[11px] text-white/60">
              Your bandmate left the session.
            </div>
          </div>
        ) : port.connectionLostCountdown !== null ? (
          <div className="relative z-20 flex justify-center px-4 pt-1.5">
            <div className="rounded-xl border border-[#ff4500]/40 bg-[#ff4500]/10 px-4 py-2 text-[11px] font-semibold text-[#ff4500]">
              Connection lost — reconnecting in {port.connectionLostCountdown}s…
            </div>
          </div>
        ) : null}

        {port.kiteSyncEnabled && port.kiteSyncNetworkMetronomePaused ? (
          <div className="relative z-20 flex justify-center px-4 pt-1.5">
            <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-[11px] font-semibold text-yellow-300">
              Metronome paused — packet loss above {port.kiteSyncLossPausePct}%. Resumes below{" "}
              {port.kiteSyncLossResumePct}%.
            </div>
          </div>
        ) : null}

        {/* ── MAIN BODY — 50/50 split screen ─────────────────────────── */}
        <main className="relative z-10 flex min-h-0 flex-1">
          <LiveSoundBarRail
            isDummyMode={port.isDummyMode}
            masterLiveLevelPercent={port.masterLiveLevelPercent}
            remoteLevel={port.remoteLevel}
            remoteMeterHeights={port.remoteMeterHeights}
            registerMasterLiveMeterElement={port.registerMasterLiveMeterElement}
          />

          <CameraPane
            role="Host"
            accent="emerald"
            cameraOn={port.cameraOn}
            remoteLevel={port.remoteLevel}
            remoteMeterHeights={port.remoteMeterHeights}
            localMicStream={port.localMicStream}
            isDummyMode={port.isDummyMode}
          />

          {/* Center dividing line — fades at both ends */}
          <div
            aria-hidden
            className="w-px shrink-0 self-stretch bg-gradient-to-b from-transparent via-white/[0.12] to-transparent"
          />

          <CameraPane
            role="Guest"
            accent="orange"
            cameraOn={port.cameraOn}
            remoteLevel={port.remoteLevel}
            remoteMeterHeights={port.remoteMeterHeights}
            localMicStream={null}
            isDummyMode={port.isDummyMode}
          />
        </main>

        {/* ── BOTTOM FOOTER — live controls OR sync-active minimal taskbar ─ */}
        <footer className="relative z-30 flex items-center gap-3 border-t border-white/[0.08] bg-[rgba(10,10,10,0.75)] px-4 py-3 backdrop-blur-[18px]">
          {/* Metronome blink indicator — must stay mounted; imperatively driven */}
          <div
            ref={port.metronomeBlinkElementRef as React.Ref<HTMLDivElement>}
            aria-hidden
            className="pointer-events-none absolute left-2 top-2 h-1 w-1 rounded-full bg-white/10"
          />

          {port.kiteSyncEnabled ? (
            <>
              <KiteSyncTaskbarHelper
                phase={port.kiteSyncReadinessPhase}
                isLocalLeader={port.kiteSyncReadinessIsLocalLeader}
                kiteSyncCountInActive={port.kiteSyncCountInActive}
                hotRef={port.kiteSyncReadinessHotRef}
                delayMs={port.delayMs}
                remoteParticipantName={port.remoteParticipantName}
                loopSec={port.activeJam?.loopSec ?? 0}
              />
              <button
                type="button"
                aria-pressed={port.micOn}
                onClick={port.onToggleMic}
                title={port.micOn ? "Xmit on — your loop is sent" : "Xmit off — your loop is not sent"}
                className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] backdrop-blur-[18px] transition-colors ${
                  port.micOn
                    ? "border-[#22c55e]/45 bg-[#22c55e]/12 text-[#22c55e]"
                    : "border-white/[0.12] bg-black/40 text-white/40 hover:text-white/60"
                }`}
              >
                {port.micOn ? <Mic size={12} /> : <MicOff size={12} />}
                Xmit {port.micOn ? "on" : "off"}
              </button>
              <button
                type="button"
                onClick={port.onEndKiteSync}
                className="flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-red-500/45 bg-red-500/10 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-red-300 backdrop-blur-[18px] transition-colors hover:border-red-400/60 hover:bg-red-500/15 hover:text-red-200"
                style={{ boxShadow: "0 0 14px rgba(239,68,68,0.14)" }}
              >
                End Kite Sync
              </button>
              {showLoopBehindTip ? (
                <div
                  role="status"
                  className="absolute bottom-[calc(100%+10px)] left-4 right-4 z-40 flex max-w-md items-start gap-3 rounded-xl border border-[#22c55e]/30 bg-[rgba(10,10,10,0.92)] px-3.5 py-2.5 shadow-[0_8px_28px_rgba(0,0,0,0.45)] backdrop-blur-[18px] sm:right-auto"
                >
                  <p className="m-0 flex-1 text-[11px] leading-relaxed text-white/70">
                    You hear each other one full loop behind — by design. Play to the{" "}
                    <span className="text-white/90">previous</span> loop; the next lands at the bar
                    countdown.
                  </p>
                  <button
                    type="button"
                    aria-label="Dismiss tip"
                    onClick={dismissLoopBehindTip}
                    className="shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-1 text-white/40 transition-colors hover:text-white/80"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              {/* Left — square Settings (glassSharp) */}
              <button
                type="button"
                aria-expanded={isSettingsOpen}
                onClick={openSettings}
                className={`flex h-12 w-12 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border font-mono text-[7px] font-semibold uppercase tracking-[0.12em] backdrop-blur-[18px] transition-colors ${
                  isSettingsOpen
                    ? "border-[#ff4500]/40 bg-[#ff4500]/10 text-[#ff4500]"
                    : "border-white/[0.08] bg-[rgba(10,10,10,0.75)] text-white/55 hover:bg-white/[0.06] hover:text-white/80"
                }`}
              >
                <Settings size={15} strokeWidth={1.75} />
                Settings
              </button>

              {/* Center — pill toggles + Input Device */}
              <div className="flex flex-1 items-center justify-center gap-3">
                <PillToggle
                  active={port.micOn}
                  onClick={port.onToggleMic}
                  disabled={port.syncCountInBlocksLive}
                  title={port.syncCountInBlocksLive ? "Locked during count-in" : undefined}
                  iconOn={<Mic size={13} />}
                  iconOff={<MicOff size={13} />}
                  label={port.micOn ? "Mic on" : "Mic off"}
                />
                <PillToggle
                  active={port.cameraOn}
                  onClick={port.onToggleCamera}
                  disabled={!port.cameraToggleEnabled}
                  title={port.cameraToggleEnabled ? undefined : "Camera unavailable"}
                  iconOn={<Video size={13} />}
                  iconOff={<VideoOff size={13} />}
                  label={port.cameraOn ? "Camera on" : "Camera off"}
                />
                <PillToggle
                  active={port.speakerOn}
                  onClick={port.onToggleSpeaker}
                  disabled={port.syncCountInBlocksLive}
                  title={port.syncCountInBlocksLive ? "Locked during count-in" : undefined}
                  iconOn={<Volume2 size={13} />}
                  iconOff={<VolumeX size={13} />}
                  label={port.speakerOn ? "Speaker on" : "Speaker off"}
                />
                <button
                  type="button"
                  aria-expanded={isInputPanelOpen}
                  onClick={openInputPanel}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] backdrop-blur-[18px] transition-colors ${
                    isInputPanelOpen
                      ? "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e]"
                      : "border-white/[0.08] bg-[rgba(10,10,10,0.75)] text-white/50 hover:text-white/75"
                  }`}
                >
                  <Mic size={12} color={isInputPanelOpen ? EMERALD : undefined} />
                  Input Device
                  <ChevronRight size={10} className="opacity-40" />
                </button>
              </div>

              {/* Right — square Chat (glassSharp) */}
              <button
                type="button"
                aria-expanded={isChatOpen}
                aria-label={
                  unreadChatCount > 0
                    ? `Chat, ${unreadChatCount} unread`
                    : "Chat"
                }
                onClick={openChat}
                className={`${GLASS_SHARP} relative flex h-12 w-12 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 font-mono text-[7px] font-semibold uppercase tracking-[0.12em] text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white/80`}
              >
                <MessageSquare size={15} strokeWidth={1.75} />
                Chat
                {unreadChatCount > 0 ? (
                  <span
                    aria-hidden
                    className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-black/40 bg-[#ef4444] px-1 text-[9px] font-bold leading-none text-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                  >
                    {unreadChatCount > 9 ? "9+" : unreadChatCount}
                  </span>
                ) : null}
              </button>

              {/* Far right — Start Kite Sync opens setup wizard (+ Sync-only start error) */}
              <div className="relative flex shrink-0 flex-col items-end gap-1.5">
                {port.wizardError && !port.wizardOpen && !syncStartErrorDismissed ? (
                  <div
                    role="alert"
                    className="absolute bottom-[calc(100%+8px)] right-0 z-40 flex w-[min(280px,70vw)] items-start gap-2 rounded-lg border border-red-500/40 bg-[rgba(40,10,10,0.95)] px-2.5 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
                  >
                    <p className="m-0 flex-1 text-[10px] leading-snug text-red-200/90">
                      {port.wizardError}
                    </p>
                    <button
                      type="button"
                      aria-label="Dismiss sync start error"
                      onClick={() => setSyncStartErrorDismissed(true)}
                      className="shrink-0 cursor-pointer rounded border-0 bg-transparent p-0.5 text-red-200/50 transition-colors hover:text-red-100"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  aria-expanded={port.wizardOpen}
                  disabled={port.jamSetupLockedByRemote}
                  title={port.jamSetupLockedByRemote ? "Bandmate is setting up…" : undefined}
                  onClick={port.onStartKiteSync}
                  className={`flex shrink-0 items-center gap-2 rounded-xl border border-[#ff4500]/60 bg-[#ff4500]/[0.08] px-5 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[#ff4500] backdrop-blur-[18px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    port.jamSetupLockedByRemote ? "" : "cursor-pointer hover:bg-[#ff4500]/[0.14]"
                  }`}
                  style={{ boxShadow: "0 0 14px rgba(255,69,0,0.16)" }}
                >
                  <Zap size={13} strokeWidth={2} />
                  {port.jamSetupLockedByRemote ? "Bandmate is setting up…" : "Start Kite Sync"}
                </button>
              </div>
            </>
          )}
        </footer>

        <style>{`
          @keyframes kiteP2pJamLed { 0%,100%{opacity:1} 50%{opacity:0.35} }
          @keyframes kiteP2pJamWave {
            0% { transform: scaleY(0.26); }
            100% { transform: scaleY(1); }
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

      {/* Overlays — siblings of root, last in return, escape stacking contexts.
          Sync-active mode blocks settings/input panels (taskbar + End Sync + tip stay usable). */}
      {!port.kiteSyncEnabled && isSettingsOpen ? (
        <div
          role="presentation"
          onClick={() => setIsSettingsOpen(false)}
          className="pointer-events-auto fixed inset-0 z-[9999] flex items-center justify-center bg-black/20 backdrop-blur-[3px]"
        >
          <P2PSettingsPanel port={port} onClose={() => setIsSettingsOpen(false)} />
        </div>
      ) : null}

      {!port.kiteSyncEnabled && isInputPanelOpen ? (
        <div
          role="presentation"
          onClick={() => setIsInputPanelOpen(false)}
          className="pointer-events-auto fixed inset-0 z-[9999] flex items-center justify-center bg-black/20 backdrop-blur-[3px]"
        >
          <P2PInputDevicePanel port={port} onClose={() => setIsInputPanelOpen(false)} />
        </div>
      ) : null}

      {isChatOpen ? (
        <div
          role="presentation"
          onClick={() => setIsChatOpen(false)}
          className="pointer-events-auto fixed inset-0 z-[9998] flex items-end justify-end p-4 sm:items-center sm:justify-center"
        >
          <ChatPanel
            messages={port.chatMessages}
            draft={chatDraft}
            onDraftChange={setChatDraft}
            onSend={handleSendChat}
            chatReady={port.chatReady}
            onClose={() => setIsChatOpen(false)}
          />
        </div>
      ) : null}

      {port.wizardOpen ? (
        <div
          role="presentation"
          onClick={port.onWizardCancel}
          className="pointer-events-auto fixed inset-0 z-[10000] flex items-center justify-center bg-black/25 backdrop-blur-[3px]"
        >
          <KiteSyncSetupWizard
            state={port.wizard}
            onChange={port.onWizardChange}
            onClose={port.onWizardCancel}
            onConfirm={port.onWizardConfirm}
            error={port.wizardError}
            audibleSyncCountIn={port.audibleSyncCountIn}
            onAudibleSyncCountInChange={port.onAudibleSyncCountInChange}
          />
        </div>
      ) : null}

      {port.audioContextSuspended ? (
        <div className="pointer-events-auto fixed inset-0 z-[10010] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className={`${GLASS_PANEL} flex flex-col items-center gap-4 px-8 py-7 text-center`}>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">
              Audio suspended
            </span>
            <p className="m-0 max-w-[280px] text-[12px] leading-relaxed text-white/60">
              Your browser paused audio playback. Resume to hear your bandmate and the metronome.
            </p>
            <button
              type="button"
              onClick={port.onResumeAudio}
              className="cursor-pointer rounded-xl border border-[#22c55e]/50 bg-[#22c55e]/15 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#22c55e] transition-colors hover:bg-[#22c55e]/25"
            >
              Resume Audio
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default P2PJamPresenter;
