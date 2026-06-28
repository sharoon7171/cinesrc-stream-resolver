import { buildActionHeaders, SITE_ORIGIN } from './config.js'
import { discoverServerActions } from './actions.js'
import { serializeOptional } from './routes.js'

async function postAction(embedPath, actionId, args, route, fetchImpl = fetch, signal) {
  const response = await fetchImpl(`${SITE_ORIGIN}${embedPath}`, {
    method: 'POST',
    headers: buildActionHeaders(actionId, route),
    body: JSON.stringify(args),
    signal,
  })
  return { raw: await response.text(), status: response.status }
}

export async function listProviders(embedPath, route) {
  const actions = await discoverServerActions(embedPath)
  const { raw, status } = await postAction(embedPath, actions.listProviders, [], route)
  const payloadLine = raw.split('\n').find((line) => line.startsWith('1:'))
  if (!payloadLine) {
    const hint = status === 403 ? ' Upstream blocked this host (HTTP 403).' : status ? ` HTTP ${status}.` : ''
    throw new Error(`Provider list response was invalid.${hint}`)
  }
  return JSON.parse(payloadLine.slice(2))
}

export async function fetchProviderStream({ embedPath, id, type, season, episode, providerId, protectionSession, route, signal, actions }) {
  const resolved = actions ?? (await discoverServerActions(embedPath))
  const args = [
    String(id),
    type === 'tv' ? 'show' : 'movie',
    serializeOptional(season),
    serializeOptional(episode),
    protectionSession.token,
    providerId,
  ]
  const { raw } = await postAction(embedPath, resolved.fetchStream, args, route, protectionSession.fetch, signal)
  return protectionSession.decode(raw)
}
