import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { JobError, LocalJobRegistry } from './jobs.ts'
import type { JobOutcome } from './jobs.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('有所有者的后台任务需要控制器，启动器失败不消耗标识', () => {
  const jobs = new LocalJobRegistry()
  assert.throws(() => jobs.start({
    kind: 'bash', label: 'x', ownerSession: 'alice',
    run: () => ({ cancel() {}, done: Promise.resolve({ status: 'completed' }) }),
  }), (error: unknown) => error instanceof JobError && error.code === 'JOB_NO_CONTROLLER')
  jobs.attachController()
  assert.throws(() => jobs.start({ kind: 'bash', label: '错误任务', run: () => { throw new Error('启动失败') } }), /启动失败/)
  const id = jobs.start({ kind: 'bash', label: 'ok', run: () => ({ cancel() {}, done: new Promise(() => {}) }) })
  assert.equal(id, 'bash-1')
})

test('所有者鉴权不泄露外部后台任务，无所有者任务对所有调用方可见', () => {
  const jobs = new LocalJobRegistry()
  jobs.attachController()
  const hooks = { cancel() {}, done: new Promise<JobOutcome>(() => {}) }
  const owned = jobs.start({ kind: 'subagent', label: 'secret', ownerSession: 'alice', run: () => hooks })
  jobs.start({ kind: 'bash', label: 'public', run: () => hooks })
  assert.deepEqual(jobs.list('bob').map(job => job.label), ['public'])
  assert.throws(() => jobs.get(owned, 'bob'), (error: unknown) => error instanceof JobError && error.code === 'JOB_NOT_FOUND')
})

test('流式输出只有一个消费游标，终态最终输出保持幂等', async () => {
  const jobs = new LocalJobRegistry()
  let buffer = 'first'
  const done = deferred<JobOutcome>()
  const streamId = jobs.start({
    kind: 'bash', label: 'stream', outputLimitBytes: 10,
    run: () => ({ cancel() {}, done: done.promise, readOutput: () => { const value = buffer; buffer = ''; return value } }),
  })
  assert.equal(jobs.read(streamId).text, 'first')
  assert.equal(jobs.read(streamId).text, '')
  buffer = '123456789012345'
  assert.match(jobs.read(streamId).text, /truncated/)
  done.resolve({ status: 'completed', detail: 'exit 0' })
  assert.equal((await jobs.wait(streamId, 100)).status, 'completed')

  const finalId = jobs.start({ kind: 'subagent', label: 'final', run: () => ({ cancel() {}, done: Promise.resolve({ status: 'completed', output: 'answer' }) }) })
  await jobs.wait(finalId, 100)
  assert.equal(jobs.read(finalId).text, 'answer')
  assert.equal(jobs.read(finalId).text, 'answer')
})

test('终止操作先调用生产方，再提交停止中状态，终态第一写胜出', async () => {
  const jobs = new LocalJobRegistry()
  const done = deferred<JobOutcome>()
  let cancelled = 0
  const id = jobs.start({
    kind: 'bash', label: 'long',
    run: () => ({ cancel: () => { cancelled += 1 }, done: done.promise }),
  })
  assert.equal(jobs.kill(id, undefined, 'stop'), 'requested')
  assert.equal(cancelled, 1)
  assert.equal(jobs.get(id).status, 'stopping')
  done.resolve({ status: 'killed', detail: 'SIGTERM' })
  assert.equal((await jobs.wait(id, 100)).status, 'killed')
  assert.equal(jobs.kill(id), 'already-finished')
})

test('等待超时不取消后台任务，取消信号只取消等待者', async () => {
  const jobs = new LocalJobRegistry()
  const id = jobs.start({ kind: 'bash', label: 'long', run: () => ({ cancel() {}, done: new Promise(() => {}) }) })
  assert.equal((await jobs.wait(id, 5)).status, 'running')
  const controller = new AbortController()
  const waiting = jobs.wait(id, 1_000, undefined, controller.signal)
  controller.abort(new Error('调用方离开'))
  await assert.rejects(waiting, /调用方离开/)
  assert.equal(jobs.get(id).status, 'running')
})

test('生产方完成承诺的拒绝被归一为失败，监听器异常被隔离', async () => {
  const jobs = new LocalJobRegistry()
  let healthyCalls = 0
  jobs.onDone(() => { throw new Error('监听器异常') })
  jobs.onDone(() => { healthyCalls += 1 })
  const id = jobs.start({ kind: 'bash', label: '损坏任务', run: () => ({ cancel() {}, done: Promise.reject(new Error('模拟爆炸')) }) })
  const result = await jobs.wait(id, 100)
  assert.equal(result.status, 'failed')
  assert.equal(result.detail, '模拟爆炸')
  assert.equal(healthyCalls, 1)
})

test('所有者释放时取消、等待并移除其私有后台任务', async () => {
  const jobs = new LocalJobRegistry()
  jobs.attachController()
  const done = deferred<JobOutcome>()
  let cancelled = false
  jobs.start({
    kind: 'subagent', label: 'child', ownerSession: 'alice',
    run: () => ({ cancel: () => { cancelled = true; done.resolve({ status: 'killed' }) }, done: done.promise }),
  })
  await jobs.disposeOwner('alice')
  assert.equal(cancelled, true)
  assert.deepEqual(jobs.list('alice'), [])
})
