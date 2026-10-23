import { resolve, join, isAbsolute } from 'node:path'

/** Desktop执行图和自己的运行数据分开，禁止从开发目录偷找缺失文件。 */
export function desktopPaths(appPath, userData) {
  if (!appPath || !userData) throw Error('桌面路径缺失')
  return { host: resolve(appPath, 'src/web-server.mjs'), preload: resolve(appPath, 'desktop/preload.cjs'), home: join(userData, 'harness-home'), browser: join(userData, 'browser-data') }
}

/** 深链接只允许打开已知会话，不把任意URL变成可执行命令。 */
export function deepLink(value) {
  const url = new URL(value)
  if (url.protocol !== 'harness-own:' || url.hostname !== 'session' || !/^\/session_[a-f0-9-]+$/.test(url.pathname)) throw Error('深链接不合法')
  return url.pathname.slice(1)
}

/** 开发模式显式传 Bun；安装后只用产物携带的 Bun，不退回系统 PATH。 */
export function hostRuntime({ packaged, resourcesPath, developmentPath, platform = process.platform }) {
  if (packaged) {
    if (!resourcesPath || !isAbsolute(resourcesPath)) throw Error('产物资源目录缺失')
    return join(resourcesPath, platform === 'win32' ? 'bun.exe' : 'bun')
  }
  if (!developmentPath || !isAbsolute(developmentPath)) throw Error('请用 bun run desktop 启动，缺少 Bun 绝对路径')
  return developmentPath
}
