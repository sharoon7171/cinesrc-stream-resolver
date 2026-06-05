import { CINESRC_HEADERS, ORIGIN } from './constants.js'
import { isHlsUrl } from './stream-sources.js'
import { upstreamFetch } from './upstream-fetch.js'

const DEFAULT_REFERER = `${ORIGIN}/`

function defaultStreamHeaders(extra = {}) {
  return {
    Referer: CINESRC_HEADERS.Referer,
    Origin: CINESRC_HEADERS.Origin,
    'User-Agent': CINESRC_HEADERS['User-Agent'],
    ...extra,
  }
}

export function mergeStreamHeaders(sourceHeaders = {}) {
  const merged = defaultStreamHeaders()
  for (const [key, value] of Object.entries(sourceHeaders)) {
    merged[key] = value
  }
  if (!merged.Referer) merged.Referer = DEFAULT_REFERER
  if (!merged['User-Agent']) merged['User-Agent'] = CINESRC_HEADERS['User-Agent']
  return merged
}

export function buildPlayUrl(baseUrl, streamUrl, sourceHeaders = {}) {
  const q = new URLSearchParams()
  q.set('url', streamUrl)
  const headers = mergeStreamHeaders(sourceHeaders)
  if (headers.Referer && headers.Referer !== DEFAULT_REFERER) q.set('referer', headers.Referer)
  for (const [key, value] of Object.entries(headers)) {
    if (key === 'Referer' || key === 'User-Agent' || key === 'Origin') continue
    q.set(`h_${key.toLowerCase()}`, value)
  }
  return `${baseUrl}/api/proxy?${q}`
}

async function proxyFetch(targetUrl, sourceHeaders = {}, init = {}) {
  const headers = mergeStreamHeaders(sourceHeaders)
  return upstreamFetch(targetUrl, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
    redirect: 'follow',
  })
}

function rewritePlaylistLine(line, baseUrl, playBase, sourceHeaders) {
  const trimmed = line.trim()
  if (!trimmed) return line
  if (trimmed.startsWith('#')) {
    if (!trimmed.includes('URI="')) return line
    return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
      const abs = new URL(uri, baseUrl).href
      return `URI="${buildPlayUrl(playBase, abs, sourceHeaders)}"`
    })
  }
  const abs = new URL(trimmed, baseUrl).href
  return buildPlayUrl(playBase, abs, sourceHeaders)
}

function normalizePlaylist(text) {
  if (!text.includes('#EXT-X-MEDIA:TYPE=AUDIO')) return text
  return text
    .split('\n')
    .filter((line) => !line.includes('#EXT-X-MEDIA:TYPE=AUDIO'))
    .map((line) => (line.includes('#EXT-X-STREAM-INF:') ? line.replace(/,AUDIO="[^"]+"/g, '') : line))
    .join('\n')
}

export async function proxyStreamResponse(targetUrl, sourceHeaders, playBase, init = {}) {
  const res = await proxyFetch(targetUrl, sourceHeaders, init)
  if (init.method === 'HEAD') {
    return { status: res.status, headers: passthroughHeaders(res), body: Buffer.alloc(0) }
  }
  const type = res.headers.get('content-type') || ''
  const buf = Buffer.from(await res.arrayBuffer())
  const text = buf.toString('utf8')
  const isPlaylist =
    text.includes('#EXTM3U') ||
    isHlsUrl(targetUrl) ||
    type.includes('mpegurl') ||
    (type.includes('text/plain') && text.includes('#EXT'))
  if (!isPlaylist) {
    return { status: res.status, headers: passthroughHeaders(res), body: buf }
  }
  const baseUrl = targetUrl
  const rewritten = normalizePlaylist(
    text
      .split('\n')
      .map((line) => rewritePlaylistLine(line, baseUrl, playBase, sourceHeaders))
      .join('\n'),
  )
  return {
    status: res.status,
    headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Access-Control-Allow-Origin': '*' },
    body: Buffer.from(rewritten, 'utf8'),
  }
}

function passthroughHeaders(res) {
  const out = { 'Access-Control-Allow-Origin': '*' }
  const type = res.headers.get('content-type')
  if (type) out['Content-Type'] = type
  const range = res.headers.get('content-range')
  if (range) out['Content-Range'] = range
  const length = res.headers.get('content-length')
  if (length) out['Content-Length'] = length
  const acceptRanges = res.headers.get('accept-ranges')
  if (acceptRanges) out['Accept-Ranges'] = acceptRanges
  return out
}
