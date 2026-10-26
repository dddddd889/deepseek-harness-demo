import assert from 'node:assert/strict'
import { Peer } from '../src/rpc.mjs'

const budget = Number(process.env.RPC_DEMO_TIMEOUT_MS ?? 5_000) // 普通5秒，断点调试可显式给一小时。
assert.ok(Number.isFinite(budget) && budget > 0, 'RPC_DEMO_TIMEOUT_MS必须是正有限毫秒数；0不表示关闭超时')

let rejectFailure // 启动、连接、消息处理错误共用的失败出口。
const failure = new Promise((resolve, reject) => { rejectFailure = reject }) // 与所有等待操作竞速。
failure.catch(() => {}) // 错误发生在等待点之间也不会成为未处理的拒绝。
const wait = promise => Promise.race([promise, failure]) // 失败后立即转入finally回收资源。
const deadline = setTimeout(() => rejectFailure(Error('WebSocket示例超过总预算')), budget) // 不靠sleep等连接。
let server // Bun的本机HTTP/WebSocket服务器。
let serverSocket // Bun服务端收到的WebSocket连接。
let serverPeer // 这条服务端连接自己的RPC Peer。
let clientSocket // Bun提供的原生WebSocket客户端。
let clientPeer // 客户端自己的RPC Peer。
let clientClosed // 等客户端close事件，不把调用close误认为已经关闭。
let resolveServerClosed // 服务端close事件的完成通知。
const serverClosed = new Promise(resolve => { resolveServerClosed = resolve }) // 明确等待服务器连接关闭，不靠sleep。
let sum // 本次真正返回的计算结果。
let echo // 本次真正往返的中文内容。
let port // Bun实际监听的临时端口。

try {
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0, // 系统分配端口，不与其他示例抢固定地址。
    /** 只接收本示例的WebSocket升级，不在HTTP正文里传RPC。 */
    fetch(request, server) {
      if (server.upgrade(request)) return
      return new Response('需要WebSocket升级', { status: 426 })
    },
    websocket: {
      /** 一条WebSocket连接对应一个Peer；发送一次就是一条完整JSON文本消息。 */
      open(socket) {
        serverSocket = socket
        serverPeer = new Peer(message => socket.send(JSON.stringify(message)))
        serverPeer.handle('sum', ({ a, b }) => a + b)
        serverPeer.handle('echo', text => text)
        serverPeer.handle('hold', () => new Promise(() => {})) // 仅用于观察断连pending清理。
      },
      /** WebSocket已提供完整消息边界，直接解JSON交Peer，不再经过framing。 */
      message(socket, text) {
        if (typeof text !== 'string') {
          serverPeer?.close()
          rejectFailure(Error('服务端只接受JSON文本消息'))
          socket.close(1003, '只接受文本') // 二进制消息明确拒绝，不把Buffer或Blob强转字符串。
          return
        }
        try {
          const message = JSON.parse(text) // 本示例约定每条文本消息只装一个RPC对象。
          void serverPeer.receive(message).catch(error => {
            serverPeer.close()
            rejectFailure(error)
            socket.close(1002, 'RPC处理失败')
          })
        } catch (error) {
          serverPeer.close()
          rejectFailure(error)
          socket.close(1002, 'JSON无效')
        }
      },
      /** 对端断开后，关闭对应Peer，拒绝它尚未完成的请求。 */
      close() {
        serverPeer?.close()
        resolveServerClosed()
      },
      /** 其他服务端handler抛错时回调；本机Bun1.3.14实测只给第一个Error参数。 */
      error(error, socket) {
        serverPeer?.close()
        ;(socket ?? serverSocket)?.terminate() // 新版若给socket就使用它，当前版本用本示例捕获的连接。
        rejectFailure(error instanceof Error ? error : Error(String(error))) // 失败出口始终收到真实Error。
      },
    },
  }) // Bun.serve启动失败会直接跳到finally。
  port = server.port
  clientSocket = new WebSocket(`ws://127.0.0.1:${port}`)
  clientPeer = new Peer(message => clientSocket.send(JSON.stringify(message))) // 不添加Content-Length或换行分隔。
  clientClosed = new Promise(resolve => clientSocket.addEventListener('close', () => {
    clientPeer.close()
    resolve()
  }, { once: true })) // 断连会立即清掉客户端pending。
  clientSocket.addEventListener('error', () => {
    clientPeer.close()
    rejectFailure(Error('WebSocket客户端连接错误'))
  })
  clientSocket.addEventListener('message', event => {
    if (typeof event.data !== 'string') {
      clientPeer.close()
      rejectFailure(Error('客户端只接受JSON文本消息'))
      clientSocket.close(1003, '只接受文本')
      return
    }
    try {
      const message = JSON.parse(event.data) // 收到的是完整文本message，不是任意字节chunk。
      void clientPeer.receive(message).catch(error => {
        clientPeer.close()
        rejectFailure(error)
        clientSocket.close(1002, 'RPC处理失败')
      })
    } catch (error) {
      clientPeer.close()
      rejectFailure(error)
      clientSocket.close(1002, 'JSON无效')
    }
  })
  const opened = new Promise(resolve => clientSocket.addEventListener('open', resolve, { once: true })) // 发请求前必须等open。
  await wait(opened)
  sum = await wait(clientPeer.request('sum', { a: 2, b: 3 }, budget))
  assert.equal(sum, 5)
  echo = await wait(clientPeer.request('echo', '中文🙂', budget))
  assert.equal(echo, '中文🙂')
  await assert.rejects(wait(clientPeer.request('missing', {}, budget)), /未知方法/)
  const pending = clientPeer.request('hold', {}, budget) // 此时客户端等待一个故意不回复的请求。
  clientSocket.close(1000, '演示断开')
  await assert.rejects(wait(pending), /RPC连接断开/)
} finally {
  clientPeer?.close()
  serverPeer?.close()
  clientSocket?.close() // Peer.close不会替你关闭WebSocket。
  serverSocket?.terminate() // finally明确回收服务端这一条连接，触发close事件。
  try {
    server?.stop(true).catch(rejectFailure) // 请求停止监听；本机1.3.14有WS关闭后stop Promise不结束的情况，不拿它当关闭凭证。
    const connectionsClosed = Promise.all([clientClosed, serverSocket ? serverClosed : undefined]) // 真正等两侧close，而不是等到总期限。
    await Promise.race([connectionsClosed, failure.catch(() => {})]) // 已失败时也能有界回收。
  } finally {
    clearTimeout(deadline) // 成功后不留下保护定时器。
  }
}
await Promise.race([failure, Promise.resolve()]) // 清理时若总预算已失败，不输出伪成功。
assert.equal(clientPeer.pending.size, 0)
assert.equal(serverPeer.pending.size, 0)
assert.equal(clientSocket.readyState, WebSocket.CLOSED)
assert.equal(serverSocket.readyState, WebSocket.CLOSED)
console.log(JSON.stringify({ transport: 'WebSocket', port, sum, echo, unknownMethodRejected: true, pendingRejectedOnDisconnect: true, pending: [clientPeer.pending.size, serverPeer.pending.size], clientClosed: true, serverSocketClosed: true, serverStopRequested: true }))
