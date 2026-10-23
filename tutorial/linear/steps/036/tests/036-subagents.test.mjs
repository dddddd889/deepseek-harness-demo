import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Subagents } from '../src/subagents.mjs'
import { Scope } from '../src/scope.mjs'
import { Agent } from '../src/agent.mjs'
import { Events } from '../src/events.mjs'
import { Tools } from '../src/tools.mjs'
import { Settings } from '../src/config.mjs'
import { ScriptModel, answer } from '../src/model.mjs'

test('真实子Agent可继续对话，父关闭后资源撤销', async () => {
  const scope = new Scope(), model = new ScriptModel([answer('first'), answer('second')])
  const children = new Subagents(async () => new Agent(new Events(), model, new Tools(), new Settings()))
  const child = await children.create(scope, 'parent')
  children.send('parent', child, 'one'); await children.wait('parent', child)
  children.send('parent', child, 'two'); await children.wait('parent', child)
  assert.equal(model.requests.length, 2)
  assert.throws(() => children.interrupt('stranger', child), /权限/)
  await scope.close(); assert.equal(children.entries.size, 0)
})
