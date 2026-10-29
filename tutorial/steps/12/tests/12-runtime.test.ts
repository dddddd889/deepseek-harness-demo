import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime } from '../src/runtime';
// 同时验证组装、一次性审批、重启恢复，以及拒绝重复 Host。
test('Runtime 写入经审批，关闭后重启能恢复会话', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-runtime-'));
  const previous = { ...process.env };
  process.env.MODEL_BACKEND = 'fake'; process.env.HARNESS_DATA = join(root, 'data'); process.env.HARNESS_WORKSPACE = root;
  let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
  try {
    runtime = await createRuntime();
    await expect(createRuntime()).rejects.toThrow();
    const session = runtime.host.create();
    session.subscribe(event => { if (event.type === 'approval') runtime!.approvals.decide(session.id, event.data.id, true); });
    expect(await runtime.start(session.id, '/tool write {"path":"hello.txt","content":"你好"}').done).toBe('stop');
    expect(await Bun.file(join(root, 'hello.txt')).text()).toBe('你好');
    await runtime.shutdown(); runtime = undefined;
    runtime = await createRuntime();
    expect(runtime.host.get(session.id).messages.at(-1)?.content).toContain('已写入');
  } finally {
    await runtime?.shutdown(); process.env = previous;
    await rm(root, { recursive: true, force: true });
  }
});
