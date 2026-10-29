import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// CLI 升级为连续会话后，入口测试也升级为真实离线单任务，隔离日志目录。
test('CLI 调用完整 Runtime 并正常释放目录锁', () => {
  const directory = mkdtempSync(join(tmpdir(), 'harness-cli-'));
  try {
    const result = Bun.spawnSync([process.execPath, 'src/main.ts', '你好'], {
      env: { ...process.env, MODEL_BACKEND: 'fake', HARNESS_DATA: directory, HARNESS_WORKSPACE: process.cwd() },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('收到：你好');
    expect(result.stderr.toString()).toContain('sessionId=');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
