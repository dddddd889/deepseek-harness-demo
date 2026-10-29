import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Host } from '../src/host';
import { Approvals } from '../src/approval';
import { registerWrite } from '../src/write-tool';
import { fakeModel } from '../src/fake-model';
// 真实文件系统验证：拒绝和审批等待期间取消，都不得写文件或遗留等待者。
test('写入拒绝与审批期间取消都不会越过权限门', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-final-'));
  const host = new Host(fakeModel, root);
  registerWrite(host.tools, root);
  const approvals = new Approvals();
  const session = host.create();
  try {
    const prompt = '/tool write {"path":"denied.txt","content":"x"}';
    expect(await host.start(session.id, prompt, async () => false).done).toBe('stop');
    expect(await Bun.file(join(root, 'denied.txt')).exists()).toBe(false);
    session.subscribe(event => { if (event.type === 'approval') host.cancel(session.id); });
    const job = host.start(session.id, prompt, (call, signal) => approvals.request(session.id, call, signal,
      (type, data) => session.emit('approval-proof', type, data)));
    expect(await job.done).toBe('cancelled');
    expect(approvals.size()).toBe(0);
    expect(await Bun.file(join(root, 'denied.txt')).exists()).toBe(false);
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});
