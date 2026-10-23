import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Host } from '../src/host.mjs'
import { product } from '../src/product.mjs'
import { capabilities } from '../src/capabilities.mjs'
import { startHTTP } from '../src/http.mjs'
import { browser } from '../src/browser.mjs'
import { Scope } from '../src/scope.mjs'

test('真正浏览器操作同一Host：审批写文件、首片取消、下一轮、刷新恢复', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-web-e2e-')), host = new Host(root), scope = new Scope()
  product(host); capabilities(host)
  const web = await startHTTP(host)
  try {
    const executable = process.env.HARNESS_CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/google-chrome')
    const app = await browser(scope, executable, { allowLocal: true }), page = app.page
    const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto(web.bootstrap)
    await page.locator('#cwd').fill(root)
    await page.waitForFunction(() => document.querySelector('#connection').textContent === '已连接')
    await page.locator('#create').click()
    await page.waitForFunction(() => document.querySelector('#title').textContent.startsWith('session_'))
    await page.locator('#prompt').fill('/tool write {"path":"proof.txt","text":"from-browser"}')
    await page.locator('#send').click()
    await page.getByRole('button', { name: '允许一次', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('#tools').textContent.includes('completed'))
    assert.equal(readFileSync(join(root, 'proof.txt'), 'utf8'), 'from-browser')
    await page.locator('#prompt').fill('/slow'); await page.locator('#send').click()
    await page.waitForFunction(() => document.querySelector('#stream').textContent === 'partial')
    await page.locator('#cancel').click()
    await page.locator('#prompt').fill('after-cancel'); await page.locator('#send').click()
    await page.waitForFunction(() => document.querySelector('#messages').textContent.includes('[离线演示] after-cancel'))
    await page.reload()
    await page.waitForFunction(() => document.querySelector('#messages').textContent.includes('[离线演示] after-cancel'))
    assert.equal(await page.getByRole('button', { name: '允许一次', exact: true }).count(), 0)
    assert.deepEqual(pageErrors, [])
  } finally { await scope.close(); await web.close(); await host.close(); rmSync(root, { recursive: true, force: true }) }
}, 30_000)
