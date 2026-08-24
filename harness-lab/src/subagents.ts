import { randomUUID } from 'node:crypto'
import type { ContentBlock } from './domain.ts'
import type { JobHooks, JobOutcome, LocalJobRegistry } from './jobs.ts'

export type SubagentStopReason = 'completed' | 'aborted' | 'error' | 'max-tokens' | 'refusal'
export interface SubagentResult {
  readonly output: readonly ContentBlock[]
  readonly structured?: unknown
  readonly stopReason: SubagentStopReason
}
export interface SubagentCapabilities {
  readonly outputSchema: boolean
  readonly depthLimit: boolean
  readonly toolFilter: boolean
  readonly persona: boolean
}
export interface SubagentStartRequest {
  readonly label?: string
  readonly prompt: readonly ContentBlock[]
  readonly parentSession: string
  readonly parentDepth: number
  readonly signal: AbortSignal
  readonly outputSchema?: Readonly<Record<string, unknown>>
  readonly maxDepth?: number
  readonly toolFilter?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] }
  readonly persona?: string
}
export interface ProviderRun {
  readonly id: string
  readonly local: boolean
  readonly result: Promise<SubagentResult>
  cancel(reason?: string): void
  dispose(): Promise<void>
}
export interface SubagentProvider {
  readonly name: string
  readonly capabilities: SubagentCapabilities
  available(): boolean
  start(request: SubagentStartRequest & { readonly depth: number }): Promise<ProviderRun>
}
export interface SubagentRun {
  readonly runId: string
  readonly id: string
  readonly provider: string
  readonly local: boolean
  readonly result: Promise<SubagentResult>
  cancel(reason?: string): void
  dispose(): Promise<void>
}
export type SubagentLifecycleEvent =
  | { readonly type: 'start'; readonly runId: string; readonly id: string; readonly provider: string; readonly parentSession: string; readonly local: boolean }
  | { readonly type: 'end'; readonly runId: string; readonly id: string; readonly provider: string; readonly parentSession: string; readonly local: boolean; readonly stopReason: SubagentStopReason }

export class SubagentError extends Error {
  readonly code: string
  constructor(message: string, code: string) { super(message); this.code = code }
}

/** 子 Agent 控制面：选择 provider、前置能力校验、配对生命周期与资源收敛。 */
export class SubagentRuntime {
  readonly #providers = new Map<string, SubagentProvider>()
  readonly #listeners = new Set<(event: SubagentLifecycleEvent) => void>()
  readonly #active = new Map<string, SubagentRun>()

