import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { once } from 'node:events'
import * as acp from '@agentclientprotocol/sdk'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('真实ACP SDK跨进程握手、prompt、语义输出、列表、关闭和恢复', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-acp-')), child = spawn(process.execPath, ['src/acp-server.mjs'], { env: { ...process.env, HARNESS_HOME: root }, stdio: ['pipe', 'pipe', 'pipe'] })
  child.stderr.resume()
  const exited = once(child, 'close')
  const updates = []
  const app = acp.client({ name: 'course' }).onNotification('session/update', ctx => { updates.push(ctx.params) }).onRequest('session/request_permission', () => ({ outcome: { outcome: 'selected', optionId: 'allow' } }))
  const connection = app.connect(acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)))
  try {
    const client = connection.agent
    await client.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await client.request(acp.methods.agent.session.new, { cwd: root, mcpServers: [] })
    const result = await client.request(acp.methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: 'text', text: 'hello' }] })
    assert.equal(result.stopReason, 'end_turn'); assert.ok(updates.some(event => event.update.sessionUpdate === 'agent_message_chunk'))
    await client.request(acp.methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: 'text', text: '/tool write {\"path\":\"proof.txt\",\"text\":\"ok\"}' }] })
    assert.equal(readFileSync(join(root, 'proof.txt'), 'utf8'), 'ok')
    const slow = client.request(acp.methods.agent.session.prompt, { sessionId: created.sessionId, prompt: [{ type: 'text', text: '/slow' }] })
    await delay(20); await client.notify(acp.methods.agent.session.cancel, { sessionId: created.sessionId })
    assert.equal((await slow).stopReason, 'cancelled')
    assert.equal((await client.request(acp.methods.agent.session.list, {})).sessions.length, 1)
    await client.request(acp.methods.agent.session.close, { sessionId: created.sessionId })
    await client.request(acp.methods.agent.session.resume, { sessionId: created.sessionId, cwd: root, mcpServers: [] })
  } finally { child.stdin.end(); await exited; rmSync(root, { recursive: true, force: true }) }
})
