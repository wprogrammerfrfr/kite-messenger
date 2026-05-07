import { NextResponse } from 'next/server';

type TurnCredentialsPayload = {
  iceServers: unknown[];
  ttlSeconds: number | null;
  expiresAtEpochMs: number | null;
};

/**
 * Metered / ICE REST responses vary: a bare `RTCIceServer[]`, or a wrapper object
 * with `iceServers` plus optional TTL hints (`expiryInSeconds`, `ttlSeconds`, `expiresAt`, …).
 */
function parseTurnCredentialsBody(raw: unknown): TurnCredentialsPayload {
  let iceServers: unknown[] = [];
  let ttlSeconds: number | null = null;
  let expiresAtEpochMs: number | null = null;

  if (Array.isArray(raw)) {
    iceServers = raw;
    return { iceServers, ttlSeconds: null, expiresAtEpochMs: null };
  }

  if (!raw || typeof raw !== 'object') {
    return { iceServers: [], ttlSeconds: null, expiresAtEpochMs: null };
  }

  const o = raw as Record<string, unknown>;

  if (Array.isArray(o.iceServers)) {
    iceServers = o.iceServers;
  }

  const pickFiniteInt = (v: unknown): number | null => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return Math.max(0, Math.floor(v));
  };

  ttlSeconds =
    pickFiniteInt(o.ttlSeconds) ??
    pickFiniteInt(o.ttl) ??
    pickFiniteInt(o.expiryInSeconds) ??
    pickFiniteInt(o.expiresInSeconds);

  if (typeof o.expiresAtEpochMs === 'number' && Number.isFinite(o.expiresAtEpochMs)) {
    expiresAtEpochMs = Math.floor(o.expiresAtEpochMs);
  } else if (typeof o.expiresAt === 'number' && Number.isFinite(o.expiresAt)) {
    expiresAtEpochMs = Math.floor(o.expiresAt);
  } else if (typeof o.expiresAt === 'string') {
    const parsed = Date.parse(o.expiresAt);
    if (!Number.isNaN(parsed)) expiresAtEpochMs = parsed;
  }

  if (expiresAtEpochMs === null && ttlSeconds !== null && ttlSeconds > 0) {
    expiresAtEpochMs = Date.now() + ttlSeconds * 1000;
  }

  return {
    iceServers,
    ttlSeconds: ttlSeconds ?? null,
    expiresAtEpochMs: expiresAtEpochMs ?? null,
  };
}

export async function GET() {
  // .trim() strips hidden Windows \r carriage returns that cause 401 errors
  const username = process.env.METERED_USERNAME?.trim();
  const password = process.env.METERED_PASSWORD?.trim();

  if (!username || !password) {
    console.error('[Kite] TURN credentials not configured on server');
    return NextResponse.json(
      { error: 'TURN credentials not configured' },
      { status: 500 }
    );
  }

  try {
    // Fetch short-lived credentials from Metered.ca API
    const res = await fetch(
      `https://${username}.metered.live/api/v1/turn/credentials?apiKey=${password}`,
      { cache: 'no-store' }
    );

    if (!res.ok) {
      throw new Error(`Metered API returned ${res.status}`);
    }

    const raw = await res.json();
    const { iceServers, ttlSeconds, expiresAtEpochMs } = parseTurnCredentialsBody(raw);

    return NextResponse.json({
      iceServers,
      ttlSeconds,
      expiresAtEpochMs,
    });
  } catch (error) {
    console.error('[Kite] Failed to fetch TURN credentials:', error);
    return NextResponse.json(
      { error: 'Failed to fetch TURN credentials' },
      { status: 500 }
    );
  }
}
