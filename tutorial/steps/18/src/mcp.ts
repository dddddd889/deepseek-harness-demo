import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';
import { Tools } from './tools';
// MCP 把外部工具接入 Tools；模型与 Loop 看不到 MCP 的请求 ID 或传输细节。
export async function mountMcp(tools: Tools, workspace: string) {
  const client = new Client({ name: 'my-harness', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [join(import.meta.dir, '../scripts/mcp-server.ts')], cwd: workspace,
    env: { PATH: process.env.PATH ?? '' }, stderr: 'inherit' });
  const disposers: (() => void)[] = [];
  try {
    await client.connect(transport);
    const remote = await client.listTools();
    for (const tool of remote.tools) disposers.push(tools.register({ name: 'mcp_' + tool.name,
      description: tool.description ?? tool.name, parameters: tool.inputSchema,
      // 不信任远端 readOnly 声明，统一逐次审批。
      mutates: true,
      async run(args, signal) {
        const result = await client.callTool({ name: tool.name, arguments: args }, undefined, { signal, timeout: 10_000 });
        const text = (result.content as any[]).filter(part => part.type === 'text').map(part => part.text).join('\n');
        if (result.isError) throw new Error(text.slice(0, 64_000));
        return text.slice(0, 64_000);
      } }));
    return async () => { for (const dispose of disposers.reverse()) dispose(); await client.close(); };
  } catch (error) { for (const dispose of disposers.reverse()) dispose(); await client.close(); throw error; }
}
