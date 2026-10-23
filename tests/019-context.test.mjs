import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { compact, Spill } from '../src/context.mjs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('压缩不改日志，不拆当前工具组，溢出原文有完整性校验', async () => {
  const history = [{ role: 'user', content: 'x'.repeat(500) }, { role: 'assistant', content: 'old' }, { role: 'user', content: 'next' }]
  const result = await compact(history, { limit: 180, measure: value => JSON.stringify(value).length, summarize: async () => '关键事实', signal: new AbortController().signal })
  assert.equal(history[0].content.length, 500)
  assert.equal(result.at(-1).content, 'next')
  const root = mkdtempSync(join(tmpdir(), 'own-spill-'))
  try { const spill = new Spill(root), ref = spill.put('完整原文'); assert.equal(spill.get(ref.id), '完整原文'); writeFileSync(join(root, ref.id), 'bad'); assert.throws(() => spill.get(ref.id), /完整性/) }
  finally { rmSync(root, { recursive: true, force: true }) }
})