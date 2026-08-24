import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { HarnessAgent } from './agent.ts'
import type { StreamChunk, ToolCallBlock, ToolDefinition } from './domain.ts'
import type { GenerateOptions, LlmProvider } from './llm.ts'
import { LlmRuntime } from './llm.ts'
import { inspectLifecycle } from './projections.ts'
import { Session } from './session.ts'
import { executeToolCalls } from './tool-execution.ts'
import { ToolRegistry } from './tools.ts'

const sumTool: ToolDefinition = {
  name: 'sum',
  description: '两数相加',
  parameters: {
    type: 'object', required: ['a', 'b'], additionalProperties: false,
    properties: { a: { type: 'number' }, b: { type: 'number' } },
  },
  async execute(args) {
    if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('参数未收窄')
    return Number(args.a) + Number(args.b)
  },
}

/** 提供逐请求脚本，便于验证工具结果确实进入下一模型请求。 */
class QueueProvider implements LlmProvider {
  readonly requests: GenerateOptions[] = []
  readonly #responses: readonly (readonly StreamChunk[])[]
  #index = 0

  constructor(responses: readonly (readonly StreamChunk[])[]) { this.#responses = responses }

  async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    this.requests.push(options)
    const response = this.#responses[this.#index++]
    if (!response) throw new Error('没有下一段模型脚本')
    for (const chunk of response) yield chunk
  }
}

test('注册表在执行前拒绝损坏的 JSON、缺失字段和额外字段', async () => {
  let executions = 0
  const registry = new ToolRegistry()
  registry.register({ ...sumTool, async execute(args, signal) { executions += 1; return sumTool.execute(args, signal) } })
  const invalid = [
    { type: 'tool-call', id: 'c1', name: 'sum', arguments: '{bad' },
    { type: 'tool-call', id: 'c2', name: 'sum', arguments: '{"a":1}' },
    { type: 'tool-call', id: 'c3', name: 'sum', arguments: '{"a":1,"b":2,"c":3}' },
  ] as const satisfies readonly ToolCallBlock[]
  const session = new Session()
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  await executeToolCalls(registry, session, 1, 1, invalid, new AbortController().signal)
  assert.equal(executions, 0)
  assert.deepEqual(session.events.filter(event => event.type === 'tool/result').map(event => event.data.error?.code), [
    'INVALID_ARGUMENTS', 'INVALID_ARGUMENTS', 'INVALID_ARGUMENTS',
  ])
})

test('未知工具和工具异常都归一为关联的工具结果', async () => {
  const registry = new ToolRegistry()
  registry.register({
    name: 'explode', description: '失败', parameters: { type: 'object' },
    async execute() { throw new TypeError('模拟爆炸') },
  })
  const session = new Session()
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  await executeToolCalls(registry, session, 1, 1, [
    { type: 'tool-call', id: 'unknown-1', name: 'missing', arguments: '{}' },
    { type: 'tool-call', id: 'explode-1', name: 'explode', arguments: '{}' },
  ], new AbortController().signal)
  const results = session.events.filter(event => event.type === 'tool/result')
  assert.deepEqual(results.map(event => event.data.error?.code), ['UNKNOWN_TOOL', 'TOOL_EXECUTION_FAILED'])
  assert.deepEqual(results.map(event => event.data.callId), ['unknown-1', 'explode-1'])
})

test('相邻并行工具重叠执行，但结果仍按模型顺序提交', async () => {
  const registry = new ToolRegistry()
  let active = 0
  let maximumActive = 0
  for (const name of ['p1', 'p2']) {
    registry.register({
      name, description: name, parameters: { type: 'object' }, isConcurrencySafe: () => true,
      async execute() {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise(resolve => setTimeout(resolve, name === 'p1' ? 20 : 5))
        active -= 1
        return name
      },
    })
  }
  const session = new Session()
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  await executeToolCalls(registry, session, 1, 1, [
    { type: 'tool-call', id: '1', name: 'p1', arguments: '{}' },
    { type: 'tool-call', id: '2', name: 'p2', arguments: '{}' },
  ], new AbortController().signal)
  assert.equal(maximumActive, 2)
  assert.deepEqual(session.events.filter(event => event.type === 'tool/result').map(event => event.data.callId), ['1', '2'])
})

