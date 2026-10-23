import { resolve, dirname } from 'node:path'
import { realpath, unlink } from 'node:fs/promises'
import { Peer, framing } from './rpc.mjs'

// stdout只承载协议，诊断必须写stderr；不让日志破坏NDJSON边界。
const peer = new Peer() // 先创建RPC管理对象，尚未连接传输。
const root = await realpath(process.argv[2]) // 主进程指定隔离的演示工作区。
peer.handle('tools/call', async ({ name, arguments: args }) => {
  if (name === 'sum') {
    if (![args.a, args.b].every(Number.isFinite)) throw Error('sum参数必须为有限数字')
    return { value: args.a + args.b, pid: process.pid }
  }
  if (name !== 'delete') throw Error('未知工具')
  // 演示只接纳根目录下的普通文件；不把RPC当作权限或沙箱。
  if (typeof args.path !== 'string' || !args.path || /[\\/]/.test(args.path)) throw Error('只允许根目录文件名')
  const path = await realpath(resolve(root, args.path)) // 防止符号链接跳出目录。
  if (dirname(path) !== root) throw Error('路径越界')
  const decision = await peer.request('approval/request', { operation: 'delete', path: args.path }, process.execArgv.some(arg => arg.startsWith('--inspect')) ? 3_600_000 : 10_000)
  if (decision?.allowed !== true) return { deleted: false, reason: '用户拒绝' }
  await unlink(path)
  return { deleted: true }
})
// EOF时释放协议等待者；进程没有额外常驻计时器。

// 先完成目录初始化和方法注册，再开始接收，避免启动时请求先于handler到达。
framing(peer, process.stdin, process.stdout)
