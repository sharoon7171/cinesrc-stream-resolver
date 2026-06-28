import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker as NodeWorker } from 'node:worker_threads'
import { Window } from 'happy-dom'
import { CanvasAdapter } from '@happy-dom/node-canvas-adapter'
import { BROWSER_PROFILE, CLIENT_HEADERS, SITE_ORIGIN } from '../site/config.js'
import { buildProtectionHeader } from '../site/routes.js'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const vendorDir = path.join(rootDir, '../../vendor')
const stageOneScript = path.join(vendorDir, 'stage1.js')
const stageTwoScript = path.join(vendorDir, 'stage2.js')
const powWorkerShim = path.join(rootDir, 'workers/pow-shim.js')
const hashGrindWorker = path.join(rootDir, 'workers/hash-grind.js')

const vmBindOld =
  'function(a,b,c){var d=b(a),e=b(a).slice();e.unshift(void 0),c(a,new(Function.bind.apply(d,e)))}'
const vmBindNew =
  'function(a,b,c){var d=b(a),e=b(a).slice();e.unshift(void 0);if(typeof d!=="function"){c(a,d);return}c(a,new(Function.bind.apply(d,e)))}'

function patchVmSource(source) {
  if (!source.includes(vmBindOld)) throw new Error('Challenge bundle is missing the VM bind patch target.')
  return source.replace(vmBindOld, vmBindNew)
}

function installWebCrypto(window) {
  const subtle = crypto.webcrypto.subtle
  Object.defineProperty(window, 'crypto', {
    configurable: true,
    value: {
      getRandomValues: (arr) => crypto.webcrypto.getRandomValues(arr),
      subtle: {
        importKey: (...args) => subtle.importKey(...args),
        exportKey: (...args) => subtle.exportKey(...args),
        encrypt: (...args) => subtle.encrypt(...args),
        decrypt: (...args) => subtle.decrypt(...args),
        deriveBits: (...args) => subtle.deriveBits(...args),
        deriveKey: (...args) => subtle.deriveKey(...args),
        digest: (...args) => subtle.digest(...args),
        generateKey: (...args) => subtle.generateKey(...args),
        sign: (...args) => subtle.sign(...args),
        verify: (...args) => subtle.verify(...args),
        wrapKey: (...args) => subtle.wrapKey(...args),
        unwrapKey: (...args) => subtle.unwrapKey(...args),
      },
    },
  })
}

function installAntiDebug(window) {
  const baseSetInterval = window.setInterval.bind(window)
  window.setInterval = (handler, delay, ...args) => {
    if (delay === 2000 || delay === 0x7d0) return 0
    return baseSetInterval(handler, delay, ...args)
  }
  const BaseFunction = window.Function
  window.Function = function (...args) {
    const body = args[args.length - 1]
    if (typeof body === 'string' && body.includes('debugger')) {
      args[args.length - 1] = body.replace(/\bdebugger\b/g, '')
    }
    return BaseFunction(...args)
  }
  window.Function.prototype = BaseFunction.prototype
  Object.defineProperty(window.performance, 'now', { value: () => 0, configurable: true })
  window.Image = class Image {
    constructor() {
      this.onload = null
      this.onerror = null
      queueMicrotask(() => this.onload?.())
    }
  }
}

function installNavigator(window) {
  const { languages, platform, hardwareConcurrency, cookieEnabled, screenWidth, screenHeight, colorDepth, devicePixelRatio } =
    BROWSER_PROFILE
  Object.defineProperty(window.navigator, 'userAgent', { value: CLIENT_HEADERS['User-Agent'], configurable: true })
  Object.defineProperty(window.navigator, 'platform', { value: platform, configurable: true })
  Object.defineProperty(window.navigator, 'language', { value: languages[0], configurable: true })
  Object.defineProperty(window.navigator, 'languages', { value: languages, configurable: true })
  Object.defineProperty(window.navigator, 'hardwareConcurrency', { value: hardwareConcurrency, configurable: true })
  Object.defineProperty(window.navigator, 'cookieEnabled', { value: cookieEnabled, configurable: true })
  Object.defineProperty(window.screen, 'width', { value: screenWidth, configurable: true })
  Object.defineProperty(window.screen, 'height', { value: screenHeight, configurable: true })
  Object.defineProperty(window.screen, 'colorDepth', { value: colorDepth, configurable: true })
  Object.defineProperty(window, 'devicePixelRatio', { value: devicePixelRatio, configurable: true })
  Object.defineProperty(window, 'innerWidth', { value: screenWidth, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: screenHeight, configurable: true })
}

function captureSetCookies(response, jar) {
  if (typeof response.headers.getSetCookie !== 'function') {
    throw new Error('Set-Cookie parsing requires Headers.getSetCookie().')
  }
  for (const entry of response.headers.getSetCookie()) {
    const pair = entry.split(';')[0].trim()
    if (pair && !jar.includes(pair)) jar.push(pair)
  }
}

