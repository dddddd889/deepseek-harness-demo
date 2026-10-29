const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const { spawn } = require('node:child_process');
const { join, resolve } = require('node:path');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync } = require('node:fs');
let child;
let window;
let origin = '';
let workspace = '';
let stopping = false;
let stopped = false;
const smoke = process.env.HARNESS_DESKTOP_SMOKE === '1';
// Host 是桌面主进程持有的子进程，窗口退出时要等待其清理审批、MCP 和目录锁。
async function stopHost() {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  await exited; clearTimeout(timer);
}
app.on('before-quit', event => {
  if (stopped) return;
  event.preventDefault();
  if (stopping) return;
  stopping = true;
  void stopHost().finally(() => { stopped = true; app.quit(); });
});
app.on('window-all-closed', () => app.quit());
app.whenReady().then(async () => {
  const selected = smoke ? { canceled: false, filePaths: [resolve(__dirname, '..')] }
    : await dialog.showOpenDialog({ title: '选择自己的 Harness 工作区', properties: ['openDirectory'] });
  if (selected.canceled) { app.quit(); return; }
  workspace = selected.filePaths[0];
  const identity = createHash('sha256').update(workspace).digest('hex').slice(0, 16);
  const data = smoke && process.env.HARNESS_SMOKE_DATA ? process.env.HARNESS_SMOKE_DATA : join(app.getPath('userData'), identity);
  mkdirSync(data, { recursive: true });
  const packaged = app.isPackaged;
  const binary = join(process.resourcesPath, 'host', process.platform === 'win32' ? 'harness-host.exe' : 'harness-host');
  if (packaged && !existsSync(binary)) throw new Error('安装包缺少 Host，请先执行第 23 步准备命令');
  const modelEnv = Object.fromEntries(['MODEL_BACKEND', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  child = spawn(packaged ? binary : process.env.BUN_EXECUTABLE || 'bun', packaged ? [] : [join(__dirname, '../src/server.ts')], {
    cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG,
      ...modelEnv,
      HARNESS_WORKSPACE: workspace, HARNESS_DATA: data, PORT: '0',
      HARNESS_COMPILED: packaged ? '1' : '0', HARNESS_WEB: packaged ? join(process.resourcesPath, 'web') : join(__dirname, '../web') },
  });
  child.stderr.on('data', bytes => console.error(bytes.toString()));
  const ready = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Host 启动超时')), 15_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Host 提前退出：' + code)); });
    child.stdout.on('data', bytes => {
      buffer += bytes.toString();
      if (buffer.length > 64_000) { clearTimeout(timer); reject(new Error('Host 就绪输出异常')); return; }
      const index = buffer.indexOf('\n');
      if (index < 0) return;
      try {
        const line = JSON.parse(buffer.slice(0, index));
        const url = new URL(line.url);
        if (line.type !== 'ready' || url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Host 地址非法');
        clearTimeout(timer); resolve(url.href);
      } catch (error) { clearTimeout(timer); reject(error); }
    });
  });
  origin = new URL(ready).origin;
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ipcMain.handle('harness:info', event => {
    if (event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error('IPC 来源非法');
    return { version: app.getVersion(), workspace };
  });
  window = new BrowserWindow({ width: 1050, height: 800, show: !smoke,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
  child.on('exit', () => { if (!stopping && window && !window.isDestroyed()) { void dialog.showMessageBox(window, { message: 'Host 已退出，请重新启动桌面端' }); } });
  await window.loadURL(ready);
  if (smoke) {
    // 真实 Electron 窗口中验证 preload、Node 隔离和 HTTP 权限链，不以 Bun 测试代替。
    const result = await window.webContents.executeJavaScript(`(async () => {
      const info = await window.harnessDesktop.info();
      const response = await fetch('/api/sessions', {method:'POST'});
      const session = await response.json();
      const started = await fetch('/api/sessions/' + session.id + '/prompts', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'桌面验收',requestId:crypto.randomUUID()})});
      return {isolated:typeof require==='undefined', workspace:info.workspace, status:started.status};
    })()`);
    if (!result.isolated || result.status !== 202 || result.workspace !== workspace) throw new Error('桌面验收失败');
    console.log('DESKTOP_SMOKE_PASS'); app.quit();
  }
}).catch(async error => { console.error(error); process.exitCode = 1; await stopHost(); stopped = true; app.quit(); });
