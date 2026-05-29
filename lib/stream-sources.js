const SOURCE_ORDER = ['HLS', 'MP4', 'DASH', 'DIRECT']

function collectStreamCandidates(data) {
  const out = []
  if (!data) return out
  if (Array.isArray(data.url)) {
    for (const item of data.url) {
      if (item?.url) out.push(item)
    }
  }
  return out
}

export function pickStreamSource(data) {
  const candidates = collectStreamCandidates(data)
  if (!candidates.length) return null
  candidates.sort((a, b) => {
    const ai = SOURCE_ORDER.indexOf(String(a.source || 'DIRECT').toUpperCase())
    const bi = SOURCE_ORDER.indexOf(String(b.source || 'DIRECT').toUpperCase())
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
  })
  const best = candidates[0]
  return {
    url: best.url,
    source: best.source || 'DIRECT',
    headers: normalizeHeaders(best.headers),
  }
}

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value != null && value !== '') out[key] = String(value)
  }
  return out
}

export function isHlsUrl(url) {
  return /\.m3u8(\?|$)/i.test(url) || /[?&]m3u8=/i.test(url)
}
