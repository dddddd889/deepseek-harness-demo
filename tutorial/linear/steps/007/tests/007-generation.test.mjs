import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Generations } from '../src/generation.mjs'

test('发布前崩溃保留旧代次，迁移不改旧文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'own-generation-'))
  try {
    const store = new Generations(root), old = store.publish({ version: 1, name: 'a' })
    assert.throws(() => store.publish({ version: 2 }, () => { throw Error('crash') }))
    assert.equal(store.read().version, 1)
    store.migrate(2, { 1: value => ({ ...value, version: 2, title: value.name }) })
    assert.equal(JSON.parse(readFileSync(join(root, old))).version, 1)
    assert.equal(store.read().title, 'a')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
