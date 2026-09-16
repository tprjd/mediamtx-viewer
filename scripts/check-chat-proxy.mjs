import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket, { WebSocketServer } from 'ws'

// Exercise the production proxy with an HTTP-only authentication endpoint.
// Next.js closes upgrade requests before its ordinary route handler runs.
export async function checkChatProxy() {
  const directory = mkdtempSync(join(tmpdir(), 'chat-proxy-'))
  const container = `chat-proxy-check-${process.pid}`
  const secret = 'proxy-check-internal-secret'
  const lastRequest = new WeakMap()
  const auth = createServer((request, response) => {
    const previous = lastRequest.get(request.socket)
    lastRequest.set(request.socket, Date.now())
    // Reproduce an upstream closing a connection that the proxy reused after
    // its five-second idle deadline. A POST must not reach this stale socket.
    if (previous && Date.now() - previous >= 5000) {
      request.socket.destroy()
      return
    }
    if (request.url === '/capacity-proxy-check' && request.method === 'POST') {
      request.resume()
      response.writeHead(201).end('accepted')
      return
    }
    response.writeHead(request.headers['x-internal-auth'] === secret &&
      request.headers.cookie === 'proxy-check=active' ? 204 : 401).end()
  })
  auth.keepAliveTimeout = 60000
  auth.on('upgrade', (_request, socket) => socket.destroy())
  const broker = createServer()
  const sockets = new WebSocketServer({server: broker})
  let brokerRequest
  sockets.on('connection', (socket, request) => {
    brokerRequest = request
    socket.send('authenticated')
  })
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const close = server => new Promise(resolve => server.close(resolve))
  try {
    await listen(auth)
    await listen(broker)
    const probe = createServer()
    await listen(probe)
    const port = probe.address().port
    await close(probe)
    const configuration = readFileSync('deploy/oracle/Caddyfile', 'utf8')
      .replaceAll('{$PUBLIC_HOSTNAME}', `http://127.0.0.1:${port}`)
      .replaceAll('{$INTERNAL_AUTH_SECRET}', secret)
      .replaceAll('viewer:3000', `127.0.0.1:${auth.address().port}`)
      .replaceAll('centrifugo:8000', `127.0.0.1:${broker.address().port}`)
    writeFileSync(join(directory, 'Caddyfile'), configuration)
    execFileSync('docker', ['run', '-d', '--rm', '--name', container, '--network', 'host',
      '-v', `${directory}/Caddyfile:/etc/caddy/Caddyfile:ro`, 'caddy:2.11.4-alpine'], {stdio: 'pipe'})
    const origin = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 10000
    for (;;) {
      try { if ((await fetch(origin, {signal: AbortSignal.timeout(500)})).status === 401) break } catch { /* Starting. */ }
      if (Date.now() > deadline) throw new Error('Chat proxy did not start')
      await delay(100)
    }
    const connect = cookie => new Promise((resolve, reject) => {
      const socket = new WebSocket(origin.replace('http:', 'ws:') + '/chat/realtime/connection/websocket',
        {headers: {cookie}, handshakeTimeout: 3000})
      socket.on('unexpected-response', (_request, response) => {
        response.resume()
        socket.terminate()
        resolve(response.statusCode)
      })
      socket.on('message', message => { socket.close(); resolve(message.toString()) })
      socket.on('error', reject)
    })
    assert.equal(await connect('proxy-check=inactive'), 401)
    assert.equal(brokerRequest, undefined)
    assert.equal(await connect('proxy-check=active'), 'authenticated')
    assert.equal(brokerRequest.url, '/connection/websocket')
    assert.equal(brokerRequest.headers.cookie, undefined)
    const post = () => fetch(`${origin}/capacity-proxy-check`, {
      method: 'POST', headers: {cookie: 'proxy-check=active'}, body: 'proxy check',
      signal: AbortSignal.timeout(3000),
    })
    const firstPost = await post()
    assert.equal(firstPost.status, 201)
    await firstPost.text()
    await delay(5200)
    const secondPost = await post()
    assert.equal(secondPost.status, 201)
    await secondPost.text()
    console.log('Production Chat proxy authenticates WebSocket upgrades and rejects inactive sessions.')
    console.log('Production proxy avoids expired upstream connections for submissions.')
  } finally {
    spawnSync('docker', ['rm', '-f', container], {stdio: 'ignore', timeout: 10000})
    for (const socket of sockets.clients) socket.terminate()
    sockets.close()
    await Promise.all([close(auth), close(broker)])
    rmSync(directory, {recursive: true, force: true})
  }
}
