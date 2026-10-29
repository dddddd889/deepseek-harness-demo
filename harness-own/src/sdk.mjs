import { spawn } from 'node:child_process'
import { Peer, framing } from './rpc.mjs'
import { fileURLToPath } from 'node:url'

/** 自己的高层SDK只组合领域协议；不另起工具/历史/模型实现。 */
export class HarnessSDK {
  constructor({ home, cwd, env = process.env }) {
    if (!home) throw Error('SDK需要显式home')
    this.cwd = cwd
    // 普通测试不等待子调试器；只有专用配置明确打开时，Host才等待附加。
    const debugHost = env.SDK_DEBUG_HOST === '1'
    // 暂停断点时延长父进程的RPC等待；普通运行仍保留正常超时。
    this.requestTimeout = debugHost ? 3_600_000 : 10_000
    const runtimeArgs = debugHost ? ['--inspect-wait=127.0.0.1:0'] : []
    // 显式传递环境，禁止重读.env，也不让Host继承父调试器的监听地址。
    const childEnv = { ...env, HARNESS_HOME: home }
    delete childEnv.BUN_INSPECT
    delete childEnv.BUN_INSPECT_NOTIFY
    this.child = spawn(process.execPath, [...runtimeArgs, '--no-env-file', fileURLToPath(new URL('./sdk-server.mjs', import.meta.url))], { cwd, env: childEnv, stdio: ['pipe', 'pipe', debugHost ? 'inherit' : 'pipe'] })
    this.child.stderr?.resume()
    this.peer = framing(new Peer(), this.child.stdout, this.child.stdin)
    this.child.on('error', () => this.peer.close())
    this.closed = new Promise(resolve => this.child.once('close', resolve))
  }
  async create() { return await this.peer.request('session.create', { cwd: this.cwd }, this.requestTimeout) }
  async run(id, content, onEvent = () => {}) {
    const notify = message => { if (message.method === 'session.event' && message.params.sessionId === id) onEvent(message.params) }
    this.peer.on('notification', notify)
    try {
      await this.peer.request('session.watch', { id }, this.requestTimeout)
      await this.peer.request('session.submit', { id, content }, this.requestTimeout)
      const ending = await this.peer.request('session.wait', { id }, Math.max(120_000, this.requestTimeout))
      const events = await this.peer.request('session.read', { id }, this.requestTimeout)
      return { ending, events, text: events.filter(event => event.type === 'message/assistant').at(-1)?.data.content ?? '' }
    } finally { this.peer.off('notification', notify) }
  }
  cancel(id) { return this.peer.request('session.cancel', { id }, this.requestTimeout) }
  async close() { this.child.stdin.end(); await this.closed; this.peer.close() }
}
