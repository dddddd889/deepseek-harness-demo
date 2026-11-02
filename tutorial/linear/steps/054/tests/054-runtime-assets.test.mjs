import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { asset } from '../src/runtime-assets.mjs'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('真实写入运行时缓存，hash错误的载荷不能发布', async () => {
  // 测试同时扮演发布方与下载方：先准备可信内容并计算预期摘要；真实应用应提前固定在锁清单中。
  const root = await mkdtemp(join(tmpdir(), 'own-runtime-')), bytes = Buffer.from('trusted-archive'), sha256 = createHash('sha256').update(bytes).digest('hex')
  try {
    // 注入假下载函数，直接返回内存字节，不连接示例域名，也不下载真实运行时。
    const path = await asset({ url: 'https://runtime.example/archive', sha256 }, root, async () => new Response(bytes))
    assert.equal((await readFile(path)).toString(), 'trusted-archive')
    // 保持预期摘要不变，改动返回内容，确认写缓存前就拒绝。
    await assert.rejects(asset({ url: 'https://runtime.example/archive', sha256 }, root, async () => new Response('tampered')), /校验/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
