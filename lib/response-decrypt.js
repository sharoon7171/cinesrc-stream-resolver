import crypto from 'node:crypto'

export function extractR1Payload(raw) {
  const errorLine = raw.split('\n').find((line) => line.startsWith('1:E'))
  if (errorLine) return { error: 'invalid_challenge', digest: errorLine.slice(3) }

  for (const line of raw.split('\n')) {
    if (line.startsWith('1:')) {
      const body = line.slice(2).replace(/^"|"$/g, '')
      if (body.startsWith('r1.')) return body
    }
    const idx = line.indexOf('r1.')
    if (idx >= 0) {
      const matched = line.slice(idx).match(/^r1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+/)
      if (matched) return matched[0]
    }
  }
  return null
}

export function parseEncryptedLine(raw) {
  const payload = extractR1Payload(raw)
  if (!payload) return null
  if (payload.error) return payload
  const dot = payload.indexOf('.', 3)
  if (dot < 0) return null
  const ivB64 = payload.slice(3, dot)
  const ctB64 = payload.slice(dot + 1)
  if (!ivB64 || !ctB64) return null
  return { ivB64, ctB64 }
}

export function decryptR1Payload({ ivB64, ctB64 }, aesKey) {
  const key = Buffer.isBuffer(aesKey) ? aesKey : Buffer.from(aesKey)
  const iv = Buffer.from(ivB64, 'base64')
  const buf = Buffer.from(ctB64, 'base64')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(buf.subarray(-16))
  const plaintext = Buffer.concat([decipher.update(buf.subarray(0, -16)), decipher.final()])
  return JSON.parse(plaintext.toString('utf8'))
}
