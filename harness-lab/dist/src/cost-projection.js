/**
 * 成本是会话用量 × 版本化价目表的派生投影，不写回事实日志。
 * 同一轮次与步骤的最终助手消息会覆盖流式用量样本，避免重复计费。
 */
export function projectCost(events, book) {
    let active;
    const samples = new Map();
    for (const event of events) {
        if (event.type === 'request/header') {
            active = { header: event.data.header, time: event.time };
            continue;
        }
        if (!active)
            continue;
        if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
            const key = `${event.data.turn}:${event.data.step}`;
            samples.set(key, { key, requestTime: active.time, header: active.header, usage: event.data.chunk.usage });
        }
        if (event.type === 'assistant/message' && event.data.usage !== undefined) {
            const key = `${event.data.turn}:${event.data.step}`;
            samples.set(key, { key, requestTime: active.time, header: active.header, usage: event.data.usage });
        }
    }
    let picoUsd = 0n;
    let pricedSteps = 0;
    const unpricedSteps = [];
    for (const sample of samples.values()) {
        const price = resolvePrice(book, sample.header, sample.requestTime);
        if (!price) {
            unpricedSteps.push(sample.key);
            continue;
        }
        picoUsd += bucketCost(sample.usage, price);
        pricedSteps += 1;
    }
    return { priceBookVersion: book.version, picoUsd, pricedSteps, unpricedSteps };
}
/** 按请求开始时间选择当时已经生效的最后一个价格版本。 */
function resolvePrice(book, header, time) {
    return book.prices
        .filter((price) => price.provider === header.provider && price.model === header.model && price.effectiveFrom <= time)
        .sort((left, right) => right.effectiveFrom - left.effectiveFrom)[0];
}
/** 分桶计价；缓存词元不会再落入普通输入桶。 */
function bucketCost(usage, price) {
    const cost = usage.inputTokens * price.inputMicroUsdPerMillion
        + usage.outputTokens * price.outputMicroUsdPerMillion
        + (usage.cacheReadTokens ?? 0) * (price.cacheReadMicroUsdPerMillion ?? price.inputMicroUsdPerMillion)
        + (usage.cacheWriteTokens ?? 0) * (price.cacheWriteMicroUsdPerMillion ?? price.inputMicroUsdPerMillion);
    if (!Number.isSafeInteger(cost))
        throw new Error('成本超出安全整数范围');
    return BigInt(cost);
}
/** 将皮美元格式化为美元字符串，仅用于展示。 */
export function formatPicoUsd(picoUsd) {
    const whole = picoUsd / 1000000000000n;
    const fraction = (picoUsd % 1000000000000n).toString().padStart(12, '0').replace(/0+$/, '');
    return fraction.length === 0 ? `$${whole}` : `$${whole}.${fraction}`;
}
//# sourceMappingURL=cost-projection.js.map