import { mkdirSync, readdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Host } from './host';
import { Approvals } from './approval';
import { loadConfig } from './config';
import { prepareContext } from './context';
import { fakeModel } from './fake-model';
import { deepseekModel } from './deepseek';
import { registerWrite } from './write-tool';
import { registerProcess } from './process-tool';
import { Kernel, installClock, readInstructions } from './plugins';
// 此函数是唯一组装点，协议入口只拿 Host，不重复实现工具、模型和会话。
export async function createRuntime() {
  const config = loadConfig();
  mkdirSync(config.directory, { recursive: true, mode: 0o700 });
  const lock = join(config.directory, 'host.lock');
  // 使用独占锁防止两个进程同时追加同一日志；异常崩溃后需确认旧进程退出再删锁。
  const fd = openSync(lock, 'wx', 0o600);
  closeSync(fd);
  const kernel = new Kernel();
  let host: Host | undefined;
  try {
    const instructions = await readInstructions(config.workspace);
    const model = config.backend === 'fake' ? fakeModel : config.backend === 'pi'
      ? (await import('./pi')).piModel({ key: config.key, model: config.model })
      : deepseekModel({ key: config.key, model: config.model });
    host = new Host(model, config.workspace, config.directory,
      messages => prepareContext(messages, config.system + '\n' + instructions));
    registerWrite(host.tools, config.workspace);
    registerProcess(host.tools, config.workspace);
    installClock(kernel, host.tools);
    for (const name of readdirSync(config.directory).filter(name => name.endsWith('.jsonl'))) {
      const session = host.create(name.slice(0, -6));
      // 重启恢复的是历史；被中断的副作用不会自动重试。
      const starts = session.events.filter(event => event.type === 'start');
      for (const start of starts) {
        if (!session.events.some(event => event.turnId === start.turnId && event.type === 'done'))
          session.emit(start.turnId, 'done', { reason: 'interrupted' });
      }
    }
    const approvals = new Approvals();
    const approve = (id: string, turnId: string) => (call: any, signal: AbortSignal) =>
      approvals.request(id, call, signal, (type, data) => host!.get(id).emit(turnId, type, data));
    const start = (id: string, prompt: string) => {
      // 回调执行在微任务中，因此启动后 turnId 已经赋值。
      const job = host!.start(id, prompt, (call, signal) => approve(id, job.turnId)(call, signal));
      return job;
    };
    const shutdown = async () => { await host!.close(); kernel.dispose(); unlinkSync(lock); };
    return { config, host, approvals, start, shutdown };
  } catch (error) {
    await host?.close(); kernel.dispose(); unlinkSync(lock); throw error;
  }
}
