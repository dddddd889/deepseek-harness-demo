import { randomUUID } from 'node:crypto';
import { createMessage } from "./domain.js";
import { deriveSurface } from "./projections.js";
import { estimateMessage, measureTokens } from "./token-meter.js";
/** surface 节点已经完成投影，因此这里只做事件到消息的一对一派生。 */
function messageOf(event) {
    if (event.type === 'user/message')
        return event.data;
    if (event.type === 'assistant/message')
        return event.data.message;
    if (event.type === 'tool/result')
        return event.data.message;
    return undefined;
}
/** 返回每个 surface 节点之后是否处于完整工具调用边界。 */
function balancedBoundaries(surface) {
    const pending = new Set();
    return surface.map(event => {
        if (event.type === 'assistant/message') {
            for (const block of event.data.message.content) {
                if (block.type === 'tool-call')
                    pending.add(block.id);
            }
        }
        if (event.type === 'tool/result')
            pending.delete(event.data.callId);
        return pending.size === 0;
    });
}
/** 从头部选择区间，保留最近预算，并向前移动到完整 tool-call/result 边界。 */
export function selectCompactableRange(events, retainTokens) {
    const measurement = measureTokens(events);
    const surface = deriveSurface(events);
    if (measurement.nodes.length === 0 || measurement.nodes.length !== surface.length)
        return null;
    let kept = 0;
    let keepFrom = surface.length;
    for (let index = measurement.nodes.length - 1; index >= 0; index -= 1) {
        kept += measurement.nodes[index]?.tokens ?? 0;
        keepFrom = index;
        if (kept >= retainTokens)
            break;
    }
    if (keepFrom <= 0)
        return null;
    const balanced = balancedBoundaries(surface);
    let endIndex = keepFrom - 1;
    while (endIndex >= 0 && balanced[endIndex] !== true)
        endIndex -= 1;
    if (endIndex < 0)
        return null;
    const first = surface[0];
    const last = surface[endIndex];
    return first === undefined || last === undefined ? null : { start: first.seq, end: last.seq };
}
/** 摘要是日志事务：失败会闭合 bracket，但绝不提交 replacement。 */
export async function compactRange(session, range, summarizer, signal) {
    signal?.throwIfAborted();
    const before = deriveSurface(session.events);
    const startIndex = before.findIndex(event => event.seq === range.start);
    const endIndex = before.findIndex(event => event.seq === range.end);
    if (startIndex < 0 || endIndex < startIndex)
        throw new Error('压缩区间不在当前 surface');
    const selected = before.slice(startIndex, endIndex + 1);
    const boundaries = balancedBoundaries(before);
    if ((startIndex > 0 && boundaries[startIndex - 1] !== true) || boundaries[endIndex] !== true) {
        throw new Error('压缩区间会拆开 tool-call/result 原子组');
    }
    const id = randomUUID();
    const startEvent = session.append('compaction/start', { id, ...range });
    try {
        const selectedSeqs = selected.map(event => event.seq);
        const selectedMessages = selected.flatMap(event => {
            const message = messageOf(event);
            return message === undefined ? [] : [message];
        });
        const shadowedTokenCount = selectedMessages.reduce((sum, message) => sum + estimateMessage(message), 0);
        const summary = await summarizer.summarize(selectedMessages, signal);
        signal?.throwIfAborted();
        const latestSurface = deriveSurface(session.events);
        const latestStart = latestSurface.findIndex(event => event.seq === range.start);
        const latestEnd = latestSurface.findIndex(event => event.seq === range.end);
        const current = latestStart < 0 || latestEnd < latestStart
            ? []
            : latestSurface.slice(latestStart, latestEnd + 1);
        if (JSON.stringify(current.map(event => event.seq)) !== JSON.stringify(selectedSeqs)) {
            throw new Error('摘要期间 surface 已变化');
        }
        const checkpoint = createMessage({
            role: 'user',
            source: { kind: 'plugin', plugin: 'compaction' },
            content: [{ type: 'text', text: `<summary>\n${summary}\n</summary>` }],
        });
        const summaryTokens = estimateMessage(checkpoint);
        if (summaryTokens >= shadowedTokenCount)
            throw new Error('摘要没有缩小上下文');
        const summaryEvent = session.append('compaction/summary', {
            id,
            shadowedTokenCount,
            ...range,
        });
        session.append('user/message', checkpoint, Date.now(), {
            surfaceOp: { op: 'replace', ...range },
            sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...selectedSeqs],
        });
        session.append('compaction/end', { id });
        return { id, ...range, shadowedSeqs: selectedSeqs, shadowedTokenCount, summaryTokens };
    }
    catch (error) {
        session.append('compaction/end', { id, error: error instanceof Error ? error.message : String(error) });
        throw error;
    }
}
//# sourceMappingURL=compaction.js.map