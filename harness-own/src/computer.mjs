import { posix } from 'node:path'
import { execute } from './process.mjs'

/** 先把动作编译为固定OS提供方命令；不接受模型传任意osascript。 */
export function computerSpec(action, platform = process.platform) {
  if (action.kind === 'screenshot' && platform === 'darwin') {
    // 要求绝对输出路径，避免空路径或以短横线开头的内容被当成截屏选项。
    if (typeof action.path !== 'string' || !posix.isAbsolute(action.path) || action.path.includes('\0')) throw Error('截图路径必须是无空字符的绝对路径')
    return { command: '/usr/sbin/screencapture', args: ['-x', action.path] }
  }
  if (action.kind === 'click' && platform === 'linux') {
    if (![action.x, action.y].every(value => Number.isSafeInteger(value) && value >= 0)) throw Error('坐标不合法')
    return { command: 'xdotool', args: ['mousemove', String(action.x), String(action.y), 'click', '1'] }
  }
  if (action.kind === 'key' && platform === 'darwin' && ['Return', 'Escape', 'Tab'].includes(action.key)) {
    // macOS的固定键码；不把外部输入拼成任意AppleScript。
    const codes = { Return: 36, Escape: 53, Tab: 48 }
    return { command: '/usr/bin/osascript', args: ['-e', 'tell application "System Events" to key code ' + codes[action.key]] }
  }
  throw Error('此平台/动作尚无真实提供方')
}

/** 系统授权失败原样返回，不能声称已经点击或截屏。 */
export async function computer(action, signal = new AbortController().signal, { runner = execute, platform = process.platform } = {}) {
  // runner允许测试检查执行契约而不控制桌面；正常调用仍执行真实系统命令。
  signal.throwIfAborted()
  const result = await runner(computerSpec(action, platform), signal)
  if (result.code) throw Error('系统动作失败：' + result.output)
  return result
}
