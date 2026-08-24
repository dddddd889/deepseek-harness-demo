import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HarnessAgent } from './agent.ts'
import { createMessage } from './domain.ts'
import { LlmRuntime, ScriptedLlmProvider } from './llm.ts'
import { inspectLifecycle } from './projections.ts'
import { JsonlSessionStore } from './session-store.ts'

const execFileAsync = promisify(execFile)

/** 创建隔离持久化根并回收所有测试文件。 */
async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'harness-store-test-'))
  try { await run(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

test('刷盘后冷恢复保持会话头、事件和连续序号', async () => fixture(async root => {
  const store = await JsonlSessionStore.open(root)
  const created = await store.create('session-a', '/workspace')
  created.session.append('turn/start', { turn: 1 }, 10)
  created.session.append('user/message', createMessage({
    role: 'user', content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' },
  }), 11)
  created.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }, 12)
  await store.flush(created.session)
  await store.close(created.session)

  const resumed = await store.resume('session-a')
  assert.equal(resumed.header.cwd, '/workspace')
  assert.equal(resumed.repair.repairedTornBytes, 0)
  assert.deepEqual(resumed.session.events.map(event => event.seq), [0, 1, 2])
  const restoredMessage = resumed.session.events[1]
  assert.equal(restoredMessage?.type, 'user/message')
  if (restoredMessage?.type === 'user/message') assert.equal(restoredMessage.data.content.length, 1)
  await store.dispose()
}))

test('缺少换行符的崩溃尾部会被截断，并持久化修复结果', async () => fixture(async root => {
  const store = await JsonlSessionStore.open(root)
  const created = await store.create('torn', '/workspace')
  created.session.append('turn/start', { turn: 1 }, 20)
  await store.flush(created.session)
  await store.close(created.session)
  await appendFile(store.pathFor('torn'), '{"kind":"event","half":')

  const resumed = await store.resume('torn')
  assert.equal(resumed.repair.repairedTornBytes, 23)
  assert.equal(resumed.repair.syntheticClosers, 1)
  assert.equal(resumed.session.events.at(-1)?.type, 'turn/end')
  await store.close(resumed.session)
  const second = await store.inspect('torn', true)
  assert.equal(second.repairedTornBytes, 0)
  assert.equal(second.syntheticClosers, 0)
  assert.doesNotMatch(await readFile(store.pathFor('torn'), 'utf8'), /"half"/)
}))

test('完整但校验和错误的记录属于已提交损坏，绝不自动截断', async () => fixture(async root => {
  const store = await JsonlSessionStore.open(root)
  const created = await store.create('corrupt', '/workspace')
  created.session.append('turn/start', { turn: 1 })
  await store.flush(created.session)
  await store.close(created.session)
  const path = store.pathFor('corrupt')
  const before = await readFile(path, 'utf8')
  await writeFile(path, before.replace('"turn":1', '"turn":9'))
  await assert.rejects(store.inspect('corrupt', true), /checksum 不匹配/)
  assert.equal(await readFile(path, 'utf8'), before.replace('"turn":1', '"turn":9'))
}))

test('恢复悬空工具调用时合成未知结果、步骤结束和已中断轮次结束事件', async () => fixture(async root => {
  const store = await JsonlSessionStore.open(root)
  const created = await store.create('tool-crash', '/workspace')
  created.session.append('turn/start', { turn: 1 }, 100)
  created.session.append('step/start', { turn: 1, step: 1 }, 101)
  const assistant = createMessage({
    role: 'assistant', source: { kind: 'model', provider: 'fake', model: 'm' },
    content: [{ type: 'tool-call', id: 'call-x', name: 'write', arguments: '{}' }],
  })
  created.session.append('assistant/message', { turn: 1, step: 1, message: assistant }, 102)
  created.session.append('tool/call', { turn: 1, step: 1, callId: 'call-x', name: 'write', arguments: '{}' }, 103)
  await store.flush(created.session)
  await store.close(created.session)

  const resumed = await store.resume('tool-crash')
  assert.deepEqual(resumed.session.events.slice(-3).map(event => event.type), ['tool/result', 'step/end', 'turn/end'])
  const result = resumed.session.events.find(event => event.type === 'tool/result')
  assert.equal(result?.data.error?.code, 'TOOL_OUTCOME_UNKNOWN')
  assert.equal(resumed.session.events.at(-1)?.time, 103)
  assert.equal(inspectLifecycle(resumed.session.events).status, 'idle')
  await store.dispose()
}))

