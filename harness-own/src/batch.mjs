/** 非独占工具可并发；独占工具必须等前组结束，后组也等它。 */
export async function batch(calls, isExclusive, execute) {
  const results = new Array(calls.length), group = []
  const run = async (call, index) => {
    try { results[index] = { ok: true, value: await execute(call) } }
    catch (error) { results[index] = { ok: false, error: error.message } }
  }
  for (const [index, call] of calls.entries()) {
    if (isExclusive(call)) {
      await Promise.all(group.splice(0))
      await run(call, index)
    } else group.push(run(call, index))
  }
  await Promise.all(group)
  return results
}

/** 装饰执行器，在不改模型接口的前提下给工具执行增加并发策略。 */
export function installBatch(tools) {
  tools.batch = (calls, context) => batch(calls, call => tools.entries.get(call.name)?.exclusive !== false, call => {
    context.before?.(call)
    return tools.execute(call, context)
  })
}