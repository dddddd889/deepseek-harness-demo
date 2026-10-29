import { Session } from './session';
// 只导出元数据，永远不把 prompt、工具参数、结果或 API Key 发给观测服务。
export function observe(session: Session, endpoint?: string, request: typeof fetch = fetch) {
  if (!endpoint) return async () => {};
  let pending: Record<string, any>[] = [];
  let sending: Promise<void> | undefined;
  const flush = () => {
    if (sending || !pending.length) return sending ?? Promise.resolve();
    const batch = pending.splice(0, 100);
    sending = (async () => {
      try {
        await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(1000),
          body: JSON.stringify({ resourceLogs: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'my-harness' } }] },
            scopeLogs: [{ scope: { name: 'harness-events' }, logRecords: batch }] }] }) });
      } catch { /* 观测失败不得阻塞模型和工具，也不进行无限重试。 */ }
    })().finally(() => { sending = undefined; });
    return sending;
  };
  const unsubscribe = session.subscribe(event => {
    if (pending.length >= 1000) pending.shift();
    pending.push({ timeUnixNano: String(BigInt(Date.parse(event.time)) * 1_000_000n),
      body: { stringValue: event.type }, attributes: [
        { key: 'session.id', value: { stringValue: event.sessionId } },
        { key: 'turn.id', value: { stringValue: event.turnId } },
        { key: 'event.seq', value: { intValue: String(event.seq) } },
      ] });
    if (event.type === 'done') void flush();
  });
  const timer = setInterval(() => { void flush(); }, 1000);
  timer.unref();
  return async () => { unsubscribe(); clearInterval(timer); await sending; while (pending.length) await flush(); };
}
