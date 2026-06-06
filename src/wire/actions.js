import { TARGET, TOKEN_MANIFEST, forgeActionHeaders } from '../target/origin.js'
import { invalidateActionSigns, isStaleActionResponse, resolveActionSigns } from '../target/signs.js'
import { nullToken } from '../target/routes.js'
import { wireFetch } from './exfil.js'

let tokenCache = null
let tokenCacheAt = 0

async function actionTokens() {
  if (tokenCache && Date.now() - tokenCacheAt < 120000) return tokenCache
  const signs = await resolveActionSigns()
  const data = await (await wireFetch(TOKEN_MANIFEST, { redirect: 'follow' })).json()
  tokenCache = data.tokens ?? [signs.fetchPayload]
  tokenCacheAt = Date.now()
  return tokenCache
}

async function fireAction(framePath, actionIds, args, route, fetchImpl = wireFetch) {
  const body = JSON.stringify(args)
  let raw = ''
  let status = 0
  for (const actionId of actionIds) {
    const res = await fetchImpl(`${TARGET}${framePath}`, {
      method: 'POST',
      headers: forgeActionHeaders(actionId, route),
      body,
    })
    status = res.status
    raw = await res.text()
    if (!raw.includes('Server action')) break
  }
  return { raw, status }
}

export async function listMirrors(framePath, route) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const signs = await resolveActionSigns({ force: attempt > 0 })
    const { raw, status } = await fireAction(framePath, [signs.listMirrors], [], route)
    const line = raw.split('\n').find((l) => l.startsWith('1:'))
    if (line) return JSON.parse(line.slice(2))
    if (attempt === 0 && isStaleActionResponse({ raw, status })) {
      invalidateActionSigns()
      continue
    }
    const hint = status === 403 ? ' Upstream blocked this host (HTTP 403).' : status ? ` HTTP ${status}.` : ''
    throw new Error(`Provider list response was invalid.${hint}`)
  }
  throw new Error('Provider list response was invalid.')
}

export async function fetchPayload({ framePath, id, type, season, episode, mirror, gatePass, route }) {
  const args = [
    String(id),
    type === 'tv' ? 'show' : 'movie',
    nullToken(season),
    nullToken(episode),
    gatePass.token,
    mirror,
  ]
  let lastRaw = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      invalidateActionSigns()
      tokenCache = null
    }
    const tokens = await actionTokens()
    const { raw, status } = await fireAction(framePath, tokens, args, route, gatePass.fetch)
    lastRaw = raw
    if (!isStaleActionResponse({ raw, status })) return gatePass.decode(raw)
  }
  return gatePass.decode(lastRaw)
}
