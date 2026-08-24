import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compactRange } from './compaction.ts'
import { createMessage } from './domain.ts'
import { deriveMessages, deriveSurface } from './projections.ts'
import { Session } from './session.ts'
import { LocalSpillStore, spillIfNeeded } from './spill-store.ts'
import { measureTokens, projectContextPressure } from './token-meter.ts'

const session = new Session()
const user = (text: string) => createMessage({
  role: 'user' as const,
  source: { kind: 'user' as const },
  content: [{ type: 'text' as const, text }],
})

session.append('user/message', user('早期问题 '.repeat(80)))
session.append('assistant/message', {
  turn: 1,
  step: 1,
  message: createMessage({
    role: 'assistant',
    source: { kind: 'model', provider: 'fake', model: 'debug' },
    content: [{ type: 'text', text: '早期回答 '.repeat(80) }],
  }),
  usage: { inputTokens: 800, outputTokens: 120, cacheReadTokens: 100 },
})
session.append('user/message', user('最近问题'))

console.log('压缩前模型可见面：', deriveSurface(session.events).map(event => event.seq))
console.log('压缩前估算：', measureTokens(session.events))
console.log('压缩前压力：', projectContextPressure(session.events, 4_096))

await compactRange(session, { start: 0, end: 1 }, {
  summarize: async messages => `已总结 ${messages.length} 条早期消息：讨论了一个历史问题。`,
})

console.log('压缩后模型可见面：', deriveSurface(session.events).map(event => event.seq))
console.log('模型可见消息：', deriveMessages(session.events).map(message => message.content))
console.log('压缩后压力：', projectContextPressure(session.events, 4_096))
console.table(session.events.map(event => ({ seq: event.seq, type: event.type, surfaceOp: JSON.stringify(event.surfaceOp ?? '-') })))

const root = await mkdtemp(join(tmpdir(), 'harness-context-demo-'))
try {
  const spilled = await spillIfNeeded(new LocalSpillStore(root), {
    sessionId: 'demo',
    suggestedName: 'tool-result.txt',
    content: '一段很大的工具结果。'.repeat(200),
  }, 128)
  console.log('模型收到：', spilled.modelText)
  console.log('溢出存储引用：', spilled.ref)
} finally {
  await rm(root, { recursive: true, force: true })
}
