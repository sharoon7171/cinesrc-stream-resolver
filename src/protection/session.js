function createSerialQueue() {
  let chain = Promise.resolve()
  return (fn) => {
    const work = chain.then(() => fn(), () => fn())
    chain = work.catch(() => {})
    return work
  }
}

function ensureHostLocks(host) {
  if (!host.mintLock) host.mintLock = createSerialQueue()
  if (!host.decodeLock) host.decodeLock = createSerialQueue()
}

function parseActionEnvelope(raw) {
  const errorLine = raw.split('\n').find((line) => line.startsWith('1:E'))
  if (errorLine) throw new Error(`invalid_challenge:${errorLine.slice(3)}`)

  for (const line of raw.split('\n')) {
    if (line.startsWith('1:')) {
      const body = line.slice(2).replace(/^"|"$/g, '')
      if (body.startsWith('e1:')) throw new Error(`invalid_challenge:${body.slice(3)}`)
      if (body.startsWith('r2.')) return body
    }
  }

  const inline = raw.match(/r2\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+(?=1:"|$)/)
  if (inline) return inline[0]

  throw new Error('Response is not an r2 envelope.')
}

async function mintProtectionToken(host) {
  const stageOneToken = await host.stageOne.gc()
  const stageTwoToken = await host.window.__ss2_challenge.gc()
  return `${stageOneToken}::c2::${stageTwoToken}::c3::${host.bootstrap.getRequestToken()}`
}

async function createProtectionSession(host) {
  return buildStreamSession(host, await mintProtectionToken(host))
}

async function refreshProtectionSession(host) {
  await host.bootstrap.bootstrap()
  return createProtectionSession(host)
}

function buildStreamSession(host, token) {
  ensureHostLocks(host)
  return {
    token,
    fetch: (url, init) => host.window.fetch(url, init),
    decode: async (raw) => host.decodeLock(() => host.stageOne.dr(parseActionEnvelope(raw))),
  }
}

export function mintLockedSession(host, refresh = false) {
  ensureHostLocks(host)
  return host.mintLock(() => (refresh ? refreshProtectionSession(host) : createProtectionSession(host)))
}
