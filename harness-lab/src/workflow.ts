import { randomUUID } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import type { JsonValue } from './json.ts'
import { assertJsonValue, snapshotJson } from './json.ts'
import type { SubagentRun, SubagentRuntime } from './subagents.ts'

export interface WorkflowMeta {
  readonly name: string
  readonly description: string
  readonly phases?: readonly { readonly title: string; readonly detail?: string }[]
}
export interface WorkflowRequest {
  readonly script: string
  readonly meta: WorkflowMeta
  readonly args?: JsonValue
  readonly subagentProvider?: string
  readonly maxTotalAgents?: number
  readonly maxConcurrentAgents?: number
  readonly cancelGraceMs?: number
  readonly parentSession: string
  readonly parentDepth: number
  readonly signal?: AbortSignal
}
export interface WorkflowResult {
  readonly value: JsonValue
  readonly stopReason: 'completed' | 'cancelled' | 'error'
  readonly error?: string
  readonly agentsStarted: number
}
export interface WorkflowRun {
  readonly id: string
  readonly result: Promise<WorkflowResult>
  cancel(reason?: string): void
}
export type WorkflowEvent =
  | { readonly type: 'start'; readonly id: string; readonly meta: WorkflowMeta }
  | { readonly type: 'phase'; readonly id: string; readonly title: string }
  | { readonly type: 'log'; readonly id: string; readonly message: string }
  | { readonly type: 'agent-start'; readonly id: string; readonly seq: number; readonly childId: string; readonly label: string; readonly phase?: string }
  | { readonly type: 'agent-end'; readonly id: string; readonly seq: number; readonly childId: string; readonly label: string; readonly outcome: 'completed' | 'failed' | 'cancelled'; readonly phase?: string }
  | { readonly type: 'end'; readonly id: string; readonly result: Omit<WorkflowResult, 'value'> }

interface AgentRequestMessage {
  readonly type: 'agent'
  readonly seq: number
  readonly prompt: string
  readonly label?: string
  readonly phase?: string
  readonly provider?: string
}

