import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// 开发入口由 Bun 启动，再将其绝对路径传给 Electron，Host 不从 PATH 猜运行时。
const require = createRequire(import.meta.url) // 这里只加载 Electron 包提供的二进制路径。
const executable = require('electron') // Electron 主进程仍使用其内置运行时。
const environment = { ...process.env, HARNESS_BUN: process.execPath }
delete environment.ELECTRON_RUN_AS_NODE
// 只在显式调试时开放本机端口；先连接 Main，再继续启动 Host 和窗口。
const debugArgs = environment.HARNESS_VSCODE_DEBUG === '1'
  ? ['--inspect-brk=127.0.0.1:9229', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222']
  : []
const child = spawn(executable, [...debugArgs, resolve('desktop/main.cjs')], { env: environment, stdio: 'inherit' })
child.once('error', error => { console.error(error.message); process.exitCode = 1 })
child.once('exit', code => { process.exitCode = code ?? 1 })