test('独占工具在前后并行组之间形成屏障', async () => {
  const registry = new ToolRegistry()
  const order: string[] = []
  for (const [name, parallel] of [['p1', true], ['exclusive', false], ['p2', true]] as const) {
    registry.register({
      name, description: name, parameters: { type: 'object' }, isConcurrencySafe: () => parallel,
      async execute() {
        order.push(`${name}:start`)
        await new Promise(resolve => setTimeout(resolve, 2))
        order.push(`${name}:end`)
        return name
      },
    })
  }
  const session = new Session()
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  await executeToolCalls(registry, session, 1, 1, ['p1', 'exclusive', 'p2'].map((name, index) => ({
    type: 'tool-call', id: String(index), name, arguments: '{}',
  })), new AbortController().signal)
  assert.deepEqual(order, ['p1:start', 'p1:end', 'exclusive:start', 'exclusive:end', 'p2:start', 'p2:end'])
})

test('智能体执行工具后自动进入下一步骤，模型能看到工具结果', async () => {
  const provider = new QueueProvider([
    [
      { type: 'tool-call-delta', index: 0, id: 'sum-1', name: 'sum', argumentsDelta: '{"a":2,"b":3}' },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ],
    [
      { type: 'text-delta', index: 0, text: '结果是 5' },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  ])
  const runtime = new LlmRuntime()
  runtime.register('fake', provider)
  const registry = new ToolRegistry()
  registry.register(sumTool)
  const session = new Session()
  const agent = new HarnessAgent(session, runtime, { provider: 'fake', model: 'm' }, registry)
  agent.send('2+3')
  const result = await agent.run()

  assert.equal(result?.reason.kind, 'completed')
  assert.equal(provider.requests.length, 2)
  assert.equal(provider.requests[0]?.tools?.[0]?.name, 'sum')
  assert.equal(provider.requests[1]?.messages.some(message => message.source.kind === 'tool'), true)
  assert.deepEqual(session.events.filter(event => event.type === 'step/start').map(event => event.data.step), [1, 2])
  assert.deepEqual(session.events.filter(event => event.type === 'tool/result').map(event => event.data.callId), ['sum-1'])
  assert.equal(inspectLifecycle(session.events).status, 'idle')
})

test('最大步骤数防止模型无限调用工具', async () => {
  const loop: StreamChunk[] = [
    { type: 'tool-call-delta', index: 0, id: 'sum-loop', name: 'sum', argumentsDelta: '{"a":1,"b":1}' },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
  const provider = new QueueProvider([loop, loop])
  const runtime = new LlmRuntime()
  runtime.register('fake', provider)
  const registry = new ToolRegistry()
  registry.register(sumTool)
  const session = new Session()
  const agent = new HarnessAgent(session, runtime, { provider: 'fake', model: 'm', maxSteps: 2 }, registry)
  agent.send('循环')
  const result = await agent.run()
  assert.equal(result?.reason.kind, 'error')
  if (result?.reason.kind === 'error') assert.equal(result.reason.error.code, 'MAX_STEPS')
  assert.equal(inspectLifecycle(session.events).status, 'idle')
})

test('取消会等待协作式工具收尾，记录工具取消错误后闭合轮次', async () => {
  const provider = new QueueProvider([[
    { type: 'tool-call-delta', index: 0, id: 'slow-1', name: 'slow', argumentsDelta: '{}' },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]])
  const runtime = new LlmRuntime()
  runtime.register('fake', provider)
  const registry = new ToolRegistry()
  registry.register({
    name: 'slow', description: '等待取消', parameters: { type: 'object' },
    async execute(_args, signal) {
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      return null
    },
  })
  const session = new Session()
  const agent = new HarnessAgent(session, runtime, { provider: 'fake', model: 'm' }, registry)
  agent.send('取消工具')
  const running = agent.run()
  setTimeout(() => agent.cancel(new Error('停止工具')), 10)
  const result = await running
  assert.equal(result?.reason.kind, 'aborted')
  const toolResult = session.events.find(event => event.type === 'tool/result')
  assert.equal(toolResult?.data.error?.code, 'TOOL_ABORTED')
  assert.equal(inspectLifecycle(session.events).status, 'idle')
})
