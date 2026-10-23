import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { ModelFiles } from '../src/files.mjs'

test('相同内容并发只上传一次，失败不污染缓存', async () => {
  let count = 0, fail = true
  const store = new ModelFiles({ root: 'http://files/v1', key: 'test', fetcher: async () => {
    count++; if (fail) return new Response('', { status: 500 }); return Response.json({ id: 'file-1' })
  } }), signal = new AbortController().signal, bytes = Buffer.from('image-bytes')
  await assert.rejects(store.upload(bytes, 'image/png', signal), /500/)
  fail = false
  assert.deepEqual(await Promise.all([store.upload(bytes, 'image/png', signal), store.upload(bytes, 'image/png', signal)]), ['file-1', 'file-1'])
  assert.equal(count, 2)
})
