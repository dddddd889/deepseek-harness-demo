import { spawn } from 'node:child_process'
import { Peer, framing } from './rpc.mjs'
import { fileURLToPath } from 'node:url'

/** 自己的高层SDK只组合领域协议；不另起工具/历史/模型实现。 */
export class HarnessSDK {
  constructor({ home, cwd, env = process.env }) {
    if (!home) throw Error('SDK需要显式home')
    this.cwd = cwd
    // 禁止子进程自动加载.env；模型密钥等配置以显式传入的env为准。
    this.child = spawn(process.execPath, ['--no-env-file', fileURLToPath(new URL('./sdk-server.mjs', import.meta.url))], { cwd, env: { ...env, HARNESS_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stderr.resume()
    this.peer = framing(new Peer(), this.child.stdout, this.child.stdin)
    this.child.on('error', () => this.peer.close())
    this.closed = new Promise(resolve => this.child.once('close', resolve))
  }
  async create() { return await this.peer.request('session.create', { cwd: this.cwd }) }
  async run(id, content, onEvent = () => {}) {
    const notify = message => { if (message.method === 'session.event' && message.params.sessionId === id) onEvent(message.params) }
    this.peer.on('notification', notify)
    try {
      await this.peer.request('session.watch', { id })
      await this.peer.request('session.submit', { id, content })
      const ending = await this.peer.request('session.wait', { id }, 120_000)
      const events = await this.peer.request('session.read', { id })
      return { ending, events, text: events.filter(event => event.type === 'message/assistant').at(-1)?.data.content ?? '' }
    } finally { this.peer.off('notification', notify) }
  }
  cancel(id) { return this.peer.request('session.cancel', { id }) }
  async close() { this.child.stdin.end(); await this.closed; this.peer.close() }
}
