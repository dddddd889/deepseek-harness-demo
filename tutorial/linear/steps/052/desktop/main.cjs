// 本文件由Electron程序执行：它启动时已注册electron内置模块并设置特殊模块加载规则。
// 因此同样的require('electron')在这里取得app、BrowserWindow等API，不走npm包的路径导出入口。
// 与Bun启动器中的区别来自运行时的模块加载机制，不是createRequire或本文件判断后切换返回值。
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const { spawn } = require('node:child_process')
const path = require('node:path')
const applicationRoot = path.resolve(__dirname, '..')
app.setName('Harness Own')
if (process.env.HARNESS_DESKTOP_USER_DATA) app.setPath('userData', path.resolve(process.env.HARNESS_DESKTOP_USER_DATA))

// 单实例锁先于profile/数据访问，避免两个Host争用同一个桌面运行图。
if (!app.requestSingleInstanceLock()) app.quit()
else {
  let window, host, address, exiting = false, stopped = false
  /** Electron 只拥有窗口；领域 Host 始终交给显式指定的 Bun。 */
  async function startHost() {
    const { desktopPaths, hostRuntime } = await import('./policy.mjs')
    const paths = desktopPaths(applicationRoot, app.getPath('userData'))
    const runtime = hostRuntime({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, developmentPath: process.env.HARNESS_BUN })
    const environment = { ...process.env, HARNESS_HOME: paths.home }
    delete environment.NODE_OPTIONS; delete environment.NODE_PATH; delete environment.ELECTRON_RUN_AS_NODE
    // Bun 与 Electron Main 使用不同调试协议，必须连接不同端口。
    const hostArgs = environment.HARNESS_VSCODE_DEBUG === '1' ? ['--inspect=127.0.0.1:6499/harness-host', paths.host] : [paths.host]
    host = spawn(runtime, hostArgs, { cwd: applicationRoot, env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', errors = ''
    address = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Host启动超时')), 20_000)
      host.stdout.on('data', bytes => { output += bytes.toString(); const match = /http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/.exec(output); if (match) { clearTimeout(timer); resolve(match[0]) } })
      host.stderr.on('data', bytes => { errors = (errors + bytes.toString()).slice(-2000); if (environment.HARNESS_VSCODE_DEBUG === '1') process.stderr.write(bytes) })
      host.once('error', error => { clearTimeout(timer); reject(error) })
      host.once('exit', code => { clearTimeout(timer); if (!exiting) { if (address) dialog.showErrorBox('Host已退出', '退出码：' + code + '\n请保留诊断后重启应用。'); else reject(Error('Host启动失败：' + errors)) } })
    })
  }
  /** Renderer隔离、沙箱与固定preload共同限制桥接面。 */
  async function openWindow() {
    if (window) { window.show(); window.focus(); return }
    window = new BrowserWindow({ width: 1280, height: 850, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(applicationRoot, 'desktop/preload.cjs') } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== new URL(address).origin) event.preventDefault() })
    window.on('closed', () => { window = undefined })
    // address来自Host本次输出：先请求/?token=...，服务端设置Cookie并302跳转到/。
    // /对应web/index.html，Chromium继续请求/app.mjs；不是Main直接读取HTML文件。
    // 上面的preload选项让Electron在页面脚本执行前加载桥接代码，暴露window.desktop。
    await window.loadURL(address)
    if (process.env.HARNESS_DESKTOP_DEBUG === '1') window.webContents.openDevTools()
  }
  ipcMain.handle('desktop:info', () => ({ platform: process.platform, version: app.getVersion() }))
  process.on('SIGTERM', () => app.quit())
  // 已持有单实例锁，用户再次启动应用时由当前实例接到通知；复用窗口而不另起Host。
  // openWindow已有窗口时会show/focus；void仅忽略返回的Promise，不表示等待执行完成。
  app.on('second-instance', () => { void openWindow() })
  // macOS点击Dock等操作会激活应用；address存在说明Host已就绪，才能加载窗口。
  app.on('activate', () => { if (address) void openWindow() })
  // 所有窗口关闭后：Windows/Linux退出应用，macOS保留应用，允许之后从Dock重新打开。
  // darwin是process.platform给macOS使用的内部名称；关窗口与退出应用不是一回事。
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  // 准备退出时先收回本应用启动的Bun Host，避免窗口消失后留下后台业务进程。
  app.on('before-quit', event => {
    // 清理后再次app.quit会重入这里；stopped允许第二次退出继续完成。
    if (stopped) return
    // 本次退出先暂停；重复退出请求仍被拦住，但exiting保证清理逻辑只启动一次。
    event.preventDefault(); if (exiting) return; exiting = true
    // 最多等5秒；超时强制结束Host再退出，不无限等待。强制结束不保证业务已完成落盘。
    const timer = setTimeout(() => { host?.kill('SIGKILL'); stopped = true; app.quit() }, 5000)
    // 未启动Host或它已经正常报告退出时，无需继续等待。
    if (!host || host.exitCode !== null) { clearTimeout(timer); stopped = true; app.quit(); return }
    // 先登记退出回调，再发SIGTERM；Host退出后解除保护计时并让Electron真正退出。
    host.once('exit', () => { clearTimeout(timer); stopped = true; app.quit() }); host.kill('SIGTERM')
  })
  app.whenReady().then(async () => { await startHost(); Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: '应用', submenu: [{ role: 'quit' }] }, { label: '调试', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] }])); await openWindow() }).catch(error => { dialog.showErrorBox('启动失败', error.message); app.quit() })
}
