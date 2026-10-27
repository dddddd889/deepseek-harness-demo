import assert from 'node:assert/strict'
import { Collaboration } from './collaboration.mjs'
import { Events } from './events.mjs'
import { messages } from './projection.mjs'

// 只演示记录与读取；默认Events在内存保存，不写磁盘、不运行模型或登录测试。
const session = new Events()
const collaboration = new Collaboration(session) // 包装同一份事件集合，不另存一张永久状态表。

// 聊天消息是固定样本，供messages投影选择；这里没有调用Agent或模型。
session.append('message/user', { role: 'user', content: '请修复登录问题' })
collaboration.set('todo', { id: 'login-tests', text: '补登录测试', status: 'doing', note: '演示中的阶段说明' })
collaboration.set('todo', { id: 'login-tests', text: '补登录测试', status: 'done' })
const reply = session.append('message/assistant', { role: 'assistant', content: '已记录你的登录问题。' }) // 返回真实事件编号。
collaboration.feedback(reply.seq, 'up', '这个解释清楚') // 点赞关联这条消息，不另造用户聊天输入。

const events = session.read() // 完整事实：两条聊天、两条状态、一条反馈。
const latestTodo = collaboration.state('todo') // 同id后写的整份对象覆盖旧对象，不合并字段。
const rebuiltTodo = new Collaboration(session).state('todo') // 在同一事件集合上换一个读取对象。
const modelMessages = messages(events) // 只选message/user、message/assistant、message/tool。
const feedback = events.find(event => event.type === 'feedback').data // 反馈读完整事件，state不负责反馈投影。

assert.equal(events.length, 5)
assert.deepEqual(events.filter(event => event.type === 'collaboration/todo').map(event => event.data.status), ['doing', 'done'])
assert.deepEqual(latestTodo, { 'login-tests': { id: 'login-tests', text: '补登录测试', status: 'done' } })
assert.equal(Object.hasOwn(latestTodo['login-tests'], 'note'), false) // 后一份对象没写note，旧note不会留下。
assert.deepEqual(rebuiltTodo, latestTodo)
assert.deepEqual(modelMessages, [
  { role: 'user', content: '请修复登录问题' },
  { role: 'assistant', content: '已记录你的登录问题。' },
])
assert.equal(feedback.messageSeq, reply.seq)

// 这是本例实际计算出的报告；状态和反馈仍在events里，只是不自动进入模型消息投影。
console.log(JSON.stringify({ storage: 'memory', modelRequested: false, eventCount: events.length,
  events, eventTypes: events.map(event => event.type), latestTodo, sameStateAfterRebuild: true,
  feedback, modelMessages }, null, 2))
