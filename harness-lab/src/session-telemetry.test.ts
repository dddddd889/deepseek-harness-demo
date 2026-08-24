import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { Session } from './session.ts'
import { MemoryTelemetrySink, SessionTelemetry } from './session-telemetry.ts'

test('full 模式只导出每个 step 的首个 chunk，并允许脱敏', async () => {
  const session = new Session()
  const sink = new MemoryTelemetrySink()
  const telemetry = new SessionTelemetry('s-1', session, sink, 'full', (record) => ({ ...record, body: '[redacted]' }))
  session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'secret' } }, 10)
  session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'more' } }, 11)
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }, 12)

  assert.equal(sink.records.length, 2)
  assert.equal(sink.records[0]?.body, '[redacted]')
  assert.equal(telemetry.handedOffThrough, 2)
  await telemetry.close()
})

test('导出失败被隔离，Session 仍可继续 append', async () => {
  const warnings: string[] = []
  const session = new Session()
  const telemetry = new SessionTelemetry('s-2', session, new MemoryTelemetrySink(0), 'full', undefined, (message) => warnings.push(message))
  session.append('turn/start', { turn: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.equal(session.events.length, 2)
  assert.equal(warnings.length, 2)
  await telemetry.close()
})

test('feedback-only 只在提交反馈后导出该记录', async () => {
  const session = new Session()
  const sink = new MemoryTelemetrySink()
  const telemetry = new SessionTelemetry('s-3', session, sink, 'feedback-only')
  session.append('user/message', { id: 'm', role: 'user', content: [{ type: 'text', text: 'private' }], source: { kind: 'user' } })
  session.append('feedback/record', { score: 'down', comment: 'bad tool choice' })
  assert.deepEqual(sink.records.map((record) => record.attributes['event.type']), ['feedback/record'])
  await telemetry.close()
})
