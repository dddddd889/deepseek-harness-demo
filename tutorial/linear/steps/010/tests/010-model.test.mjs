import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { ScriptModel, answer } from '../src/model.mjs'

test('模型按片输出，signal 能结束正在等待的外部流', async () => {
  const model = new ScriptModel([answer('你好'), 'hang']), controller = new AbortController()
  const chunks = []
  for await (const part of model.stream({ signal: controller.signal })) chunks.push(part)
  assert.deepEqual(chunks.map(part => part.kind), ['text', 'finish'])
  const stream = model.stream({ signal: controller.signal })
  assert.equal((await stream.next()).value.text, 'partial')
  controller.abort()
  await assert.rejects(stream.next(), /abort/i)
})
