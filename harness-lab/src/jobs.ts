export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed'

export interface JobOutcome {
  readonly status: 'completed' | 'killed' | 'failed'
  readonly detail?: string
  readonly output?: string
}

export interface JobHooks {
  cancel(reason?: string): void
  readonly done: Promise<JobOutcome>
  readOutput?(): string
}

export interface JobStart {
  readonly kind: string
  readonly label: string
  readonly ownerSession?: string
  readonly outputLimitBytes?: number
  run(): JobHooks
}

export interface JobSnapshot {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly ownerSession?: string
  readonly outputLimitBytes?: number
  readonly status: JobStatus
  readonly detail?: string
  readonly startedAt: number
  readonly finishedAt?: number
  readonly reported: boolean
}

export interface JobRead { readonly text: string; readonly snapshot: JobSnapshot }

interface JobRecord {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly ownerSession: string | undefined
  readonly outputLimitBytes: number | undefined
  readonly startedAt: number
  readonly hooks: JobHooks
  status: JobStatus
  detail: string | undefined
  output: string | undefined
  finishedAt: number | undefined
  reported: boolean
  settled: boolean
  readonly waiters: Set<() => void>
}

export class JobError extends Error {
  readonly code: string
  constructor(message: string, code: string) { super(message); this.code = code }
}

/** 进程内后台任务控制面；执行资源仍归生产方，注册表只拥有身份与生命周期。 */
export class LocalJobRegistry {
  readonly #records = new Map<string, JobRecord>()
  readonly #counters = new Map<string, number>()
  readonly #doneListeners = new Set<(snapshot: JobSnapshot) => void | PromiseLike<void>>()
  readonly #changeListeners = new Set<(ownerSession?: string) => void>()
  #controllers = 0
  #disposed = false

