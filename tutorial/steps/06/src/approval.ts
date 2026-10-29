import type { ToolCall, Emit } from './domain';
// Pending 只在内存存在；取消和超时都必须移除审批，不能在重启后自动同意。
export class Approvals {
  private pending = new Map<string, { sessionId: string; decide: (allow: boolean) => void }>();
  request(sessionId: string, call: ToolCall, signal: AbortSignal, emit: Emit, timeout = 60_000) {
    signal.throwIfAborted();
    return new Promise<boolean>((resolve, reject) => {
      const id = crypto.randomUUID();
      const finish = (allow: boolean, error?: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.pending.delete(id);
        emit('approval_resolved', { id, allow, cancelled: !!error });
        if (error) reject(error); else resolve(allow);
      };
      const abort = () => finish(false, signal.reason ?? new Error('审批已取消'));
      const timer = setTimeout(() => finish(false), timeout);
      this.pending.set(id, { sessionId, decide: allow => finish(allow) });
      signal.addEventListener('abort', abort, { once: true });
      emit('approval', { id, call });
    });
  }
  decide(sessionId: string, id: string, allow: boolean) {
    const item = this.pending.get(id);
    if (!item || item.sessionId !== sessionId) throw new Error('审批不存在或已失效');
    item.decide(allow);
  }
  size() { return this.pending.size; }
}
