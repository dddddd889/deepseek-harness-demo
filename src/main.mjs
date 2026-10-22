import { pathToFileURL } from 'node:url'

/** 先把命令行边界做好；以后换 UI，任务文字仍然从这里进入领域。 */
export function input(argv) {
  const prompt = argv.join(' ').trim() // 参数里可能有中文和空格。
  if (!prompt) throw new Error('用法：bun run start "你的任务"')
  return prompt
}

// 只在直接执行时启动，测试 import 不会偷偷运行程序。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log('收到任务：' + input(process.argv.slice(2))) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}