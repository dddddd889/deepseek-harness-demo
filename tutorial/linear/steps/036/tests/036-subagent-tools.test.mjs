import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Agent } from '../src/agent.mjs'
import { Settings } from '../src/config.mjs'
import { Events } from '../src/events.mjs'
import { ScriptModel, answer } from '../src/model.mjs'
import { Scope } from '../src/scope.mjs'
import { Subagents } from '../src/subagents.mjs'
import { subagentTools } from '../src/subagent-tools.mjs'
import { runSubagentsDemo } from '../src/subagents-demo.mjs'
import { Tools } from '../src/tools.mjs'

test('父模型从动态编号继续send/wait，读孩子真实计算结果再回答', async () => {
  const report = await runSubagentsDemo({ write: () => {} }) // 跑普通demo的同一入口，不另造内存echo。
  assert.deepEqual(report.parentToolSequence, ['subagent_create', 'subagent_send', 'subagent_wait'])
  assert.equal(report.parentRequests, 4); assert.equal(report.childRequests, 3)
  assert.equal(report.childToolRuns, 1); assert.equal(report.childTurns, 2)
  assert.equal(report.childResult.total, 57)
  assert.equal(report.finalText, '子Agent已计算：订单总价为57元。')
  assert.equal(report.cleanup.children, 0); assert.equal(report.cleanup.parentTools, 0)
})

test('改变订单后父答案跟随孩子工具结果，不能写死样本57', async () => {
  const report = await runSubagentsDemo({ unitPrice: 23, quantity: 5, write: () => {} })
  assert.equal(report.childResult.total, 115)
  assert.equal(report.finalText, '子Agent已计算：订单总价为115元。')
})

test('子Agent工具仍受参数、守卫和归属检查约束，关闭后全部注销', async () => {
  const scope = new Scope(), tools = new Tools(), context = { signal: new AbortController().signal }
  let factoryCalls = 0 // 参数错误或守卫拒绝时，工厂不该创建任何孩子。
  const children = new Subagents(async () => {
    factoryCalls++
    return new Agent(new Events(), new ScriptModel([answer('ready')]), new Tools(), new Settings())
  })
  subagentTools(scope, tools, children, 'parent-session')
  try {
    assert.equal(tools.catalog().length, 4)
    assert.ok(tools.catalog().every(tool => !('run' in tool)))
    await assert.rejects(tools.execute({ name: 'subagent_create', arguments: { task: 123 } }, context), /类型/)
    tools.guard = async () => { throw Error('用户拒绝') }
    await assert.rejects(tools.execute({ name: 'subagent_create', arguments: { task: 'prepare' } }, context), /拒绝/)
    assert.equal(factoryCalls, 0)
    tools.guard = async () => {}
    const foreignId = await children.create(scope, 'stranger') // 归属检查发生在Tools包装后，不能靠知道编号绕过。
    await assert.rejects(tools.execute({ name: 'subagent_send', arguments: { id: foreignId, text: 'wrong owner' } }, context), /权限/)
    await assert.rejects(tools.execute({ name: 'subagent_wait', arguments: { id: foreignId } }, context), /权限/)
    await assert.rejects(tools.execute({ name: 'subagent_interrupt', arguments: { id: foreignId } }, context), /权限/)
  } finally { await scope.close() }
  assert.equal(children.entries.size, 0)
  assert.equal(tools.catalog().length, 0)
  await assert.rejects(tools.execute({ name: 'subagent_create', arguments: { task: 'closed' } }, context), /未知工具/)
})

test('显式live缺凭据时失败，不能静默回退成离线成功', async () => {
  await assert.rejects(runSubagentsDemo({ live: true, write: () => {} }), /DEEPSEEK_API_KEY/)
})