function installFetch(window, embedPath) {
  const cookies = []
  let protectionHeader = ''
  let requestToken = ''
  let requestPacket = ''

  window.fetch = async (input, init = {}) => {
    let url = typeof input === 'string' ? input : input.url
    if (url.startsWith('/')) url = `${SITE_ORIGIN}${url}`
    const headers = new Headers(CLIENT_HEADERS)
    if (init.headers) {
      for (const [key, value] of new Headers(init.headers)) headers.set(key, value)
    }
    if (!headers.has('Referer')) headers.set('Referer', `${SITE_ORIGIN}${embedPath}`)
    if (cookies.length) headers.set('Cookie', cookies.join('; '))

    const parsed = new URL(url)
    if (parsed.origin === SITE_ORIGIN) {
      if (parsed.pathname === '/api/c/issue') {
        if (requestToken) headers.set('x-cs-r', requestToken)
        if (protectionHeader) headers.set('x-cs-q', protectionHeader)
        if (requestPacket) headers.set('x-cs-p', requestPacket)
      } else if (parsed.pathname === '/api/c/stage2/issue' && requestToken) {
        headers.set('x-cs-r', requestToken)
      }
    }

    const response = await fetch(url, { ...init, headers })
    captureSetCookies(response, cookies)
    return response
  }

  return {
    async bootstrap() {
      protectionHeader = buildProtectionHeader(embedPath)
      const response = await window.fetch('/api/c/bootstrap', {
        method: 'POST',
        headers: { 'x-cs-q': protectionHeader },
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`Protection bootstrap failed (${response.status}).`)
      const body = await response.json()
      if (typeof body.r !== 'string' || !body.r || typeof body.p !== 'string' || !body.p) {
        throw new Error('Protection bootstrap payload was invalid.')
      }
      requestToken = body.r
      requestPacket = body.p
      return body
    },
    getRequestToken() {
      return requestToken
    },
  }
}

function installWorkers(window) {
  let blobId = 0
  window.Blob = class Blob {
    constructor(parts, opts = {}) {
      this._parts = parts
      this.type = opts.type || ''
    }
  }
  window.URL.createObjectURL = () => `blob:n${blobId++}`
  window.URL.revokeObjectURL = () => {}

  window.Worker = class Worker {
    constructor() {
      this.onmessage = null
      this.onerror = null
      this._done = false
      this._threads = new Set()
    }
    postMessage(data) {
      if (this._done) return
      const isWasmPow = data && typeof data === 'object' && !Array.isArray(data) && 'work' in data
      const thread = new NodeWorker(isWasmPow ? powWorkerShim : hashGrindWorker, isWasmPow
        ? undefined
        : {
            workerData: {
              publicSalt: data[0],
              target: data[1],
              difficulty: data[2],
              start: data[3],
              end: data[4],
            },
          })
      this._threads.add(thread)
      thread.on('message', (message) => {
        if (message.solution || message.ok === true) {
          this._done = true
          for (const worker of this._threads) worker.terminate()
          this._threads.clear()
        }
        this.onmessage?.({ data: message })
      })
      thread.on('error', (error) => {
        this.onerror?.({ message: error.message })
      })
      thread.on('exit', () => this._threads.delete(thread))
      if (isWasmPow) thread.postMessage(data)
    }
    terminate() {
      this._done = true
      for (const worker of this._threads) worker.terminate()
      this._threads.clear()
    }
    addEventListener() {}
    removeEventListener() {}
  }
}

function waitForStageOne(window, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Protection stage 1 timed out.')), timeoutMs)
    window.addEventListener(
      '_cs',
      (event) => {
        clearTimeout(timeout)
        const stageOne = window[event.detail]
        if (!stageOne?.gc || !stageOne?.dr) {
          reject(new Error('Protection stage 1 is unavailable.'))
          return
        }
        resolve(stageOne)
      },
      { once: true },
    )
  })
}

export async function createChallengeHost(embedPath) {
  if (!embedPath) throw new Error('Embed path is required.')
  const { screenWidth, screenHeight } = BROWSER_PROFILE
  const window = new Window({
    url: `${SITE_ORIGIN}${embedPath}`,
    width: screenWidth,
    height: screenHeight,
    settings: { canvasAdapter: new CanvasAdapter() },
  })
  window.document.write(
    '<!DOCTYPE html><html><head></head><body><canvas id="c" width="256" height="128"></canvas></body></html>',
  )
  window.TextEncoder = globalThis.TextEncoder
  window.TextDecoder = globalThis.TextDecoder
  installAntiDebug(window)
  installWebCrypto(window)
  installNavigator(window)
  const bootstrap = installFetch(window, embedPath)
  installWorkers(window)

  window.eval(patchVmSource(fs.readFileSync(stageTwoScript, 'utf8')))
  if (!window.__ss2_challenge?.gc) throw new Error('Protection stage 2 is unavailable.')

  const stageOneReady = waitForStageOne(window)
  window.eval(patchVmSource(fs.readFileSync(stageOneScript, 'utf8')))
  const stageOne = await stageOneReady

  await bootstrap.bootstrap()
  await window.happyDOM.waitUntilComplete()
  return {
    window,
    stageOne,
    embedPath,
    bootstrap,
    release() {
      window.happyDOM.close()
    },
  }
}

