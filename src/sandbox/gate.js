import { dropFrame, spawnFrame } from './frame.js'
import { openEnvelope, parseEnvelope, peelEnvelope } from '../vault/cipher.js'

async function decodeWire(stageOneCore, raw, sessionKeys) {
  const envelope = peelEnvelope(raw)
  if (!envelope) return { error: 'bad resp token' }
  if (envelope.error) return envelope
  if (!envelope.startsWith('r1.')) return { error: 'bad resp token' }

  try {
    const out = stageOneCore.dr(envelope)
    const resolved = out?.then ? await out : out
    if (resolved && typeof resolved === 'object' && resolved.error === 'bad resp token') {
      throw new Error('bad resp token')
    }
    if (resolved != null && resolved !== '') return resolved
  } catch {}

  const parsed = parseEnvelope(raw)
  if (!parsed || parsed.error) return parsed ?? { error: 'bad resp token' }
  for (const key of sessionKeys ?? []) {
    try {
      return openEnvelope(parsed, key)
    } catch {}
  }
  return { error: 'bad resp token' }
}

export async function forgeGatePass(framePath = '/embed/movie/0') {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { stageOneCore, window } = await spawnFrame(framePath)
      const keys = window.__cinesrcSessionKeys ?? []
      const stageOne = await stageOneCore.gc()
      const stageTwo = await window.__ss2_challenge.gc()
      const token = `${stageOne}::c2::${stageTwo}`
      return {
        token,
        fetch: (url, init) => window.fetch(url, init),
        decode: (raw) => decodeWire(stageOneCore, raw, keys),
      }
    } catch (err) {
      if (err?.message === 'stage2_issue_429' && attempt < 3) {
        dropFrame()
        await new Promise((r) => setTimeout(r, (attempt + 1) * 3000))
        continue
      }
      throw err
    }
  }
  throw new Error('Challenge rate limit reached. Wait a moment and try again.')
}
