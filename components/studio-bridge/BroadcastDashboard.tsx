"use client";

import { memo } from "react";

export type BroadcastStatus = "idle" | "connecting" | "syncing" | "live";

export type BroadcastDashboardProps = {
  metronomeBpm: number;
  visualActiveBeatInBar: number | null;
  broadcastStatus: BroadcastStatus;
  kiteSyncCountInActive: boolean;
  kiteSyncEnabled: boolean;
  canStartSync: boolean;
  canControlStop: boolean;
  remoteParticipantName: string | null;
  syncInitiatorId: string | null;
  localJamSetupOwnerId: string;
  onStartCountIn: () => void;
  onStopSync: () => void;
};

function BroadcastDashboardComponent({
  metronomeBpm,
  visualActiveBeatInBar,
  broadcastStatus,
  kiteSyncCountInActive,
  kiteSyncEnabled,
  canStartSync,
  canControlStop,
  remoteParticipantName,
  syncInitiatorId,
  localJamSetupOwnerId,
  onStartCountIn,
  onStopSync,
}: BroadcastDashboardProps) {
  const syncStatusLabel =
    broadcastStatus === "idle"
      ? "Ready"
      : kiteSyncCountInActive
        ? "Count-in"
        : broadcastStatus === "live"
          ? "Live"
          : "Starting";
  const phaseLabel =
    visualActiveBeatInBar === 0
      ? "Downbeat"
      : visualActiveBeatInBar !== null
        ? "Beat"
        : "\u2014";

  const partnerSessionLabel = remoteParticipantName?.trim() || "Partner";
  const jamAnchorMessage =
    syncInitiatorId === localJamSetupOwnerId
      ? "You're leading this sync."
      : syncInitiatorId
        ? `Synced by ${partnerSessionLabel}`
        : "Active jam session";

  return (
    <div className="space-y-3 rounded-xl border border-stone-800/90 bg-stone-950/45 p-4">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center">
        <p className="font-mono text-sm text-stone-100">
          <span className="text-stone-500">BPM</span>{" "}
          <span className="font-semibold tabular-nums">{metronomeBpm}</span>
        </p>
        <p className="font-mono text-sm text-stone-100">
          <span className="text-stone-500">Phase</span>{" "}
          <span className="font-semibold">{phaseLabel}</span>
        </p>
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">
          {syncStatusLabel}
        </p>
      </div>
      {canStartSync ? (
        <button
          type="button"
          onClick={onStartCountIn}
          className="w-full rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/15"
        >
          Start Count-In &amp; Jam
        </button>
      ) : null}
      {broadcastStatus !== "idle" || kiteSyncEnabled ? (
        <p className="text-center text-xs font-medium text-stone-400">{jamAnchorMessage}</p>
      ) : null}
      <button
        type="button"
        disabled={!canControlStop}
        aria-disabled={!canControlStop}
        onClick={() => {
          if (!canControlStop) return;
          onStopSync();
        }}
        className={`w-full rounded-xl border px-4 py-3 text-sm font-semibold transition ${
          canControlStop
            ? "border-orange-500/40 bg-orange-500/10 text-orange-200 hover:bg-orange-500/15"
            : "cursor-not-allowed border-stone-700/80 bg-stone-900/50 text-stone-500 opacity-60"
        }`}
      >
        Stop Kite Sync
      </button>
    </div>
  );
}

export const BroadcastDashboard = memo(BroadcastDashboardComponent);
