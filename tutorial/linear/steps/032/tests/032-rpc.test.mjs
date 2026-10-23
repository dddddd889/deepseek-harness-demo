import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { Peer, framing } from '../src/rpc.mjs'

test('双向LSP字节帧、中文、未知方法与断连等待清理', async () => {
  const left = new PassThrough(), right = new PassThrough() // 两个方向的字节通道。
  const a = new Peer(), b = new Peer() // 两边各自管理请求和等待表。
  framing(a, left, right, 'lsp') // A读取left，写入right。
  framing(b, right, left, 'lsp') // B读取right，写入left。
  b.handle('echo', text => text)
  assert.equal(await a.request('echo', '中文'), '中文')
  await assert.rejects(a.request('missing', {}), /未知/)
  b.handle('hang', () => new Promise(() => {}))
  const pending = a.request('hang', {}); a.close()
  await assert.rejects(pending, /断开/)
  b.close(); left.destroy(); right.destroy()
})
