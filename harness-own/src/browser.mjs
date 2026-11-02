import { chromium } from 'playwright-core'
import { Web } from './web-tools.mjs'

/** 浏览器使用独立临时profile，不接管用户已登录的个人浏览器。 */
export async function browser(scope, executablePath, { allowLocal = false } = {}) {
  const instance = await chromium.launch({ executablePath, headless: true })
  scope.own(() => instance.close())
  const context = await instance.newContext(), page = await context.newPage(), policy = new Web({ allowLocal })
  await context.route('**/*', async route => { try { await policy.check(route.request().url()); await route.continue() } catch { await route.abort() } })
  return { page,
    async navigate(url) { await policy.check(url); await page.goto(url); return { title: await page.title(), text: await page.locator('body').innerText() } },
    async click(selector) { await page.locator(selector).click(); return await page.locator('body').innerText() },
    async fill(selector, text) { await page.locator(selector).fill(text) },
    screenshot: () => page.screenshot({ type: 'png' }),
  }
}
