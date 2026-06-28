import { buildEmbedPath, buildRouterStateTree } from '../site/routes.js'
import { createChallengeHost } from '../protection/host.js'
import { mintLockedSession } from '../protection/session.js'
import { discoverServerActions } from '../site/actions.js'
import { listProviders, fetchProviderStream } from '../site/streams.js'
import { pickStream } from './select-source.js'

const CHALLENGE_RETRY_MS = 1500
const CHALLENGE_ATTEMPTS = 2
const HOST_TIMEOUT_MS = 120_000
const MINT_TIMEOUT_MS = 90_000
const FETCH_TIMEOUT_MS = 15_000
const PROVIDER_TIMEOUT_MS = 15_000

export function parseStreamQuery(query) {
  if (!query.id) return { error: 'TMDB ID is required.' }
  const type = query.type === 'tv' ? 'tv' : 'movie'
  const season = query.season != null && query.season !== '' ? Number(query.season) : undefined
  const episode = query.episode != null && query.episode !== '' ? Number(query.episode) : undefined
  const id = String(query.id)
  return {
    id,
    type,
    season,
    episode,
    embedPath: buildEmbedPath({ id, type, season, episode }),
    route: { routeTree: buildRouterStateTree({ id, type, season, episode }) },
  }
}

function meta(input) {
  return { type: input.type, embedPath: input.embedPath, tmdbId: input.id }
}

function catalogProviders(providers) {
  return providers
    .map(({ id, name, rank }) => {
      if (rank == null) throw new Error(`Provider ${id} is missing rank.`)
      if (!name) throw new Error(`Provider ${id} is missing name.`)
      return { id, name, rank }
    })
    .sort((a, b) => b.rank - a.rank)
}

function retryable(error) {
  const message = String(error?.message || error)
  if (message === 'timeout') return false
  return message.includes('invalid_challenge') || message.includes('challenge_fetch_429')
}

function withTimeout(promise, ms, message = 'timeout') {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function withChallengeHost(input, fn) {
  const host = await withTimeout(createChallengeHost(input.embedPath), HOST_TIMEOUT_MS, 'host timeout')
  try {
    return await fn(host)
  } finally {
    host.release()
  }
}

async function fetchProviderResult(session, input, providerId, actions) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const data = await fetchProviderStream({
      ...input,
      providerId,
      protectionSession: session,
      route: input.route,
      signal: controller.signal,
      actions,
    })
    return pickStream(data)
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('timeout')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function probeProvider(host, provider, input, actions) {
  const run = async () => {
    for (let attempt = 0; attempt < CHALLENGE_ATTEMPTS; attempt++) {
      try {
        const session = await withTimeout(mintLockedSession(host, attempt > 0), MINT_TIMEOUT_MS, 'mint timeout')
        const picked = await fetchProviderResult(session, input, provider.id, actions)
        if (picked.reason) {
          if (attempt < CHALLENGE_ATTEMPTS - 1 && retryable({ message: picked.reason })) {
            await new Promise((resolve) => setTimeout(resolve, CHALLENGE_RETRY_MS * (attempt + 1)))
            continue
          }
          return { reason: picked.reason }
        }
        return picked
      } catch (error) {
        if (attempt < CHALLENGE_ATTEMPTS - 1 && retryable(error)) {
          await new Promise((resolve) => setTimeout(resolve, CHALLENGE_RETRY_MS * (attempt + 1)))
          continue
        }
        throw error
      }
    }
    return { reason: 'invalid_challenge' }
  }
  return withTimeout(run(), PROVIDER_TIMEOUT_MS, 'timeout')
}

function providerFields(provider, ms, stream) {
  return { ms, id: provider.id, name: provider.name, rank: provider.rank, ...stream }
}

export async function fetchProviderCatalog(input) {
  const providers = await listProviders(input.embedPath, input.route)
  if (!providers.length) throw new Error('No providers are available for this title.')
  return { ...meta(input), providers: catalogProviders(providers) }
}

export async function resolveProviderStream(input, providerId) {
  if (!providerId) throw new Error('Provider id is required.')

  const { providers } = await fetchProviderCatalog(input)
  const provider = providers.find((entry) => entry.id === providerId)
  if (!provider) throw new Error(`Unknown provider: ${providerId}`)

  const actions = await discoverServerActions(input.embedPath)
  const started = Date.now()
  return withChallengeHost(input, async (host) => {
    const result = await probeProvider(host, provider, input, actions)
    const fields = providerFields(provider, Date.now() - started, result)
    if (result.reason) return { ok: false, ...fields }
    return { ok: true, ...fields }
  })
}

function emitProviderResult(emit, streamMeta, provider, ms, result, error) {
  if (error) {
    emit('skipped', {
      ...streamMeta,
      ...providerFields(provider, ms, {}),
      reason: String(error.message || error),
    })
    return false
  }
  const fields = providerFields(provider, ms, result)
  if (result.reason) {
    emit('skipped', { ...streamMeta, ...fields, reason: result.reason })
    return false
  }
  emit('ready', { ...streamMeta, ...fields })
  return true
}

export async function resolveFirstStream(input, emit = () => {}) {
  const streamMeta = meta(input)
  const { providers } = await fetchProviderCatalog(input)
  const actions = await discoverServerActions(input.embedPath)

  try {
    await withChallengeHost(input, async (host) => {
      for (const provider of providers) {
        emit('probing', { ...streamMeta, id: provider.id, name: provider.name, rank: provider.rank })
        const started = Date.now()
        try {
          const result = await probeProvider(host, provider, input, actions)
          if (emitProviderResult(emit, streamMeta, provider, Date.now() - started, result, null)) return
        } catch (error) {
          emitProviderResult(emit, streamMeta, provider, Date.now() - started, null, error)
        }
      }
      emit('fail', { error: 'No playable stream from any provider.', ...streamMeta })
    })
  } catch (error) {
    emit('fail', { error: String(error.message || error), ...streamMeta })
  }
}
