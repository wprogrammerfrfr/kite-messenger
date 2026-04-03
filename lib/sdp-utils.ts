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
      const newParamMap = new Map(
        newParams.map(p => {
          const [k, v] = p.split('=')
          return [k.trim(), v.trim()]
        })
      )
      const merged = existing.map(p => {
        const key = p.split('=')[0].trim()
        return newParamMap.has(key) ? `${key}=${newParamMap.get(key)}` : p
      })
      newParamMap.forEach((v, k) => {
        if (!existing.some(p => p.split('=')[0].trim() === k)) {
          merged.push(`${k}=${v}`)
        }
      })
      return sdp.replace(fmtpRegex, `$1${merged.join('; ')}`)
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
