import { PassThrough } from 'node:stream'
import { setImmediate } from 'node:timers/promises'
import { Peer, framing } from './rpc.mjs'

// NDJSON协议：每条JSON消息末尾都有换行符。
const request =
  '{"jsonrpc":"2.0","id":1,"method":"session.list","params":{}}\n'

// 分别演示一次收全和分两次收到。
async function demonstrate(name, chunks) {
  console.log('\n===', name, '===')

  // 用内存管道模拟子进程的输入、输出。
  const input = new PassThrough()
  const output = new PassThrough()
  const peer = framing(new Peer(), input, output)

  let calls = 0

  // Peer根据method找到这个处理函数。
  peer.handle('session.list', () => {
    calls++
    console.log('Peer：执行session.list处理函数')
    return ['session-demo']
  })

  // framing把Peer的响应编码成JSON加换行，写到输出管道。
  output.on('data', chunk => {
    console.log('输出响应：', chunk.toString().trim())
  })

  for (const chunk of chunks) {
    console.log('输入字节：', JSON.stringify(chunk))
    input.write(Buffer.from(chunk))

    // 等待本轮异步处理完成，便于观察输出顺序。
    await setImmediate()
    console.log('处理函数累计执行：', calls, '次')
  }

  input.end()
  output.destroy()
}

// 情况一：一次收到完整消息。
await demonstrate('一次收全', [request])

// 情况二：消息在method字段中间断开。
const position = request.indexOf('session.list') + 4
await demonstrate('分两次收到', [
  request.slice(0, position),
  request.slice(position),
])