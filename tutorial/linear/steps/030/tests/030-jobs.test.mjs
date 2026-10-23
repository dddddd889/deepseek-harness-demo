import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { Jobs } from '../src/jobs.mjs'
import { Scope } from '../src/scope.mjs'

test('wait超时不杀任务，跨owner拒绝，kill才终止生产方', async () => {
  const jobs = new Jobs(), scope = new Scope()
  const jobId = jobs.start(scope, 's1', async (signal, emit) => { emit('first'); await delay(60_000, undefined, { signal }) })
  assert.equal((await jobs.wait('s1', jobId, 10)).state, 'running')
  assert.throws(() => jobs.read('s2', jobId), /权限/)
  assert.deepEqual(jobs.read('s1', jobId).chunks, ['first'])
  await jobs.kill('s1', jobId)
  assert.equal((await jobs.wait('s1', jobId)).state, 'cancelled')
  await scope.close(); assert.equal(jobs.entries.size, 0)
})
