import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parentPort } from 'node:worker_threads'

const vendorDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../vendor')
const wasmPath = path.join(vendorDir, 'pow.wasm')
const workerScriptPath = path.join(vendorDir, 'pow-worker.js')

globalThis.self = globalThis
globalThis.postMessage = (message) => parentPort.postMessage(message)
globalThis.onmessage = null

globalThis.fetch = async (input) => {
  const url = String(input)
  if (!url.includes('pow-v3.wasm')) throw new Error(`Unexpected worker fetch: ${url}`)
  const bytes = fs.readFileSync(wasmPath)
  return {
    ok: true,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

parentPort.on('message', (data) => {
  globalThis.onmessage?.({ data })
})

eval(fs.readFileSync(workerScriptPath, 'utf8'))
