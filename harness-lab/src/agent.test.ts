import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { HarnessAgent } from './agent.ts'
import { LlmRuntime, ScriptedLlmProvider } from './llm.ts'
import { deriveMessages, inspectLifecycle } from './projections.ts'
import { Session } from './session.ts'

/** 构造一个输出指定终止原因的运行时。 */
function runtimeWithFinish(kind: 'stop' | 'tool-calls' | 'max-tokens', delay = 0): LlmRuntime {
  const runtime = new LlmRuntime()
  runtime.register('fake', new ScriptedLlmProvider([
    { type: 'text-delta', index: 0, text: '回答' },
    { type: 'usage', usage: { inputTokens: 2, outputTokens: 1 } },
    { type: 'finish', reason: { kind } },
  ], delay))
  return runtime
}

test('智能体原子认领收件箱，并生成完整轮次与步骤日志', async () => {
  const session = new Session()
  const agent = new HarnessAgent(session, runtimeWithFinish('stop'), { provider: 'fake', model: 'm' })
  agent.send('第一条')
  agent.send('第二条')
  const statuses: string[] = []
  agent.onStatus(status => statuses.push(status))
  const result = await agent.run()

  assert.equal(result?.reason.kind, 'completed')
  assert.deepEqual(statuses, ['running', 'idle'])
  assert.equal(agent.pendingMessages, 0)
  assert.deepEqual(session.events.map(event => event.type), [
    'turn/start', 'user/message', 'user/message', 'step/start', 'request/header',
    'assistant/chunk', 'assistant/chunk', 'assistant/chunk', 'assistant/message', 'step/end', 'turn/end',
  ])
  assert.equal(deriveMessages(session.events).length, 3)
  assert.equal(inspectLifecycle(session.events).status, 'idle')
})

test('没有收件箱输入时，运行操作不产生副作用', async () => {
  const session = new Session()
  const agent = new HarnessAgent(session, runtimeWithFinish('stop'), { provider: 'fake', model: 'm' })
  assert.equal(await agent.run(), undefined)
  assert.equal(session.events.length, 0)
})

test('并发运行被拒绝，新输入留给下一个轮次', async () => {
  const session = new Session()
  const agent = new HarnessAgent(session, runtimeWithFinish('stop', 20), { provider: 'fake', model: 'm' })
  agent.send('turn 1')
  const first = agent.run()
  agent.send('turn 2')
  await assert.rejects(agent.run(), /禁止并发/)
  assert.equal((await first)?.turn, 1)
  assert.equal((await agent.run())?.turn, 2)
})

test('取消被写成已取消的轮次结束事件，生命周期仍闭合', async () => {
  const session = new Session()
  const agent = new HarnessAgent(session, runtimeWithFinish('stop', 1_000), { provider: 'fake', model: 'm' })
  agent.send('慢请求')
  const running = agent.run()
  setTimeout(() => agent.cancel(), 10)
  const result = await running
  assert.equal(result?.reason.kind, 'aborted')
  assert.equal(inspectLifecycle(session.events).status, 'idle')
})

test('未知提供方错误成为错误轮次结束事件', async () => {
  const session = new Session()
  const agent = new HarnessAgent(session, new LlmRuntime(), { provider: 'missing', model: 'm' })
  agent.send('请求')
  const result = await agent.run()
  assert.equal(result?.reason.kind, 'error')
  if (result?.reason.kind === 'error') assert.equal(result.reason.error.code, 'UNKNOWN_PROVIDER')
})

test('尚未接入工具管线时，工具调用明确结束为阻塞', async () => {
  const session = new Session()
  const agent = new HarnessAgent(session, runtimeWithFinish('tool-calls'), { provider: 'fake', model: 'm' })
  agent.send('调用工具')
  assert.equal((await agent.run())?.reason.kind, 'blocked')
})
