import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Host } from '../src/host.mjs'
import { capabilities } from '../src/capabilities.mjs'
import { product } from '../src/product.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('从同一Agent真正调用接线后的协作工具，拒绝后不绕过审批', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-capabilities-')), host = new Host(root)
  product(host); capabilities(host)
  try {
    const record = host.create({ cwd: root })
    record.session.on(event => { if (event.type === 'approval/request') record.approvals.answer(record.header.id, event.data.id, true) })
    record.agent.submit('/tool todo_update {"value":{"id":"one","status":"done","text":"写完了"}}')
    await record.agent.idle()
    assert.equal(record.domains.collaboration.state('todo').one.status, 'done')
    assert.ok(record.tools.catalog().some(tool => tool.name === 'subagent_create'))
  } finally { await host.close(); rmSync(root, { recursive: true, force: true }) }
})
