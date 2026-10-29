import * as acp from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';
import { realpath } from 'node:fs/promises';
import { createRuntime } from './runtime';
// 该文件就是自己的 dsh-acp 粘合层；SDK 管 JSON-RPC，本文件做领域转换。
const runtime = await createRuntime();
const app = acp.agent({ name: 'my-harness' })
  .onRequest('initialize', async () => ({ protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false, promptCapabilities: { image: false } } }))
  .onRequest('session/new', async ctx => {
    if (await realpath(ctx.params.cwd) !== await realpath(runtime.config.workspace)) throw acp.RequestError.invalidParams(undefined, '只能使用启动工作区');
    if (ctx.params.mcpServers.length) throw acp.RequestError.invalidParams(undefined, '本教程的 MCP 在 Host 启动时固定装配');
    return { sessionId: runtime.host.create().id };
  })
  .onRequest('session/prompt', async ctx => {
    const id = ctx.params.sessionId;
    if (ctx.params.prompt.some(part => part.type !== 'text')) throw acp.RequestError.invalidParams(undefined, '本教程只接收文本');
    const prompt = ctx.params.prompt.map(part => part.type === 'text' ? part.text : '').join('\n');
    const session = runtime.host.get(id);
    let sends = Promise.resolve();
    let transportError: unknown;
    const unsubscribe = session.subscribe(event => {
      let update: acp.SessionNotification['update'] | undefined;
      if (event.type === 'text') update = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: event.data.text } };
      if (event.type === 'tool_start') update = { sessionUpdate: 'tool_call', toolCallId: event.data.call.id,
        title: event.data.call.function.name, status: 'in_progress', kind: 'other', rawInput: event.data.call.function.arguments };
      if (event.type === 'tool_end') update = { sessionUpdate: 'tool_call_update', toolCallId: event.data.callId,
        status: event.data.failed ? 'failed' : 'completed', rawOutput: event.data.result };
      if (update) {
        const notification = { sessionId: id, update };
        sends = sends.then(() => ctx.client.notify(acp.methods.client.session.update, notification)).catch(error => {
          transportError = error; runtime.host.cancel(id);
        });
      }
      if (event.type === 'approval') {
        // 权限请求是反向 RPC：Agent 服务端 -> ACP 客户端。
        void ctx.client.request<acp.RequestPermissionResponse>(acp.methods.client.session.requestPermission, { sessionId: id,
          toolCall: { toolCallId: event.data.call.id, title: event.data.call.function.name, kind: 'other', status: 'pending', rawInput: event.data.call.function.arguments },
          options: [{ optionId: 'yes', name: '允许一次', kind: 'allow_once' }, { optionId: 'no', name: '拒绝', kind: 'reject_once' }] })
          .then((response: acp.RequestPermissionResponse) => { runtime.approvals.decide(id, event.data.id,
            response.outcome.outcome === 'selected' && response.outcome.optionId === 'yes'); })
          .catch(() => { try { runtime.approvals.decide(id, event.data.id, false); } catch { /* 取消后旧 RPC 回答无效。 */ } });
      }
    });
    try {
      const reason = await runtime.start(id, prompt).done;
      await sends;
      if (transportError || reason === 'error') throw acp.RequestError.internalError(undefined, '任务或传输失败');
      return { stopReason: reason === 'cancelled' ? 'cancelled' : 'end_turn' };
    } finally { unsubscribe(); }
  })
  .onNotification('session/cancel', async ctx => { runtime.host.cancel(ctx.params.sessionId); });
// stdout 必须只放 NDJSON 协议；诊断一律 console.error。
const connection = app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>));
await connection.closed;
await runtime.shutdown();
