import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { Host } from '../src/host.mjs'
import { startHTTP } from '../src/http.mjs'
import { Peer } from '../src/rpc.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('真实HTTP认证交换和WebSocket领域调用', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-http-')), host = new Host(root), web = await startHTTP(host)
  let ws
  try {
    assert.equal((await fetch(web.url + '/status')).status, 401)
    const bootstrap = await fetch(web.bootstrap, { redirect: 'manual' }), cookie = bootstrap.headers.get('set-cookie').split(';')[0]
    assert.equal(bootstrap.status, 302)
    ws = new WebSocket(web.url.replace('http:', 'ws:') + '/rpc', { headers: { Cookie: cookie, Origin: web.url } })
    await once(ws, 'open')
    const client = new Peer(message => ws.send(JSON.stringify(message)))
    ws.on('message', bytes => void client.receive(JSON.parse(bytes.toString())))
    const header = await client.request('session.create', { cwd: root })
    assert.equal(header.owner, 'local')
    client.close()
  } finally { ws?.terminate(); await web.close(); await host.close(); rmSync(root, { recursive: true, force: true }) }
})
