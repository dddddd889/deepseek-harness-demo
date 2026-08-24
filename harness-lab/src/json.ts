export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue }

/** 断言输入可以被 JSON 无损表达；错误包含第一处非法值的路径。 */
export function assertJsonValue(value: unknown, path = '$', ancestors = new WeakSet<object>()): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} 必须是有限数字`)
    return
  }
  if (typeof value !== 'object') throw new TypeError(`${path} 不是 JSON 值：${typeof value}`)
  if (ancestors.has(value)) throw new TypeError(`${path} 包含循环引用`)

  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} 必须是普通对象`)
  }
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`${path} 含有 Symbol key`)

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError(`${path}[${index}] 是数组空洞`)
        assertJsonValue(value[index], `${path}[${index}]`, ancestors)
      }
      return
    }
    for (const [key, child] of Object.entries(value)) {
      assertJsonValue(child, `${path}.${key}`, ancestors)
    }
  } finally {
    ancestors.delete(value)
  }
}

/** 在跨边界前校验、克隆并冻结 JSON 数据，隔离调用方后续修改。 */
export function snapshotJson<T>(value: T): T {
  assertJsonValue(value)
  const snapshot = structuredClone(value)
  return deepFreeze(snapshot)
}

/** 递归冻结普通 JSON 图；使用迭代遍历避免深数据耗尽调用栈。 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  const pending: object[] = [value]
  const visited = new WeakSet<object>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current)) continue
    visited.add(current)
    for (const child of Object.values(current)) {
      if (typeof child === 'object' && child !== null) pending.push(child)
    }
    Object.freeze(current)
  }
  return value
}

