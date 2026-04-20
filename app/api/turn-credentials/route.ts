import { NextResponse } from 'next/server';

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

    const iceServers = await res.json();
    return NextResponse.json({ iceServers });
  } catch (error) {
    console.error('[Kite] Failed to fetch TURN credentials:', error);
    return NextResponse.json(
      { error: 'Failed to fetch TURN credentials' },
      { status: 500 }
    );
  }
}