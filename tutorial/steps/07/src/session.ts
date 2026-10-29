import { mkdirSync, readFileSync, existsSync, openSync, writeSync, fsyncSync, closeSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import type { Event, Message } from './domain';
// JSONL 是事实记录，messages 是可重建投影；每条记录先落盘再通知订阅者。
export class Session {
  events: Event[] = [];
  messages: Message[] = [];
  private listeners = new Set<(event: Event) => void>();
  private file?: string;
  constructor(public id: string = crypto.randomUUID(), directory?: string) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('会话标识非法');
    if (!directory) return;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = join(directory, id + '.jsonl');
    if (!existsSync(this.file)) return;
    const raw = readFileSync(this.file, 'utf8');
    const lines = raw.split('\n');
    // 最后一行未换行，视为崩溃时未完成的写入，只截去这一行。
    const complete = lines.slice(0, -1);
    for (const line of complete) {
      const event = JSON.parse(line) as Event;
      if (event.sessionId !== id || event.seq !== this.events.length + 1 || typeof event.type !== 'string'
        || typeof event.turnId !== 'string' || !event.data || typeof event.data !== 'object') throw new Error('日志结构损坏');
      if (event.type === 'messages' && !Array.isArray(event.data.messages)) throw new Error('消息记录损坏');
      this.apply(event);
    }
    if (!raw.endsWith('\n')) truncateSync(this.file, Buffer.byteLength(complete.map(line => line + '\n').join('')));
  }
  private apply(event: Event) {
    this.events.push(event);
    if (event.type === 'messages') this.messages.push(...structuredClone(event.data.messages));
  }
  emit(turnId: string, type: string, data: Record<string, any>) {
    const event: Event = { seq: this.events.length + 1, sessionId: this.id, turnId,
      time: new Date().toISOString(), type, data: structuredClone(data) };
    if (this.file) {
      const fd = openSync(this.file, 'a', 0o600);
      try { writeSync(fd, JSON.stringify(event) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    }
    this.apply(event);
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)); } catch { /* 展示异常与持久化异常分别处理。 */ }
    }
    return event;
  }
  subscribe(listener: (event: Event) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
