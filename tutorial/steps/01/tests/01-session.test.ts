import { test, expect } from 'bun:test';
import { Session } from '../src/session';
// 一份日志能够导出模型历史，同时保持稳定的单调序号。
test('事件与消息投影一致，解除订阅后不再收到通知', () => {
  const session = new Session();
  let received = 0;
  const dispose = session.subscribe(() => received++);
  session.emit('turn-1', 'messages', { messages: [{ role: 'user', content: '你好' }] });
  dispose();
  session.emit('turn-1', 'text', { text: '好' });
  expect(received).toBe(1);
  expect(session.events.map(event => event.seq)).toEqual([1, 2]);
  expect(session.messages).toHaveLength(1);
});
