import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Events } from '../src/events.mjs'
import { Tools } from '../src/tools.mjs'
import { Settings } from '../src/config.mjs'
import { ScriptModel, answer } from '../src/model.mjs'
import { Agent } from '../src/agent.mjs'

test('首片取消、排队第二轮继续，配置快照不串轮', async () => {
  const session = new Events(), settings = new Settings({ model: 'first' }), model = new ScriptModel(['hang', answer('second')])
  const agent = new Agent(session, model, new Tools(), settings)
  session.on(event => {
    if (event.type === 'stream/text' && event.data.text === 'partial') { settings.set({ model: 'second' }); agent.submit('下一轮'); agent.cancel() }
  })
  agent.submit('第一轮')
  await agent.idle()
  assert.deepEqual(session.read().filter(event => event.type === 'turn/end').map(event => event.data.reason), ['cancelled', 'completed'])
  assert.deepEqual(model.requests.map(request => request.config.model), ['first', 'second'])
  await agent.close()
})
