import { Host } from './host.mjs'
import { DeepSeekModel } from './deepseek.mjs'
import { Peer, framing } from './rpc.mjs'
import { remote } from './remote.mjs'
import { resolve } from 'node:path'

// stdio只承担协议；日志必须走stderr。所有数据路径显式隔离。
const home = process.env.HARNESS_HOME
if (!home) throw Error('SDK服务必须显式设置HARNESS_HOME')
const modelFactory = process.env.DEEPSEEK_API_KEY ? () => new DeepSeekModel({ key: process.env.DEEPSEEK_API_KEY, model: process.env.DSH_MODEL ?? 'deepseek-flash' }) : undefined
const host = new Host(home, modelFactory), peer = framing(new Peer(), process.stdin, process.stdout)
remote(peer, host, 'local')
peer.once('closed', () => { void host.close().catch(error => { console.error(error); process.exitCode = 1 }) })
