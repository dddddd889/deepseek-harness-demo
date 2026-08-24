import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { createMessage } from './domain.ts'
import type { Message, SessionEvent, TokenUsage } from './domain.ts'
import { deriveMessages, foldTokenUsage, inspectLifecycle } from './projections.ts'
import { Session } from './session.ts'

const usage1: TokenUsage = { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3 }
const usage2: TokenUsage = { inputTokens: 12, outputTokens: 4, reasoningTokens: 1 }

/** 创建测试消息，显式 id 让日志重放断言保持确定性。 */
function message(id: string, role: Message['role'], text: string): Message {
  return createMessage({ role, content: text ? [{ type: 'text', text }] : [], source: { kind: 'user' } }) as Message & { id: string }
}

/** 构造一段包含模型流与工具调用的完整事实日志。 */
function completedLog(): Session {
  const session = new Session()
  const user = message('user-1', 'user', '计算')
  const assistant = message('assistant-1', 'assistant', '调用工具')
  const tool = message('tool-1', 'user', '42')
  session.append('turn/start', { turn: 1 })
  session.append('user/message', user)
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '调用' } })
  session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: usage1 } })
  session.append('assistant/message', { turn: 1, step: 1, message: assistant, usage: usage2 })
  session.append('tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'calculator', arguments: '{"x":42}' })
  session.append('tool/result', { turn: 1, step: 1, callId: 'call-1', message: tool })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return session
}

test('消息投影忽略 chunk，并保留事件里已有的消息身份', () => {
  const session = completedLog()
  const messages = deriveMessages(session.events)
  assert.equal(messages.length, 3)
  assert.equal(messages[0], session.events[1]?.data)
  assert.equal(messages[1], (session.events[5] as SessionEvent<'assistant/message'>).data.message)
  assert.equal(messages[2], (session.events[7] as SessionEvent<'tool/result'>).data.message)
})

test('空 assistant 消息只承载 usage，不进入模型历史', () => {
  const session = new Session()
  session.append('assistant/message', { turn: 1, step: 1, message: message('empty', 'assistant', ''), usage: usage1 })
  assert.deepEqual(deriveMessages(session.events), [])
})

test('同一 turn/step 的最终 usage 覆盖流式样本，不重复计费', () => {
  const session = completedLog()
  session.append('assistant/message', { turn: 1, step: 2, message: message('a2', 'assistant', ''), usage: usage1 })
  assert.deepEqual(foldTokenUsage(session.events), {
    inputTokens: 22,
    outputTokens: 6,
    cacheReadTokens: 3,
    cacheWriteTokens: 0,
    reasoningTokens: 1,
  })
})

test('生命周期投影可判断日志已经完整结束', () => {
  assert.deepEqual(inspectLifecycle(completedLog().events), {
    status: 'idle', turns: 1, steps: 1, openTurn: null, openStep: null, pendingToolCalls: [],
  })
})

test('生命周期损坏时错误指向具体 seq', () => {
  const session = new Session()
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('tool/result', { turn: 1, step: 1, callId: 'missing', message: message('bad', 'user', 'x') })
  assert.throws(() => inspectLifecycle(session.events), /seq=2.*找不到工具调用 missing/)
})

test('序列化恢复后所有投影保持一致', () => {
  const original = completedLog()
  const restored = new Session(JSON.parse(JSON.stringify(original.events)) as SessionEvent[])
  assert.deepEqual(deriveMessages(restored.events), deriveMessages(original.events))
  assert.deepEqual(foldTokenUsage(restored.events), foldTokenUsage(original.events))
  assert.deepEqual(inspectLifecycle(restored.events), inspectLifecycle(original.events))
})