  register(provider: SubagentProvider): () => void {
    if (this.#providers.has(provider.name)) throw new SubagentError(`Subagent provider 重复：${provider.name}`, 'SUBAGENT_PROVIDER_CONFLICT')
    this.#providers.set(provider.name, provider)
    return () => this.#providers.delete(provider.name)
  }

  onLifecycle(listener: (event: SubagentLifecycleEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  active(): readonly SubagentRun[] { return [...this.#active.values()] }

  async start(providerName: string | undefined, request: SubagentStartRequest): Promise<SubagentRun> {
    request.signal.throwIfAborted()
    const provider = this.#resolve(providerName)
    const depth = request.parentDepth + 1
    if (!Number.isSafeInteger(request.parentDepth) || request.parentDepth < 0) throw new SubagentError('parentDepth 无效', 'SUBAGENT_INVALID_REQUEST')
    if (request.maxDepth !== undefined) {
      this.#require(provider, 'depthLimit')
      if (!Number.isSafeInteger(request.maxDepth) || request.maxDepth < 0 || depth > request.maxDepth) {
        throw new SubagentError(`子 Agent 深度 ${depth} 超过上限 ${request.maxDepth}`, 'SUBAGENT_DEPTH_LIMIT')
      }
    }
    if (request.outputSchema !== undefined) this.#require(provider, 'outputSchema')
    if (request.toolFilter !== undefined) this.#require(provider, 'toolFilter')
    if (request.persona !== undefined) this.#require(provider, 'persona')

    const raw = await provider.start({ ...request, depth })
    if (request.signal.aborted) {
      raw.cancel('request aborted during publication')
      await raw.dispose()
      request.signal.throwIfAborted()
    }
    const runId = randomUUID()
    let disposed: Promise<void> | undefined
    let ended = false
    let cancelled = false
    const info = { runId, id: raw.id, provider: provider.name, parentSession: request.parentSession, local: raw.local }
    const result = Promise.resolve(raw.result).then(
      value => value,
      error => ({
        output: [],
        stopReason: cancelled || request.signal.aborted ? 'aborted' as const : 'error' as const,
        structured: { error: error instanceof Error ? error.message : String(error) },
      }),
    ).then(value => {
      if (!ended) {
        ended = true
        this.#active.delete(runId)
        this.#emit({ type: 'end', ...info, stopReason: value.stopReason })
      }
      return value
    })
    const run: SubagentRun = {
      ...info,
      result,
      cancel: reason => { cancelled = true; raw.cancel(reason) },
      dispose: () => {
        disposed ??= (async () => {
          if (!ended) { cancelled = true; raw.cancel('subagent run disposed') }
          await result
          await raw.dispose()
        })()
        return disposed
      },
    }
    this.#active.set(runId, run)
    this.#emit({ type: 'start', ...info })
    return run
  }

  /** 把一次 delegation 包成 owner-private 后台 Job。 */
  startJob(
    jobs: LocalJobRegistry,
    providerName: string | undefined,
    request: Omit<SubagentStartRequest, 'signal'>,
  ): string {
    const controller = new AbortController()
    let run: SubagentRun | undefined
    const hooks: JobHooks = {
      cancel: reason => { controller.abort(new Error(reason ?? 'job killed')); run?.cancel(reason) },
      done: this.start(providerName, { ...request, signal: controller.signal }).then(async started => {
        run = started
        const result = await started.result
        await started.dispose()
        const output = result.output.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
        const status: JobOutcome['status'] = result.stopReason === 'completed' ? 'completed'
          : result.stopReason === 'aborted' ? 'killed' : 'failed'
        return { status, detail: result.stopReason, output }
      }).catch(error => ({ status: controller.signal.aborted ? 'killed' : 'failed', detail: error instanceof Error ? error.message : String(error) })),
    }
    return jobs.start({
      kind: 'subagent', label: request.label ?? 'subagent', ownerSession: request.parentSession,
      run: () => hooks,
    })
  }

  async dispose(): Promise<void> {
    const active = [...this.#active.values()]
    for (const run of active) run.cancel('runtime disposed')
    await Promise.all(active.map(run => run.dispose()))
    this.#providers.clear()
    this.#listeners.clear()
  }

  #resolve(name?: string): SubagentProvider {
    if (name !== undefined) {
      const provider = this.#providers.get(name)
      if (provider === undefined || !provider.available()) throw new SubagentError(`Subagent provider 不可用：${name}`, 'SUBAGENT_PROVIDER_UNAVAILABLE')
      return provider
    }
    const available = [...this.#providers.values()].filter(provider => provider.available())
    if (available.length !== 1) throw new SubagentError('必须显式选择 Subagent provider', available.length === 0 ? 'SUBAGENT_PROVIDER_UNAVAILABLE' : 'SUBAGENT_PROVIDER_AMBIGUOUS')
    return available[0] as SubagentProvider
  }

  #require(provider: SubagentProvider, capability: keyof SubagentCapabilities): void {
    if (!provider.capabilities[capability]) throw new SubagentError(`provider ${provider.name} 不支持 ${capability}`, 'SUBAGENT_CAPABILITY_UNSUPPORTED')
  }

  #emit(event: SubagentLifecycleEvent): void {
    for (const listener of this.#listeners) {
      try { listener(event) } catch { /* lifecycle observer 隔离 */ }
    }
  }
}

/** 可注入 execute 的本地 provider，便于断点调试完整生命周期。 */
export class InProcessSubagentProvider implements SubagentProvider {
  readonly name: string
  readonly capabilities: SubagentCapabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }
  readonly #execute: (request: SubagentStartRequest & { readonly depth: number }, signal: AbortSignal) => Promise<SubagentResult>

  constructor(name: string, execute: (request: SubagentStartRequest & { readonly depth: number }, signal: AbortSignal) => Promise<SubagentResult>) {
    this.name = name
    this.#execute = execute
  }

  available(): boolean { return true }

  async start(request: SubagentStartRequest & { readonly depth: number }): Promise<ProviderRun> {
    request.signal.throwIfAborted()
    const controller = new AbortController()
    const aborted = (): void => controller.abort(request.signal.reason)
    request.signal.addEventListener('abort', aborted, { once: true })
    const result = this.#execute(request, controller.signal).finally(() => request.signal.removeEventListener('abort', aborted))
    return {
      id: `child-${randomUUID()}`, local: true, result,
      cancel: reason => controller.abort(new Error(reason ?? 'subagent cancelled')),
      dispose: async () => { controller.abort(new Error('subagent disposed')); await result.catch(() => undefined) },
    }
  }
}
