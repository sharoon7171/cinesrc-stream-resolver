import { SPOOF_HEADERS, TARGET } from '../target/origin.js'
import { isPlaylistUrl } from '../pipeline/pick.js'
import { wireFetch } from '../wire/exfil.js'

const DEFAULT_REFERER = `${TARGET}/`

function tunnelHeaders(sourceHeaders = {}) {
  return {
    Referer: sourceHeaders.Referer || SPOOF_HEADERS.Referer || DEFAULT_REFERER,
    Origin: SPOOF_HEADERS.Origin,
    'User-Agent': SPOOF_HEADERS['User-Agent'],
    ...sourceHeaders,
  }
}

export function forgeTunnelUrl(baseUrl, streamUrl, sourceHeaders = {}) {
  const q = new URLSearchParams({ url: streamUrl })
  const headers = tunnelHeaders(sourceHeaders)
  if (headers.Referer && headers.Referer !== DEFAULT_REFERER) q.set('referer', headers.Referer)
  for (const [key, value] of Object.entries(headers)) {
    if (key === 'Referer' || key === 'User-Agent' || key === 'Origin') continue
    q.set(`h_${key.toLowerCase()}`, value)
  }
  return `${baseUrl}/api/proxy?${q}`
}

function rewritePlaylistLine(line, baseUrl, relayBase, sourceHeaders) {
  const trimmed = line.trim()
  if (!trimmed) return line
  if (trimmed.startsWith('#')) {
    if (!trimmed.includes('URI="')) return line
    return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
      const abs = new URL(uri, baseUrl).href
      return `URI="${forgeTunnelUrl(relayBase, abs, sourceHeaders)}"`
    })
  }
  return forgeTunnelUrl(relayBase, new URL(trimmed, baseUrl).href, sourceHeaders)
}

function stripAudioTracks(text) {
  if (!text.includes('#EXT-X-MEDIA:TYPE=AUDIO')) return text
  return text
    .split('\n')
    .filter((line) => !line.includes('#EXT-X-MEDIA:TYPE=AUDIO'))
    .map((line) => (line.includes('#EXT-X-STREAM-INF:') ? line.replace(/,AUDIO="[^"]+"/g, '') : line))
    .join('\n')
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

export async function relayResponse(targetUrl, sourceHeaders, relayBase, init = {}) {
  const res = await wireFetch(targetUrl, {
    ...init,
    headers: { ...tunnelHeaders(sourceHeaders), ...(init.headers || {}) },
    redirect: 'follow',
  })
  if (init.method === 'HEAD') {
    return { status: res.status, headers: passthroughHeaders(res), body: Buffer.alloc(0) }
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const text = buf.toString('utf8')
  const type = res.headers.get('content-type') || ''
  const isPlaylist =
    text.includes('#EXTM3U') ||
    isPlaylistUrl(targetUrl) ||
    type.includes('mpegurl') ||
    (type.includes('text/plain') && text.includes('#EXT'))
  if (!isPlaylist) {
    return { status: res.status, headers: passthroughHeaders(res), body: buf }
  }
  const rewritten = stripAudioTracks(
    text
      .split('\n')
      .map((line) => rewritePlaylistLine(line, targetUrl, relayBase, sourceHeaders))
      .join('\n'),
  )
  return {
    status: res.status,
    headers: { 'Content-Type': 'application/vnd.apple.mpegurl', 'Access-Control-Allow-Origin': '*' },
    body: Buffer.from(rewritten, 'utf8'),
  }
}
