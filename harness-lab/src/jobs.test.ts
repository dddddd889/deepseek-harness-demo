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

test('owned job 需要 controller，starter 失败不消耗 id', () => {
  const jobs = new LocalJobRegistry()
  assert.throws(() => jobs.start({
    kind: 'bash', label: 'x', ownerSession: 'alice',
    run: () => ({ cancel() {}, done: Promise.resolve({ status: 'completed' }) }),
  }), (error: unknown) => error instanceof JobError && error.code === 'JOB_NO_CONTROLLER')
  jobs.attachController()
  assert.throws(() => jobs.start({ kind: 'bash', label: 'bad', run: () => { throw new Error('spawn failed') } }), /spawn failed/)
  const id = jobs.start({ kind: 'bash', label: 'ok', run: () => ({ cancel() {}, done: new Promise(() => {}) }) })
  assert.equal(id, 'bash-1')
})

test('owner 鉴权不泄露 foreign job，unowned job 对所有调用方可见', () => {
  const jobs = new LocalJobRegistry()
  jobs.attachController()
  const hooks = { cancel() {}, done: new Promise<JobOutcome>(() => {}) }
  const owned = jobs.start({ kind: 'subagent', label: 'secret', ownerSession: 'alice', run: () => hooks })
  jobs.start({ kind: 'bash', label: 'public', run: () => hooks })
  assert.deepEqual(jobs.list('bob').map(job => job.label), ['public'])
  assert.throws(() => jobs.get(owned, 'bob'), (error: unknown) => error instanceof JobError && error.code === 'JOB_NOT_FOUND')
})

test('stream output 只有一个消费游标，终态 final output 则幂等', async () => {
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

test('kill 先调用 producer，再提交 stopping，终态第一写胜出', async () => {
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

test('wait 超时不取消 job，Abort 只取消等待者', async () => {
  const jobs = new LocalJobRegistry()
  const id = jobs.start({ kind: 'bash', label: 'long', run: () => ({ cancel() {}, done: new Promise(() => {}) }) })
  assert.equal((await jobs.wait(id, 5)).status, 'running')
  const controller = new AbortController()
  const waiting = jobs.wait(id, 1_000, undefined, controller.signal)
  controller.abort(new Error('caller left'))
  await assert.rejects(waiting, /caller left/)
  assert.equal(jobs.get(id).status, 'running')
})

test('producer done rejection 归一为 failed，listener 异常被隔离', async () => {
  const jobs = new LocalJobRegistry()
  let healthyCalls = 0
  jobs.onDone(() => { throw new Error('bad listener') })
  jobs.onDone(() => { healthyCalls += 1 })
  const id = jobs.start({ kind: 'bash', label: 'broken', run: () => ({ cancel() {}, done: Promise.reject(new Error('boom')) }) })
  const result = await jobs.wait(id, 100)
  assert.equal(result.status, 'failed')
  assert.equal(result.detail, 'boom')
  assert.equal(healthyCalls, 1)
})

test('owner dispose 取消、等待并移除 owner-private jobs', async () => {
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
