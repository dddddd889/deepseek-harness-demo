import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

/** 启动学习者实际运行的CLI入口，验收完整Agent/路由/解析/工具链及清理。 */
test('018独立demo贯通路由重试、工具及并发鉴权前的单次刷新', () => {
  const result = spawnSync(process.execPath, ['src/routes-demo.mjs'], { cwd: process.cwd(), env: { ...process.env }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const summary = result.stdout.split('\n').find(line => line.startsWith('018验收结果：'))
  assert.ok(summary, result.stdout)
  const report = JSON.parse(summary.slice('018验收结果：'.length))
  assert.deepEqual(report.scenarios.map(scene => scene.reason), ['completed', 'completed', 'error', 'error', 'error', 'completed'])
  assert.deepEqual(report.scenarios.map(scene => [scene.mainHTTP, scene.altHTTP]), [[3, 0], [0, 1], [1, 0], [0, 0], [2, 0], [0, 0]])
  assert.equal(report.scenarios[0].requests, 2)
  assert.equal(report.scenarios[0].text, '5')
  assert.equal(report.scenarios[2].text, '已经输出的半句')
  assert.equal(report.scenarios[2].interrupted, true)
  assert.deepEqual(report.stats, { mainHTTP: 6, altHTTP: 1, toolRuns: 1, replayChecked: true })
  // 不只数刷新次数：还检查等待阶段没有发HTTP，以及两个实际请求头都已更新。
  assert.deepEqual(report.oauth.beforeRelease, { getCalls: 2, refreshes: 1, modelHTTP: 0, pending: true })
  assert.equal(report.oauth.refreshes, 1); assert.equal(report.oauth.writes, 1); assert.equal(report.oauth.modelHTTP, 2)
  assert.deepEqual(report.oauth.requests.map(request => [request.label, request.usedNewToken, request.savedBeforeSend]).sort(), [['A', true, true], ['B', true, true]])
  assert.deepEqual(report.oauth.reasons, ['completed', 'completed'])
  assert.deepEqual(report.oauth.texts, ['A完成', 'B完成'])
  assert.equal(report.oauth.pendingCleared, true)
  assert.deepEqual(report.oauth.cleanup, { agentsClosed: true, listeners: 0, routeRemoved: true })
  assert.deepEqual(report.cleanup, { agentClosed: true, routes: 0, tools: 0, listeners: 0 })
})
