import { createHash } from 'node:crypto'
import { parentPort, workerData } from 'node:worker_threads'

const { publicSalt, target, difficulty, start, end } = workerData
const chars = '0123456789abcdef'
const width = Math.ceil(difficulty / 4)
const batch = 256

function suffix(n) {
  let s = ''
  for (let k = 0; k < width; k++) {
    s = chars[n & 0xf] + s
    n >>= 4
  }
  return s
}

function digestHex(salt, suf) {
  return createHash('sha256').update(salt + suf).digest('hex')
}

try {
  let solution = null
  for (let i = start; i <= end && !solution; i += batch) {
    const bEnd = Math.min(i + batch - 1, end)
    for (let j = i; j <= bEnd; j++) {
      if (digestHex(publicSalt, suffix(j)) === target) {
        solution = suffix(j)
        break
      }
    }
  }
  parentPort.postMessage({ solution })
} catch (err) {
  parentPort.postMessage({ error: err?.message || 'worker failed' })
}
