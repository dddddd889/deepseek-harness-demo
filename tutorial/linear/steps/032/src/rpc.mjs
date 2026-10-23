import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'

/** JSON-RPC双向Peer，单一传输同时承载请求、响应、通知和反向审批。 */
export class Peer extends EventEmitter {
  pending = new Map()
  methods = new Map()
  closed = false
  constructor(send) { super(); this.send = send }
  handle(method, handler) { if (this.methods.has(method)) throw Error('重复RPC方法'); this.methods.set(method, handler); return () => this.methods.delete(method) }
  /** 请求超时只结束本次等待；领域取消须显式发送取消方法。 */
  request(method, params, timeout = 10_000) {
    if (this.closed) return Promise.reject(Error('RPC已关闭'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('RPC超时：' + method)) }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ jsonrpc: '2.0', id, method, params }) }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }
  notify(method, params) { if (!this.closed) this.send({ jsonrpc: '2.0', method, params }) }
  /** 任何handler异常变成关联错误，不能让整个连接静默消失。 */
  async receive(message) {
    if (message.jsonrpc !== '2.0') throw Error('RPC版本错误')
    if ('method' in message) {
      const handler = this.methods.get(message.method)
      if (!('id' in message)) { if (handler) await handler(message.params); else this.emit('notification', message); return }
      try {
        if (!handler) throw Object.assign(Error('未知方法'), { code: -32601 })
        const result = await handler(message.params)
        if (!this.closed) this.send({ jsonrpc: '2.0', id: message.id, result: result ?? null })
      } catch (error) { if (!this.closed) this.send({ jsonrpc: '2.0', id: message.id, error: { code: error.code ?? -32603, message: error.message } }) }
    } else {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer); this.pending.delete(message.id)
      if (message.error) pending.reject(Object.assign(Error(message.error.message), { code: message.error.code })); else pending.resolve(message.result)
    }
  }
  close() { this.closed = true; for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error('RPC连接断开')) }; this.pending.clear(); this.emit('closed') }
}

/** 分帧器支持NDJSON和LSP Content-Length；都按字节长度而非字符数。 */
export function framing(peer, readable, writable, mode = 'ndjson') {
  let buffer = Buffer.alloc(0)
  peer.send = message => {
    const bytes = Buffer.from(JSON.stringify(message)), packet = mode === 'lsp' ? Buffer.concat([Buffer.from('Content-Length: ' + bytes.length + '\r\n\r\n'), bytes]) : Buffer.concat([bytes, Buffer.from('\n')])
    if (!writable.write(packet) && writable.writableLength > 1024 * 1024) throw Error('RPC消费者过慢')
  }
  readable.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk])
    if (buffer.length > 2 * 1024 * 1024) { peer.close(); return }
    for (;;) {
      let size, start
      if (mode === 'lsp') {
        const header = buffer.indexOf('\r\n\r\n'); if (header < 0) break
        const match = /^Content-Length: (\d+)$/im.exec(buffer.subarray(0, header).toString())
        if (!match) { peer.close(); return }
        size = Number(match[1]); start = header + 4; if (buffer.length < start + size) break
      } else { size = buffer.indexOf(10); start = 0; if (size < 0) break }
      const raw = buffer.subarray(start, start + size); buffer = buffer.subarray(start + size + (mode === 'lsp' ? 0 : 1))
      try { void peer.receive(JSON.parse(raw.toString())).catch(() => peer.close()) } catch { peer.close() }
    }
  })
  readable.on('end', () => peer.close()); readable.on('error', () => peer.close()); writable.on('error', () => peer.close())
  return peer
}
