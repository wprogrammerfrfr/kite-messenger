"use client";

// Studio Bridge — Preflight Lobby Dashboard (sandbox only)
// Preview: /sandbox/studio-bridge-preflight
// Delete this file + app/sandbox/ to remove entirely.

import React, { useState } from "react";

type RowState = "pending" | "done" | "error";

interface AudioDevice {
  id: string;
  label: string;
  selected?: boolean;
}

export interface StudioBridgePreflightProps {
  authReady: boolean;
  isAuthenticated: boolean;
  showLobbyControls: boolean;
  micPermissionDenied: boolean;
  micPermissionHint?: string;
  micSyncTimedOut: boolean;
  statusNote?: string;

  micRowState: RowState;
  audioRowState: RowState;
  connRowState: RowState;
  audioPendingCopy: string;
  kitePendingCopy: string;
  kiteErrorCopy: string;

  canEnterStudio: boolean;
  canPracticeAlone: boolean;
  onEnterStudio: () => void;
  onEnterSoloLooper: () => void;
  onRetryMicSync: () => void;
  onRunAudioTest: () => void;
  audioTestPlaying: boolean;
  audioTestDone: boolean;

  hasLocalMicStream: boolean;
  hasRemoteStream: boolean;
  remoteMeterTapActive: boolean;
  remoteIsLive: boolean;
  isMicMuted: boolean;
  isSpeakerMuted: boolean;
  remotePlaybackVolume: number;
  onToggleMic: () => void;
  onToggleSpeaker: () => void;
  onRemotePlaybackVolumeChange: (value: number) => void;
  localMicLevels?: number[];
  remoteLevels?: number[];

  devicePanelOpen: boolean;
  onToggleDevicePanel: () => void;
  audioInputDevices: AudioDevice[];
  onSelectInputDevice: (id: string) => void;

  onCopyInviteLink?: () => void;
  onOpenAdvancedAudio?: () => void;
  onReturnToLobby?: () => void;
}

const IconMic = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const IconSpeaker = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

const IconSignal = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <circle cx="12" cy="20" r="1" fill="currentColor" />
  </svg>
);

const IconCheck = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconX = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconClock = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const IconPlay = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const IconAlertTriangle = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const IconRefresh = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const LiveDot = ({ active }: { active: boolean }) => (
  <span
    className={`inline-block h-2 w-2 rounded-full ${active ? "animate-pulse bg-emerald-400" : "bg-stone-600"}`}
    aria-hidden="true"
  />
);

