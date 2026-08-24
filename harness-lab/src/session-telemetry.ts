import type { SessionEvent } from './domain.ts'
import type { Session } from './session.ts'

export type TelemetryMode = 'disabled' | 'feedback-only' | 'full'
export type TelemetrySeverity = 'info' | 'warn' | 'error'

export interface TelemetryRecord {
  readonly channel: 'ledger' | 'ops'
  readonly time: number
  readonly severity: TelemetrySeverity
  readonly attributes: Readonly<Record<string, string | number>>
  readonly body: unknown
}

export interface TelemetrySink {
  /** 必须是非阻塞入队；传输失败不能回穿 agent loop。 */
  emit(record: TelemetryRecord): void
  shutdown(): Promise<void>
}

export type TelemetryRedactor = (record: TelemetryRecord) => TelemetryRecord

/**
 * 将权威 Session Log 投影成 OTel Logs 风格记录。
 * 它只维护“已交给 sink”的游标，不承诺远端已经收到，因此不能承担恢复职责。
 */
export class SessionTelemetry {
  readonly #seenChunks = new Set<string>()
  readonly #sessionId: string
  readonly #session: Session
  readonly #sink: TelemetrySink
  readonly #mode: TelemetryMode
  readonly #redact: TelemetryRedactor
  readonly #warn: (message: string) => void
  #cursor: number
  #unsubscribe: (() => void) | undefined

  constructor(
    sessionId: string,
    session: Session,
    sink: TelemetrySink,
    mode: TelemetryMode = 'disabled',
    redact: TelemetryRedactor = (record) => record,
    warn: (message: string) => void = () => {},
  ) {
    this.#sessionId = sessionId
    this.#session = session
    this.#sink = sink
    this.#mode = mode
    this.#redact = redact
    this.#warn = warn
    this.#cursor = session.events.length - 1
    for (const event of session.events) this.#track(event)
    this.#unsubscribe = session.onAppend((event) => this.#capture(event))
  }

  /** 关闭捕获并尽力排空后端；失败被隔离，不影响应用退出。 */
  async close(): Promise<void> {
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    try {
      await this.#sink.shutdown()
    } catch (error) {
      this.#warn(`telemetry shutdown failed: ${String(error)}`)
    }
  }

  #capture(event: SessionEvent): void {
    if (this.#mode === 'disabled') return
    if (this.#mode === 'feedback-only' && event.type !== 'feedback/record') return
    if (event.type === 'assistant/chunk') {
      const key = `${event.data.turn}:${event.data.step}`
      if (this.#seenChunks.has(key)) return
      this.#seenChunks.add(key)
    }
    try {
      const record = this.#redact({
        channel: 'ledger',
        time: event.time,
        severity: severityOf(event),
        attributes: {
          'session.id': this.#sessionId,
          'event.type': event.type,
          'event.seq': event.seq,
        },
        body: structuredClone(event.data),
      })
      this.#sink.emit(record)
      this.#cursor = event.seq
    } catch (error) {
      this.#warn(`telemetry capture failed at seq ${event.seq}: ${String(error)}`)
    }
  }

  #track(event: SessionEvent): void {
    if (event.type === 'assistant/chunk') this.#seenChunks.add(`${event.data.turn}:${event.data.step}`)
  }

  get handedOffThrough(): number {
    return this.#cursor
  }
}

/** 根据事件自身结果生成告警级别。 */
function severityOf(event: SessionEvent): TelemetrySeverity {
  if (event.type === 'tool/result' && event.data.error !== undefined) return 'error'
  if (event.type === 'turn/end' && event.data.reason.kind === 'error') return 'error'
  return 'info'
}

/** 测试与本地调试用的内存日志导出器。 */
export class MemoryTelemetrySink implements TelemetrySink {
  readonly records: TelemetryRecord[] = []
  readonly #failAt: number | undefined
  constructor(failAt?: number) { this.#failAt = failAt }

  emit(record: TelemetryRecord): void {
    if (this.#failAt === this.records.length) throw new Error('注入的导出失败')
    this.records.push(structuredClone(record))
  }

  async shutdown(): Promise<void> {}
}
