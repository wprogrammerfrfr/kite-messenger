export function forceMusicModeOpus(sdp: string): string {
  try {
    const rtpMatch = sdp.match(
      /a=rtpmap:(\d+)\s+opus\/48000(?:\/\d+)?/i
    )
    if (!rtpMatch) return sdp

    const id = rtpMatch[1]
    const fmtpRegex = new RegExp(
      `(a=fmtp:${id} )([^\r\n]*)`,
      'i'
    )
    const fmtpMatch = sdp.match(fmtpRegex)

    if (fmtpMatch) {
      const existingParams = fmtpMatch[2]
      
      // Replace useinbandfec value directly in the string
      let updated = existingParams.replace(
        /useinbandfec=\d/i,
        'useinbandfec=0'
      )
      
      // Add maxaveragebitrate if not present
      if (!/maxaveragebitrate/i.test(updated)) {
        updated += ';maxaveragebitrate=510000'
      }
      
      return sdp.replace(fmtpMatch[0], fmtpMatch[1] + updated)
    } else {
      // No fmtp line exists — insert one after rtpmap line
      const rtpLine = sdp.match(
        new RegExp(`a=rtpmap:${id}[^\\r\\n]*\\r?\\n`, 'i')
      )?.[0]
      if (!rtpLine) return sdp
      const newLine = 
        `a=fmtp:${id} useinbandfec=0;maxaveragebitrate=510000\r\n`
      return sdp.replace(rtpLine, rtpLine + newLine)
    }
  } catch (error) {
    console.warn('[Kite] SDP modification failed:', error)
    return sdp
  }
}
