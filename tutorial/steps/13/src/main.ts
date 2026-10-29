import readline from 'node:readline/promises';
import { createRuntime } from './runtime';
// 保留命令行单任务入口；不传参数时进入连续会话。
const runtime = await createRuntime();
const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
const session = process.env.SESSION_ID ? runtime.host.get(process.env.SESSION_ID) : runtime.host.create();
console.error('sessionId=' + session.id);
let current: ReturnType<typeof runtime.start> | undefined;
let interrupted = false;
const interrupt = () => {
  if (current) { runtime.host.cancel(session.id); terminal.close(); interrupted = true; }
  else { terminal.close(); interrupted = true; }
};
process.on('SIGINT', interrupt);
terminal.on('SIGINT', interrupt);
const unsubscribe = session.subscribe(event => {
  if (event.type === 'text') process.stdout.write(event.data.text);
  if (event.type === 'tool_start') console.error('\n工具：', event.data.call.function.name);
  if (event.type === 'approval') {
    // 单独异步提问，事件分发不能阻塞 Loop；旧审批已取消时忽略回答。
    void terminal.question('\n批准这一次操作？输入 yes 同意，其余拒绝：').then(answer => {
      runtime.approvals.decide(session.id, event.data.id, answer.trim() === 'yes');
    }).catch(() => {});
  }
});
try {
  const oneShot = process.argv.slice(2).join(' ').trim();
  do {
    const prompt = oneShot || await terminal.question('\n任务（/exit 退出）：');
    if (prompt === '/exit') break;
    if (!prompt.trim()) continue;
    current = runtime.start(session.id, prompt);
    const reason = await current.done;
    current = undefined;
    console.error('\n结束：' + reason);
    if (oneShot) { process.exitCode = reason === 'stop' ? 0 : 1; break; }
  } while (!interrupted);
} catch (error) {
  if (!interrupted) { console.error(error); process.exitCode = 1; }
} finally {
  unsubscribe(); terminal.close(); process.off('SIGINT', interrupt);
  await runtime.shutdown();
}
