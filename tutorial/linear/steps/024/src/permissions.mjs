/** 效果分类和 OS confinement 分开；审批允许不代表可以跳过沙箱。 */
export function permissionGuard(settings, approvals) {
  return async (tool, call, context) => {
    const policy = settings.snapshot().permission ?? 'ask'
    if (!['read', 'write', 'execute', 'network'].includes(tool.effect)) throw Error('工具缺少效果声明')
    if (policy === 'read-only' && tool.effect !== 'read') throw Error('只读策略拒绝副作用')
    const mustAsk = policy === 'ask' && tool.effect !== 'read'
    context.session.append('permission/decision', { tool: call.name, effect: tool.effect, policy, mustAsk })
    if (mustAsk && !await approvals.request(context.session.id, { call, effect: tool.effect }, context.signal)) throw Error('用户拒绝')
    context.signal.throwIfAborted()
  }
}
