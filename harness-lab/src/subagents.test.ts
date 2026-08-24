import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { LocalJobRegistry } from './jobs.ts'
import { InProcessSubagentProvider, SubagentError, SubagentRuntime } from './subagents.ts'
import type { SubagentProvider } from './subagents.ts'

const baseRequest = (signal = new AbortController().signal) => ({
  prompt: [{ type: 'text' as const, text: 'research' }],
  parentSession: 'parent-1', parentDepth: 0, signal,
})

test('发布成功后，开始与结束事件按运行标识唯一配对', async () => {
  const runtime = new SubagentRuntime()
  runtime.register(new InProcessSubagentProvider('inproc', async request => ({
    output: [{ type: 'text', text: `depth=${request.depth}` }], stopReason: 'completed',
  })))
  const events: { type: string; runId: string }[] = []
  runtime.onLifecycle(event => events.push(event))
  const run = await runtime.start('inproc', baseRequest())
  assert.deepEqual(await run.result, { output: [{ type: 'text', text: 'depth=1' }], stopReason: 'completed' })
  await run.dispose()
  assert.deepEqual(events.map(event => event.type), ['start', 'end'])
  assert.equal(events[0]?.runId, events[1]?.runId)
  assert.equal(runtime.active().length, 0)
})

test('能力和深度校验在提供方启动前明确失败', async () => {
  const runtime = new SubagentRuntime()
  let starts = 0
  const provider: SubagentProvider = {
    name: 'limited',
    capabilities: { outputSchema: false, depthLimit: true, toolFilter: false, persona: false },
    available: () => true,
    start: async () => { starts += 1; throw new Error('不应调用') },
  }
  runtime.register(provider)
  await assert.rejects(runtime.start('limited', { ...baseRequest(), outputSchema: { type: 'object' } }),
    (error: unknown) => error instanceof SubagentError && error.code === 'SUBAGENT_CAPABILITY_UNSUPPORTED')
  await assert.rejects(runtime.start('limited', { ...baseRequest(), parentDepth: 2, maxDepth: 2 }),
    (error: unknown) => error instanceof SubagentError && error.code === 'SUBAGENT_DEPTH_LIMIT')
  assert.equal(starts, 0)
})

test('取消传播到子智能体，结果拒绝被归一化且仍产生结束事件', async () => {
  const runtime = new SubagentRuntime()
  runtime.register(new InProcessSubagentProvider('inproc', async (_request, signal) => {
    await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    return { output: [], stopReason: 'completed' }
  }))
  const events: string[] = []
  runtime.onLifecycle(event => events.push(`${event.type}:${event.type === 'end' ? event.stopReason : ''}`))
  const run = await runtime.start('inproc', baseRequest())
  run.cancel('stop')
  assert.equal((await run.result).stopReason, 'aborted')
  await run.dispose()
  assert.deepEqual(events, ['start:', 'end:aborted'])
})

test('提供方发布失败时不伪造生命周期开始事件', async () => {
  const runtime = new SubagentRuntime()
  runtime.register({
    name: 'broken', capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    available: () => true, start: async () => { throw new Error('握手失败') },
  })
  const events: string[] = []
  runtime.onLifecycle(event => events.push(event.type))
  await assert.rejects(runtime.start('broken', baseRequest()), /握手失败/)
  assert.deepEqual(events, [])
})

test('子智能体可作为所有者私有后台任务启动、汇合并读取最终输出', async () => {
  const runtime = new SubagentRuntime()
  runtime.register(new InProcessSubagentProvider('inproc', async () => ({
    output: [{ type: 'text', text: 'child answer' }], stopReason: 'completed',
  })))
  const jobs = new LocalJobRegistry()
  jobs.attachController()
  const id = runtime.startJob(jobs, 'inproc', {
    label: 'research', prompt: [{ type: 'text', text: 'go' }], parentSession: 'parent-1', parentDepth: 0,
  })
  assert.equal((await jobs.wait(id, 100, 'parent-1')).status, 'completed')
  assert.equal(jobs.read(id, 'parent-1').text, 'child answer')
})