  attachController(): () => void {
    if (this.#disposed) throw new JobError('后台任务注册表已释放', 'JOB_DISPOSED')
    this.#controllers += 1
    let active = true
    return () => {
      if (!active) return
      active = false
      this.#controllers -= 1
    }
  }

  start(spec: JobStart): string {
    if (this.#disposed) throw new JobError('后台任务注册表已释放', 'JOB_DISPOSED')
    if (!/^[a-z][a-z0-9-]*$/.test(spec.kind)) throw new JobError(`后台任务类型无效：${spec.kind}`, 'JOB_INVALID')
    if (spec.label.trim() === '') throw new JobError('后台任务标签不能为空', 'JOB_INVALID')
    if (spec.ownerSession !== undefined && this.#controllers === 0) {
      throw new JobError('没有控制器接管有所有者的后台任务', 'JOB_NO_CONTROLLER')
    }
    if (spec.outputLimitBytes !== undefined && (!Number.isSafeInteger(spec.outputLimitBytes) || spec.outputLimitBytes <= 0)) {
      throw new JobError('输出字节上限必须为正整数', 'JOB_INVALID')
    }

    // 运行函数抛错时不消耗标识，也不发布半条记录。
    const hooks = spec.run()
    const next = (this.#counters.get(spec.kind) ?? 0) + 1
    const id = `${spec.kind}-${next}`
    const record: JobRecord = {
      id, kind: spec.kind, label: spec.label,
      ownerSession: spec.ownerSession,
      outputLimitBytes: spec.outputLimitBytes,
      startedAt: Date.now(), hooks,
      status: 'running', detail: undefined, output: undefined, finishedAt: undefined,
      reported: false, settled: false, waiters: new Set(),
    }
    this.#counters.set(spec.kind, next)
    this.#records.set(id, record)
    this.#changed(record.ownerSession)
    void Promise.resolve(hooks.done).then(
      outcome => this.#settle(record, outcome),
      error => this.#settle(record, { status: 'failed', detail: error instanceof Error ? error.message : String(error) }),
    )
    return id
  }

  list(callerSession?: string): readonly JobSnapshot[] {
    return [...this.#records.values()]
      .filter(record => record.ownerSession === undefined || record.ownerSession === callerSession)
      .map(record => this.#snapshot(record))
  }

  get(id: string, callerSession?: string): JobSnapshot {
    return this.#snapshot(this.#authorized(id, callerSession))
  }

  read(id: string, callerSession?: string): JobRead {
    const record = this.#authorized(id, callerSession)
    const raw = record.hooks.readOutput?.() ?? (record.settled ? record.output ?? '' : '')
    const text = this.#cap(raw, record.outputLimitBytes)
    if (record.settled) record.reported = true
    return { text, snapshot: this.#snapshot(record) }
  }

  kill(id: string, callerSession?: string, reason?: string): 'requested' | 'already-finished' {
    const record = this.#authorized(id, callerSession)
    if (record.settled) {
      record.reported = true
      return 'already-finished'
    }
    // 取消函数抛错时状态保持运行中，调用方能明确重试或升级。
    record.hooks.cancel(reason)
    record.status = 'stopping'
    record.reported = true
    this.#changed(record.ownerSession)
    return 'requested'
  }

  async wait(id: string, timeoutMs: number, callerSession?: string, signal?: AbortSignal): Promise<JobSnapshot> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new JobError('等待超时时间必须为正数', 'JOB_INVALID')
    const record = this.#authorized(id, callerSession)
    if (record.settled) return this.#snapshot(record)
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>
      const done = (): void => { cleanup(); resolve() }
      const aborted = (): void => { cleanup(); reject(signal?.reason ?? new Error('wait aborted')) }
      const cleanup = (): void => {
        clearTimeout(timer)
        record.waiters.delete(done)
        signal?.removeEventListener('abort', aborted)
      }
      timer = setTimeout(done, timeoutMs)
      record.waiters.add(done)
      signal?.addEventListener('abort', aborted, { once: true })
      if (signal?.aborted === true) aborted()
    })
    return this.#snapshot(record)
  }

  onDone(listener: (snapshot: JobSnapshot) => void | PromiseLike<void>): () => void {
    this.#doneListeners.add(listener)
    return () => this.#doneListeners.delete(listener)
  }

  onChanged(listener: (ownerSession?: string) => void): () => void {
    this.#changeListeners.add(listener)
    return () => this.#changeListeners.delete(listener)
  }

  /** 所有者释放会停止并等待其所有活动任务，然后删除这些 所有者私有记录。 */
  async disposeOwner(ownerSession: string): Promise<void> {
    const owned = [...this.#records.values()].filter(record => record.ownerSession === ownerSession)
    for (const record of owned) {
      record.reported = true
      if (!record.settled) {
        try {
          record.hooks.cancel('owner disposed')
          record.status = 'stopping'
        } catch (error) {
          this.#settle(record, { status: 'failed', detail: `cleanup cancel failed: ${String(error)}` })
        }
      }
    }
    await Promise.all(owned.map(async record => {
      if (!record.settled) await this.wait(record.id, 30_000, ownerSession)
      this.#records.delete(record.id)
    }))
    this.#changed(ownerSession)
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    const live = [...this.#records.values()].filter(record => !record.settled)
    for (const record of live) {
      record.reported = true
      try { record.hooks.cancel('registry disposed'); record.status = 'stopping' }
      catch (error) { this.#settle(record, { status: 'failed', detail: `cleanup cancel failed: ${String(error)}` }) }
    }
    await Promise.all(live.map(record => record.settled ? Promise.resolve() : record.hooks.done.catch(() => undefined)))
    this.#records.clear()
    this.#doneListeners.clear()
    this.#changeListeners.clear()
  }

  #authorized(id: string, callerSession?: string): JobRecord {
    const record = this.#records.get(id)
    // 不区分 未知记录或外部记录，防止可预测 标识成为跨所有者 枚举侧信道。
    if (record === undefined || (record.ownerSession !== undefined && record.ownerSession !== callerSession)) {
      throw new JobError(`后台任务不存在或无权访问：${id}`, 'JOB_NOT_FOUND')
    }
    return record
  }

  #settle(record: JobRecord, outcome: JobOutcome): void {
    if (record.settled) return
    record.settled = true
    record.status = outcome.status
    record.detail = outcome.detail
    record.output = outcome.output
    record.finishedAt = Date.now()
    for (const wake of record.waiters) wake()
    this.#changed(record.ownerSession)
    const snapshot = this.#snapshot(record)
    for (const listener of this.#doneListeners) {
      try { Promise.resolve(listener(snapshot)).catch(() => undefined) } catch { /* listener 隔离 */ }
    }
  }

  #snapshot(record: JobRecord): JobSnapshot {
    return {
      id: record.id, kind: record.kind, label: record.label, status: record.status,
      startedAt: record.startedAt, reported: record.reported,
      ...record.ownerSession === undefined ? {} : { ownerSession: record.ownerSession },
      ...record.outputLimitBytes === undefined ? {} : { outputLimitBytes: record.outputLimitBytes },
      ...record.detail === undefined ? {} : { detail: record.detail },
      ...record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt },
    }
  }

  #changed(ownerSession?: string): void {
    for (const listener of this.#changeListeners) {
      try { listener(ownerSession) } catch { /* observer 隔离 */ }
    }
  }

  #cap(text: string, limit?: number): string {
    if (limit === undefined || Buffer.byteLength(text, 'utf8') <= limit) return text
    let end = Math.min(text.length, limit)
    while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > limit) end -= 1
    return `${text.slice(0, end)}\n[output truncated]`
  }
}
