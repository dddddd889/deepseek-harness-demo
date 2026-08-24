import type { Message, SessionEvent } from './domain.ts'
import { deriveMessages, foldTokenUsage, inspectLifecycle } from './projections.ts'
import type { UsageTotals } from './projections.ts'

export interface ConversationView {
  readonly sessionId: string
  readonly lastSeq: number
  readonly messages: readonly Message[]
  readonly partialAssistantText: string
  readonly running: boolean
  readonly usage: UsageTotals
}

/** 浏览器/SDK 共用投影：严格连续 seq，绝不靠 UI 本地猜测补洞。 */
export class ClientProjection {
  readonly #sessionId: string
  readonly #events: SessionEvent[] = []
  #partial = ''

  constructor(sessionId: string) { this.#sessionId = sessionId }
  get lastSeq(): number { return this.#events.at(-1)?.seq ?? -1 }
  get events(): readonly SessionEvent[] { return this.#events }

  reset(events: readonly SessionEvent[]): void {
    this.#events.length = 0
    this.#partial = ''
    for (const event of events) this.apply(event)
  }

  apply(event: SessionEvent): void {
    const expected = this.lastSeq + 1
    if (event.seq < expected) return // SSE replay 与 snapshot 重叠时幂等忽略。
    if (event.seq !== expected) throw new Error(`CLIENT_EVENT_GAP：期望 seq=${expected}，收到 ${event.seq}`)
    this.#events.push(event)
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') this.#partial += chunk.text
    }
    if (event.type === 'assistant/message' || event.type === 'turn/end') this.#partial = ''
  }

  view(): ConversationView {
    let running = false
    try { running = inspectLifecycle(this.#events).status === 'running' }
    catch { running = this.#events.some(event => event.type === 'turn/start') && this.#events.at(-1)?.type !== 'turn/end' }
    return {
      sessionId: this.#sessionId, lastSeq: this.lastSeq,
      messages: deriveMessages(this.#events), partialAssistantText: this.#partial,
      running, usage: foldTokenUsage(this.#events),
    }
  }
}

interface RpcEnvelope<T> {
  readonly jsonrpc: '2.0'
  readonly id: string
  readonly result?: T
  readonly error?: { readonly code: string; readonly message: string; readonly details?: unknown }
}

export class AgentClientError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, code: string, status: number) { super(message); this.code = code; this.status = status }
}

export interface FollowCallbacks {
  onView?(view: ConversationView): void
  onConnection?(state: 'connecting' | 'connected' | 'reconnecting'): void
  onError?(error: unknown): void
}

/** 网络 Client：RPC request id 由调用方稳定持有，断线后 SSE 从 lastSeq 继续。 */
export class AgentClient {
  readonly #baseURL: string
  readonly #token: () => string
  readonly #fetch: typeof fetch

  constructor(baseURL: string, token: string | (() => string), fetchImpl: typeof fetch = fetch) {
    this.#baseURL = baseURL.replace(/\/$/, '')
    this.#token = typeof token === 'string' ? () => token : token
    this.#fetch = fetchImpl
  }

  async rpc<T>(method: string, params: Record<string, unknown>, requestId: string = crypto.randomUUID(), signal?: AbortSignal): Promise<T> {
    const response = await this.#fetch(`${this.#baseURL}/rpc`, {
      method: 'POST', ...(signal === undefined ? {} : { signal }),
      headers: { authorization: `Bearer ${this.#token()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
    })
    const envelope = await response.json() as RpcEnvelope<T>
    if (envelope.error !== undefined) throw new AgentClientError(envelope.error.message, envelope.error.code, response.status)
    if (envelope.result === undefined) throw new AgentClientError('RPC 缺少 result', 'INVALID_RESPONSE', response.status)
    return envelope.result
  }

  async snapshot(sessionId: string, signal?: AbortSignal): Promise<readonly SessionEvent[]> {
    const result = await this.rpc<{ readonly events: readonly SessionEvent[] }>('session.snapshot', { sessionId }, crypto.randomUUID(), signal)
    return result.events
  }

  /** 一直追随到 signal 取消；网络断开指数退避，协议 gap 先重新 snapshot。 */
  async follow(sessionId: string, projection: ClientProjection, signal: AbortSignal, callbacks: FollowCallbacks = {}): Promise<void> {
    callbacks.onConnection?.('connecting')
    projection.reset(await this.snapshot(sessionId, signal))
    callbacks.onView?.(projection.view())
    let delay = 50
    while (!signal.aborted) {
      try {
        callbacks.onConnection?.(delay === 50 ? 'connected' : 'reconnecting')
        for await (const event of this.events(sessionId, projection.lastSeq, signal)) {
          try { projection.apply(event) }
          catch (error) {
            projection.reset(await this.snapshot(sessionId, signal))
            callbacks.onError?.(error)
          }
          callbacks.onView?.(projection.view())
          delay = 50
        }
        if (!signal.aborted) throw new Error('SSE 连接意外结束')
      } catch (error) {
        if (signal.aborted) return
        callbacks.onError?.(error)
        callbacks.onConnection?.('reconnecting')
        await abortableDelay(delay, signal)
        delay = Math.min(delay * 2, 2_000)
      }
    }
  }

  async *events(sessionId: string, after: number, signal?: AbortSignal): AsyncGenerator<SessionEvent> {
    const response = await this.#fetch(`${this.#baseURL}/events?sessionId=${encodeURIComponent(sessionId)}&after=${after}`, {
      headers: { authorization: `Bearer ${this.#token()}` }, ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok || response.body === null) throw new AgentClientError(`SSE HTTP ${response.status}`, 'EVENT_STREAM_FAILED', response.status)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true }).replaceAll('\r\n', '\n')
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
          if (data === '') continue
          const value: unknown = JSON.parse(data)
          yield value as SessionEvent
        }
      }
    } finally {
      // fetch Abort 已拥有底层连接关闭；不能让某些实现迟缓的 cancel() 阻塞重连/退出。
      void reader.cancel().catch(() => undefined)
    }
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
}
