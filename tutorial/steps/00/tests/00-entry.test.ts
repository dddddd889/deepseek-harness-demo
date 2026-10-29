import { test, expect } from 'bun:test';
// 用真正的子进程检查入口，避免测试只验证自己的字符串。
test('入口接收任务，缺少任务时失败', () => {
  const success = Bun.spawnSync([process.execPath, 'src/main.ts', '你好']);
  expect(success.exitCode).toBe(0);
  expect(success.stdout.toString()).toContain('你好');
  const missing = Bun.spawnSync([process.execPath, 'src/main.ts']);
  expect(missing.exitCode).toBe(1);
});
