import { test, expect } from 'bun:test';
import { observe } from '../src/telemetry';
import { Session } from '../src/session';
// 验证真正发出的 HTTP body 不含用户内容，失败出口也能结束。
test('观测只发元数据且关闭时释放队列', async () => {
  const bodies: string[] = [];
  const request = (async (_url: any, init: any) => { bodies.push(init.body); throw new Error('离线'); }) as unknown as typeof fetch;
  const session = new Session();
  const close = observe(session, 'http://127.0.0.1:14318/v1/logs', request);
  session.emit('t', 'text', { text: 'secret-user-content' });
  session.emit('t', 'done', { reason: 'stop' });
  await close();
  expect(bodies.join('')).toContain('my-harness');
  expect(bodies.join('')).not.toContain('secret-user-content');
});
