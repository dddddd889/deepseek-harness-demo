import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { asset } from '../src/runtime-assets.mjs'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('真实写入运行时缓存，hash错误的载荷不能发布', async () => {
  const root = await mkdtemp(join(tmpdir(), 'own-runtime-')), bytes = Buffer.from('trusted-archive'), sha256 = createHash('sha256').update(bytes).digest('hex')
  try {
    const path = await asset({ url: 'https://runtime.example/archive', sha256 }, root, async () => new Response(bytes))
    assert.equal((await readFile(path)).toString(), 'trusted-archive')
    await assert.rejects(asset({ url: 'https://runtime.example/archive', sha256 }, root, async () => new Response('tampered')), /校验/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
