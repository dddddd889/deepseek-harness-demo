import assert from 'node:assert/strict'
import { test } from 'bun:test'
import type { LlmProvider } from './llm.ts'
import { BlockAssembler, LlmRuntime, ScriptedLlmProvider } from './llm.ts'
import { runModelStep } from './model-step.ts'
import { foldTokenUsage, inspectLifecycle } from './projections.ts'
import { Session } from './session.ts'

const request = { provider: 'fake', model: 'debug-model', messages: [] } as const

test('内容块组装器按首次索引顺序组装可交错的文本与工具参数', () => {
  const assembler = new BlockAssembler()
  assembler.push({ type: 'block-start', index: 0, blockType: 'text' })
  assembler.push({ type: 'text-delta', index: 0, text: '先' })
  assembler.push({ type: 'tool-call-delta', index: 1, id: 'c1', name: 'sum', argumentsDelta: '{"a":' })
  assembler.push({ type: 'text-delta', index: 0, text: '算' })
  assembler.push({ type: 'tool-call-delta', index: 1, id: 'c1', argumentsDelta: '1}' })
  assert.deepEqual(assembler.blocks(), [
    { type: 'text', text: '先算' },
    { type: 'tool-call', id: 'c1', name: 'sum', arguments: '{"a":1}' },
  ])
})

test('大模型运行时把提供方裸异常转换成唯一错误终止帧', async () => {
  const runtime = new LlmRuntime()
  const broken: LlmProvider = {
    async *stream() {
      yield { type: 'text-delta', index: 0, text: '半截' }
      throw new Error('连接断开')
    },
  }
  runtime.register('fake', broken)
  const chunks = []
  for await (const chunk of runtime.stream(request, new AbortController().signal)) chunks.push(chunk)
  assert.equal(chunks.length, 2)
  assert.deepEqual(chunks[1], {
    type: 'finish', reason: { kind: 'error', failure: { code: 'PROVIDER_ERROR', message: '连接断开' } },
  })
})

test('取消等待中的提供方会快速得到取消终止帧', async () => {
  const runtime = new LlmRuntime()
  runtime.register('fake', new ScriptedLlmProvider([{ type: 'text-delta', index: 0, text: '不会到达' }], 1_000))
  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error('用户停止')), 10)
  const chunks = []
  for await (const chunk of runtime.stream(request, controller.signal)) chunks.push(chunk)
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0]?.type, 'finish')
  if (chunks[0]?.type === 'finish') assert.equal(chunks[0].reason.kind, 'aborted')
})

test('模型步骤逐数据块落账，并把最终用量与消息写入会话', async () => {
  const runtime = new LlmRuntime()
  runtime.register('fake', new ScriptedLlmProvider([
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '你好' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '你好' } },
    { type: 'usage', usage: { inputTokens: 8, outputTokens: 2 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]))
  const session = new Session()
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const result = await runModelStep(runtime, session, 1, 1, request, new AbortController().signal)
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  assert.equal(result.finish.kind, 'stop')
  assert.deepEqual(result.message?.content, [{ type: 'text', text: '你好' }])
  assert.equal(session.events.filter(event => event.type === 'assistant/chunk').length, 5)
  assert.deepEqual(foldTokenUsage(session.events), {
    inputTokens: 8, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0,
  })
  assert.equal(inspectLifecycle(session.events).status, 'idle')
})

test('失败流保留原始数据块，但不伪造助手消息', async () => {
  const runtime = new LlmRuntime()
  runtime.register('fake', {
    async *stream() { throw new Error('上游 503') },
  })
  const session = new Session()
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const result = await runModelStep(runtime, session, 1, 1, request, new AbortController().signal)
  assert.equal(result.finish.kind, 'error')
  assert.equal(session.events.some(event => event.type === 'assistant/message'), false)
  assert.equal(session.events.filter(event => event.type === 'assistant/chunk').length, 1)
})
