import type { Event, Message } from './domain';
// Session 是事件的主人；模型历史是一份投影，不能由 UI 单独改写。
export class Session {
  events: Event[] = [];
  messages: Message[] = [];
  private listeners = new Set<(event: Event) => void>();
  constructor(public id: string = crypto.randomUUID(), _directory?: string) {}
  emit(turnId: string, type: string, data: Record<string, any>) {
    const event: Event = { seq: this.events.length + 1, sessionId: this.id, turnId,
      time: new Date().toISOString(), type, data: structuredClone(data) };
    this.events.push(event);
    if (type === 'messages') this.messages.push(...structuredClone(data.messages));
    for (const listener of this.listeners) {
      try { listener(structuredClone(event)); } catch { /* 展示失败不破坏 Agent。 */ }
    }
    return event;
  }
  subscribe(listener: (event: Event) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
