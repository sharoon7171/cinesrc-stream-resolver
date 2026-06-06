import { TARGET } from './origin.js'
import { wireFetch } from '../wire/exfil.js'

const PROBE_PATH = '/embed/movie/0'
const CHUNK_RE = /src="(\/_next\/static\/chunks\/[^"]+\.js)"/g
const SIGN_CALL_RE = /createServerReference\)\("([0-9a-f]+)",[^)]+\)/g
const SIGN_NAMES = {
  getProviderList: 'listMirrors',
  getStream: 'fetchPayload',
}

let cache = null
let cacheAt = 0
const TTL_MS = 30 * 60 * 1000

function parseSigns(source) {
  const out = {}
  for (const m of source.matchAll(SIGN_CALL_RE)) {
    const name = m[0].match(/,"(getProviderList|getStream)"\)/)
    if (!name) continue
    out[SIGN_NAMES[name[1]]] = m[1]
  }
  return out
}

function chunkPaths(html) {
  return [...html.matchAll(CHUNK_RE)].map((m) => m[1])
}

async function loadFromChunks(scriptPaths) {
  for (const path of scriptPaths) {
    const js = await (await wireFetch(`${TARGET}${path}`)).text()
    if (!js.includes('getProviderList')) continue
    const signs = parseSigns(js)
    if (signs.listMirrors && signs.fetchPayload) return signs
  }
  throw new Error('Could not resolve Cinesrc server-action IDs from live client bundles.')
}

export function invalidateActionSigns() {
  cache = null
  cacheAt = 0
}

export function isStaleActionResponse({ raw, status }) {
  return status === 404 && raw.includes('Server action not found')
}

export async function resolveActionSigns({ force = false } = {}) {
  if (!force && cache && Date.now() - cacheAt < TTL_MS) return cache

  const res = await wireFetch(`${TARGET}${PROBE_PATH}`, { redirect: 'follow' })
  const html = await res.text()
  const scripts = chunkPaths(html)
  if (!scripts.length) throw new Error('Could not find Cinesrc client bundles.')

  cache = await loadFromChunks(scripts)
  cacheAt = Date.now()
  return cache
}
