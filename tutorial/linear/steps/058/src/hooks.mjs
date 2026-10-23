import { execute } from './process.mjs'
import { validate } from './tools.mjs'

/** Hooks默认不开；显式配置的可信脚本也不能改完参数后绕过校验。 */
export function hooks(tools, spec, publish = () => {}) {
  const previous = tools.guard
  tools.guard = async (tool, call, context) => {
    if (spec.enabled) {
      // 输入使用argv中的独立JSON，不拼到shell字符串；脚本是用户安装的可信执行扩展。
      const result = await execute({ command: spec.command, args: [...(spec.args ?? []), JSON.stringify({ event: 'before-tool', name: call.name, arguments: call.arguments })], timeout: 5000 }, context.signal)
      if (result.code) throw Error('Hook执行失败')
      const reply = JSON.parse(result.output || '{}')
      publish({ input: call.arguments, output: reply })
      if (reply.allow === false) throw Error('Hook拒绝')
      if (reply.arguments) { validate(tool.schema, reply.arguments); call.arguments = reply.arguments }
    }
    await previous(tool, call, context)
  }
  return () => { tools.guard = previous }
}
