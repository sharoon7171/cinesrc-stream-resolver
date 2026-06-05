import { ACTIONS, ORIGIN, TOKEN_URL, buildActionHeaders } from './constants.js'
import { undefinedArg } from './content-path.js'
import { upstreamFetch } from './upstream-fetch.js'

async function fetchStreamActionTokens() {
  if (fetchStreamActionTokens.cache && Date.now() - fetchStreamActionTokens.cacheAt < 120000) {
    return fetchStreamActionTokens.cache
  }
  const res = await upstreamFetch(TOKEN_URL, { redirect: 'follow' })
  const data = await res.json()
  const tokens = data.tokens ?? [ACTIONS.getStream]
  fetchStreamActionTokens.cache = tokens
  fetchStreamActionTokens.cacheAt = Date.now()
  return tokens
}
fetchStreamActionTokens.cache = null
fetchStreamActionTokens.cacheAt = 0

export async function callServerAction(contentPath, actionIds, args, route, fetchImpl = upstreamFetch) {
  const body = JSON.stringify(args)
  let raw = ''
  let status = 0

  for (const actionId of actionIds) {
    const res = await fetchImpl(`${ORIGIN}${contentPath}`, {
      method: 'POST',
      headers: buildActionHeaders(actionId, route),
      body,
    })
    status = res.status
    raw = await res.text()
    if (!raw.includes('Server action')) break
  }

  return { raw, status }
}

export async function getProviders(contentPath, route) {
  const { raw, status } = await callServerAction(contentPath, [ACTIONS.getProviderList], [], route)
  const line = raw.split('\n').find((l) => l.startsWith('1:'))
  if (!line) {
    const hint = status === 403 ? ' Upstream blocked this host (HTTP 403).' : status ? ` HTTP ${status}.` : ''
    throw new Error(`Provider list response was invalid.${hint}`)
  }
  return JSON.parse(line.slice(2))
}

export async function getStream({ contentPath, id, type, season, episode, provider, challengeSession, route }) {
  const mediaType = type === 'tv' ? 'show' : 'movie'
  const args = [
    String(id),
    mediaType,
    undefinedArg(season),
    undefinedArg(episode),
    challengeSession.token,
    provider,
  ]
  const tokens = await fetchStreamActionTokens()
  const { raw } = await callServerAction(contentPath, tokens, args, route, challengeSession.fetch)
  return challengeSession.decode(raw)
}
