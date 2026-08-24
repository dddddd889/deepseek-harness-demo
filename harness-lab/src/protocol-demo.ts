import { createMessage } from './domain.ts'
import { Session } from './session.ts'

const session = new Session()
const message = createMessage({
  role: 'user',
  source: { kind: 'user' },
  content: [{ type: 'text', text: '请解释这个仓库' }],
})

session.append('turn/start', { turn: 1 }, 1000)
session.append('user/message', message, 1001)
session.append('step/start', { turn: 1, step: 1 }, 1002)
session.append('request/header', {
  reason: 'initial',
  header: { provider: 'mock', model: 'echo-1', system: '你是一个编程助手。' },
}, 1003)
session.append('assistant/chunk', {
  turn: 1,
  step: 1,
  chunk: { type: 'text-delta', index: 0, text: '这是一个 Harness 仓库。' },
}, 1004)
session.append('assistant/chunk', {
  turn: 1,
  step: 1,
  chunk: { type: 'usage', usage: { inputTokens: 12, outputTokens: 6 } },
}, 1005)

console.log(JSON.stringify(session.events, null, 2))

