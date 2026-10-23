import { Readable, Writable } from 'node:stream'
import { ndJsonStream } from '@agentclientprotocol/sdk'
import { Host } from '../../src/host.mjs'
import { ScriptModel, answer } from '../../src/model.mjs'
import { acpApp } from '../../src/acp.mjs'
import { writeSync } from 'node:fs'

// 只替换外部模型，自己的Host/Loop/ACP实现全部真实执行。
const host = new Host(process.env.HARNESS_HOME, () => {
  const model = new ScriptModel([answer('golden-answer'), 'hang', answer('after-cancel')]), stream = model.stream.bind(model)
  model.stream = async function* (request) {
    for await (const part of stream(request)) { yield part; if (part.kind === 'text' && part.text === 'partial') writeSync(3, 'partial-consumed\n') }
  }
  return model
})
const connection = acpApp(host).connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
try { await connection.closed } finally { await host.close() }
