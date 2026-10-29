import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { PiModel } from '../src/pi.mjs'

test('真正 pi-ai SDK 解析固定 HTTP 流，领域层只见自己的 Part', async () => {
  const model = { id: 'test', name: 'test', api: 'openai-completions', provider: 'openai', baseUrl: 'http://model/v1', reasoning: false, input: ['text'], contextWindow: 8000, maxTokens: 2048, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
  const raw = [{ choices: [{ index: 0, delta: { role: 'assistant', content: '你好' }, finish_reason: null }] }, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]
  const adapter = new PiModel(model, 'test', async () => new Response(raw.map(value => 'data: ' + JSON.stringify(value) + '\n\n').join('') + 'data: [DONE]\n\n'))
  const received = []
  for await (const part of adapter.stream({ config: {}, messages: [{ role: 'user', content: 'hi' }], tools: [], signal: new AbortController().signal })) received.push(part)
  assert.equal(received.filter(part => part.kind === 'text').map(part => part.text).join(''), '你好')
  assert.equal(received.at(-1).reason, 'stop')
  assert.equal(received.find(part => part.kind === 'replay').value.provider, 'pi')
})