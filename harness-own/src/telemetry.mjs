import { randomBytes } from 'node:crypto'

/** 默认关闭，只允许明确白名单字段进入OTLP；业务不等待遥测成功。 */
export class Telemetry {
  queue = []
  constructor({ enabled = false, endpoint, fetcher = fetch } = {}) { this.enabled = enabled; this.endpoint = endpoint; this.fetcher = fetcher }
  record(name, attributes = {}) {
    if (!this.enabled) return
    const allowed = ['sessionId', 'requestId', 'toolName', 'reason', 'durationMs', 'inputTokens', 'outputTokens']
    this.queue.push({ timeUnixNano: String(BigInt(Date.now()) * 1_000_000n), severityText: 'INFO', body: { stringValue: name }, attributes: Object.entries(attributes).filter(([key]) => allowed.includes(key)).map(([key, value]) => ({ key, value: { stringValue: String(value) } })) })
    if (this.queue.length > 1000) this.queue.shift()
  }
  /** 有界批次，超时/失败被记录为false，不向业务抛网络异常。 */
  async flush() {
    if (!this.enabled || !this.queue.length) return true
    const batch = this.queue.splice(0, 100)
    try {
      const response = await this.fetcher(this.endpoint, { method: 'POST', signal: AbortSignal.timeout(2000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resourceLogs: [{ scopeLogs: [{ scope: { name: 'harness-own' }, logRecords: batch }] }] }) })
      return response.ok
    } catch { return false }
  }
}
