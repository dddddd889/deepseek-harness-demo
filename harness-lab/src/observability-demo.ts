import { projectCost, formatPicoUsd, type PriceBook } from './cost-projection.ts'
import { Session } from './session.ts'
import { MemoryTelemetrySink, SessionTelemetry } from './session-telemetry.ts'

const session = new Session()
const sink = new MemoryTelemetrySink()
const telemetry = new SessionTelemetry('demo-observe', session, sink, 'full')
session.append('request/header', { header: { provider: 'deepseek', model: 'deepseek-chat' }, reason: 'initial' }, 100)
session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40 } } }, 101)

const prices: PriceBook = {
  version: 'demo-v1',
  prices: [{
    provider: 'deepseek', model: 'deepseek-chat', effectiveFrom: 0,
    inputMicroUsdPerMillion: 280_000, outputMicroUsdPerMillion: 420_000, cacheReadMicroUsdPerMillion: 28_000,
  }],
}
const cost = projectCost(session.events, prices)
console.log(JSON.stringify({ exportedLogs: sink.records.length, cost: formatPicoUsd(cost.picoUsd), priceBook: cost.priceBookVersion }))
await telemetry.close()
