/** 工具消费者只依赖 fs 契约；更换远端提供方不用改工具 Schema。 */
export function fileTools(scope, tools, fs) {
  const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
  const string = { type: 'string' }
  tools.register(scope, { name: 'read', description: '读取文本并记录版本', exclusive: false, effect: 'read', schema: object({ path: string }), run: args => fs.read(args.path) })
  tools.register(scope, { name: 'write', description: '新建文件或基于读取版本写入', effect: 'write', schema: { type: 'object', properties: { path: string, text: string, version: string }, required: ['path', 'text'], additionalProperties: false }, run: args => fs.write(args.path, args.text, args.version) })
  tools.register(scope, { name: 'edit', description: '必须先读；默认唯一匹配，显式replaceAll=true才替换全部', effect: 'write',
    // replaceAll是可选布尔值；不用上面的object助手，避免把它也列为必填参数。
    schema: { type: 'object', properties: { path: string, before: string, after: string, version: string,
      replaceAll: { type: 'boolean', description: '仅true表示替换所有非重叠匹配；省略或false要求唯一匹配' } },
      required: ['path', 'before', 'after', 'version'], additionalProperties: false }, async run(args) {
    const current = await fs.read(args.path)
    if (current.version !== args.version) throw Error('文件版本冲突')
    if (!args.before) throw Error('待替换内容不能为空')
    // 按普通字符串拆分，片段数减一就是非重叠匹配数；不把before当正则表达式。
    const pieces = current.text.split(args.before), matches = pieces.length - 1
    if (matches === 0) throw Error('未找到待替换内容')
    if (args.replaceAll !== true && matches !== 1) throw Error('替换必须唯一匹配')
    // 默认模式已确认只有一个匹配；全量模式允许多个。join让after里的$&等字符保持原样。
    return fs.write(args.path, pieces.join(args.after), args.version)
  } })
}