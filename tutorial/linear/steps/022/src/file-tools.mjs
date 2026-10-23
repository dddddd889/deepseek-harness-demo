/** 工具消费者只依赖 fs 契约；更换远端提供方不用改工具 Schema。 */
export function fileTools(scope, tools, fs) {
  const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
  const string = { type: 'string' }
  tools.register(scope, { name: 'read', description: '读取文本并记录版本', exclusive: false, effect: 'read', schema: object({ path: string }), run: args => fs.read(args.path) })
  tools.register(scope, { name: 'write', description: '新建文件或基于读取版本写入', effect: 'write', schema: { type: 'object', properties: { path: string, text: string, version: string }, required: ['path', 'text'], additionalProperties: false }, run: args => fs.write(args.path, args.text, args.version) })
  tools.register(scope, { name: 'edit', description: '唯一匹配替换；必须先读', effect: 'write', schema: object({ path: string, before: string, after: string, version: string }), async run(args) {
    const current = await fs.read(args.path)
    if (current.version !== args.version) throw Error('文件版本冲突')
    if (!args.before || current.text.split(args.before).length !== 2) throw Error('替换必须唯一匹配')
    return fs.write(args.path, current.text.replace(args.before, args.after), args.version)
  } })
}
