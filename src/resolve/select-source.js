const PROTOCOLS = ['HLS', 'MP4', 'DASH', 'DIRECT']

function isPlaylistUrl(url) {
  return /\.m3u8(\?|$)/i.test(url) || /[?&]m3u8=/i.test(url) || /\/m3u8(\?|$)/i.test(url) || /\/playlist\.jpg(\?|$)/i.test(url)
}

function qualityHeight(item) {
  if (typeof item?.height === 'number' && Number.isFinite(item.height)) return item.height
  const match = `${item?.label ?? ''} ${item?.source ?? ''}`.match(/(\d{3,4})\s*p?/i)
  return match ? Number.parseInt(match[1], 10) : 0
}

function resolveProtocol(item) {
  const source = String(item.source || '').toUpperCase()
  if (PROTOCOLS.includes(source)) return source

  const format = String(item.format || '').toLowerCase()
  if (format === 'hls') return 'HLS'
  if (format === 'mp4') return 'MP4'
  if (format === 'dash') return 'DASH'
  if (isPlaylistUrl(item.url)) return 'HLS'
  if (/\.mp4(\?|$)/i.test(item.url)) return 'MP4'
  if (/\.mpd(\?|$)/i.test(item.url)) return 'DASH'
  return 'DIRECT'
}

function playableEntries(data) {
  if (!Array.isArray(data?.url)) return []
  return data.url.filter((item) => typeof item?.url === 'string' && item.url.length > 0)
}

export function pickStream(data) {
  if (data?.error) return { reason: String(data.error) }
  const entries = playableEntries(data)
  if (!entries.length) return { reason: 'no_streams' }

  let best = entries[0]
  for (const item of entries) {
    if (qualityHeight(item) > qualityHeight(best)) best = item
  }

  return { url: best.url, source: resolveProtocol(best) }
}
