import { ACTIONS, ORIGIN, TOKEN_URL, USER_AGENT } from './constants.js'
import { undefinedArg } from './content-path.js'

function actionHeaders(actionId, route) {
  return {
    Accept: 'text/x-component',
    'Content-Type': 'text/plain;charset=UTF-8',
    'Next-Action': actionId,
    'Next-Router-State-Tree': route.routerStateTree,
    Referer: `${ORIGIN}/`,
    'User-Agent': USER_AGENT,
  }
}

async function fetchStreamActionTokens() {
  if (fetchStreamActionTokens.cache && Date.now() - fetchStreamActionTokens.cacheAt < 120000) {
    return fetchStreamActionTokens.cache
  }
  const res = await fetch(TOKEN_URL, { redirect: 'follow' })
  const data = await res.json()
  const tokens = data.tokens ?? [ACTIONS.getStream]
  fetchStreamActionTokens.cache = tokens
  fetchStreamActionTokens.cacheAt = Date.now()
  return tokens
}
fetchStreamActionTokens.cache = null
fetchStreamActionTokens.cacheAt = 0

async function callServerAction(contentPath, actionId, args, route) {
  const tokens = actionId === ACTIONS.getStream ? await fetchStreamActionTokens() : [actionId]
  const body = JSON.stringify(args)
  let raw = ''

  for (const token of tokens) {
    const res = await fetch(`${ORIGIN}${contentPath}`, {
      method: 'POST',
      headers: actionHeaders(token, route),
      body,
    })
    raw = await res.text()
    if (!raw.includes('Server action')) break
  }

  return raw
}

export async function getProviders(contentPath, route) {
  const raw = await callServerAction(contentPath, ACTIONS.getProviderList, [], route)
  const line = raw.split('\n').find((l) => l.startsWith('1:'))
  if (!line) throw new Error('Provider list response was invalid.')
  return JSON.parse(line.slice(2))
}

export async function getStream({ contentPath, id, type, season, episode, provider, challengeSession, route }) {
  const mediaType = type === 'tv' ? 'show' : 'movie'
  const raw = await callServerAction(
    contentPath,
    ACTIONS.getStream,
    [String(id), mediaType, undefinedArg(season), undefinedArg(episode), challengeSession.token, provider],
    route,
  )
  return challengeSession.decode(raw)
}
