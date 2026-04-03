export function forceMusicModeOpus(sdp: string): string {
  try {
    const rtpMatch = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000(?:\/\d+)?\r?\n/i)
    if (!rtpMatch) return sdp

    const id = rtpMatch[1]
    const newParams = ['maxaveragebitrate=510000', 'useinbandfec=0']
    const fmtpRegex = new RegExp(`(a=fmtp:${id}\\s+)([^\r\n]*)`, 'i')
    const fmtpMatch = sdp.match(fmtpRegex)

    if (fmtpMatch) {
      const existing = fmtpMatch[2].split(/;\s*/)
      const existingKeys = existing.map(p => p.split('=')[0].trim())
      const toAdd = newParams.filter(p => 
        !existingKeys.includes(p.split('=')[0].trim())
      )
      if (toAdd.length === 0) return sdp
      return sdp.replace(fmtpRegex, `$1${fmtpMatch[2]}; ${toAdd.join('; ')}`)
    } else {
      const rtpLine = rtpMatch[0]
      const newLine = `a=fmtp:${id} ${newParams.join('; ')}\r\n`
      return sdp.replace(rtpLine, rtpLine + newLine)
    }
  } catch (error) {
    console.warn('[Kite] SDP modification failed:', error)
    return sdp
  }
}
