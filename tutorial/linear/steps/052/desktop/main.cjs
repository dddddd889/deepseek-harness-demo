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
    await window.loadURL(address)
    if (process.env.HARNESS_DESKTOP_DEBUG === '1') window.webContents.openDevTools()
  }
  ipcMain.handle('desktop:info', () => ({ platform: process.platform, version: app.getVersion() }))
  process.on('SIGTERM', () => app.quit())
  app.on('second-instance', () => { void openWindow() })
  app.on('activate', () => { if (address) void openWindow() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', event => {
    if (stopped) return
    event.preventDefault(); if (exiting) return; exiting = true
    const timer = setTimeout(() => { host?.kill('SIGKILL'); stopped = true; app.quit() }, 5000)
    if (!host || host.exitCode !== null) { clearTimeout(timer); stopped = true; app.quit(); return }
    host.once('exit', () => { clearTimeout(timer); stopped = true; app.quit() }); host.kill('SIGTERM')
  })
  app.whenReady().then(async () => { await startHost(); Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: '应用', submenu: [{ role: 'quit' }] }, { label: '调试', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }] }])); await openWindow() }).catch(error => { dialog.showErrorBox('启动失败', error.message); app.quit() })
}
