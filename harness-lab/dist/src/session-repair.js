/** 为冷恢复时的 open turn 生成确定性 tool/step/turn closers。 */
export function interruptedTurnClosers(events) {
    let openTurn = null;
    let openStep = null;
    const pending = new Map();
    for (const event of events) {
        if (event.type === 'turn/start') {
            openTurn = event.data.turn;
            openStep = null;
            pending.clear();
        }
        else if (event.type === 'turn/end') {
            openTurn = null;
            openStep = null;
            pending.clear();
        }
        else if (event.type === 'step/start') {
            openStep = event.data.step;
        }
        else if (event.type === 'assistant/message') {
            for (const block of event.data.message.content) {
                if (block.type === 'tool-call')
                    pending.set(block.id, { turn: event.data.turn, step: event.data.step, started: false });
            }
        }
        else if (event.type === 'tool/call') {
            const existing = pending.get(event.data.callId);
            if (existing)
                existing.started = true;
            else
                pending.set(event.data.callId, { turn: event.data.turn, step: event.data.step, started: true });
        }
        else if (event.type === 'tool/result') {
            pending.delete(event.data.callId);
        }
        else if (event.type === 'step/end') {
            pending.clear();
            openStep = null;
        }
    }
    const last = events.at(-1);
    if (openTurn === null || !last)
        return [];
    let seq = last.seq + 1;
    const closers = [];
    for (const [callId, call] of pending) {
        const code = call.started ? 'TOOL_OUTCOME_UNKNOWN' : 'TOOL_NOT_STARTED';
        const message = {
            id: `interrupted-tool-result-${callId}-${seq}`,
            role: 'user', source: { kind: 'tool', callId },
            content: [{
                    type: 'tool-result', toolCallId: callId, isError: true,
                    content: [{ type: 'text', text: call.started
                                ? '工具已开始但结果未持久化；副作用是否发生未知。先检查外部状态，不要盲目重试。'
                                : '工具请求尚未记录为开始；如果仍需要，可以重试。' }],
                }],
        };
        closers.push({
            type: 'tool/result', seq, time: last.time,
            data: { turn: call.turn, step: call.step, callId, message, error: { name: 'InterruptedToolError', code } },
        });
        seq += 1;
    }
    if (openStep !== null) {
        closers.push({ type: 'step/end', seq, time: last.time, data: { turn: openTurn, step: openStep } });
        seq += 1;
    }
    closers.push({ type: 'turn/end', seq, time: last.time, data: { turn: openTurn, reason: { kind: 'interrupted' } } });
    return closers;
}
//# sourceMappingURL=session-repair.js.map