/** 把管理器包装成模型工具；父身份来自装配闭包，不由模型提交。 */
export function subagentTools(scope, tools, children, parent) {
  // 四个工具仍进入已有Tools.register/execute，沿用参数校验、守卫和注销。
  const add = (name, description, properties, run, effect = 'execute') => tools.register(scope, {
    name, description, effect, exclusive: effect !== 'read',
    schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
    run,
  })
  // 模型得到的是这些参数Schema；run函数不会被发送给模型。
  const string = { type: 'string' }
  add('subagent_create', '创建子Agent并提交初始任务；返回id，后续send/wait使用此id。', { task: string }, async args => {
    const childId = await children.create(scope, parent) // 工厂创建真实Agent并登记归属。
    children.send(parent, childId, args.task) // create工具组合创建与首次提交。
    return { id: childId }
  })
  add('subagent_send', '向已有子Agent补充任务；返回接收凭据，不是最终答案。', { id: string, text: string }, args => {
    const receipt = children.send(parent, args.id, args.text) // 先提交输入，便于断点观察真实接收凭据。
    return { receipt }
  })
  add('subagent_wait', '等待子Agent空闲并读取完整会话事件；从message/assistant中读取回答。', { id: string }, async args => {
    const events = await children.wait(parent, args.id) // 等孩子空闲后，才能在这里观察整份返回事件。
    return events
  }, 'read')
  add('subagent_interrupt', '请求取消子Agent当前活动；不等待取消完成。', { id: string }, args => {
    children.interrupt(parent, args.id)
    return {}
  })
}
