import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Questions } from './questions.mjs'
import { startDemo } from './server.mjs'

/** 每个测试使用新的登记簿和取消信号，直接检查问题身份与生命周期。 */
function fixture() {
  const events = [], controller = new AbortController(), questions = new Questions(event => events.push(event))
  return { events, controller, questions }
}
const single = { kind: 'single', title: '数据库', options: [{ id: 'sqlite', label: 'SQLite' }, { id: 'pg', label: 'PostgreSQL' }] }

test('单选校验归属与选项，错误回答不消费，重复答复拒绝', async () => {
  const { events, controller, questions } = fixture(), waiting = questions.request('s1', single, controller.signal)
  const id = events[0].id
  assert.throws(() => questions.answer('s2', id, { status: 'answered', value: 'sqlite' }), /不属于/)
  assert.throws(() => questions.answer('s1', id, { status: 'answered', value: 'unknown' }), /有效选项/)
  assert.equal(questions.pending.size, 1)
  questions.answer('s1', id, { status: 'answered', value: 'sqlite' })
  assert.deepEqual(await waiting, { status: 'answered', value: 'sqlite' })
  assert.equal(questions.pending.size, 0)
  assert.throws(() => questions.answer('s1', id, { status: 'answered', value: 'pg' }), /不存在/)
})

test('多选与文本分别校验，保持结构化答案', async () => {
  const { events, controller, questions } = fixture()
  const multiple = questions.request('s', { ...single, kind: 'multiple' }, controller.signal)
  assert.throws(() => questions.answer('s', events[0].id, { status: 'answered', value: ['pg', 'pg'] }), /不重复/)
  questions.answer('s', events[0].id, { status: 'answered', value: ['sqlite', 'pg'] })
  assert.deepEqual((await multiple).value, ['sqlite', 'pg'])
  const text = questions.request('s', { kind: 'text', title: '名称' }, controller.signal), id = events.at(-1).id
  assert.throws(() => questions.answer('s', id, { status: 'answered', value: ' ' }), /文本/)
  questions.answer('s', id, { status: 'answered', value: '我的项目' })
  assert.equal((await text).value, '我的项目')
})

test('取消问答、取消任务、超时互相区分，并清理等待', async () => {
  const { events, controller, questions } = fixture()
  const cancelled = questions.request('s', single, controller.signal)
  questions.answer('s', events[0].id, { status: 'cancelled' })
  assert.deepEqual(await cancelled, { status: 'cancelled' })
  const expired = questions.request('s', single, controller.signal, 5)
  assert.deepEqual(await expired, { status: 'timed_out' })
  const aborted = questions.request('s', single, controller.signal)
  controller.abort()
  await assert.rejects(aborted, /任务已取消/)
  assert.equal(questions.pending.size, 0)
})

test('发布时同步回答不丢失，发布失败清理等待', async () => {
  const q = new Questions(event => { if (event.type === 'question/request') q.answer('s', event.id, { status: 'answered', value: 'sqlite' }) })
  assert.equal((await q.request('s', single, new AbortController().signal)).value, 'sqlite')
  const broken = new Questions(() => { throw Error('发布失败') })
  await assert.rejects(broken.request('s', single, new AbortController().signal), /发布失败/)
  assert.equal(broken.pending.size, 0)
})

test('真实HTTP启动任务、提交答案并观察调用方继续', async () => {
  const app = startDemo(), base = app.server.url
  const post = (path, body) => fetch(new URL(path, base), { method: 'POST', headers: { origin: base.origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    assert.equal((await post('/tasks', { kind: 'single' })).status, 202)
    const state = await (await fetch(new URL('/state', base))).json()
    assert.equal(state.running, true)
    assert.equal((await post('/answer', { id: state.question.id, answer: { status: 'answered', value: 'sqlite' } })).status, 200)
    const finished = await (await fetch(new URL('/state', base))).json()
    assert.equal(finished.running, false)
    assert.equal(finished.result.answer.value, 'sqlite')
    assert.equal((await post('/answer', { id: state.question.id, answer: { status: 'answered', value: 'pg' } })).status, 400)
  } finally { await app.close() }
})
