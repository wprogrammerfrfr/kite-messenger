import {
  parseInboundAudioPacketLoss,
  parseSelectedCandidatePairRttMs,
  type CandidatePairRtt,
  type InboundAudioPacketLoss,
} from "@/lib/studio-bridge-webrtc";

/** RTT/2 clamped to [0, 2000] ms, rounded to 0.1 ms — mirrors studio-bridge stats effect. */
export function computeOneWayDelayMs(rttMs: number): number {
  return Math.max(0, Math.min(2000, Math.round((rttMs / 2) * 10) / 10));
}

export type ParsedConnectionStats = {
  oneWayDelayMs: number | null;
  packetLossPercent: number | null;
  jitterSec: number;
  inboundLoss: InboundAudioPacketLoss | null;
  rtt: CandidatePairRtt | null;
};

function extractInboundAudioJitterSec(stats: RTCStatsReport): number {
  let jitterSec = 0;
  stats.forEach((stat) => {
    if (
      stat.type === "inbound-rtp" &&
      stat.kind === "audio" &&
      typeof (stat as RTCInboundRtpStreamStats).jitter === "number"
    ) {
      const j = (stat as RTCInboundRtpStreamStats).jitter;
      if (typeof j === "number") jitterSec = j;
    }
  });
  return jitterSec;
}

/** Parse getStats() into the fields the studio-bridge stats effect consumes. */
export function parseConnectionStats(stats: RTCStatsReport): ParsedConnectionStats {
  const rtt = parseSelectedCandidatePairRttMs(stats);
  const oneWayDelayMs = rtt === null ? null : computeOneWayDelayMs(rtt.rttMs);
  const jitterSec = extractInboundAudioJitterSec(stats);
  const inboundLoss = parseInboundAudioPacketLoss(stats);
  const packetLossPercent =
    inboundLoss === null ? null : Math.round(inboundLoss.ratio * 1000) / 10;

  return {
    oneWayDelayMs,
    packetLossPercent,
    jitterSec,
    inboundLoss,
    rtt,
  };
}

export type AutoTargetLeadInput = {
  rttMs: number;
  jitterSec: number;
  sampleRate: number;
};

/** clamp((rtt/2 + jitter + 0.02) * sr, 480..19200) */
export function computeAutoTargetLeadFrames(input: AutoTargetLeadInput): number {
  const rttSec = input.rttMs / 2 / 1000;
  const autoTarget = Math.round((rttSec + input.jitterSec + 0.02) * input.sampleRate);
  return Math.max(480, Math.min(19200, autoTarget));
}

/** Hysteresis gate: only update when |new - current| >= 480 frames. */
export function shouldUpdateAutoTarget(current: number, next: number): boolean {
  return Math.abs(next - current) >= 480;
}
