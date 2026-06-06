import crypto from 'node:crypto'

export function peelEnvelope(raw) {
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

export function parseEnvelope(raw) {
  const envelope = peelEnvelope(raw)
  if (!envelope) return null
  if (envelope.error) return envelope
  const dot = envelope.indexOf('.', 3)
  if (dot < 0) return null
  const ivB64 = envelope.slice(3, dot)
  const ctB64 = envelope.slice(dot + 1)
  if (!ivB64 || !ctB64) return null
  return { ivB64, ctB64 }
}

export function openEnvelope({ ivB64, ctB64 }, aesKey) {
  const key = Buffer.isBuffer(aesKey) ? aesKey : Buffer.from(aesKey)
  const iv = Buffer.from(ivB64, 'base64')
  const buf = Buffer.from(ctB64, 'base64')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(buf.subarray(-16))
  const plaintext = Buffer.concat([decipher.update(buf.subarray(0, -16)), decipher.final()])
  return JSON.parse(plaintext.toString('utf8'))
}
