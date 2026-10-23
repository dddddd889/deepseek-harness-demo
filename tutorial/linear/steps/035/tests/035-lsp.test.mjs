import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { languageServer } from '../src/lsp.mjs'
import { Scope } from '../src/scope.mjs'
import { resolve } from 'node:path'

test('真实进程LSP握手、文档通知、定义查询、关闭', async () => {
  const scope = new Scope()
  try {
    const lsp = await languageServer(scope, { command: process.execPath, args: ['tests/fixtures/lsp.mjs'] }, process.cwd())
    const path = resolve('example.ts')
    lsp.open(path, 'const x = 1', 'typescript')
    lsp.change(path, 'const x = 2')
    const result = await lsp.query('definition', path, 0, 7)
    assert.ok(result.uri.endsWith('example.ts')); assert.equal(result.range.start.line, 0)
  } finally { await scope.close() }
})
