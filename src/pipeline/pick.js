const SOURCE_RANK = ['HLS', 'MP4', 'DASH', 'DIRECT']

function rank(source) {
  const index = SOURCE_RANK.indexOf(String(source || 'DIRECT').toUpperCase())
  return index < 0 ? 99 : index
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value != null && value !== '') out[key] = String(value)
  }
  return out
}

export function pickBestMirror(data) {
  const mirrors = Array.isArray(data?.url) ? data.url.filter((item) => item?.url) : []
  if (!mirrors.length) return null
  mirrors.sort((a, b) => rank(a.source) - rank(b.source))
  const best = mirrors[0]
  return {
    url: best.url,
    source: best.source || 'DIRECT',
    headers: normalizeHeaders(best.headers),
  }
}

export function isPlaylistUrl(url) {
  return /\.m3u8(\?|$)/i.test(url) || /[?&]m3u8=/i.test(url)
}
