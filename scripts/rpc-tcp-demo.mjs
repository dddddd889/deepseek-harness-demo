import assert from 'node:assert/strict'
import { createServer, createConnection } from 'node:net'
import { Peer, framing } from '../src/rpc.mjs'

const budget = Number(process.env.RPC_DEMO_TIMEOUT_MS ?? 5_000) // 普通5秒，断点调试可显式给一小时。
assert.ok(Number.isFinite(budget) && budget > 0, 'RPC_DEMO_TIMEOUT_MS必须是正有限毫秒数；0不表示关闭超时')

let rejectFailure // 所有启动、连接和传输错误共用一个失败出口。
const failure = new Promise((resolve, reject) => { rejectFailure = reject }) // 在每个等待点与它竞速。
failure.catch(() => {}) // 即使错误发生在两个await之间，也不会成为未处理的拒绝。
const wait = promise => Promise.race([promise, failure]) // 出错或总期限到达，就结束当前等待。
const deadline = setTimeout(() => rejectFailure(Error('TCP示例超过总预算')), budget) // 不用sleep等待服务端启动。
let serverSocket // 服务端accept得到的node:net.Socket。
let serverPeer // 服务端这条连接专属的Peer。
let clientSocket // 客户端创建的node:net.Socket，同样是Duplex。
let clientPeer // 客户端这一侧的Peer。
let sum // 保存真正收到的RPC结果。
let port // 系统分配的临时端口，避免固定端口冲突。

const server = createServer(socket => {
  serverSocket = socket // 这个最小示例只创建一个客户端连接。
  serverPeer = new Peer()
  framing(serverPeer, socket, socket, 'lsp') // 同一个Duplex同时作为读取端和写入端。
  socket.once('close', () => serverPeer.close()) // 原framing只订阅end/error，本地destroy还要兜底close。
  socket.on('error', rejectFailure) // 连接错误同样终止外层等待。
  serverPeer.handle('sum', ({ a, b }) => a + b)
  serverPeer.handle('hold', () => new Promise(() => {})) // 用于验证断连会唤醒等待方。
})
server.on('error', rejectFailure) // listen失败也进入finally清理。

try {
  const listening = new Promise(resolve => server.once('listening', resolve)) // 先订阅，再开始监听。
  server.listen(0, '127.0.0.1') // 真实TCP回环连接，只绑定本机，端口由系统分配。
  await wait(listening)
  port = server.address().port
  clientSocket = createConnection({ host: '127.0.0.1', port })
  clientPeer = new Peer()
  framing(clientPeer, clientSocket, clientSocket, 'lsp') // 必须传node流，不能直接塞Bun.connect的原生socket。
  clientSocket.once('close', () => clientPeer.close()) // 本地destroy也立即清理pending。
  clientSocket.on('error', rejectFailure)
  const connected = new Promise(resolve => clientSocket.once('connect', resolve)) // 连接成功后再发业务请求。
  await wait(connected)
  sum = await wait(clientPeer.request('sum', { a: 2, b: 3 }, budget))
  assert.equal(sum, 5)
  await assert.rejects(wait(clientPeer.request('missing', {}, budget)), /未知方法/)
  const pending = clientPeer.request('hold', {}, budget) // 模拟已经发出但还没有回复的请求。
  clientSocket.destroy() // 主动断开底层TCP，close监听会关闭本地Peer。
  await assert.rejects(wait(pending), /RPC连接断开/)
} finally {
  clientPeer?.close()
  serverPeer?.close()
  clientSocket?.destroy() // 只清pending还不够，TCP socket也要关闭。
  serverSocket?.destroy()
  try {
    const closed = new Promise(resolve => {
      try { server.close(() => resolve()) } // 关闭监听；尚未成功监听时callback也会结束。
      catch { resolve() } // 同步启动失败时仍允许执行余下清理。
    })
    await Promise.race([closed, failure.catch(() => {})]) // 出错路径不再无限等待close回调。
  } finally {
    clearTimeout(deadline)
  }
}
await Promise.race([failure, Promise.resolve()]) // 清理阶段若耗尽总预算，也不能把失败当成成功。
assert.equal(clientPeer.pending.size, 0)
assert.equal(serverPeer.pending.size, 0)
assert.ok(clientSocket.destroyed && serverSocket.destroyed)
assert.equal(server.listening, false)
console.log(JSON.stringify({ transport: 'TCP', port, sum, unknownMethodRejected: true, pendingRejectedOnDisconnect: true, pending: [clientPeer.pending.size, serverPeer.pending.size], socketsDestroyed: true, serverListening: server.listening }))
