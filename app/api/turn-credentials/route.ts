import { NextResponse } from 'next/server'

export async function GET() {
  const username = process.env.METERED_USERNAME
  const credential = process.env.METERED_PASSWORD

  if (!username || !credential) {
    console.error('[Kite] TURN credentials not configured')
    return NextResponse.json(
      { error: 'TURN credentials not configured' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: [
          'turn:global.relay.metered.ca:80',
          'turn:global.relay.metered.ca:80?transport=tcp',
          'turn:global.relay.metered.ca:443?transport=tcp',
          'turns:global.relay.metered.ca:443?transport=tcp',
        ],
        username,
        credential,
      },
    ],
  })
}
