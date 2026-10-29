import { appendFileSync, mkdirSync } from 'node:fs'
import { format } from 'node:util'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

// 相对于当前fixture文件，定位项目根目录下的tmp。
const logDirectory = new URL('../../tmp/', import.meta.url)
mkdirSync(logDirectory, { recursive: true })

// 日志追加写入，不覆盖之前的内容。
const logFile = new URL('mcp-server.log', logDirectory)

// 后面所有console.log调用都会写入文件。
console.log = (...args) => {
  const line = `[${new Date().toISOString()}] ${format(...args)}\n`
  appendFileSync(logFile, line, 'utf8')
}

// 示例：这条日志会进入文件。
console.log('MCP服务启动', { pid: process.pid })

// 外部工具进程的固定样本，只替换外部系统，不替换Harness的MCP适配器。
const server = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, request => {
	console.log('ListToolsRequest', request.params?.cursor)
	return ({ tools: [{ name: request.params?.cursor ? 'second' : 'first', inputSchema: { type: 'object', properties: {} } }], ...(request.params?.cursor ? {} : { nextCursor: 'page2' }) })
})
server.setRequestHandler(CallToolRequestSchema, request => ({ content: [{ type: 'text', text: request.params.name }] }))
await server.connect(new StdioServerTransport())