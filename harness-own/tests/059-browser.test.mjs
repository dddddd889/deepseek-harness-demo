import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { browser } from '../src/browser.mjs'
import { computer, computerSpec } from '../src/computer.mjs'
import { Scope } from '../src/scope.mjs'

test('真实隔离Chrome执行页面动作，截图为PNG；系统动作不接受任意脚本', async () => {
  const scope = new Scope(), executable = process.env.HARNESS_CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome')
  try {
    const app = await browser(scope, executable)
    await app.page.setContent(`<input id="name"><button onclick="document.body.dataset.done='yes'">go</button>`)
    await app.fill('#name', '中文')
    await app.click('button')
    assert.equal(await app.page.locator('#name').inputValue(), '中文')
    assert.equal(await app.page.locator('body').getAttribute('data-done'), 'yes')
    assert.equal((await app.screenshot()).subarray(1, 4).toString(), 'PNG')
    assert.throws(() => computerSpec({ kind: 'key', key: 'arbitrary script' }, 'darwin'), /尚无/)
  } finally { await scope.close() }
})


// 以下系统侧测试不需要桌面权限，不实际截屏或向前台窗口发送输入。
test('系统截图生成固定命令，空格路径保留为一个参数', () => {
  assert.deepEqual(computerSpec({ kind: 'screenshot', path: '/tmp/系统 截图.png' }, 'darwin'), {
    command: '/usr/sbin/screencapture', args: ['-x', '/tmp/系统 截图.png'],
  })
  for (const path of ['', '-i', 'relative.png', '/tmp/bad\0.png', undefined]) {
    assert.throws(() => computerSpec({ kind: 'screenshot', path }, 'darwin'), /截图路径/)
  }
})

test('macOS按键只编译允许的固定键码', () => {
  // 同时检查三个允许的按键，以及脚本注入和未知按键被拒绝。
  for (const [key, code] of [['Return', 36], ['Escape', 53], ['Tab', 48]]) {
    assert.deepEqual(computerSpec({ kind: 'key', key }, 'darwin'), {
      command: '/usr/bin/osascript', args: ['-e', 'tell application "System Events" to key code ' + code],
    })
  }
  for (const key of ['Space', 'Return; do shell script "anything"', '']) {
    assert.throws(() => computerSpec({ kind: 'key', key }, 'darwin'), /尚无/)
  }
})

test('Linux点击保留坐标参数，拒绝非法坐标', () => {
  assert.deepEqual(computerSpec({ kind: 'click', x: 0, y: 240 }, 'linux'), {
    command: 'xdotool', args: ['mousemove', '0', '240', 'click', '1'],
  })
  for (const value of [-1, 1.5, NaN, Infinity, '10', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => computerSpec({ kind: 'click', x: value, y: 0 }, 'linux'), /坐标/)
    assert.throws(() => computerSpec({ kind: 'click', x: 0, y: value }, 'linux'), /坐标/)
  }
})

test('没有提供方的平台动作组合明确拒绝', () => {
  for (const [platform, action] of [
    ['win32', { kind: 'screenshot', path: '/tmp/test.png' }],
    ['darwin', { kind: 'click', x: 0, y: 0 }],
    ['linux', { kind: 'key', key: 'Return' }],
  ]) assert.throws(() => computerSpec(action, platform), /尚无/)
})

test('系统执行转交固定命令和取消信号，并返回执行结果', async () => {
  const controller = new AbortController(), expected = { code: 0, output: '', bytes: 0 }
  // 固定执行替身只检查参数，不启动系统程序。
  const runner = async (spec, signal) => {
    assert.equal(signal, controller.signal)
    assert.deepEqual(spec, { command: 'xdotool', args: ['mousemove', '12', '34', 'click', '1'] })
    return expected
  }
  assert.equal(await computer({ kind: 'click', x: 12, y: 34 }, controller.signal, { runner, platform: 'linux' }), expected)
})

test('系统命令非零退出和启动失败不能返回成功', async () => {
  const action = { kind: 'key', key: 'Return' }
  await assert.rejects(computer(action, undefined, {
    platform: 'darwin', runner: async () => ({ code: 1, output: '辅助功能权限不足' }),
  }), /系统动作失败：辅助功能权限不足/)
  // 命令缺失等底层错误保持原对象，便于调用方判断原因。
  const failure = Object.assign(Error('找不到命令'), { code: 'ENOENT' })
  await assert.rejects(computer(action, undefined, {
    platform: 'darwin', runner: async () => { throw failure },
  }), error => error === failure)
})

test('已取消或参数非法时不进入执行器', async () => {
  let calls = 0
  const runner = async () => { calls++; return { code: 0 } }
  const controller = new AbortController(); controller.abort()
  await assert.rejects(computer({ kind: 'click', x: 0, y: 0 }, controller.signal, { runner, platform: 'linux' }))
  await assert.rejects(computer({ kind: 'click', x: -1, y: 0 }, undefined, { runner, platform: 'linux' }), /坐标/)
  assert.equal(calls, 0)
})
