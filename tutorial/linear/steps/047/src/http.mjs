import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'
import { Peer } from './rpc.mjs'
import { remote } from './remote.mjs'

/** Web传输只装配认证和Peer；业务仍是已有Remote控制器。 */
export async function startHTTP(host, { port = 0 } = {}) {
  const token = randomBytes(32).toString('base64url'), connections = new Set()
  const equal = value => typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token))
  let authority
  const authorized = request => request.headers.host === authority && equal(/(?:^|;\s*)harness=([^;]+)/.exec(request.headers.cookie ?? '')?.[1]) && (!request.headers.origin || request.headers.origin === 'http://' + authority)
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://' + authority)
    if (request.headers.host !== authority) { response.writeHead(403); response.end(); return }
    if (url.pathname === '/' && equal(url.searchParams.get('token'))) {
      response.writeHead(302, { location: '/', 'set-cookie': 'harness=' + token + '; HttpOnly; SameSite=Strict; Path=/', 'referrer-policy': 'no-referrer' }); response.end(); return
    }
    if (!authorized(request)) { response.writeHead(401); response.end('Unauthorized'); return }
    const assets = { '/': ['../web/index.html', 'text/html; charset=utf-8'], '/app.mjs': ['../web/app.mjs', 'text/javascript; charset=utf-8'], '/view.mjs': ['./view.mjs', 'text/javascript; charset=utf-8'] }
    if (assets[url.pathname]) {
      try { response.setHeader('content-type', assets[url.pathname][1]); response.end(await readFile(fileURLToPath(new URL(assets[url.pathname][0], import.meta.url)))) }
      catch { response.writeHead(404); response.end('Web文件将在第049步创建') }
    } else { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ service: 'harness-own', transport: 'websocket', model: 'explicitly-configured' })) }
  })
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })
  server.on('upgrade', (request, socket, head) => {
    if (!authorized(request) || request.url !== '/rpc') { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return }
    sockets.handleUpgrade(request, socket, head, ws => {
      connections.add(ws)
      const peer = new Peer(message => {
        if (ws.bufferedAmount > 1024 * 1024) { ws.close(1008, 'slow consumer'); throw Error('消费者过慢') }
        ws.send(JSON.stringify(message))
      })
      remote(peer, host, 'local')
      ws.on('message', bytes => { try { void peer.receive(JSON.parse(bytes.toString())).catch(() => ws.close(1008)) } catch { ws.close(1008) } })
      ws.on('close', () => { connections.delete(ws); peer.close() }); ws.on('error', () => peer.close())
    })
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  authority = '127.0.0.1:' + server.address().port
  return { url: 'http://' + authority, bootstrap: 'http://' + authority + '/?token=' + token,
    async close() { for (const ws of connections) ws.terminate(); sockets.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) },
  }
}
