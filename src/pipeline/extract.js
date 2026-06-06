import { buildFramePath, buildRouteTree } from '../target/routes.js'
import { forgeGatePass } from '../sandbox/gate.js'
import { fetchPayload, listMirrors } from '../wire/actions.js'
import { pickBestMirror } from './pick.js'
import { forgeTunnelUrl } from '../relay/tunnel.js'
import { dropFrame } from '../sandbox/frame.js'

export function parseStreamQuery(q) {
  if (!q.id) return { error: 'TMDB ID is required.' }
  const type = q.type === 'tv' ? 'tv' : 'movie'
  const season = q.season != null && q.season !== '' ? Number(q.season) : undefined
  const episode = q.episode != null && q.episode !== '' ? Number(q.episode) : undefined
  const id = String(q.id)
  return {
    id,
    type,
    season,
    episode,
    framePath: buildFramePath({ id, type, season, episode }),
    route: { routeTree: buildRouteTree({ id, type, season, episode }) },
  }
}

function packResult(mirrorId, data, playBase) {
  if (data?.error) return null
  const picked = pickBestMirror(data)
  if (!picked?.url) return null
  const playUrl = playBase ? forgeTunnelUrl(playBase, picked.url, picked.headers) : picked.url
  return { provider: mirrorId, url: picked.url, playUrl, source: picked.source }
}

function providerView(list) {
  return list.map((p) => ({ id: p.id, name: p.name || p.id, rank: p.rank }))
}

async function probeMirror(mirror, ctx) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      dropFrame()
      await new Promise((r) => setTimeout(r, 500))
    }
    try {
      const gatePass = await forgeGatePass(ctx.framePath)
      const data = await fetchPayload({
        framePath: ctx.framePath,
        id: ctx.id,
        type: ctx.type,
        season: ctx.season,
        episode: ctx.episode,
        mirror: mirror.id,
        gatePass,
        route: ctx.route,
      })
      if (data?.error === 'invalid_challenge') continue
      return packResult(mirror.id, data, ctx.playBase)
    } catch {}
  }
  return null
}

export async function extractStreamLive(input, options = {}, emit = () => {}) {
  const { id, type, season, episode, framePath, route } = input
  const meta = { type, framePath }
  const ctx = { framePath, id, type, season, episode, route, playBase: options.playBase || '' }

  let mirrors
  try {
    mirrors = await listMirrors(framePath, route)
  } catch (err) {
    emit('fail', { error: String(err.message || err), ...meta })
    return
  }
  if (!mirrors.length) {
    emit('fail', { error: 'No providers are available for this title.', ...meta })
    return
  }

  const ranked = [...mirrors].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))
  const playable = []
  let ready = false

  dropFrame()
  try {
    for (const mirror of ranked) {
      const packed = await probeMirror(mirror, ctx)
      if (!packed) continue
      const entry = { id: mirror.id, name: mirror.name || mirror.id, rank: mirror.rank }
      const index = playable.push(entry) - 1
      emit('found', { index, ...entry, ...meta, ...packed })
      if (!ready) {
        ready = true
        emit('ready', {
          ...meta,
          ...packed,
          providers: providerView(playable),
          selectedProvider: { index, id: mirror.id, name: entry.name },
        })
      }
    }
  } finally {
    dropFrame()
  }

  if (!ready) {
    emit('fail', { error: 'No playable stream from any provider.', ...meta, providers: [] })
  }
  emit('done', { ...meta, providers: providerView(playable) })
}
