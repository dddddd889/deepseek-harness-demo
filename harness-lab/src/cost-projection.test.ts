import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { projectCost, formatPicoUsd, type PriceBook } from './cost-projection.ts'
import { createMessage } from './domain.ts'
import { Session } from './session.ts'

const book: PriceBook = {
  version: '2026-08',
  prices: [
    { provider: 'deepseek', model: 'chat', effectiveFrom: 0, inputMicroUsdPerMillion: 100_000, outputMicroUsdPerMillion: 200_000, cacheReadMicroUsdPerMillion: 10_000 },
    { provider: 'deepseek', model: 'chat', effectiveFrom: 200, inputMicroUsdPerMillion: 300_000, outputMicroUsdPerMillion: 400_000, cacheReadMicroUsdPerMillion: 20_000 },
  ],
}

test('最终 usage 覆盖流式样本，并按请求时刻选择价格', () => {
  const session = new Session()
  session.append('request/header', { header: { provider: 'deepseek', model: 'chat' }, reason: 'initial' }, 100)
  session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 9, outputTokens: 9 } } }, 101)
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({ role: 'assistant', content: [{ type: 'text', text: 'ok' }], source: { kind: 'model', provider: 'deepseek', model: 'chat' } }),
    usage: { inputTokens: 2, outputTokens: 3, cacheReadTokens: 5 },
  }, 300)
  const result = projectCost(session.events, book)
  assert.equal(result.picoUsd, 850_000n)
  assert.equal(formatPicoUsd(result.picoUsd), '$0.00000085')
})

test('未知模型显式进入 unpriced，不被静默当成零成本', () => {
  const session = new Session()
  session.append('request/header', { header: { provider: 'x', model: 'unknown' }, reason: 'initial' }, 1)
  session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } } })
  const result = projectCost(session.events, book)
  assert.deepEqual(result.unpricedSteps, ['1:1'])
  assert.equal(result.pricedSteps, 0)
})
