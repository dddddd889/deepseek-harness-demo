import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

// 外部工具进程的固定样本，只替换外部系统，不替换Harness的MCP适配器。
const server = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, request => ({ tools: [{ name: request.params?.cursor ? 'second' : 'first', inputSchema: { type: 'object', properties: {} } }], ...(request.params?.cursor ? {} : { nextCursor: 'page2' }) }))
server.setRequestHandler(CallToolRequestSchema, request => ({ content: [{ type: 'text', text: request.params.name }] }))
await server.connect(new StdioServerTransport())
