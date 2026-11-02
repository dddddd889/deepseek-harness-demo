import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Telemetry } from '../src/telemetry.mjs'

test('真正序列化OTLP白名单，Key和prompt不发送，失败不阻断业务', async () => {
  let sent
  const telemetry = new Telemetry({ enabled: true, endpoint: 'http://collector/v1/logs', fetcher: async (url, request) => { sent = request.body; return new Response('', { status: 503 }) } })
  telemetry.record('turn/end', { sessionId: 's', prompt: 'private text', apiKey: 'secret-value', reason: 'completed' })
  assert.equal(await telemetry.flush(), false)
  assert.ok(!sent.includes('private text') && !sent.includes('secret-value'))
  assert.equal(JSON.parse(sent).resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue, 'turn/end')
})