test('恢复后智能体从下一个轮次编号继续运行', async () => fixture(async root => {
  const firstStore = await JsonlSessionStore.open(root)
  const created = await firstStore.create('continue', '/workspace')
  created.session.append('turn/start', { turn: 1 })
  created.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  await firstStore.flush(created.session)
  await firstStore.dispose()

  const secondStore = await JsonlSessionStore.open(root)
  const resumed = await secondStore.resume('continue')
  const runtime = new LlmRuntime()
  runtime.register('fake', new ScriptedLlmProvider([
    { type: 'text-delta', index: 0, text: 'continued' },
    { type: 'finish', reason: { kind: 'stop' } },
  ]))
  const agent = new HarnessAgent(resumed.session, runtime, { provider: 'fake', model: 'm' })
  agent.send('next')
  assert.equal((await agent.run())?.turn, 2)
  await secondStore.flush(resumed.session)
  await secondStore.dispose()

  const finalStore = await JsonlSessionStore.open(root)
  assert.deepEqual((await finalStore.inspect('continue')).events.filter(event => event.type === 'turn/start').map(event => event.data.turn), [1, 2])
}))

test('分叉在指定序号截断并补齐边界，随后与源日志独立增长', async () => fixture(async root => {
  const store = await JsonlSessionStore.open(root)
  const source = await store.create('source', '/workspace')
  source.session.append('turn/start', { turn: 1 }, 1)
  source.session.append('step/start', { turn: 1, step: 1 }, 2)
  source.session.append('assistant/message', {
    turn: 1, step: 1,
    message: createMessage({
      role: 'assistant', source: { kind: 'model', provider: 'fake', model: 'm' },
      content: [{ type: 'tool-call', id: 'not-started', name: 'read', arguments: '{}' }],
    }),
  }, 3)
  source.session.append('step/end', { turn: 1, step: 1 }, 4)
  source.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }, 5)
  await store.flush(source.session)

  const fork = await store.fork('source', 'branch', 2)
  assert.deepEqual(fork.header.parent, { sessionId: 'source', seq: 2 })
  assert.equal(fork.session.events.find(event => event.type === 'tool/result')?.data.error?.code, 'TOOL_NOT_STARTED')
  assert.equal(fork.session.events.at(-1)?.type, 'turn/end')
  fork.session.append('sandbox/mode', { mode: 'danger-full-access' })
  await store.flush(fork.session)
  assert.equal(source.session.events.some(event => event.type === 'sandbox/mode'), false)
  await store.dispose()

  const cold = await JsonlSessionStore.open(root)
  assert.equal((await cold.inspect('source')).events.length, 5)
  assert.equal((await cold.inspect('branch')).events.some(event => event.type === 'sandbox/mode'), true)
}))

test('危险会话标识被编码为根目录内的单个文件名，重复标识不会覆盖', async () => fixture(async root => {
  const store = await JsonlSessionStore.open(root)
  const dangerous = '../outside/session'
  const created = await store.create(dangerous, '/workspace')
  assert.equal(store.pathFor(dangerous).startsWith(`${store.root}/`), true)
  assert.doesNotMatch(store.pathFor(dangerous).slice(store.root.length + 1), /\//)
  await assert.rejects(store.create(dangerous, '/other'), /EEXIST/)
  await store.close(created.session)
  assert.equal((await store.inspect(dangerous)).header.cwd, '/workspace')
}))

test('刷盘是进程骤停前的持久化屏障', async () => fixture(async root => {
  const moduleUrl = pathToFileURL(join(process.cwd(), 'src/session-store.ts')).href
  const script = `
    import { JsonlSessionStore } from ${JSON.stringify(moduleUrl)};
    const store = await JsonlSessionStore.open(process.argv[1]);
    const { session } = await store.create('child-crash', '/workspace');
    session.append('turn/start', { turn: 1 }, 77);
    await store.flush(session);
    process.exit(0);
  `
  await execFileAsync(process.execPath, ['--input-type=module', '--eval', script, root])
  const store = await JsonlSessionStore.open(root)
  const resumed = await store.resume('child-crash')
  assert.equal(resumed.session.events[0]?.type, 'turn/start')
  const last = resumed.session.events.at(-1)
  assert.equal(last?.type, 'turn/end')
  if (last?.type === 'turn/end') assert.equal(last.data.reason.kind, 'interrupted')
  await store.dispose()
}))
