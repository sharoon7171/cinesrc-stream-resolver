import { ProxyAgent, fetch as undiciFetch } from 'undici'

const proxyUrl = process.env.CINESRC_PROXY
let proxyDispatcher = null

function proxyDispatcherInstance() {
  if (!proxyUrl) return null
  if (!proxyDispatcher) {
    proxyDispatcher = new ProxyAgent({
      uri: proxyUrl,
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 60_000,
    })
  }
  return proxyDispatcher
}

function shouldUseProxyFallback(res) {
  return res.status === 403 || res.status === 407 || res.status === 451 || res.status === 429
}

async function fetchDirect(url, init) {
  return fetch(url, init)
}

async function fetchViaProxy(url, init) {
  const dispatcher = proxyDispatcherInstance()
  if (!dispatcher) return fetchDirect(url, init)
  return undiciFetch(url, { ...init, dispatcher })
}

export async function upstreamFetch(url, init = {}) {
  let res
  try {
    res = await fetchDirect(url, init)
  } catch {
    return fetchViaProxy(url, init)
  }
  if (!proxyUrl || !shouldUseProxyFallback(res)) return res
  return fetchViaProxy(url, init)
}
