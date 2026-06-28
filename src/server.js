import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStreamQuery, fetchProviderCatalog, resolveProviderStream, resolveFirstStream } from './resolve/live.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(root, '../public')
const hlsPath = path.join(root, '../node_modules/hls.js/dist/hls.mjs')
const port = Number(process.env.PORT) || 8787

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
}

const cors = { 'Access-Control-Allow-Origin': '*' }

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors })
  res.end(JSON.stringify(body))
}

function query(url) {
  return Object.fromEntries(new URL(url, 'http://local').searchParams.entries())
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function serveStatic(pathOnly, res) {
  const rel = pathOnly === '/' ? 'index.html' : pathOnly.slice(1)
  const filePath = path.resolve(publicDir, rel)
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false
  const ext = path.extname(filePath)
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
  res.end(fs.readFileSync(filePath))
  return true
}

async function apiJson(res, handler) {
  try {
    json(res, 200, await handler())
  } catch (error) {
    json(res, 502, { error: String(error.message || error) })
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const pathOnly = req.url?.split('?')[0]

    if (req.method === 'GET' && serveStatic(pathOnly, res)) return

    if (req.method === 'GET' && pathOnly === '/vendor/hls.mjs') {
      res.writeHead(200, { 'Content-Type': MIME['.mjs'] })
      res.end(fs.readFileSync(hlsPath))
      return
    }

    if (req.method === 'GET' && pathOnly === '/api/catalog') {
      const parsed = parseStreamQuery(query(req.url))
      if (parsed.error) return json(res, 400, { error: parsed.error })
      return apiJson(res, () => fetchProviderCatalog(parsed))
    }

    if (req.method === 'GET' && pathOnly === '/api/stream/provider') {
      const params = query(req.url)
      const parsed = parseStreamQuery(params)
      if (parsed.error) return json(res, 400, { error: parsed.error })
      if (!params.provider) return json(res, 400, { error: 'Provider id is required.' })
      return apiJson(res, () => resolveProviderStream(parsed, params.provider))
    }

    if (req.method === 'GET' && pathOnly === '/api/stream/live') {
      const parsed = parseStreamQuery(query(req.url))
      if (parsed.error) return json(res, 400, { error: parsed.error })
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...cors,
      })
      res.flushHeaders?.()
      res.socket?.setNoDelay(true)
      try {
        await resolveFirstStream(parsed, (event, data) => sse(res, event, data))
      } catch (error) {
        sse(res, 'fail', { error: String(error.message || error) })
      }
      res.end()
      return
    }

    json(res, 404, { error: 'Not found.' })
  } catch (error) {
    json(res, 500, { error: error.message })
  }
})

server.on('connection', (socket) => socket.setNoDelay(true))
server.listen(port, () => {
  console.log(`Cinesrc Stream Resolver listening on http://127.0.0.1:${port}`)
})
