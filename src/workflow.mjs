/** DAG校验先于执行，避免跑一半才发现循环；每个节点仍使用统一工具入口。 */
export async function workflow(nodes, tools, context, budget = 100) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  if (byId.size !== nodes.length || nodes.length > budget) throw Error('工作流重复身份或超预算')
  const visited = new Set(), visiting = new Set()
  const check = node => {
    if (visiting.has(node.id)) throw Error('工作流循环')
    if (visited.has(node.id)) return
    visiting.add(node.id)
    for (const dependency of node.after ?? []) { if (!byId.has(dependency)) throw Error('缺少依赖'); check(byId.get(dependency)) }
    visiting.delete(node.id); visited.add(node.id)
  }
  nodes.forEach(check)
  const results = new Map()
  while (results.size < nodes.length) {
    context.signal.throwIfAborted()
    const ready = nodes.filter(node => !results.has(node.id) && (node.after ?? []).every(id => results.has(id)))
    await Promise.all(ready.map(async node => { const value = await tools.execute(node.call, context); results.set(node.id, value) }))
  }
  return Object.fromEntries(results)
}