function StateBadge({ state }: { state: RowState }) {
  if (state === "done") {
    return (
      <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
        <IconCheck /> Ready
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/15 px-2 py-0.5 text-xs font-semibold text-orange-400">
        <IconX /> Error
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-full border border-stone-600/40 bg-stone-700/60 px-2 py-0.5 text-xs font-semibold text-stone-400">
      <IconClock /> Checking
    </span>
  );
}

function SoundBar({ levels, active }: { levels: number[]; active: boolean }) {
  return (
    <div className="flex h-full min-h-[3rem] flex-1 items-end gap-0.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-2">
      {levels.slice(0, 12).map((level, i) => {
        const height = Math.max(4, Math.round(level * 32));
        const isHot = level > 0.85;
        return (
          <div key={i} className="relative flex h-full flex-1 items-end">
            <div
              className={`w-full rounded-sm transition-all duration-75 ${
                !active ? "bg-emerald-900/40" : isHot ? "bg-orange-400" : "bg-emerald-400"
              }`}
              style={{ height: `${height}px` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function SidebarCheckRow({
  icon,
  label,
  state,
  middle,
}: {
  icon: React.ReactNode;
  label: string;
  state: RowState;
  middle: React.ReactNode;
}) {
  const borderColor =
    state === "done" ? "border-emerald-500/25" :
    state === "error" ? "border-orange-500/25" :
    "border-white/[0.08]";

  const bgColor =
    state === "done" ? "bg-emerald-500/[0.06]" :
    state === "error" ? "bg-orange-500/[0.06]" :
    "bg-white/[0.02]";

  const iconColor =
    state === "done" ? "text-emerald-400" :
    state === "error" ? "text-orange-400" :
    "text-stone-500";

  return (
    <div className={`flex min-h-0 flex-1 flex-col rounded-xl border ${borderColor} ${bgColor} p-4`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className={`flex items-center gap-2 ${iconColor}`}>
          {icon}
          <span className="text-sm font-semibold text-white/90">{label}</span>
        </div>
        <StateBadge state={state} />
      </div>
      <div className="flex min-h-0 flex-1 items-stretch w-full">{middle}</div>
    </div>
  );
}

function PermissionDeniedBanner({ hint }: { hint?: string }) {
  return (
    <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl border border-orange-500/25 bg-orange-500/8 px-4 py-3.5">
      <span className="mt-0.5 shrink-0 text-orange-400"><IconAlertTriangle /></span>
      <div>
        <p className="text-sm font-semibold text-orange-300">Microphone Access Denied</p>
        <p className="mt-0.5 text-xs leading-relaxed text-stone-400">
          {hint ?? "Please allow microphone access in your browser or system settings, then reload this page."}
        </p>
      </div>
    </div>
  );
}

function MicTimeoutBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-white/[0.08] bg-stone-800/60 px-4 py-3.5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-stone-400"><IconClock size={15} /></span>
        <div>
          <p className="text-sm font-semibold text-stone-300">Microphone Sync Timeout</p>
          <p className="mt-0.5 text-xs text-stone-500">Could not detect your mic within the expected time.</p>
        </div>
      </div>
      <button
        onClick={onRetry}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-orange-500/30 px-3 py-1.5 text-xs font-semibold text-orange-400 transition-all hover:bg-orange-500/10 focus:outline-none focus:ring-2 focus:ring-orange-500/30"
      >
        <IconRefresh /> Retry
      </button>
    </div>
  );
}

function TipList() {
  return (
    <div className="rounded-xl border border-white/[0.05] bg-white/[0.02] px-4 py-3.5">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-stone-600">Before you enter</p>
      <ul className="space-y-1.5 text-xs leading-relaxed text-stone-500">
        <li>- use wired headphones</li>
        <li>- calibrate before looping</li>
        <li>- Ethernet for best performance</li>
      </ul>
    </div>
  );
}

export default function StudioBridgePreflightRedesign(props: StudioBridgePreflightProps) {
  const {
    micPermissionDenied,
    micPermissionHint,
    micSyncTimedOut,
    statusNote,
    micRowState,
    audioRowState,
    connRowState,
    canEnterStudio,
    canPracticeAlone,
    onEnterStudio,
    onEnterSoloLooper,
    onRetryMicSync,
    onRunAudioTest,
    audioTestPlaying,
    audioTestDone,
    hasLocalMicStream,
    isMicMuted,
    localMicLevels = Array(12).fill(0),
    onCopyInviteLink,
    onReturnToLobby,
  } = props;

  const allReady = micRowState === "done" && audioRowState === "done" && connRowState === "done";
  const hasError = micRowState === "error" || audioRowState === "error" || connRowState === "error";
  const roomCode = statusNote?.replace(/^Session ID:\s*/i, "") ?? "kite-demo-001";

  return (
    <div
      className="flex h-full min-h-screen flex-col bg-stone-950 font-sans antialiased"
      style={{ fontFamily: "'Sora', 'DM Sans', system-ui, sans-serif" }}
    >
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-24 left-0 h-[34rem] w-[34rem] rounded-full bg-orange-500/[0.1] blur-3xl" />
        <div className="absolute top-1/3 right-0 h-[30rem] w-[30rem] rounded-full bg-emerald-500/[0.09] blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-[26rem] w-[26rem] rounded-full bg-orange-500/[0.06] blur-3xl" />
        <div className="absolute top-1/2 left-1/2 h-[22rem] w-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/[0.05] blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      <header className="relative shrink-0 border-b border-white/[0.06] bg-stone-950/80 px-4 py-5 backdrop-blur-xl md:px-8 md:py-6">
        <div className="flex w-full items-center gap-4 md:gap-8">
          {onReturnToLobby ? (
            <button
              onClick={onReturnToLobby}
              className="shrink-0 rounded-xl border border-white/[0.14] bg-stone-900/70 px-4 py-2.5 text-sm font-semibold text-stone-300 shadow-sm transition-all hover:border-orange-500/35 hover:bg-orange-500/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-orange-500/30"
            >
              ← return to lobby
            </button>
          ) : (
            <div className="hidden w-[168px] shrink-0 md:block" aria-hidden />
          )}

          <div className="flex flex-1 items-center justify-center gap-3 md:gap-4">
            <h1 className="bg-gradient-to-r from-orange-400 via-orange-300 to-emerald-400 bg-clip-text text-2xl font-black tracking-tight text-transparent md:text-4xl">
              Kite Studio
            </h1>
            <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/12 px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-emerald-400 md:px-3 md:py-1.5 md:text-xs">
              Preflight
            </span>
          </div>

          <div className="hidden w-[168px] shrink-0 md:block" aria-hidden />
        </div>
      </header>

      <main className="relative flex min-h-0 w-full flex-1 flex-col px-4 py-4 md:px-6 md:py-5">
        {(micPermissionDenied || micSyncTimedOut) && (
          <>
            {micPermissionDenied && <PermissionDeniedBanner hint={micPermissionHint} />}
            {micSyncTimedOut && !micPermissionDenied && <MicTimeoutBanner onRetry={onRetryMicSync} />}
          </>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,360px)_1fr] lg:items-stretch">
          {/* Left — system readiness sidebar */}
          <section
            aria-labelledby="preflight-heading"
            className="flex h-full min-h-[360px] flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-stone-900/50 backdrop-blur-sm lg:min-h-0"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.05] px-5 py-4">
              <div>
                <h2 id="preflight-heading" className="text-sm font-bold tracking-tight text-white">
                  System Readiness
                </h2>
                <p className="mt-px text-[11px] text-stone-500">All checks must pass before entering</p>
              </div>
              <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                allReady
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                  : hasError
                  ? "border-orange-500/25 bg-orange-500/10 text-orange-400"
                  : "border-white/[0.06] bg-stone-800/60 text-stone-400"
              }`}>
                <LiveDot active={allReady} />
                {allReady ? "All Ready" : hasError ? "Action Required" : "Checking…"}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            <SidebarCheckRow
              icon={<IconMic />}
              label="Microphone"
              state={micRowState}
              middle={
                <SoundBar
                  levels={localMicLevels}
                  active={hasLocalMicStream && !isMicMuted}
                />
              }
            />
            <SidebarCheckRow
              icon={<IconSpeaker />}
              label="Speaker"
              state={audioRowState}
              middle={
                audioRowState === "done" ? (
                  <div className="flex h-full min-h-[3rem] w-full flex-1 items-center rounded-lg border border-emerald-500/25 bg-emerald-500/8 px-3 text-xs font-medium text-emerald-400">
                    Audio output confirmed
                  </div>
                ) : (
                  <button
                    onClick={onRunAudioTest}
                    disabled={audioTestPlaying}
                    className={`flex h-full min-h-[3rem] w-full flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-orange-500/30 ${
                      audioTestDone
                        ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-400"
                        : audioTestPlaying
                        ? "cursor-not-allowed border-white/[0.08] text-stone-500"
                        : "border-orange-500/30 text-orange-400 hover:bg-orange-500/8"
                    }`}
                  >
                    {audioTestDone ? (
                      <><IconCheck /> Done</>
                    ) : audioTestPlaying ? (
                      "Playing…"
                    ) : (
                      <><IconPlay /> tap to test audio</>
                    )}
                  </button>
                )
              }
            />
            <SidebarCheckRow
              icon={<IconSignal />}
              label="Kite Signal"
              state={connRowState}
              middle={
                <div className="flex h-full min-h-[3rem] w-full flex-1 items-center justify-center rounded-lg border border-dashed border-white/[0.08] bg-white/[0.01] px-3">
                  <span className={`text-xs ${
                    connRowState === "done" ? "text-emerald-400/80" :
                    connRowState === "error" ? "text-orange-400/80" :
                    "text-stone-600"
                  }`}>
                    {connRowState === "done" ? "Relay connected" : connRowState === "error" ? "Connection failed" : "Awaiting relay…"}
                  </span>
                </div>
              }
            />
            </div>
          </section>

          {/* Right — room info + session actions */}
          <section className="grid h-full min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-2xl border border-white/[0.07] bg-stone-900/50 backdrop-blur-sm max-lg:min-h-[360px] md:grid-cols-2">
            <div className="flex min-h-0 flex-col gap-5 border-b border-white/[0.05] p-6 md:border-b-0 md:border-r">
              <div>
                <h2 className="text-sm font-bold tracking-tight text-white">Session</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
                  Share the room code with your collaborator.
                </p>
              </div>

              <button
                type="button"
                onClick={onCopyInviteLink}
                className="w-full rounded-xl border border-white/[0.08] bg-stone-950/50 px-4 py-5 text-center transition-all hover:border-emerald-500/30 hover:bg-stone-950/70 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              >
                <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">Room code</p>
                <p className="mt-1 font-mono text-xl font-bold tracking-wider text-white">{roomCode}</p>
                <p className="mt-1 text-xs text-stone-500">tap to copy</p>
              </button>

              <TipList />
            </div>

            <div className="flex min-h-0 flex-col gap-4 p-6">
              <div>
                <h2 className="text-sm font-bold tracking-tight text-white">Session Actions</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-stone-500">
                  {canEnterStudio
                    ? "All checks passed. You're ready to enter."
                    : "Complete preflight checks to enable session entry."}
                </p>
              </div>

              <button
                onClick={onEnterStudio}
                disabled={!canEnterStudio}
                aria-label="Jam with a friend"
                className={`flex flex-1 items-center justify-center gap-3 rounded-2xl px-6 py-8 text-base font-bold tracking-tight transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-orange-500/40 ${
                  canEnterStudio
                    ? "bg-gradient-to-r from-orange-500 to-emerald-500 text-white shadow-lg shadow-orange-500/25 hover:scale-[1.01] hover:shadow-orange-500/40 active:scale-[0.99]"
                    : "cursor-not-allowed border border-white/[0.05] bg-stone-800/60 text-stone-600"
                }`}
              >
                {canEnterStudio ? (
                  <>
                    <span>Jam with a friend</span>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </>
                ) : (
                  <span>Waiting for Preflight…</span>
                )}
              </button>

              <button
                onClick={onEnterSoloLooper}
                disabled={!canPracticeAlone}
                aria-label="Kite loopstation"
                className={`flex flex-[1.35] items-center justify-center gap-2.5 rounded-2xl border px-6 py-10 text-lg font-semibold tracking-tight transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${
                  canPracticeAlone
                    ? "border-emerald-500/30 text-emerald-400 hover:border-emerald-500/50 hover:bg-emerald-500/8 active:scale-[0.99]"
                    : "cursor-not-allowed border-white/[0.06] text-stone-600"
                }`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14" />
                </svg>
                Kite loopstation
              </button>

              <div className="grid grid-cols-3 gap-2 border-t border-white/[0.05] pt-4 text-center">
                {([
                  { label: "Mic", state: micRowState },
                  { label: "Audio", state: audioRowState },
                  { label: "Signal", state: connRowState },
                ] as { label: string; state: RowState }[]).map(({ label, state }) => (
                  <div
                    key={label}
                    className={`rounded-lg border px-1 py-2 ${
                      state === "done" ? "border-emerald-500/20 bg-emerald-500/5" :
                      state === "error" ? "border-orange-500/20 bg-orange-500/5" :
                      "border-white/[0.05] bg-white/[0.02]"
                    }`}
                  >
                    <div className={`text-[11px] font-bold ${
                      state === "done" ? "text-emerald-400" :
                      state === "error" ? "text-orange-400" :
                      "text-stone-500"
                    }`}>
                      {state === "done" ? "✓" : state === "error" ? "✕" : "…"}
                    </div>
                    <div className="mt-0.5 text-[9px] uppercase tracking-widest text-stone-600">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="relative flex shrink-0 items-center justify-between border-t border-white/[0.04] px-4 py-3 md:px-6">
        <span className="text-[10px] text-stone-700">Kite Studio © 2025</span>
        <span className="text-[10px] text-stone-700">Preflight v2 · Stable</span>
      </footer>
    </div>
  );
}

// ─── DEMO / PREVIEW WRAPPER ────────────────────────────────────────────────────

const MOCK_LEVELS_LOCAL = [0.2, 0.5, 0.8, 0.6, 0.9, 0.7, 0.4, 0.6, 0.3, 0.7, 0.5, 0.4];

const mockProps: StudioBridgePreflightProps = {
  authReady: true,
  isAuthenticated: true,
  showLobbyControls: false,
  micPermissionDenied: false,
  micSyncTimedOut: false,
  statusNote: "Session ID: kite-demo-001",

  micRowState: "done",
  audioRowState: "pending",
  connRowState: "done",
  audioPendingCopy: "Run the audio test to confirm output.",
  kitePendingCopy: "Connecting to Kite relay server…",
  kiteErrorCopy: "Failed to reach Kite server. Check your connection.",

  canEnterStudio: false,
  canPracticeAlone: true,
  onEnterStudio: () => console.log("Jam with a friend"),
  onEnterSoloLooper: () => console.log("Kite loopstation"),
  onRetryMicSync: () => console.log("Retry mic sync"),
  onRunAudioTest: () => console.log("Run audio test"),
  audioTestPlaying: false,
  audioTestDone: false,

  hasLocalMicStream: true,
  hasRemoteStream: false,
  remoteMeterTapActive: false,
  remoteIsLive: false,
  isMicMuted: false,
  isSpeakerMuted: false,
  remotePlaybackVolume: 0.85,
  onToggleMic: () => {},
  onToggleSpeaker: () => {},
  onRemotePlaybackVolumeChange: () => {},
  localMicLevels: MOCK_LEVELS_LOCAL,
  remoteLevels: [],

  devicePanelOpen: false,
  onToggleDevicePanel: () => {},
  audioInputDevices: [],
  onSelectInputDevice: () => {},

  onCopyInviteLink: () => console.log("Copy room code"),
  onReturnToLobby: () => console.log("Return to lobby"),
};

export function StudioBridgePreflightDemo() {
  const [audioTestPlaying, setAudioTestPlaying] = useState(false);
  const [audioTestDone, setAudioTestDone] = useState(false);
  const [audioRowState, setAudioRowState] = useState<RowState>("pending");

  const handleAudioTest = () => {
    if (audioTestPlaying || audioTestDone) return;
    setAudioTestPlaying(true);
    window.setTimeout(() => {
      setAudioTestPlaying(false);
      setAudioTestDone(true);
      setAudioRowState("done");
    }, 1200);
  };

  return (
    <StudioBridgePreflightRedesign
      {...mockProps}
      audioRowState={audioRowState}
      audioTestPlaying={audioTestPlaying}
      audioTestDone={audioTestDone}
      onRunAudioTest={handleAudioTest}
      canEnterStudio={mockProps.micRowState === "done" && audioRowState === "done" && mockProps.connRowState === "done"}
    />
  );
}
