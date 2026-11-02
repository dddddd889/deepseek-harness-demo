import { HarnessSDK } from './sdk.mjs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** 有界外部Worker使用同一SDK协议；拒绝超额，不无限启动进程。 */
export class Workers {
  active = new Map()
  constructor(home, limit = 2, env = process.env) { this.home = home; this.limit = limit; this.env = env }
  async run(scope, cwd, text, signal) {
    if (this.active.size >= this.limit) throw Error('Worker超额')
    const id = randomUUID(), sdk = new HarnessSDK({ home: join(this.home, id), cwd, env: this.env })
    this.active.set(id, sdk)
    const close = scope.own(async () => { await sdk.close(); this.active.delete(id) })
    let sessionId
    const abort = () => { if (sessionId) void sdk.cancel(sessionId).catch(() => {}) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      signal.throwIfAborted(); const session = await sdk.create(); sessionId = session.id
      signal.throwIfAborted(); return await sdk.run(sessionId, text)
    } finally { signal.removeEventListener('abort', abort); await close() }
  }
}
