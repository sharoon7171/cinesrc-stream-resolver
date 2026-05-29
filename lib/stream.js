import { buildContentPath, buildRouterStateTree } from './content-path.js'
import { createChallengeSession } from './challenge-engine.js'
import { getStream } from './cinesrc-api.js'
import { pickStreamSource } from './stream-sources.js'
import { buildPlayUrl } from './stream-proxy.js'
import { resetChallengeWindow } from './challenge-window.js'

export async function resolveStream(input, options = {}) {
  const id = String(input.id)
  const type = input.type === 'tv' ? 'tv' : 'movie'
  const season = input.season != null ? Number(input.season) : undefined
  const episode = input.episode != null ? Number(input.episode) : undefined
  const provider = input.provider
  if (!provider) throw new Error('Provider is required.')

  const contentPath = buildContentPath({ id, type, season, episode })
  const route = {
    routerStateTree: buildRouterStateTree({ id, type, season, episode }),
  }

  let lastData = null
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      resetChallengeWindow()
      await new Promise((r) => setTimeout(r, 2000))
    }
    const challengeSession = await createChallengeSession(contentPath)
    const data = await getStream({
      contentPath,
      id,
      type,
      season,
      episode,
      provider,
      challengeSession,
      route,
    })
    if (data?.error !== 'invalid_challenge') return formatResult(provider, data, options)
    lastData = data
  }

  return formatResult(provider, lastData, options)
}

function formatResult(provider, data, options) {
  if (data?.error === 'invalid_challenge') throw new Error('Challenge verification failed. Try again.')
  if (data?.error === 'bad resp token') throw new Error('Stream response could not be decoded.')
  if (data?.error === 'no_streams') throw new Error(`${provider} has no stream for this title.`)
  if (data?.error) throw new Error(String(data.error))

  const picked = pickStreamSource(data)
  if (!picked?.url) throw new Error('No playable stream URL was returned.')

  const playBase = options.playBase || ''
  const playUrl = playBase ? buildPlayUrl(playBase, picked.url, picked.headers) : picked.url

  return {
    provider,
    url: picked.url,
    playUrl,
    source: picked.source,
  }
}
