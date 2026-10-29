import { test, expect } from 'bun:test';
import { Tools } from '../src/tools';
import { mountMcp } from '../src/mcp';
// 真正启动 MCP 子进程，完成 initialize、listTools 和 callTool。
test('MCP 外部工具可装载、调用并卸载', async () => {
  const tools = new Tools();
  const close = await mountMcp(tools, process.cwd());
  try {
    expect(tools.specs().some(tool => tool.name === 'mcp_project_info')).toBe(true);
    const text = await tools.execute({ id: 'c', type: 'function', function: { name: 'mcp_project_info', arguments: '{}' } }, new AbortController().signal);
    expect(text).toContain('my-harness');
  } finally { await close(); }
  expect(tools.specs()).toHaveLength(0);
}, 10_000);
