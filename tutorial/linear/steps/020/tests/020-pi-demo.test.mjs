import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

/** 启动用户实际运行的入口，验证真实SDK、Routes、Agent和工具续轮，而非只测适配器。 */
test('020的CLI经pi-ai和DeepSeek路由贯通模型工具模型', () => {
  const result = spawnSync(process.execPath, ['src/pi-demo.mjs'], { cwd: process.cwd(), env: { ...process.env }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const line = result.stdout.split('\n').find(value => value.startsWith('020验收结果：'))
  assert.ok(line, result.stdout)
  const report = JSON.parse(line.slice('020验收结果：'.length))
  assert.equal(report.mode, 'offline'); assert.equal(report.route, 'deepseek-pi')
  assert.equal(report.provider, 'deepseek'); assert.equal(report.model, 'deepseek-flash')
  assert.equal(report.reason, 'completed'); assert.equal(report.requests, 2); assert.equal(report.http, 2)
  assert.equal(report.toolRuns, 1); assert.equal(report.finalText, '5')
  assert.equal(report.historyChecked, true); assert.equal(report.reasoningReplayed, true)
  assert.deepEqual(report.replayProviders, ['pi', 'pi']); assert.equal(report.usageEvents, 2)
  assert.deepEqual(report.cleanup, { agentClosed: true, routes: 0, tools: 0, listeners: 0 })
})

/** 显式真实模式缺少Key必须失败，不能偷偷改跑固定响应后宣称真实通过。 */
test('020真实模式缺少凭据拒绝运行，不回退离线', () => {
  const result = spawnSync(process.execPath, ['src/pi-demo.mjs', '--live'], { cwd: process.cwd(), env: { ...process.env, DEEPSEEK_API_KEY: '' }, encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /缺少DEEPSEEK_API_KEY/)
  assert.ok(!result.stdout.includes('020验收结果：'))
})
