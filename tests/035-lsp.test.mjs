import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { languageServer } from '../src/lsp.mjs'
import { Scope } from '../src/scope.mjs'
import { resolve } from 'node:path'

test('真实进程LSP握手、文档通知、定义查询、关闭', async () => {
  const scope = new Scope()
  try {
    // const lsp = await languageServer(scope, { command: process.execPath, args: ['tests/fixtures/lsp.mjs'] }, process.cwd())
		// 只在显式调试时开启子进程Inspector。
		const debugLsp = process.env.LSP_DEBUG === '1'
		const lsp = await languageServer(scope, {
			command: process.execPath,
			args: [
				...(debugLsp ? ['--inspect-brk=127.0.0.1:6502/lsp-035'] : []),
				'tests/fixtures/lsp.mjs',
			],
		}, process.cwd())
    const path = resolve('example.ts')
    lsp.open(path, 'const x = 1', 'typescript')
    lsp.change(path, 'const x = 2')
    const result = await lsp.query('definition', path, 0, 7)
    assert.ok(result.uri.endsWith('example.ts')); assert.equal(result.range.start.line, 0)
  } finally { await scope.close() }
})