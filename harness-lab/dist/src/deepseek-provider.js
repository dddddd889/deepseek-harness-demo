/** 最小 DeepSeek SSE Adapter；只负责 HTTP/Wire 与 Harness StreamChunk 之间的翻译。 */
export class DeepSeekProvider {
    #apiKey;
    #baseURL;
    #fetch;
    constructor(options) {
        this.#apiKey = options.apiKey;
        this.#baseURL = (options.baseURL ?? 'https://api.deepseek.com').replace(/\/$/, '');
        this.#fetch = options.fetch ?? fetch;
    }
    async *stream(options, signal) {
        const apiKey = this.#apiKey();
        if (!apiKey)
            throw new Error('缺少 DEEPSEEK_API_KEY');
        const response = await this.#fetch(`${this.#baseURL}/chat/completions`, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify(serializeRequest(options)),
            signal,
        });
        if (!response.ok)
            throw new Error(`DeepSeek HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
        if (!response.body)
            throw new Error('DeepSeek 响应缺少流 body');
        yield* translateDeepSeek(parseSse(response.body));
    }
}
/** DeepSeek prompt_tokens 包含缓存命中；转换成 Harness 互斥 token 桶。 */
export function mapDeepSeekUsage(usage) {
    const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens;
    const reasoning = usage.completion_tokens_details?.reasoning_tokens;
    return {
        inputTokens: usage.prompt_tokens - (cacheRead ?? 0),
        outputTokens: usage.completion_tokens,
        ...(cacheRead === undefined ? {} : { cacheReadTokens: cacheRead }),
        ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
    };
}
/** 将 DeepSeek data payload 翻译为稳定的块协议，并保证 usage 位于 finish 之前。 */
export async function* translateDeepSeek(payloads) {
    let nextIndex = 0;
    let text;
    let reasoning;
    const toolBlocks = new Map();
    const order = [];
    let pendingUsage;
    let pendingFinish;
    const open = (kind) => {
        const block = { index: nextIndex, kind, text: '' };
        nextIndex += 1;
        order.push(block);
        return block;
    };
    for await (const payload of payloads) {
        if (payload === '[DONE]') {
            for (const block of order)
                yield { type: 'block-end', index: block.index, block: closeBlock(block) };
            if (pendingUsage)
                yield { type: 'usage', usage: pendingUsage };
            yield {
                type: 'finish',
                reason: pendingFinish ?? (order.length > 0
                    ? { kind: 'stop' }
                    : { kind: 'error', failure: { code: 'EMPTY_RESPONSE', message: 'DeepSeek 返回空响应' } }),
            };
            return;
        }
        let wire;
        try {
            wire = JSON.parse(payload);
        }
        catch {
            throw new Error(`DeepSeek SSE JSON 无效：${payload.slice(0, 120)}`);
        }
        for (const choice of wire.choices ?? []) {
            const delta = choice.delta;
            if (delta?.reasoning_content) {
                if (!reasoning) {
                    reasoning = open('reasoning');
                    yield { type: 'block-start', index: reasoning.index, blockType: 'reasoning' };
                }
                reasoning.text += delta.reasoning_content;
                yield { type: 'reasoning-delta', index: reasoning.index, text: delta.reasoning_content };
            }
            if (delta?.content) {
                if (!text) {
                    text = open('text');
                    yield { type: 'block-start', index: text.index, blockType: 'text' };
                }
                text.text += delta.content;
                yield { type: 'text-delta', index: text.index, text: delta.content };
            }
            for (const call of delta?.tool_calls ?? []) {
                let block = toolBlocks.get(call.index);
                if (!block) {
                    block = open('tool-call');
                    toolBlocks.set(call.index, block);
                    yield { type: 'block-start', index: block.index, blockType: 'tool-call' };
                }
                if (call.id !== undefined)
                    block.callId = call.id;
                if (call.function?.name !== undefined)
                    block.name = call.function.name;
                const fragment = call.function?.arguments ?? '';
                block.text += fragment;
                yield {
                    type: 'tool-call-delta', index: block.index, id: block.callId ?? '',
                    ...(block.name === undefined ? {} : { name: block.name }), argumentsDelta: fragment,
                };
            }
            if (choice.finish_reason)
                pendingFinish = mapFinish(choice.finish_reason);
        }
        if (wire.usage)
            pendingUsage = mapDeepSeekUsage(wire.usage);
    }
    throw new Error('DeepSeek SSE 在 [DONE] 前结束');
}
/** 解析跨任意网络 chunk 边界的 SSE data 帧。 */
async function* parseSse(body) {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of body) {
        buffer += decoder.decode(bytes, { stream: true }).replaceAll('\r\n', '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart());
            if (data.length > 0)
                yield data.join('\n');
            boundary = buffer.indexOf('\n\n');
        }
    }
}
/** 将 Harness 请求映射为 DeepSeek Chat Completions 请求。 */
function serializeRequest(options) {
    return {
        model: options.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
            ...(options.system === undefined ? [] : [{ role: 'system', content: options.system }]),
            ...options.messages.flatMap(serializeMessage),
        ],
        ...(options.tools === undefined ? {} : { tools: options.tools.map(tool => ({ type: 'function', function: tool })) }),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    };
}
/** 一个 Harness message 可能拆成多个 DeepSeek tool 消息。 */
function serializeMessage(message) {
    if (message.content.some(block => block.type === 'image')) {
        throw new Error('当前 DeepSeek Chat Adapter 不支持图片输入；请配置支持 image block 的模型适配器');
    }
    const toolResults = message.content.filter(block => block.type === 'tool-result');
    if (toolResults.length > 0) {
        return toolResults.map(block => ({
            role: 'tool', tool_call_id: block.toolCallId,
            content: block.content.filter(item => item.type === 'text').map(item => item.text).join('\n'),
        }));
    }
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('');
    const toolCalls = message.content.filter(block => block.type === 'tool-call');
    return [{
            role: message.role,
            content: text,
            ...(toolCalls.length === 0 ? {} : {
                tool_calls: toolCalls.map(block => ({
                    id: block.id, type: 'function', function: { name: block.name, arguments: block.arguments },
                })),
            }),
        }];
}
/** 映射 Provider 的终止原因。 */
function mapFinish(reason) {
    if (reason === 'stop')
        return { kind: 'stop' };
    if (reason === 'tool_calls')
        return { kind: 'tool-calls' };
    if (reason === 'length')
        return { kind: 'max-tokens' };
    return { kind: 'error', failure: { code: reason.toUpperCase(), message: `DeepSeek 停止：${reason}` } };
}
/** 关闭一个 Provider block，保留工具原始 JSON 参数。 */
function closeBlock(block) {
    if (block.kind === 'text')
        return { type: 'text', text: block.text };
    if (block.kind === 'reasoning')
        return { type: 'reasoning', text: block.text };
    return { type: 'tool-call', id: (block.callId ?? ''), name: block.name ?? '', arguments: block.text };
}
//# sourceMappingURL=deepseek-provider.js.map