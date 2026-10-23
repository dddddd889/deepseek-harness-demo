import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { input } from '../src/main.mjs'

test('入口既接收中文，也通过退出码报告空任务', () => {
  assert.equal(input(['读取 README', '并解释']), '读取 README 并解释')
  assert.throws(() => input([]), /用法/)
  // 显式传当前环境，避免 Bun 默认缓存的启动环境把父调试地址带进子进程。
  const failed = spawnSync(process.execPath, ['src/main.mjs'], { env: { ...process.env }, encoding: 'utf8' })
  assert.equal(failed.status, 1)
  assert.match(failed.stderr, /用法/)
})
