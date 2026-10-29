/** 有界的程序式工具编排；每个嵌套调用仍穿过Tools.execute及审批。 */
export async function runProgram(program, tools, context, maxCalls = 20) {
  // 用声明式寄存器程序先做可审计执行，不用eval假装完成任意代码沙箱。
  if (!Array.isArray(program) || program.length > maxCalls) throw Error('程序超预算')
  const values = new Map()
  for (const instruction of program) {
    context.signal.throwIfAborted()
    if (!instruction.id || values.has(instruction.id)) throw Error('程序身份重复')
    const argumentsValue = structuredClone(instruction.arguments)
    for (const [key, value] of Object.entries(argumentsValue)) {
      if (value && typeof value === 'object' && '$ref' in value) {
        if (!values.has(value.$ref)) throw Error('程序引用尚未定义')
        argumentsValue[key] = structuredClone(values.get(value.$ref))
      }
    }
    const value = await tools.execute({ name: instruction.tool, arguments: argumentsValue }, context)
    values.set(instruction.id, value)
  }
  return Object.fromEntries(values)
}