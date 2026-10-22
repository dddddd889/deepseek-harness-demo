import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { sse } from '../src/sse.mjs'

test('按单字节分割中文、CRLF、多行 data，残帧拒绝', async () => {
  const raw = Buffer.from('data: 你好\r\n\r\ndata: a\ndata: b\n\n'), pieces = [...raw].map(byte => Uint8Array.of(byte)), received = []
  for await (const value of sse(pieces)) received.push(value)
  assert.deepEqual(received, ['你好', 'a\nb'])
  await assert.rejects(async () => { for await (const value of sse([Buffer.from('data: partial')])) {} }, /尾帧/)
})