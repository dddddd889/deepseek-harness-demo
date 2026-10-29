import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import { workspacePath } from '../src/tools';
// 固定 MCP 提供方：与主 Harness 不同进程，通过标准 MCP stdio 协议通信。
const server = new McpServer({ name: 'tutorial-project', version: '1.0.0' });
server.registerTool('project_info', { description: '读取当前工作区 package.json', inputSchema: {} }, async () => {
  try {
    const path = await workspacePath(process.cwd(), 'package.json');
    const text = await readFile(path, 'utf8');
    if (text.length > 64_000) throw new Error('文件过大');
    return { content: [{ type: 'text', text }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] }; }
});
await server.connect(new StdioServerTransport());
