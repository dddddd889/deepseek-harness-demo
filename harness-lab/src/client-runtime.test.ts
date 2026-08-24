import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'bun:test'
import { AgentServer } from './agent-server.ts'
import { LocalAttachmentStore } from './attachment-store.ts'
import { AgentClient, ClientProjection } from './client-runtime.ts'
import { createMessage } from './domain.ts'
import { HeadlessHost } from './headless-host.ts'
import { InteractionBroker } from './interactions.ts'
import { validateProfile } from './profile.ts'
import { Session } from './session.ts'

const TOKEN = 'web-client-token-0123456789'

test('ClientProjection 严格检查 seq，重复 replay 幂等且 gap fail loud', () => {
  const session = new Session()
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }))
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'par' } })
  const projection = new ClientProjection('s')
  projection.reset(session.events)
  assert.equal(projection.view().partialAssistantText, 'par')
  projection.apply(session.events[3] as NonNullable<typeof session.events[3]>)
  assert.equal(projection.lastSeq, 3)
  assert.throws(() => projection.apply({ ...session.events[3], seq: 5 } as NonNullable<typeof session.events[3]>), /CLIENT_EVENT_GAP/)
})

test('ClientProjection 重放 surface replacement 与 usage 覆盖规则', () => {
  const session = new Session()
  const old = createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'old' }] })
  session.append('user/message', old)
  session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } } })
  session.append('assistant/message', {
    turn: 1, step: 1,
    message: createMessage({ role: 'assistant', source: { kind: 'model', provider: 'x', model: 'y' }, content: [{ type: 'text', text: 'answer' }] }),
    usage: { inputTokens: 6, outputTokens: 3 },
  })
  session.append('user/message', createMessage({
    role: 'user', source: { kind: 'plugin', plugin: 'compaction' }, content: [{ type: 'text', text: 'summary' }],
  }), Date.now(), { surfaceOp: { op: 'replace', start: 0, end: 2 } })
  const projection = new ClientProjection('s')
  projection.reset(session.events)
  assert.equal(projection.view().messages.length, 1)
  assert.equal(projection.view().usage.inputTokens, 6)
  assert.equal(projection.view().usage.outputTokens, 3)
})

async function serverFixture() {
  const root = await mkdtemp(join(tmpdir(), 'harness-web-client-'))
  const profile = validateProfile({
    name: 'web', provider: 'scripted', model: 'fixture', scriptedResponse: 'web answer',
    persistenceRoot: join(root, 'sessions'), cwd: root, apiKeyEnv: 'X', maxSteps: 3,
    sandboxMode: 'read-only', approvalPolicy: 'never',
  })
  const server = new AgentServer(await HeadlessHost.open(profile), {
    authToken: TOKEN,
    webRoot: join(import.meta.dirname, '../web'),
    heartbeatMs: 50,
  })
  const address = await server.listen()
  return { server, url: address.url }
}

test('AgentClient snapshot 后 SSE 追尾，Abort 可终止 follow', async () => {
  const fixture = await serverFixture()
  try {
    const client = new AgentClient(fixture.url, TOKEN)
    await client.rpc('session.create', { sessionId: 'follow' }, 'create')
    const projection = new ClientProjection('follow')
    const controller = new AbortController()
    const states: string[] = []
    const following = client.follow('follow', projection, controller.signal, {
      onConnection: state => states.push(state),
      onView: () => {
        if (projection.events.some(event => event.type === 'turn/end')) controller.abort()
      },
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    await client.rpc('session.send', { sessionId: 'follow', text: 'hello' }, 'send')
    await following
    assert.ok(projection.events.some(event => event.type === 'turn/end'))
    assert.ok(states.includes('connected'))
    assert.equal(projection.view().messages.length, 2)
  } finally { await fixture.server.close() }
})

test('同源 Web 静态资源带 CSP，静态路径不能逃逸；RPC 仍需鉴权', async () => {
  const fixture = await serverFixture()
  try {
    const page = await fetch(`${fixture.url}/`)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/)
    assert.match(await page.text(), /DeepSeek Harness Lab/)
    const script = await fetch(`${fixture.url}/app.js`)
    assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8')
    const escape = await fetch(`${fixture.url}/%2e%2e%2fpackage.json`)
    assert.ok(escape.status === 400 || escape.status === 404)
    const rpc = await fetch(`${fixture.url}/rpc`, { method: 'POST', body: '{}' })
    assert.equal(rpc.status, 401)
  } finally { await fixture.server.close() }
})

test('审批通过共享 Broker 由 RPC 第一写决定', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-web-approval-'))
  const profile = validateProfile({
    name: 'approval', provider: 'scripted', model: 'fixture', scriptedResponse: 'ok',
    persistenceRoot: join(root, 'sessions'), cwd: root, apiKeyEnv: 'X', maxSteps: 3,
    sandboxMode: 'read-only', approvalPolicy: 'ask',
  })
  const interactions = new InteractionBroker()
  const server = new AgentServer(await HeadlessHost.open(profile, undefined, interactions), { authToken: TOKEN, interactions })
  const address = await server.listen()
  const client = new AgentClient(address.url, TOKEN)
  try {
    await client.rpc('session.create', { sessionId: 'approval' }, 'create')
    const controller = new AbortController()
    const pending = interactions.answerer('approval')({
      id: 'approval-1', toolName: 'fs_write', callId: 'call-1', reason: '写入文件',
      requestedMode: 'workspace-write', signal: controller.signal,
    })
    const listed = await client.rpc<{ interactions: { id: string }[] }>('interaction.list', { sessionId: 'approval' }, 'list')
    assert.deepEqual(listed.interactions.map(value => value.id), ['approval-1'])
    await client.rpc('interaction.answer', { sessionId: 'approval', id: 'approval-1', outcome: 'allowed-once' }, 'answer')
    assert.equal(await pending, 'allowed-once')
    await assert.rejects(client.rpc('interaction.answer', { sessionId: 'approval', id: 'approval-1', outcome: 'rejected' }, 'answer-2'), /审批不存在/)
  } finally { await server.close() }
})

test('图片上传、durable ref 消息与鉴权读取形成附件闭环', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-web-attachment-'))
  const profile = validateProfile({
    name: 'attachment', provider: 'scripted', model: 'fixture', scriptedResponse: 'saw image',
    persistenceRoot: join(root, 'sessions'), cwd: root, apiKeyEnv: 'X', maxSteps: 3,
    sandboxMode: 'read-only', approvalPolicy: 'never',
  })
  const attachments = new LocalAttachmentStore(root, { maxImageBytes: 1024, maxImagePixels: 100, mediaTypes: ['image/png'] })
  const server = new AgentServer(await HeadlessHost.open(profile), { authToken: TOKEN, attachments })
  const address = await server.listen()
  const client = new AgentClient(address.url, TOKEN)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  try {
    await client.rpc('session.create', { sessionId: 'image' }, 'create')
    const uploaded = await fetch(`${address.url}/attachments`, {
      method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'image/png', 'x-file-name': 'pixel.png' }, body: png,
    })
    assert.equal(uploaded.status, 201)
    const ref = await uploaded.json() as Record<string, unknown>
    await client.rpc('session.send', { sessionId: 'image', text: '看图', attachments: [ref] }, 'send')
    const events = await client.snapshot('image')
    const user = events.find(event => event.type === 'user/message')
    assert.ok(user?.type === 'user/message' && user.data.content.some(block => block.type === 'image'))
    const read = await fetch(`${address.url}/attachment/read`, {
      method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(ref),
    })
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), png)
  } finally { await server.close() }
})
