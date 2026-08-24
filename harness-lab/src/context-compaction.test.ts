import assert from 'node:assert/strict'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'bun:test'
import { compactRange, selectCompactableRange } from './compaction.ts'
import { createMessage } from './domain.ts'
import { deriveMessages, deriveSurface } from './projections.ts'
import { Session } from './session.ts'
import { LocalSpillStore, spillIfNeeded } from './spill-store.ts'
import { measureTokens, projectContextPressure } from './token-meter.ts'

function user(text: string) {
  return createMessage({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
}

function assistant(text: string) {
  return createMessage({
    role: 'assistant',
    source: { kind: 'model', provider: 'test', model: 'test' },
    content: [{ type: 'text', text }],
  })
}

test('词元计量器分别累计用量、模型可见面估算与下一请求压力', () => {
  const session = new Session()
  session.append('user/message', user('旧问题'))
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: assistant('旧答案'),
    usage: { inputTokens: 80, outputTokens: 20, cacheReadTokens: 10 },
  })
  session.append('user/message', user('新问题会立刻增加 projected，而 pressure 保持 provider 实测'))

  const measured = measureTokens(session.events)
  const pressure = projectContextPressure(session.events, 1_000)
  assert.equal(pressure.pressureTokens, 90)
  assert.ok((pressure.projectedTokens ?? 0) > 90)
  assert.equal(pressure.ratio, (pressure.projectedTokens ?? 0) / 1_000)
  assert.equal(measured.nodes.length, 3)
})

test('选择压缩区间不会切开工具调用与结果的原子组', () => {
  const session = new Session()
  session.append('user/message', user('a'.repeat(120)))
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      source: { kind: 'model', provider: 'test', model: 'test' },
      content: [{ type: 'tool-call', id: 'c1', name: 'read', arguments: '{}' }],
    }),
  })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    callId: 'c1',
    message: createMessage({
      role: 'user',
      source: { kind: 'tool', callId: 'c1' },
      content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }],
    }),
  })
  session.append('user/message', user('tail'.repeat(30)))

  const range = selectCompactableRange(session.events, 25)
  assert.deepEqual(range, { start: 0, end: 2 })
})

test('压缩只替换模型可见面，原日志保留且冷重放一致', async () => {
  const session = new Session()
  session.append('user/message', user('历史问题 '.repeat(40)))
  session.append('assistant/message', { turn: 1, step: 1, message: assistant('历史答案 '.repeat(40)) })
  session.append('user/message', user('最近问题'))
  const beforeCount = session.events.length

  const result = await compactRange(session, { start: 0, end: 1 }, {
    summarize: async () => '较短的历史摘要',
  })
  assert.equal(session.events.length, beforeCount + 4)
  assert.deepEqual(result.shadowedSeqs, [0, 1])
  assert.equal(deriveSurface(session.events).length, 2)
  const summaryBlock = deriveMessages(session.events)[0]?.content[0]
  assert.match(summaryBlock?.type === 'text' ? summaryBlock.text : '', /历史摘要/)

  const replayed = new Session(JSON.parse(JSON.stringify(session.events)))
  assert.deepEqual(deriveMessages(replayed.events), deriveMessages(session.events))
})

test('替换记录可以继续替换旧摘要，形成可重放压缩链', async () => {
  const session = new Session()
  session.append('user/message', user('第一段 '.repeat(50)))
  session.append('assistant/message', { turn: 1, step: 1, message: assistant('第二段 '.repeat(50)) })
  session.append('user/message', user('第三段 '.repeat(50)))
  await compactRange(session, { start: 0, end: 1 }, { summarize: async () => '第一次摘要 '.repeat(5) })
  const firstSummarySeq = deriveSurface(session.events)[0]?.seq
  assert.equal(typeof firstSummarySeq, 'number')
  await compactRange(session, { start: firstSummarySeq ?? -1, end: 2 }, {
    summarize: async () => '二次摘要',
  })
  assert.equal(deriveSurface(session.events).length, 1)
  const block = deriveMessages(session.events)[0]?.content[0]
  assert.match(block?.type === 'text' ? block.text : '', /二次摘要/)
})

test('压缩降低下一请求预计压力，但不改变历史用量', async () => {
  const session = new Session()
  session.append('user/message', user('旧输入 '.repeat(100)))
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: assistant('旧输出 '.repeat(100)),
    usage: { inputTokens: 500, outputTokens: 80 },
  })
  const before = projectContextPressure(session.events, 2_000)
  await compactRange(session, { start: 0, end: 1 }, { summarize: async () => '极短摘要' })
  const after = projectContextPressure(session.events, 2_000)
  assert.equal(after.pressureTokens, 500)
  assert.ok((after.projectedTokens ?? Infinity) < (before.projectedTokens ?? 0))
})

test('摘要失败只留下闭合的审计记录，不改变模型可见面', async () => {
  const session = new Session()
  session.append('user/message', user('很长内容 '.repeat(30)))
  const before = deriveMessages(session.events)
  await assert.rejects(compactRange(session, { start: 0, end: 0 }, {
    summarize: async () => { throw new Error('摘要器不可用') },
  }), /摘要器不可用/)
  assert.deepEqual(deriveMessages(session.events), before)
  assert.deepEqual(session.events.slice(-2).map(event => event.type), ['compaction/start', 'compaction/end'])
})

test('摘要不够小时拒绝写入替换记录', async () => {
  const session = new Session()
  session.append('user/message', user('short'))
  await assert.rejects(compactRange(session, { start: 0, end: 0 }, {
    summarize: async () => '比原内容长很多'.repeat(20),
  }), /摘要没有缩小上下文/)
  assert.equal(deriveSurface(session.events)[0]?.seq, 0)
})

test('溢出存储为大文本使用私有随机文件，并在读取时校验完整性', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-spill-'))
  const store = new LocalSpillStore(root)
  const result = await spillIfNeeded(store, {
    sessionId: '../danger',
    suggestedName: '../../result.txt',
    content: '秘密输出'.repeat(100),
  }, 32)
  assert.ok(result.ref)
  assert.match(result.modelText, /已落盘/)
  assert.equal(await store.readText(result.ref), '秘密输出'.repeat(100))
  assert.ok(result.ref.locator.startsWith(root))

  await chmod(result.ref.locator, 0o600)
  await writeFile(result.ref.locator, 'tampered', 'utf8')
  await assert.rejects(store.readText(result.ref), /完整性校验失败/)
})
