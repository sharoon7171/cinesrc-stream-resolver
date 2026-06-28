import { SITE_ORIGIN } from './config.js'

const CHUNK_PATH = /src="(\/_next\/static\/chunks\/[^"]+\.js)"/g
const ACTION_ID = /createServerReference\)\("([0-9a-f]+)",[^)]+\)/g
const ACTION_NAMES = { getProviderList: 'listProviders', getStream: 'fetchStream' }

let cache = null
let cacheAt = 0
let inflight = null
const CACHE_MS = 30 * 60 * 1000

function parseActions(source) {
  const actions = {}
  for (const match of source.matchAll(ACTION_ID)) {
    const name = match[0].match(/,"(getProviderList|getStream)"\)/)
    if (!name) continue
    actions[ACTION_NAMES[name[1]]] = match[1]
  }
  return actions
}

async function loadActions(scriptPaths) {
  for (const scriptPath of scriptPaths) {
    const source = await (await fetch(`${SITE_ORIGIN}${scriptPath}`)).text()
    if (!source.includes('getProviderList')) continue
    const actions = parseActions(source)
    if (actions.listProviders && actions.fetchStream) return actions
  }
  throw new Error('Could not resolve server-action IDs from live client bundles.')
}

export async function discoverServerActions(embedPath) {
  if (!embedPath) throw new Error('Embed path is required for server-action discovery.')
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache
  if (inflight) return inflight
  inflight = (async () => {
    const html = await (await fetch(`${SITE_ORIGIN}${embedPath}`, { redirect: 'follow' })).text()
    const scriptPaths = [...html.matchAll(CHUNK_PATH)].map((match) => match[1])
    if (!scriptPaths.length) throw new Error('Could not find client bundles on embed page.')
    cache = await loadActions(scriptPaths)
    cacheAt = Date.now()
    return cache
  })()
  try {
    return await inflight
  } finally {
    inflight = null
  }
}
