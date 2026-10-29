import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtempSync, appendFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Journal } from '../src/journal.mjs'
import { Events } from '../src/events.mjs'

test('重启恢复、双写拒绝、尾半行修复、中间损坏拒绝', () => {
  const root = mkdtempSync(join(tmpdir(), 'own-log-')), path = join(root, 'events.jsonl')
  try {
    const log = new Journal(path), session = new Events('s', event => log.append(event))
    session.append('user', { text: '中文\n换行' })
    assert.throws(() => new Journal(path), /EEXIST/)
    log.close()
    appendFileSync(path, '{"seq":')
    const restored = new Journal(path)
    assert.equal(restored.records[0].data.text, '中文\n换行')
    restored.close()
    appendFileSync(path, 'broken\n')
    assert.throws(() => new Journal(path), SyntaxError)
  } finally { rmSync(root, { recursive: true, force: true }) }
})