const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const pending = new Map()
let seq = 0
let cancelled = false
parentPort.on('message', message => {
  if (message.type === 'agent-result') {
    const slot = pending.get(message.seq)
    if (!slot) return
    pending.delete(message.seq)
    message.error ? slot.reject(new Error(message.error)) : slot.resolve(message.value)
  }
  if (message.type === 'cancel') {
    cancelled = true
    for (const slot of pending.values()) slot.reject(new Error(message.reason || 'workflow cancelled'))
    pending.clear()
  }
})
const phase = title => { parentPort.postMessage({ type: 'phase', title }) }
const log = message => { parentPort.postMessage({ type: 'log', message: String(message) }) }
const agent = options => {
  if (cancelled) return Promise.reject(new Error('workflow cancelled'))
  const current = ++seq
  return new Promise((resolve, reject) => {
    pending.set(current, { resolve, reject })
    parentPort.postMessage({ type: 'agent', seq: current, ...options })
  })
}
;(async () => {
  try {
    const fn = new AsyncFunction('args', 'phase', 'log', 'agent', workerData.script)
    const value = await fn(workerData.args, phase, log, agent)
    parentPort.postMessage({ type: 'result', value: value === undefined ? null : value })
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error), cancelled })
  }
})()
`

/** Worker-thread Workflow：脚本动态 fan-out，Host 掌握子 Agent 与预算。 */
export class WorkflowEngine {
  readonly #subagents: SubagentRuntime
  readonly #listeners = new Set<(event: WorkflowEvent) => void>()

  constructor(subagents: SubagentRuntime) { this.#subagents = subagents }

  onEvent(listener: (event: WorkflowEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  start(request: WorkflowRequest): WorkflowRun {
    this.#validate(request)
    const id = randomUUID()
    const controller = new AbortController()
    const maxTotal = request.maxTotalAgents ?? 16
    const maxConcurrent = request.maxConcurrentAgents ?? 4
    const grace = request.cancelGraceMs ?? 1_000
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { script: request.script, args: request.args ?? null },
    })
    let agentsStarted = 0
    let active = 0
    let settled = false
    let cancelling = false
    let cancelReason = 'workflow cancelled'
    let pendingFinish: WorkflowResult | undefined
    const children = new Set<SubagentRun>()
    const queue: AgentRequestMessage[] = []
    let resolveResult!: (result: WorkflowResult) => void
    const result = new Promise<WorkflowResult>(resolve => { resolveResult = resolve })

    const finish = (outcome: WorkflowResult): void => {
      if (settled) return
      settled = true
      request.signal?.removeEventListener('abort', parentAborted)
      void worker.terminate()
      const frozen = snapshotJson(outcome)
      this.#emit({ type: 'end', id, result: {
        stopReason: frozen.stopReason, agentsStarted: frozen.agentsStarted,
        ...frozen.error === undefined ? {} : { error: frozen.error },
      } })
      resolveResult(frozen)
    }
    const finishWhenQuiescent = (outcome: WorkflowResult, force = false): void => {
      if (!force && active > 0) {
        pendingFinish = outcome
        return
      }
      finish(outcome)
    }
    const cancel = (reason = 'workflow cancelled'): void => {
      if (settled || cancelling) return
      cancelling = true
      cancelReason = reason
      controller.abort(new Error(reason))
      worker.postMessage({ type: 'cancel', reason })
      for (const child of children) child.cancel(reason)
      queue.splice(0)
      const timer = setTimeout(() => finishWhenQuiescent({ value: null, stopReason: 'cancelled', error: cancelReason, agentsStarted }, true), grace)
      timer.unref()
    }
    const parentAborted = (): void => cancel(request.signal?.reason instanceof Error ? request.signal.reason.message : 'caller aborted')
    request.signal?.addEventListener('abort', parentAborted, { once: true })

    const drain = (): void => {
      while (!cancelling && active < maxConcurrent && queue.length > 0) {
        const message = queue.shift()
        if (message !== undefined) void executeAgent(message)
      }
    }
    const executeAgent = async (message: AgentRequestMessage): Promise<void> => {
      active += 1
      agentsStarted += 1
      const label = message.label ?? message.prompt.slice(0, 80)
      let child: SubagentRun | undefined
      try {
        child = await this.#subagents.start(message.provider ?? request.subagentProvider, {
          label, prompt: [{ type: 'text', text: message.prompt }],
          parentSession: request.parentSession, parentDepth: request.parentDepth,
          signal: controller.signal,
        })
        children.add(child)
        this.#emit({ type: 'agent-start', id, seq: message.seq, childId: child.id, label, ...message.phase === undefined ? {} : { phase: message.phase } })
        const childResult = await child.result
        const outcome = cancelling || childResult.stopReason === 'aborted' ? 'cancelled'
          : childResult.stopReason === 'completed' ? 'completed' : 'failed'
        this.#emit({ type: 'agent-end', id, seq: message.seq, childId: child.id, label, outcome, ...message.phase === undefined ? {} : { phase: message.phase } })
        const value = outcome === 'completed'
          ? { output: childResult.output, ...(childResult.structured === undefined ? {} : { structured: childResult.structured }) }
          : null
        if (!settled) worker.postMessage({ type: 'agent-result', seq: message.seq, value })
      } catch (error) {
        if (!settled) worker.postMessage({ type: 'agent-result', seq: message.seq, error: error instanceof Error ? error.message : String(error) })
      } finally {
        if (child !== undefined) { children.delete(child); await child.dispose() }
        active -= 1
        if (active === 0 && pendingFinish !== undefined) {
          const outcome = pendingFinish
          pendingFinish = undefined
          finish(outcome)
          return
        }
        drain()
      }
    }

    worker.on('message', (message: unknown) => {
      if (settled || typeof message !== 'object' || message === null || !('type' in message)) return
      const value = message as Record<string, unknown>
      if (value.type === 'phase' && typeof value.title === 'string') {
        const declared = request.meta.phases?.some(phase => phase.title === value.title) ?? false
        if (!declared && request.meta.phases !== undefined) { cancel(`未声明的 workflow phase：${value.title}`); return }
        this.#emit({ type: 'phase', id, title: value.title })
      } else if (value.type === 'log' && typeof value.message === 'string') {
        this.#emit({ type: 'log', id, message: value.message })
      } else if (value.type === 'agent') {
        const agentMessage = this.#agentMessage(value)
        if (agentsStarted + queue.length >= maxTotal) { cancel(`Workflow 超过 maxTotalAgents=${maxTotal}`); return }
        queue.push(agentMessage)
        drain()
      } else if (value.type === 'result') {
        try {
          assertJsonValue(value.value)
          finishWhenQuiescent({
            value: snapshotJson(value.value),
            stopReason: cancelling ? 'cancelled' : 'completed',
            ...cancelling ? { error: cancelReason } : {},
            agentsStarted,
          })
        } catch (error) {
          finishWhenQuiescent({ value: null, stopReason: 'error', error: `Workflow 返回值不是 JSON：${String(error)}`, agentsStarted })
        }
      } else if (value.type === 'error') {
        finishWhenQuiescent({ value: null, stopReason: cancelling || value.cancelled === true ? 'cancelled' : 'error', error: typeof value.error === 'string' ? value.error : 'worker error', agentsStarted })
      }
    })
    worker.on('error', error => finishWhenQuiescent({
      value: null,
      stopReason: cancelling ? 'cancelled' : 'error',
      error: error instanceof Error ? error.message : String(error),
      agentsStarted,
    }))
    worker.on('exit', code => {
      if (!settled && code !== 0) finishWhenQuiescent({ value: null, stopReason: cancelling ? 'cancelled' : 'error', error: `workflow worker exit ${code}`, agentsStarted })
    })

    this.#emit({ type: 'start', id, meta: request.meta })
    if (request.signal?.aborted === true) parentAborted()
    return { id, result, cancel }
  }

  #validate(request: WorkflowRequest): void {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(request.meta.name) || request.meta.description.trim() === '') throw new TypeError('Workflow meta 无效')
    const titles = new Set<string>()
    for (const phase of request.meta.phases ?? []) {
      if (phase.title.trim() === '' || titles.has(phase.title)) throw new TypeError(`Workflow phase 无效或重复：${phase.title}`)
      titles.add(phase.title)
    }
    for (const [name, value] of [['maxTotalAgents', request.maxTotalAgents], ['maxConcurrentAgents', request.maxConcurrentAgents], ['cancelGraceMs', request.cancelGraceMs]] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new TypeError(`${name} 必须为正整数`)
    }
    if ((request.maxConcurrentAgents ?? 4) > (request.maxTotalAgents ?? 16)) throw new TypeError('maxConcurrentAgents 不能超过 maxTotalAgents')
  }

  #agentMessage(value: Record<string, unknown>): AgentRequestMessage {
    if (!Number.isSafeInteger(value.seq) || typeof value.prompt !== 'string' || value.prompt.trim() === '') throw new TypeError('Workflow agent() 参数无效')
    return {
      type: 'agent', seq: value.seq as number, prompt: value.prompt,
      ...typeof value.label === 'string' ? { label: value.label } : {},
      ...typeof value.phase === 'string' ? { phase: value.phase } : {},
      ...typeof value.provider === 'string' ? { provider: value.provider } : {},
    }
  }

  #emit(event: WorkflowEvent): void {
    for (const listener of this.#listeners) {
      try { listener(event) } catch { /* observer 隔离 */ }
    }
  }
}
