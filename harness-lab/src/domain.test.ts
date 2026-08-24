import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { assertNever, createMessage, type SessionEvent, type StreamChunk } from './domain.ts'
import { assertJsonValue } from './json.ts'
import { Session } from './session.ts'

test('消息生成稳定身份并与调用方对象隔离', () => {
  const content = [{ type: 'text' as const, text: '你好' }]
  const message = createMessage({ role: 'user', content, source: { kind: 'user' } })
  content[0]!.text = '调用方后来修改'

  assert.match(message.id, /^[0-9a-f-]{36}$/)
  assert.equal(message.content[0]?.type, 'text')
  assert.deepEqual(message.content, [{ type: 'text', text: '你好' }])
  assert.ok(Object.isFrozen(message))
  assert.ok(Object.isFrozen(message.content))
})

test('Session 分配连续 seq，事件可以无损 JSON 往返', () => {
  const session = new Session()
  session.append('turn/start', { turn: 1 }, 100)
  session.append('step/start', { turn: 1, step: 1 }, 101)
  session.append('assistant/chunk', {
    turn: 1,
    step: 1,
    chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 7 } },
  }, 102)

  assert.deepEqual(session.events.map(event => event.seq), [0, 1, 2])
  assert.deepEqual(JSON.parse(JSON.stringify(session.events)), session.events)
})

test('恢复拒绝 seq 缺口，避免从残缺历史继续运行', () => {
  const broken = [
    { type: 'turn/start', seq: 0, time: 100, data: { turn: 1 } },
    { type: 'turn/end', seq: 2, time: 101, data: { turn: 1, reason: { kind: 'completed' } } },
  ] as SessionEvent[]
  assert.throws(() => new Session(broken), /期望 1，得到 2/)
})

test('JSON 边界拒绝静默丢失或改变含义的数据', () => {
  assert.throws(() => assertJsonValue({ value: undefined }), /不是 JSON 值/)
  assert.throws(() => assertJsonValue({ value: Number.NaN }), /有限数字/)
  assert.throws(() => assertJsonValue({ value: 1n }), /不是 JSON 值/)
  assert.throws(() => assertJsonValue({ value: new Date() }), /普通对象/)
  const cyclic: { self?: unknown } = {}
  cyclic.self = cyclic
  assert.throws(() => assertJsonValue(cyclic), /循环引用/)
})

test('StreamChunk 消费者可以按标签处理全部当前变体', () => {
  const describe = (chunk: StreamChunk): string => {
    switch (chunk.type) {
      case 'block-start': return `开始:${chunk.blockType}`
      case 'text-delta': return `文本:${chunk.text}`
      case 'reasoning-delta': return `推理:${chunk.text}`
      case 'tool-call-delta': return `工具:${chunk.id}`
      case 'block-end': return `块:${chunk.block.type}`
      case 'usage': return `输出:${chunk.usage.outputTokens}`
      case 'finish': return `结束:${chunk.reason.kind}`
      default: return assertNever(chunk)
    }
  }

  assert.equal(describe({ type: 'finish', reason: { kind: 'stop' } }), '结束:stop')
})
