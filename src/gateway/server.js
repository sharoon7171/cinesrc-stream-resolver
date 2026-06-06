import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractStreamLive, parseStreamQuery } from '../pipeline/extract.js'
import { relayResponse } from '../relay/tunnel.js'

const staticRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public')
const listenPort = Number(process.env.PORT) || 8787

function relayBase(req) {
  const host = req.headers.host || `127.0.0.1:${listenPort}`
  const proto = req.headers['x-forwarded-proto'] || 'http'
  return `${proto}://${host}`
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify(body))
}

function readQuery(url) {
  return Object.fromEntries(new URL(url, 'http://local').searchParams.entries())
}

function readTunnelHeaders(q) {
  const headers = {}
  if (q.referer) headers.Referer = q.referer
  for (const [key, value] of Object.entries(q)) {
    if (key.startsWith('h_')) headers[key.slice(2)] = value
  }
  return headers
}

function pushSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

const server = http.createServer(async (req, res) => {
  try {
    const pathOnly = req.url?.split('?')[0]

    if (req.method === 'GET' && (pathOnly === '/' || pathOnly === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(fs.readFileSync(path.join(staticRoot, 'index.html')))
      return
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && pathOnly === '/api/proxy') {
      const q = readQuery(req.url)
      if (!q.url) return sendJson(res, 400, { error: 'Stream URL is required.' })
      const init = { method: req.method }
      if (req.headers.range) init.headers = { Range: req.headers.range }
      const relayed = await relayResponse(q.url, readTunnelHeaders(q), relayBase(req), init)
      res.writeHead(relayed.status, relayed.headers)
      res.end(req.method === 'HEAD' ? undefined : relayed.body)
      return
    }

    if (req.method === 'GET' && pathOnly === '/api/stream/live') {
      const parsed = parseStreamQuery(readQuery(req.url))
      if (parsed.error) return sendJson(res, 400, { error: parsed.error })
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      })
      try {
        await extractStreamLive(parsed, { playBase: relayBase(req) }, (event, data) => pushSse(res, event, data))
      } catch (err) {
        pushSse(res, 'fail', { error: String(err.message || err) })
      }
      res.end()
      return
    }

    sendJson(res, 404, { error: 'Not found.' })
  } catch (err) {
    sendJson(res, 500, { error: err.message })
  }
})

server.listen(listenPort, () => {
  console.log(`Cinesrc Stream Resolver listening on http://127.0.0.1:${listenPort}`)
})
