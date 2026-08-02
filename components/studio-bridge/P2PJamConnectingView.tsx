"use client";

/**
 * Dedicated connecting-status UI for P2P v2.
 * Pure presenter — no engine imports. Parent supplies status + retry.
 */

import Link from "next/link";

type RowState = "pending" | "done" | "error";

export type P2PJamConnectingViewProps = {
  sessionId: string | null;
  role: "host" | "peer" | null;
  status: "connecting" | "connected" | "failed";
  statusNote: string | null;
  bridgeInitError: string | null;
  micState: RowState;
  signalState: RowState;
  pingMs: number | null;
  kitePendingCopy: string;
  kiteErrorCopy: string;
  micPermissionHint: string | null;
  onRetry: () => void;
  onCancel: () => void;
  /** Same-account guest join blocked — show guidance without engine changes. */
  ownSessionBlockedMessage: string | null;
  onDismissOwnSessionBlocked: () => void;
  /** Host waiting for guest — optional invite share. */
  inviteLink?: string | null;
  onCopyInviteLink?: () => void;
};

function Row({
  label,
  state,
  detail,
}: {
  label: string;
  state: RowState;
  detail?: string;
}): React.JSX.Element {
  const color =
    state === "done"
      ? "text-[#22c55e]"
      : state === "error"
        ? "text-red-300"
        : "text-white/40";
  const mark = state === "done" ? "✓" : state === "error" ? "!" : "…";
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/[0.06] py-3 last:border-0">
      <div>
        <div className="text-[12px] font-semibold text-white/75">{label}</div>
        {detail ? (
          <div className="mt-0.5 text-[10px] leading-relaxed text-white/35">{detail}</div>
        ) : null}
      </div>
      <span className={`font-mono text-[12px] font-bold ${color}`}>{mark}</span>
    </div>
  );
}

export function P2PJamConnectingView({
  sessionId,
  role,
  status,
  statusNote,
  bridgeInitError,
  micState,
  signalState,
  pingMs,
  kitePendingCopy,
  kiteErrorCopy,
  micPermissionHint,
  onRetry,
  onCancel,
  ownSessionBlockedMessage,
  onDismissOwnSessionBlocked,
  inviteLink = null,
  onCopyInviteLink,
}: P2PJamConnectingViewProps): React.JSX.Element {
  const failed = status === "failed" || Boolean(bridgeInitError);
  const hostWaiting =
    !failed &&
    role === "host" &&
    status !== "connected" &&
    (signalState === "done" || Boolean(sessionId));

  const headline = failed
    ? "Connection failed"
    : hostWaiting
      ? "Waiting for your bandmate…"
      : "Connecting to session…";
  const sub =
    bridgeInitError ||
    statusNote ||
    (failed
      ? "Something went wrong while joining."
      : hostWaiting
        ? "Share the invite link so your guest can join this room."
        : "Setting up audio and peer link.");

  const signalDetail =
    signalState === "done"
      ? pingMs != null
        ? `Relay ready · ${pingMs} ms`
        : hostWaiting
          ? "Waiting for peer…"
          : "Relay ready"
      : signalState === "error"
        ? kiteErrorCopy
        : kitePendingCopy;

  const micDetail =
    micState === "done"
      ? "Microphone ready"
      : micState === "error"
        ? micPermissionHint || "Microphone access required"
        : "Requesting microphone…";

  return (
    <div className="mx-auto mt-8 w-full max-w-md">
      <div className="rounded-[18px] border border-white/[0.08] bg-[rgba(10,10,10,0.75)] p-5 shadow-2xl backdrop-blur-[18px]">
        <div className="flex items-center gap-3">
          {!failed ? (
            <div
              className="h-8 w-8 shrink-0 rounded-full border-2 border-[#ff4500]/35 border-t-[#22c55e]/80 animate-spin"
              style={{ animationDuration: "1.1s" }}
              aria-hidden
            />
          ) : (
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 text-[12px] font-bold text-red-300"
              aria-hidden
            >
              !
            </div>
          )}
          <div>
            <p className="m-0 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-[#22c55e]/80">
              Kite Studio · P2P
            </p>
            <h2 className="m-0 mt-1 text-[17px] font-bold tracking-tight text-white/90">
              {headline}
            </h2>
          </div>
        </div>

        <p className="mt-3 text-[12px] leading-relaxed text-white/45">{sub}</p>

        <div className="mt-4 rounded-xl border border-white/[0.06] bg-black/35 px-3.5">
          <Row label="Microphone" state={micState} detail={micDetail} />
          <Row label="Kite Signal" state={signalState} detail={signalDetail} />
          <Row
            label="Session"
            state={failed ? "error" : status === "connected" ? "done" : hostWaiting ? "done" : "pending"}
            detail={
              sessionId
                ? `Room ${sessionId.toUpperCase()} · ${role === "host" ? "Host" : role === "peer" ? "Guest" : "…"}`
                : "Reserving session…"
            }
          />
        </div>

        {hostWaiting && inviteLink && onCopyInviteLink ? (
          <button
            type="button"
            onClick={onCopyInviteLink}
            className="mt-4 w-full cursor-pointer rounded-xl border border-[#ff4500]/40 bg-gradient-to-r from-[#ff4500]/15 to-[#22c55e]/12 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/85 hover:from-[#ff4500]/22 hover:to-[#22c55e]/18"
          >
            Copy Invite Link
          </button>
        ) : null}

        {ownSessionBlockedMessage ? (
          <div
            className="mt-4 rounded-xl border border-orange-500/35 bg-orange-950/30 px-3.5 py-3"
            role="alert"
          >
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-orange-200">
              Cannot join as the same person
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-orange-100/85">
              {ownSessionBlockedMessage}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-orange-100/60">
              To test two peers: use a second browser profile, another device, or a different
              account. Same logged-in user cannot join their own room as guest.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/sandbox/p2p-jam"
                className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/70 hover:bg-white/10"
              >
                Open UI sandbox
              </Link>
              <button
                type="button"
                onClick={onDismissOwnSessionBlocked}
                className="cursor-pointer rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-orange-200 hover:bg-orange-500/20"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 cursor-pointer rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60 hover:bg-white/[0.06]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="flex-1 cursor-pointer rounded-xl border border-[#ff4500]/40 bg-[#ff4500]/10 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#ff4500] hover:bg-[#ff4500]/18"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}

export default P2PJamConnectingView;
