import * as acp from '@agentclientprotocol/sdk';
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
// 这是一个真正的 ACP 客户端进程，用来验收另一进程中的适配器。
const child = spawn(process.execPath, ['src/acp.ts'], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
const stream = acp.ndJsonStream(Writable.toWeb(child.stdin!), Readable.toWeb(child.stdout!) as unknown as ReadableStream<Uint8Array>);
const prompt = process.argv.slice(2).join(' ') || '/tool read {"path":"package.json"}';
let sawText = false;
let sawPermission = false;
try {
  await acp.client({ name: 'tutorial-client' })
    .onRequest(acp.methods.client.session.requestPermission, async () => {
      sawPermission = true;
      // 固定验收客户端只允许此显式环境变量授权，不作为通用客户端默认策略。
      return { outcome: { outcome: 'selected', optionId: process.env.ACP_ALLOW === 'yes' ? 'yes' : 'no' } };
    })
    .connectWith(stream, async ctx => {
      await ctx.request(acp.methods.agent.initialize, { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
      return ctx.buildSession(process.cwd()).withSession(async session => {
        session.prompt(prompt);
        for (;;) {
          const item = await session.nextUpdate();
          if (item.kind === 'stop') { console.log('\nstopReason=' + item.response.stopReason); break; }
          const update = item.notification.update;
          if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
            sawText = true; process.stdout.write(update.content.text);
            if (process.env.ACP_CANCEL === 'yes') await ctx.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId });
          }
        }
      });
    });
  if (!sawText) throw new Error('没有收到文本更新');
  if (process.env.ACP_ALLOW === 'yes' && !sawPermission) throw new Error('没有收到反向审批');
} finally {
  child.stdin!.end();
  // 正常先关闭协议等待退出，只有超时才强制结束，避免遗留 Host 锁。
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  const timer = setTimeout(() => child.kill('SIGTERM'), 2000);
  await exited; clearTimeout(timer);
}
