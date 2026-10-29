import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

test('真正PythonSDK驱动同一Bun Host并正常退出', () => {
  const root = mkdtempSync(join(tmpdir(), 'own-python-')), env = { ...process.env, PYTHONPATH: resolve('python') }; delete env.DEEPSEEK_API_KEY
  try {
    const result = spawnSync(process.env.PYTHON ?? 'python3', ['tests/fixtures/python-sdk.py', process.execPath, resolve('src/sdk-server.mjs'), root], { env, encoding: 'utf8', timeout: 10_000 })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /completed/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
