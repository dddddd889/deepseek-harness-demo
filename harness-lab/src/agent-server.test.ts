import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'bun:test'
import { AgentServer } from './agent-server.ts'
import { HeadlessHost } from './headless-host.ts'
import { ScriptedLlmProvider } from './llm.ts'
import { validateProfile } from './profile.ts'

const TOKEN = '0123456789abcdef-test-token'

async function fixture(delayMs = 0, serverOptions: { readonly maxRequestBytes?: number; readonly maxSseQueueBytes?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'harness-agent-server-'))
  const profile = validateProfile({
    name: 'server-test', provider: 'scripted', model: 'fixture', scriptedResponse: 'server answer',
    persistenceRoot: join(root, 'sessions'), cwd: root, apiKeyEnv: 'TEST_KEY', maxSteps: 3,
    sandboxMode: 'read-only', approvalPolicy: 'never',
  })
  const provider = delayMs === 0 ? undefined : new ScriptedLlmProvider([
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'slow answer' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'slow answer' } },
    { type: 'finish', reason: { kind: 'stop' } },
  ], delayMs)
  const host = await HeadlessHost.open(profile, provider)
  const server = new AgentServer(host, { authToken: TOKEN, heartbeatMs: 50, ...serverOptions })
  const listening = await server.listen()
  return { root, profile, host, server, url: listening.url }
}

async function rpc(url: string, id: string, method: string, params: Record<string, unknown> = {}, token = TOKEN) {
  const response = await fetch(`${url}/rpc`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

test('持有者令牌鉴权发生在 RPC 分派前', async () => {
  const value = await fixture()
  try {
    const denied = await rpc(value.url, '1', 'session.create', { sessionId: 'secret' }, 'wrong-token-wrong')
    assert.equal(denied.status, 401)
    assert.deepEqual(denied.body, { error: { code: 'UNAUTHORIZED', message: '未授权' } })
    const snapshot = await rpc(value.url, '2', 'session.snapshot', { sessionId: 'secret' })
    assert.equal((snapshot.body.error as { code: string }).code, 'SESSION_NOT_ACTIVE')
  } finally { await value.server.close() }
})

test('RPC 请求标识对同一命令幂等，对不同命令报告冲突', async () => {
  const value = await fixture()
  try {
    const first = await rpc(value.url, 'same-id', 'session.create', { sessionId: 'stable' })
    const replay = await rpc(value.url, 'same-id', 'session.create', { sessionId: 'stable' })
    assert.deepEqual(replay.body, first.body)
    const conflict = await rpc(value.url, 'same-id', 'session.create', { sessionId: 'different' })
    assert.equal(conflict.status, 409)
    assert.equal((conflict.body.error as { code: string }).code, 'IDEMPOTENCY_CONFLICT')
  } finally { await value.server.close() }
})

test('多会话独立路由，发送后快照暴露持久事件而非智能体对象', async () => {
  const value = await fixture()
  try {
    await rpc(value.url, 'c1', 'session.create', { sessionId: 'a' })
    await rpc(value.url, 'c2', 'session.create', { sessionId: 'b' })
    const turn = await rpc(value.url, 's1', 'session.send', { sessionId: 'a', text: 'hello' })
    assert.equal(((turn.body.result as { reason: { kind: string } }).reason).kind, 'completed')
    const a = await rpc(value.url, 'p1', 'session.snapshot', { sessionId: 'a' })
    const b = await rpc(value.url, 'p2', 'session.snapshot', { sessionId: 'b' })
    assert.ok((a.body.result as { events: unknown[] }).events.length > 0)
    assert.equal((b.body.result as { events: unknown[] }).events.length, 0)
  } finally { await value.server.close() }
})

test('并发发送被忙碌错误拒绝，取消操作传播到运行轮次', async () => {
  const value = await fixture(30)
  try {
    await rpc(value.url, 'create', 'session.create', { sessionId: 'busy' })
    const running = rpc(value.url, 'send-1', 'session.send', { sessionId: 'busy', text: 'slow' })
    await new Promise(resolve => setTimeout(resolve, 10))
    const busy = await rpc(value.url, 'send-2', 'session.send', { sessionId: 'busy', text: 'second' })
    assert.equal(busy.status, 409)
    assert.equal((busy.body.error as { code: string }).code, 'AGENT_BUSY')
    const cancelled = await rpc(value.url, 'cancel', 'session.cancel', { sessionId: 'busy', reason: 'operator' })
    assert.equal((cancelled.body.result as { accepted: boolean }).accepted, true)
    const finished = await running
    assert.equal(((finished.body.result as { reason: { kind: string } }).reason).kind, 'aborted')
  } finally { await value.server.close() }
})

test('SSE 从起始序号重放后追尾，事件标识与会话序号一致', async () => {
  const value = await fixture()
  try {
    await rpc(value.url, 'create', 'session.create', { sessionId: 'events' })
    const response = await fetch(`${value.url}/events?sessionId=events&after=-1`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    assert.equal(response.status, 200)
    const reader = response.body?.getReader()
    assert.ok(reader)
    const send = rpc(value.url, 'send', 'session.send', { sessionId: 'events', text: 'stream me' })
    const decoder = new TextDecoder()
    let text = ''
    while (!text.includes('"type":"turn/end"')) {
      const chunk = await reader?.read()
      if (chunk?.done === true) break
      text += decoder.decode(chunk?.value, { stream: true })
    }
    await send
    assert.match(text, /event: session-event/)
    assert.match(text, /id: 0/)
    assert.match(text, /"type":"turn\/end"/)
    await reader?.cancel()
  } finally { await value.server.close() }
})

test('服务关闭并刷盘后可由新宿主冷恢复', async () => {
  const value = await fixture()
  await rpc(value.url, 'create', 'session.create', { sessionId: 'durable' })
  await rpc(value.url, 'send', 'session.send', { sessionId: 'durable', text: 'one' })
  await value.server.close()

  const nextHost = await HeadlessHost.open(value.profile)
  const resumed = await nextHost.resume('durable')
  assert.equal((await resumed.run('two')).turn, 2)
  await resumed.close(); await nextHost.dispose()
})

test('RPC 请求体超限返回 413，SSE 单帧超预算会断开慢消费者', async () => {
  const bodyLimited = await fixture(0, { maxRequestBytes: 64 })
  try {
    const response = await fetch(`${bodyLimited.url}/rpc`, {
      method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'large', method: 'x', params: { text: 'x'.repeat(200) } }),
    })
    assert.equal(response.status, 413)
  } finally { await bodyLimited.server.close() }

  const queueLimited = await fixture(0, { maxSseQueueBytes: 32 })
  try {
    await rpc(queueLimited.url, 'create', 'session.create', { sessionId: 'slow' })
    const response = await fetch(`${queueLimited.url}/events?sessionId=slow`, { headers: { authorization: `Bearer ${TOKEN}` } })
    const reader = response.body?.getReader()
    const reading = reader?.read()
    await rpc(queueLimited.url, 'send', 'session.send', { sessionId: 'slow', text: 'make a large event frame' })
    await assert.rejects(async () => {
      await reading
      while (true) {
        const next = await reader?.read()
        if (next?.done === true) throw new Error('SSE 因背压关闭')
      }
    }, /terminated|backpressure|closed/i)
  } finally { await queueLimited.server.close() }
})
