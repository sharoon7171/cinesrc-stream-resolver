import 'canvas'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { Worker as NodeWorker } from 'node:worker_threads'
import { ORIGIN, USER_AGENT } from './constants.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROD_PATH = path.join(__dirname, '../assets/050926-prod.js')
const DONUT_PATH = path.join(__dirname, '../assets/donut.js')
const POW_WORKER = path.join(__dirname, 'stage2-pow-worker.mjs')

const BIND_OLD =
  'function(a,b,c){var d=b(a),e=b(a).slice();e.unshift(void 0),c(a,new(Function.bind.apply(d,e)))}'
const BIND_NEW =
  'function(a,b,c){var d=b(a),e=b(a).slice();e.unshift(void 0);if(typeof d!=="function"){c(a,d);return}c(a,new(Function.bind.apply(d,e)))}'

function patchVmSource(source) {
  let out = source.includes(BIND_OLD) ? source.replace(BIND_OLD, BIND_NEW) : source
  out = out.replace(/_0xbc361=!0x0/g, '_0xbc361=!0x1')
  return out
}

function installWorkerEnv(window) {
  let blobId = 0
  window.Blob = class Blob {
    constructor(parts, opts = {}) {
      this._parts = parts
      this.type = opts.type || ''
    }
  }
  window.URL.createObjectURL = () => `blob:n${blobId++}`
  window.URL.revokeObjectURL = () => {}
  const activeWorkers = new Set()
  window.Worker = class Worker {
    constructor() {
      this.onmessage = null
      this.onerror = null
      this._done = false
    }
    postMessage(data) {
      if (this._done) return
      const w = new NodeWorker(POW_WORKER, {
        workerData: {
          publicSalt: data[0],
          target: data[1],
          difficulty: data[2],
          start: data[3],
          end: data[4],
        },
      })
      activeWorkers.add(w)
      w.on('message', (msg) => {
        if (msg.solution) {
          this._done = true
          for (const worker of activeWorkers) worker.terminate()
          activeWorkers.clear()
        }
        this.onmessage?.({ data: msg })
      })
      w.on('error', (err) => {
        this.onerror?.({ message: err.message })
      })
      w.on('exit', () => activeWorkers.delete(w))
    }
    terminate() {
      this._done = true
      for (const worker of activeWorkers) worker.terminate()
      activeWorkers.clear()
    }
    addEventListener() {}
    removeEventListener() {}
  }
}

function installAntiDebug(window) {
  const realSetInterval = window.setInterval.bind(window)
  window.setInterval = (handler, delay, ...args) => {
    if (delay === 2000 || delay === 0x7d0) return 0
    return realSetInterval(handler, delay, ...args)
  }
  const NativeFunction = window.Function
  window.Function = function (...args) {
    const last = args[args.length - 1]
    if (typeof last === 'string' && last.includes('debugger')) {
      args[args.length - 1] = last.replace(/\bdebugger\b/g, '')
    }
    return NativeFunction(...args)
  }
  window.Function.prototype = NativeFunction.prototype
  Object.defineProperty(window.performance, 'now', { value: () => 0, configurable: true })
  window.Image = class Image {
    constructor() {
      this.onload = null
      this.onerror = null
      queueMicrotask(() => this.onload?.())
    }
  }
}

function installSessionKeyCapture(window) {
  const keys = []
  window.__cinesrcSessionKeys = keys
  const subtle = window.crypto.subtle
  const origImportKey = subtle.importKey.bind(subtle)
  subtle.importKey = async (...args) => {
    const key = await origImportKey(...args)
    const raw = args[1]
    if (raw?.byteLength === 32) keys.push(Buffer.from(raw))
    return key
  }
  const origExportKey = subtle.exportKey.bind(subtle)
  subtle.exportKey = async (...args) => {
    const out = await origExportKey(...args)
    if (out instanceof ArrayBuffer && out.byteLength === 32) keys.push(Buffer.from(out))
    return out
  }
  const origDecrypt = subtle.decrypt.bind(subtle)
  subtle.decrypt = async (algo, key, data) => {
    try {
      const out = await origExportKey('raw', key)
      if (out instanceof ArrayBuffer && out.byteLength === 32) keys.push(Buffer.from(out))
    } catch {}
    return origDecrypt(algo, key, data)
  }
}

