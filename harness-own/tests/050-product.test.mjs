import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Host } from '../src/host.mjs'
import { product } from '../src/product.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('产品设置持久化、凭据只返回描述、请求路由真实生效', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-product-')), host = new Host(root)
  product(host)
  try {
    const record = host.create({ cwd: root })
    record.settings.set({ backend: 'offline', permission: 'read-only' })
    record.agent.submit('product'); await record.agent.idle()
    await host.closeSession(record.header.id, 'local')
    assert.equal(host.open(record.header.id).settings.snapshot().permission, 'read-only')
    const next = host.open(record.header.id); next.settings.set({ backend: 'missing' }); next.agent.submit('fail'); await next.agent.idle()
    assert.equal(next.session.read().at(-1).data.reason, 'error')
  } finally { await host.close(); rmSync(root, { recursive: true, force: true }) }
})
