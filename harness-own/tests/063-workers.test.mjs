import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Workers } from '../src/workers.mjs'
import { Scope } from '../src/scope.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('真实隔离Host进程完成Worker任务，关闭后配额归还', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-workers-')), workers = new Workers(root), scope = new Scope()
  try {
    const result = await workers.run(scope, root, 'worker', new AbortController().signal)
    assert.match(result.text, /worker/); assert.equal(workers.active.size, 0)
    workers.limit = 0
    await assert.rejects(workers.run(scope, root, 'no', new AbortController().signal), /超额/)
  } finally { await scope.close(); rmSync(root, { recursive: true, force: true }) }
})
