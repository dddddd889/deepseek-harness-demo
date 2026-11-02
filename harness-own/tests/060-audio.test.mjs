import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { transcribe, translate } from '../src/audio.mjs'
import { ScriptModel, answer } from '../src/model.mjs'

test('语音走FormData与凭据，翻译复用已有模型流', async () => {
  const signal = new AbortController().signal
  const text = await transcribe(Buffer.from('fixed-audio'), { url: 'https://asr.example', key: 'test', model: 'asr' }, signal, async (url, request) => {
    assert.ok(request.body instanceof FormData); assert.equal(request.headers.authorization, 'Bearer test'); return Response.json({ text: '你好' })
  })
  assert.equal(text, '你好')
  assert.equal(await translate(text, '英语', new ScriptModel([answer('hello')]), signal), 'hello')
})
