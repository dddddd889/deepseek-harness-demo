import { id } from './events.mjs'
import { setTimeout as delay } from 'node:timers/promises'

/** 后台任务有独立生产方、owner和输出游标；wait超时不会kill。 */
export class Jobs {
  entries = new Map()
  start(scope, owner, producer) {
    const job = { id: id('job'), owner, state: 'running', output: [], controller: new AbortController() }
    this.entries.set(job.id, job)
    job.done = Promise.resolve().then(() => producer(job.controller.signal, text => job.output.push(text)))
      .then(value => { job.state = 'completed'; job.value = value }, error => { job.state = job.controller.signal.aborted ? 'cancelled' : 'failed'; job.error = error.message })
    scope.own(async () => { job.controller.abort(); await job.done; this.entries.delete(job.id) })
    return job.id
  }
  get(owner, jobId) { const job = this.entries.get(jobId); if (!job || job.owner !== owner) throw Error('没有任务权限'); return job }
  /** 只等待观察，超时返回当前状态。 */
  async wait(owner, jobId, timeout = 1000) {
    const job = this.get(owner, jobId), clock = new AbortController()
    try { await Promise.race([job.done, delay(timeout, undefined, { signal: clock.signal }).catch(() => {})]) }
    finally { clock.abort() }
    return { id: job.id, state: job.state, value: job.value, error: job.error }
  }
  read(owner, jobId, cursor = 0) { const job = this.get(owner, jobId); return { cursor: job.output.length, chunks: job.output.slice(cursor) } }
  async kill(owner, jobId) { const job = this.get(owner, jobId); job.controller.abort(); await job.done }
}
