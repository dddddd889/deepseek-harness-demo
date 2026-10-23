import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { Peer, framing } from '../src/rpc.mjs'

test('双向LSP字节帧、中文、未知方法与断连等待清理', async () => {
  const left = new PassThrough(), right = new PassThrough(), a = framing(new Peer(), left, right, 'lsp'), b = framing(new Peer(), right, left, 'lsp')
  b.handle('echo', text => text)
  assert.equal(await a.request('echo', '中文'), '中文')
  await assert.rejects(a.request('missing', {}), /未知/)
  b.handle('hang', () => new Promise(() => {}))
  const pending = a.request('hang', {}); a.close()
  await assert.rejects(pending, /断开/)
  b.close(); left.destroy(); right.destroy()
})
