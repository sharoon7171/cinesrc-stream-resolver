import './lib/load-env.js'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildContentPath, buildRouterStateTree } from './lib/content-path.js'
import { getProviders } from './lib/cinesrc-api.js'
import { proxyStreamResponse } from './lib/stream-proxy.js'

let resolveStreamFn = null
async function resolveStream(input, options) {
  if (!resolveStreamFn) {
    resolveStreamFn = (await import('./lib/stream.js')).resolveStream
  }
  return resolveStreamFn(input, options)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, 'public')
const port = Number(process.env.PORT) || 8787

function baseUrl(req) {
  const host = req.headers.host || `127.0.0.1:${port}`
  const proto = req.headers['x-forwarded-proto'] || 'http'
  return `${proto}://${host}`
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(payload)
}

function parseQuery(url) {
  const q = new URL(url, 'http://local')
  return Object.fromEntries(q.searchParams.entries())
}

function parseProxyHeaders(q) {
  const headers = {}
  if (q.referer) headers.Referer = q.referer
  for (const [key, value] of Object.entries(q)) {
    if (key.startsWith('h_')) headers[key.slice(2)] = value
  }
  return headers
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = fs.readFileSync(path.join(publicDir, 'index.html'))
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && req.url?.startsWith('/api/proxy')) {
      const q = parseQuery(req.url)
      const target = q.url
      if (!target) return sendJson(res, 400, { error: 'Stream URL is required.' })
      const sourceHeaders = parseProxyHeaders(q)
      const init = { method: req.method }
      if (req.headers.range) init.headers = { Range: req.headers.range }
      const proxied = await proxyStreamResponse(target, sourceHeaders, baseUrl(req), init)
      res.writeHead(proxied.status, proxied.headers)
      res.end(req.method === 'HEAD' ? undefined : proxied.body)
      return
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/providers')) {
      const q = parseQuery(req.url)
      const id = q.id
      const type = q.type === 'tv' ? 'tv' : 'movie'
      if (!id) return sendJson(res, 400, { error: 'TMDB ID is required.' })
      const contentPath = buildContentPath({ id, type, season: q.season, episode: q.episode })
      const route = { routerStateTree: buildRouterStateTree({ id, type, season: q.season, episode: q.episode }) }
      const providers = await getProviders(contentPath, route)
      return sendJson(res, 200, { providers })
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/resolve')) {
      const q = parseQuery(req.url)
      const id = q.id
      const type = q.type === 'tv' ? 'tv' : 'movie'
      const provider = q.provider
      if (!id) return sendJson(res, 400, { error: 'TMDB ID is required.' })
      if (!provider) return sendJson(res, 400, { error: 'Provider is required.' })
      const result = await resolveStream(
        {
          id,
          type,
          season: q.season,
          episode: q.episode,
          provider: q.provider,
        },
        { playBase: baseUrl(req) },
      )
      return sendJson(res, 200, result)
    }

    sendJson(res, 404, { error: 'Not found.' })
  } catch (err) {
    sendJson(res, 500, { error: err.message })
  }
})

server.listen(port, () => {
  console.log(`Cinesrc Stream Resolver listening on http://127.0.0.1:${port}`)
  if (process.env.CINESRC_PROXY) console.log('Proxy fallback configured (CINESRC_PROXY)')
})