function installNavigator(window) {
  Object.defineProperty(window.navigator, 'userAgent', { value: USER_AGENT, configurable: true })
  Object.defineProperty(window.navigator, 'platform', { value: 'Linux armv81', configurable: true })
  Object.defineProperty(window.navigator, 'language', { value: 'en-GB', configurable: true })
  Object.defineProperty(window.navigator, 'languages', { value: ['en-GB', 'en-US', 'en'], configurable: true })
  Object.defineProperty(window.navigator, 'hardwareConcurrency', { value: 8, configurable: true })
  Object.defineProperty(window.navigator, 'cookieEnabled', { value: true, configurable: true })
  Object.defineProperty(window.screen, 'width', { value: 360, configurable: true })
  Object.defineProperty(window.screen, 'height', { value: 806, configurable: true })
  Object.defineProperty(window.screen, 'colorDepth', { value: 24, configurable: true })
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true })
  Object.defineProperty(window, 'innerWidth', { value: 360, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: 806, configurable: true })
}

function installFetch(window, embedPath) {
  window.fetch = (input, init = {}) => {
    let url = typeof input === 'string' ? input : input.url
    if (url.startsWith('/')) url = `${ORIGIN}${url}`
    const headers = new Headers(init.headers)
    if (!headers.has('User-Agent')) headers.set('User-Agent', USER_AGENT)
    if (!headers.has('Referer')) headers.set('Referer', `${ORIGIN}${embedPath}`)
    return globalThis.fetch(url, { ...init, headers })
  }
}

function findProdApi(window) {
  for (const value of Object.values(window)) {
    if (value && typeof value === 'object' && typeof value.gc === 'function' && typeof value.dr === 'function') {
      return value
    }
  }
  return null
}

function waitForProdApi(window, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Challenge timed out.')), timeoutMs)
    window.addEventListener(
      '_cs',
      (ev) => {
        const key = ev.detail
        const api = key ? window[key] : null
        clearTimeout(timeout)
        resolve(api || findProdApi(window))
      },
      { once: true },
    )
  })
}

let cached = null

export async function getChallengeWindow(embedPath = '/embed/movie/0') {
  if (cached?.embedPath === embedPath) return cached
  if (cached) resetChallengeWindow()

  const dom = new JSDOM(
    '<!DOCTYPE html><html><head></head><body><canvas id="c" width="256" height="128"></canvas></body></html>',
    {
      url: `${ORIGIN}${embedPath}`,
      runScripts: 'dangerously',
      pretendToBeVisual: true,
    },
  )
  const { window } = dom
  installAntiDebug(window)
  Object.defineProperty(window, 'crypto', { value: crypto.webcrypto, configurable: true })
  installSessionKeyCapture(window)
  installNavigator(window)
  installFetch(window, embedPath)
  installWorkerEnv(window)

  window.eval(patchVmSource(fs.readFileSync(DONUT_PATH, 'utf8')))
  if (!window.__ss2_challenge?.gc) {
    throw new Error('Stage 2 challenge is unavailable.')
  }

  const prodReady = waitForProdApi(window)
  window.eval(patchVmSource(fs.readFileSync(PROD_PATH, 'utf8')))
  const prodApi = (await prodReady) || findProdApi(window)
  if (!prodApi?.gc || !prodApi?.dr) {
    throw new Error('Stage 1 challenge is unavailable.')
  }

  cached = { window, prodApi, embedPath }
  return cached
}

export function resetChallengeWindow() {
  cached = null
}
