import { join } from 'node:path';
import type { createRuntime } from './runtime';
// HTTP 只做身份检查、参数解析和事件转发，不执行第二套 Agent Loop。
export function serve(runtime: Awaited<ReturnType<typeof createRuntime>>, port = 4319) {
  const token = crypto.randomUUID();
  const requests = new Map<string, { prompt: string; turnId: string }>();
  const streams = new Set<() => void>();
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
  const server = Bun.serve({ hostname: '127.0.0.1', port, maxRequestBodySize: 128_000,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.host !== `127.0.0.1:${server.port}`) return json({ error: 'Host 不匹配' }, 403);
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return json({ error: '跨来源请求被拒绝' }, 403);
      // 首次打开启动 URL 时把令牌换成 HttpOnly cookie，随后地址栏不再保留令牌。
      if (url.pathname === '/' && url.searchParams.get('token') === token) return new Response(null, { status: 303,
        headers: { Location: '/', 'Set-Cookie': `harness=${token}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store' } });
      const cookie = request.headers.get('cookie')?.split(';').map(value => value.trim()).includes('harness=' + token);
      if (!cookie && request.headers.get('authorization') !== 'Bearer ' + token) return json({ error: '需要启动令牌' }, 401);
      try {
        if (request.method === 'GET' && ['/', '/app.js'].includes(url.pathname)) {
          const file = Bun.file(join(import.meta.dir, '../web', url.pathname === '/' ? 'index.html' : 'app.js'));
          if (!(await file.exists())) return json({ error: '先完成第 15 步的 Web 文件' }, 404);
          return new Response(file, { headers: { 'Content-Type': url.pathname === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'",
            'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
        }
        if (url.pathname === '/api/sessions') {
          if (request.method === 'GET') return json([...runtime.host.sessions.values()].map(session => ({ id: session.id, busy: runtime.host.busy(session.id) })));
          if (request.method === 'POST') return json({ id: runtime.host.create().id }, 201);
        }
        const match = /^\/api\/sessions\/([a-zA-Z0-9_-]+)(?:\/(events|prompts|cancel|approvals))?$/.exec(url.pathname);
        if (!match) return json({ error: '接口不存在' }, 404);
        const [, id, action] = match;
        const session = runtime.host.get(id);
        if (!action && request.method === 'GET') return json({ id, events: session.events, busy: runtime.host.busy(id) });
        if (action === 'events' && request.method === 'GET') {
          const after = Number(request.headers.get('last-event-id') ?? url.searchParams.get('after') ?? 0);
          if (!Number.isSafeInteger(after) || after < 0 || after > session.events.length) return json({ error: '事件游标非法' }, 400);
          const encoder = new TextEncoder();
          let cleanup = () => {};
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              let closed = false;
              let unsubscribe = () => {};
              let heartbeat: ReturnType<typeof setInterval> | undefined;
              const stop = () => {
                if (closed) return;
                closed = true; unsubscribe(); clearInterval(heartbeat);
                request.signal.removeEventListener('abort', stop); streams.delete(stop);
                try { controller.close(); } catch { /* 客户端可能已关闭。 */ }
              };
              cleanup = stop;
              const send = (event: any) => {
                if (closed) return;
                if ((controller.desiredSize ?? 0) < -1000) { stop(); return; }
                controller.enqueue(encoder.encode(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`));
              };
              streams.add(stop);
              // 订阅与同步重放之间没有 await，因此不会遗漏期间到达的事件。
              unsubscribe = session.subscribe(send);
              for (const event of session.events) if (event.seq > after) send(event);
              heartbeat = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(': heartbeat\n\n')); }, 10_000);
              request.signal.addEventListener('abort', stop, { once: true });
              if (request.signal.aborted) stop();
            },
            cancel() { cleanup(); },
          });
          return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
        }
        if (request.method !== 'POST') return json({ error: '方法不支持' }, 405);
        if (action === 'cancel') { runtime.host.cancel(id); return json({ ok: true }); }
        const data = await request.json() as any;
        if (!data || typeof data !== 'object') return json({ error: '请求体必须是对象' }, 400);
        if (action === 'approvals') {
          if (typeof data.id !== 'string' || typeof data.allow !== 'boolean') return json({ error: '审批参数非法' }, 400);
          runtime.approvals.decide(id, data.id, data.allow); return json({ ok: true });
        }
        if (action === 'prompts') {
          if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 16_000
            || typeof data.requestId !== 'string' || !/^[\w-]{1,80}$/.test(data.requestId)) return json({ error: 'prompt 或 requestId 非法' }, 400);
          const key = id + ':' + data.requestId;
          const previous = requests.get(key);
          if (previous) return previous.prompt === data.prompt ? json({ turnId: previous.turnId }, 202) : json({ error: '重复 requestId 的内容不同' }, 409);
          if (runtime.host.busy(id)) return json({ error: '会话忙' }, 409);
          const job = runtime.start(id, data.prompt);
          requests.set(key, { prompt: data.prompt, turnId: job.turnId });
          if (requests.size > 1000) requests.delete(requests.keys().next().value!);
          void job.done.catch(error => console.error('任务异常', error));
          return json({ turnId: job.turnId }, 202);
        }
        return json({ error: '接口不存在' }, 404);
      } catch (error) {
        return json({ error: String(error) }, 400);
      }
    } });
  return { server, token, close() { for (const stop of [...streams]) stop(); server.stop(true); } };
}
