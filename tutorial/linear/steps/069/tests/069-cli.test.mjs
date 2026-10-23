import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

test('最终CLI真正调用同一个持久Host读取实际工作区文件', () => {
  const root = mkdtempSync(join(tmpdir(), 'own-final-cli-')), env = { ...process.env, HARNESS_HOME: join(root, 'data') }
  delete env.DEEPSEEK_API_KEY; delete env.HARNESS_SESSION
  try {
    writeFileSync(join(root, 'proof.txt'), '真实文件正文')
    const result = spawnSync(process.execPath, [resolve('src/main.mjs'), '/tool read {"path":"proof.txt"}'], { cwd: root, env, encoding: 'utf8', timeout: 10_000 })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /真实文件正文/); assert.match(result.stdout, /completed/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
