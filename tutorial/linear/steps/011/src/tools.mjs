/** 对本教程公开的 JSON Schema 子集做执行前校验，不能只信模型声明。 */
export function validate(schema, value, path = '$') {
  if (schema.enum && !schema.enum.includes(value)) throw Error(path + ' 不在枚举中')
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(path + ' 应为对象')
    for (const key of schema.required ?? []) if (!(key in value)) throw Error(path + ' 缺少 ' + key)
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) validate(schema.properties[key], item, path + '.' + key)
      else if (schema.additionalProperties === false) throw Error(path + ' 未知字段 ' + key)
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) throw Error(path + ' 应为数组')
    value.forEach((item, index) => validate(schema.items ?? {}, item, path + '[' + index + ']'))
  } else if (schema.type && typeof value !== schema.type) throw Error(path + ' 类型错误')
}

/** 工具注册只描述能力；执行前统一走参数、守卫与取消入口。 */
export class Tools {
  entries = new Map()
  guard = async () => {}
  /** 返回准确撤销当前注册项的函数，插件卸载不会留下幽灵工具。 */
  register(scope, tool) {
    if (this.entries.has(tool.name)) throw Error('重复工具：' + tool.name)
    this.entries.set(tool.name, tool)
    return scope.own(() => { if (this.entries.get(tool.name) === tool) this.entries.delete(tool.name) })
  }
  /** 模型只得到 schema，看不到执行函数和秘密。 */
  catalog() { return [...this.entries.values()].map(({ name, description, schema }) => ({ name, description, schema: structuredClone(schema) })) }
  /** 所有消费者，包括嵌套代码执行，最终都必须进这个门。 */
  async execute(call, context) {
    context.signal.throwIfAborted()
    const tool = this.entries.get(call.name)
    if (!tool) throw Error('未知工具：' + call.name)
    validate(tool.schema, call.arguments)
    await this.guard(tool, call, context)
    context.signal.throwIfAborted()
    return await tool.run(structuredClone(call.arguments), context)
  }
}
