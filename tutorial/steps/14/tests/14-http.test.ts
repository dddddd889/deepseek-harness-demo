import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime } from '../src/runtime';
import { serve } from '../src/http';
import { sseData } from '../src/sse';
// 真 HTTP + SSE 验证，不把内部函数返回值当成协议已经接通。
test('HTTP 身份、幂等提交、SSE 重放和取消', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'harness-http-'));
  const previous = { ...process.env };
  process.env.MODEL_BACKEND = 'fake'; process.env.HARNESS_DATA = directory;
  const runtime = await createRuntime();
  const api = serve(runtime, 0);
  const base = `http://127.0.0.1:${api.server.port}`;
  const request = (path: string, body?: unknown) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + api.token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    expect((await fetch(base + '/api/sessions')).status).toBe(401);
    const session = await (await request('/api/sessions', {})).json() as any;
    const path = `/api/sessions/${session.id}`;
    const body = { prompt: '/slow', requestId: 'one' };
    const first = await (await request(path + '/prompts', body)).json();
    expect(await (await request(path + '/prompts', body)).json()).toEqual(first);
    const response = await request(path + '/events?after=0');
    const seen: any[] = [];
    const controller = new AbortController();
    for await (const data of sseData(response.body!, controller.signal)) {
      const event = JSON.parse(data); seen.push(event);
      if (event.type === 'text') await request(path + '/cancel', {});
      if (event.type === 'done') break;
    }
    expect(seen.at(-1).data.reason).toBe('cancelled');
    const cursor = seen.at(-1).seq;
    const snapshot = await (await request(path)).json() as any;
    expect(snapshot.events.at(-1).seq).toBe(cursor);
  } finally { api.close(); await runtime.shutdown(); process.env = previous; await rm(directory, { recursive: true, force: true }); }
}, 10_000);
