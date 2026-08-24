import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { DeepSeekProvider, mapDeepSeekUsage, translateDeepSeek } from './deepseek-provider.ts'
import type { DeepSeekFetch } from './deepseek-provider.ts'

/** 将字符串数组包装成异步 载荷 流。 */
async function* payloads(values: readonly string[]): AsyncGenerator<string> {
  for (const value of values) yield value
}

test('DeepSeek 用量转换成互斥缓存桶', () => {
  assert.deepEqual(mapDeepSeekUsage({
    prompt_tokens: 100,
    completion_tokens: 20,
    prompt_cache_hit_tokens: 40,
    completion_tokens_details: { reasoning_tokens: 8 },
  }), { inputTokens: 60, outputTokens: 20, cacheReadTokens: 40, reasoningTokens: 8 })
})

test('DeepSeek 转换器在结束标记处按内容块结束、用量和终止帧收尾', async () => {
  const chunks = []
  for await (const chunk of translateDeepSeek(payloads([
    JSON.stringify({ choices: [{ delta: { reasoning_content: '想' } }] }),
    JSON.stringify({ choices: [{ delta: { content: '答' }, finish_reason: 'stop' }] }),
    JSON.stringify({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
    '[DONE]',
  ]))) chunks.push(chunk)
  assert.deepEqual(chunks.map(chunk => chunk.type), [
    'block-start', 'reasoning-delta', 'block-start', 'text-delta',
    'block-end', 'block-end', 'usage', 'finish',
  ])
  assert.deepEqual(chunks.at(-2), { type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } })
})

test('DeepSeek 提供方每次解析密钥，并正确发送流请求', async () => {
  let capturedURL = ''
  let capturedInit: RequestInit | undefined
  const fakeFetch: DeepSeekFetch = async (input, init) => {
    capturedURL = String(input)
    capturedInit = init
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\n`,
      'data: [DONE]\n\n',
    ].join('')
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  const provider = new DeepSeekProvider({ apiKey: () => 'secret-for-test', baseURL: 'https://example.test/', fetch: fakeFetch })
  const chunks = []
  for await (const chunk of provider.stream({
    provider: 'deepseek-official', model: 'deepseek-chat', messages: [], system: '你是助手',
  }, new AbortController().signal)) chunks.push(chunk)

  assert.equal(capturedURL, 'https://example.test/chat/completions')
  assert.equal(new Headers(capturedInit?.headers).get('authorization'), 'Bearer secret-for-test')
  assert.match(String(capturedInit?.body), /"stream":true/)
  assert.equal(chunks.at(-1)?.type, 'finish')
})

test('缺少密钥在网络请求前失败', async () => {
  let called = false
  const provider = new DeepSeekProvider({ apiKey: () => undefined, fetch: async () => { called = true; return new Response() } })
  await assert.rejects(async () => {
    for await (const _chunk of provider.stream({ provider: 'deepseek-official', model: 'x', messages: [] }, new AbortController().signal)) {
      // 消费异步流才能触发请求前校验。
    }
  }, /DEEPSEEK_API_KEY/)
  assert.equal(called, false)
})
