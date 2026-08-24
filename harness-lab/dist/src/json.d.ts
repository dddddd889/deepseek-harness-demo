export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {
    readonly [key: string]: JsonValue;
};
/** 断言输入可以被 JSON 无损表达；错误包含第一处非法值的路径。 */
export declare function assertJsonValue(value: unknown, path?: string, ancestors?: WeakSet<object>): asserts value is JsonValue;
/** 在跨边界前校验、克隆并冻结 JSON 数据，隔离调用方后续修改。 */
export declare function snapshotJson<T>(value: T): T;
/** 递归冻结普通 JSON 图；使用迭代遍历避免深数据耗尽调用栈。 */
export declare function deepFreeze<T>(value: T): T;
