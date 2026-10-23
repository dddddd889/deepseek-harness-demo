import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

// 启动真实CLI，再由CLI启动工具worker，检查实际磁盘副作用与退出清理。
test('跨进程RPC调用工具并反向审批：允许才删除，拒绝保留', () => {
  const result = spawnSync(process.execPath, ['src/rpc-demo.mjs', '--auto'], {
    cwd: process.cwd(), env: { ...process.env }, encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const line = result.stdout.split('\n').find(row => row.startsWith('032验收结果：'))
  assert.ok(line, result.stdout)
  const report = JSON.parse(line.slice('032验收结果：'.length))
  assert.equal(report.separateProcess, true); assert.equal(report.sum, 5)
  assert.deepEqual(report.answers, [{ path: 'allow.txt', allowed: true }, { path: 'deny.txt', allowed: false }])
  assert.deepEqual(report.results, [{ path: 'allow.txt', deleted: true }, { path: 'deny.txt', deleted: false, reason: '用户拒绝' }])
  assert.equal(report.exitCode, 0); assert.equal(report.rpcPending, 0); assert.equal(report.approvalPending, 0)
}, 15_000)
