import { Readable, Writable } from 'node:stream'
import { ndJsonStream } from '@agentclientprotocol/sdk'
import { Host } from './host.mjs'
import { acpApp } from './acp.mjs'

// 显式home，stdout只放ACP，服务退出清理自己拥有的所有会话。
if (!process.env.HARNESS_HOME) throw Error('ACP需要显式HARNESS_HOME')
const host = new Host(process.env.HARNESS_HOME)
const connection = acpApp(host).connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)))
try { await connection.closed } finally { await host.close() }
