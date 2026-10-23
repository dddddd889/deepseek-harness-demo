import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Host } from '../src/host.mjs'
import { startHTTP } from '../src/http.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('真正Host服务当前Web产物，认证后才能取得页面和模块', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-page-')), host = new Host(root), web = await startHTTP(host)
  try {
    const entry = await fetch(web.bootstrap, { redirect: 'manual' }), headers = { cookie: entry.headers.get('set-cookie').split(';')[0] }
    const response = await fetch(web.url, { headers })
    assert.equal(response.status, 200); assert.match(await response.text(), /我自己的 Harness/)
    assert.match(await (await fetch(web.url + '/app.mjs', { headers })).text(), /session.submit/)
    assert.equal((await fetch(web.url + '/app.mjs')).status, 401)
  } finally { await web.close(); await host.close(); rmSync(root, { recursive: true, force: true }) }
})
