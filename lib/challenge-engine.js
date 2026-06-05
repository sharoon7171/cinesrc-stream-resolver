import { getChallengeWindow, resetChallengeWindow } from './challenge-window.js'
import { decryptR1Payload, extractR1Payload, parseEncryptedLine } from './response-decrypt.js'

async function decodeWithProdApi(prodApi, raw, sessionKeys) {
  const payload = extractR1Payload(raw)
  if (!payload) return { error: 'bad resp token' }
  if (payload.error) return payload
  if (!payload.startsWith('r1.')) return { error: 'bad resp token' }

  try {
    const out = prodApi.dr(payload)
    const resolved = out?.then ? await out : out
    if (resolved && typeof resolved === 'object' && resolved.error === 'bad resp token') {
      throw new Error('bad resp token')
    }
    if (resolved != null && resolved !== '') return resolved
  } catch {}

  const parsed = parseEncryptedLine(raw)
  if (!parsed || parsed.error) return parsed ?? { error: 'bad resp token' }
  for (const key of sessionKeys ?? []) {
    try {
      return decryptR1Payload(parsed, key)
    } catch {}
  }
  return { error: 'bad resp token' }
}

export async function createChallengeSession(embedPath = '/embed/movie/0') {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { prodApi, window } = await getChallengeWindow(embedPath)
      const keys = window.__cinesrcSessionKeys ?? []
      const stage1 = await prodApi.gc()
      const stage2 = await window.__ss2_challenge.gc()
      const token = `${stage1}::c2::${stage2}`
      return {
        token,
        fetch: (url, init) => window.fetch(url, init),
        decode: (raw) => decodeWithProdApi(prodApi, raw, keys),
      }
    } catch (err) {
      if (err?.message === 'stage2_issue_429' && attempt < 3) {
        resetChallengeWindow()
        await new Promise((r) => setTimeout(r, (attempt + 1) * 3000))
        continue
      }
      throw err
    }
  }
  throw new Error('Challenge rate limit reached. Wait a moment and try again.')
}
