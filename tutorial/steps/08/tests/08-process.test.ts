import { test, expect } from 'bun:test';
import { Tools } from '../src/tools';
import { registerProcess } from '../src/process-tool';
// 检查真实子进程的退出码和输出；故障不能靠字符串假装。
test('命令结果包含退出码；输出超限会终止进程', async () => {
  const tools = new Tools();
  registerProcess(tools, process.cwd());
  const execute = (code: string) => tools.execute({ id: 'c', type: 'function', function: { name: 'run',
    arguments: JSON.stringify({ argv: [process.execPath, '-e', code] }) } }, new AbortController().signal);
  expect(JSON.parse(await execute('console.log("ok"); process.exit(3)'))).toEqual({ code: 3, output: 'ok\n' });
  await expect(execute('console.log("x".repeat(100000))')).rejects.toThrow('64KB');
});
