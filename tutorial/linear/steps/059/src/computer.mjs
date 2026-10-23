import { execute } from './process.mjs'

/** 先把动作编译为固定OS提供方命令；不接受模型传任意osascript。 */
export function computerSpec(action, platform = process.platform) {
  if (action.kind === 'screenshot' && platform === 'darwin') return { command: '/usr/sbin/screencapture', args: ['-x', action.path] }
  if (action.kind === 'click' && platform === 'linux') {
    if (![action.x, action.y].every(value => Number.isSafeInteger(value) && value >= 0)) throw Error('坐标不合法')
    return { command: 'xdotool', args: ['mousemove', String(action.x), String(action.y), 'click', '1'] }
  }
  if (action.kind === 'key' && platform === 'darwin' && ['Return', 'Escape', 'Tab'].includes(action.key)) {
    const codes = { Return: 36, Escape: 53, Tab: 48 }
    return { command: '/usr/bin/osascript', args: ['-e', 'tell application "System Events" to key code ' + codes[action.key]] }
  }
  throw Error('此平台/动作尚无真实提供方')
}

/** 系统授权失败原样返回，不能声称已经点击或截屏。 */
export async function computer(action, signal) {
  const result = await execute(computerSpec(action), signal)
  if (result.code) throw Error('系统动作失败：' + result.output)
  return result
}
