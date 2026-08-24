import { snapshotJson } from "./json.js";
/** 创建稳定身份、隔离且冻结的消息。 */
export function createMessage(input) {
    return snapshotJson({ ...input, id: crypto.randomUUID() });
}
/** 生成可预测的穷尽检查错误，供协议消费者的 default 分支使用。 */
export function assertNever(value) {
    throw new Error(`未处理的协议变体：${JSON.stringify(value)}`);
}
//# sourceMappingURL=domain.js.map