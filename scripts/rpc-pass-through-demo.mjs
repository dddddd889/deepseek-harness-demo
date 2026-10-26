import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { Peer, framing } from '../src/rpc.mjs'

const budget = Number(process.env.RPC_DEMO_TIMEOUT_MS ?? 5_000) // 普通5秒，断点调试可显式给一小时。
assert.ok(Number.isFinite(budget) && budget > 0, 'RPC_DEMO_TIMEOUT_MS必须是正有限毫秒数；0不表示关闭超时')

const bToA = new PassThrough() // B向A发送的字节管道，A从这里读取。
const aToB = new PassThrough() // A向B发送的字节管道，B从这里读取。
const a = new Peer() // A拥有自己的请求ID和pending等待表。
const b = new Peer() // B拥有另一份方法表与等待表，不与A共享。
framing(a, bToA, aToB, 'lsp') // 读取端在前，写入端在后。
framing(b, aToB, bToA, 'lsp') // 两条管道交叉接线，仍按Content-Length拆帧。
b.handle('sum', ({ a, b }) => a + b) // 固定演示请求参数和返回值。
b.handle('hold', () => new Promise(() => {})) // 故意不回复，只用于观察关闭时清理pending。

const deadline = setTimeout(() => {
  a.close() // 请求等待不能因为示例故障无限挂住。
  b.close()
  bToA.destroy()
  aToB.destroy()
}, budget) // 有界保护，不用sleep协调消息到达。
let sum // 保存本次RPC真正返回的结果。
try {
  sum = await a.request('sum', { a: 2, b: 3 }, budget)
  assert.equal(sum, 5)
  await assert.rejects(a.request('missing', {}, budget), /未知方法/) // Peer负责把远端错误对应回原请求。
  const pending = a.request('hold', {}, budget) // 此时A等待表里有一项。
  a.close() // 只关闭本地Peer，原等待会以RPC连接断开失败。
  await assert.rejects(pending, /RPC连接断开/)
} finally {
  a.close()
  b.close()
  bToA.destroy() // Peer.close不等于关闭字节流，流也必须由拥有者回收。
  aToB.destroy()
  clearTimeout(deadline) // 成功后不留下保护定时器。
}
assert.equal(a.pending.size, 0)
assert.equal(b.pending.size, 0)
assert.ok(bToA.destroyed && aToB.destroyed)
console.log(JSON.stringify({ transport: 'PassThrough', sum, unknownMethodRejected: true, pendingRejectedOnClose: true, pending: [a.pending.size, b.pending.size], streamsDestroyed: true }))
