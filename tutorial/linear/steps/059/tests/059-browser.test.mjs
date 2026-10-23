import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { browser } from '../src/browser.mjs'
import { computerSpec } from '../src/computer.mjs'
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
