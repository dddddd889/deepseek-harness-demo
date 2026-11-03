import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { Readable, Writable } from 'node:stream'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import * as acp from '@agentclientprotocol/sdk'

/** 只规范化本组样本允许忽略的身份；停止原因与提交文字不能过滤。 */
export function signature(updates, endings) {
  return { messages: updates.filter(value => value.update.sessionUpdate === 'agent_message_chunk').map(value => value.update.content.text), endings }
}

/** 两边都是外部进程和真实ACP SDK连接；模型输入完全固定。 */
async function scenario(command, args, cwd, environment) {
  const home = mkdtempSync(join(tmpdir(), 'own-diff-')), child = spawn(command, args, { cwd, env: { ...environment, HARNESS_HOME: home }, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] }), exited = once(child, 'close'), updates = [], endings = []
  // 固定模型的独立测试通道确认首片已被Loop消费，取消不依赖随意sleep。
  const firstPartial = once(child.stdio[3], 'data')
  let errors = ''; child.stderr.on('data', bytes => { errors = (errors + bytes.toString()).slice(-8000) })
  const app = acp.client({ name: 'differential-sample' }).onNotification('session/update', ctx => { updates.push(ctx.params) })
  const connection = app.connect(acp.ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout))), client = connection.agent
  try {
    await client.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} })
    const session = await client.request(acp.methods.agent.session.new, { cwd: home, mcpServers: [] })
    const prompt = text => client.request(acp.methods.agent.session.prompt, { sessionId: session.sessionId, prompt: [{ type: 'text', text }] })
    endings.push((await prompt('one')).stopReason)
    const slow = prompt('two'); await firstPartial; await client.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId }); endings.push((await slow).stopReason)
    endings.push((await prompt('three')).stopReason)
    return { signature: signature(updates, endings), rawUpdates: updates }
  } catch (error) { throw Error(error.message + '\n' + errors) }
  finally { child.stdin.end(); const force = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(force); rmSync(home, { recursive: true, force: true }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = process.env.HARNESS_ORACLE_SOURCE
  if (!source) throw Error('先设置HARNESS_ORACLE_SOURCE，禁止缺原版时假装通过')
  let pinned
  try { pinned = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { pinned = JSON.parse(readFileSync(resolve(source, '.replica-course.json'), 'utf8')).commit }
  if (pinned !== '687f282e8625c6b8d11ff58211a90524be2e4317') throw Error('原版目录不是锁定提交')
  const own = await scenario(process.execPath, [resolve('tests/fixtures/own-acp.mjs')], process.cwd(), process.env)
  const oracle = await scenario(process.execPath, [resolve('scripts/oracle-acp.mjs')], source, process.env)
  const equal = JSON.stringify(own.signature) === JSON.stringify(oracle.signature)
  mkdirSync('.evidence', { recursive: true })
  writeFileSync('.evidence/acp-comparison.json', JSON.stringify({ baseline: '687f282e8625c6b8d11ff58211a90524be2e4317', scope: '仅固定文字、取消、取消后继续三个ACP样本；不是全产品等价', equal, own, oracle }, null, 2))
  console.log(JSON.stringify({ equal, signature: own.signature }, null, 2))
  if (!equal) process.exitCode = 1
}
