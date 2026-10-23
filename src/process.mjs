import { spawn } from 'node:child_process'

/** 显式 argv 执行；取消和超时终止进程树，返回实际退出码。 */
export function execute({ command, args = [], cwd, env = process.env, timeout = 5000, maxBytes = 64 * 1024 }, signal, onOutput = () => {}) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', bytes = 0, failure, forceTimer
    const stop = reason => {
      failure ??= reason
      if (!child.pid) return
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => child.kill())
      else {
        try { process.kill(-child.pid, 'SIGTERM') } catch {}
        forceTimer ??= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 200)
      }
    }
    const abort = () => stop(Error('执行已取消'))
    signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => stop(Error('执行超时')), timeout)
    const collect = data => {
      bytes += Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data)
      if (bytes > maxBytes) { stop(Error('输出超限')); return }
      const text = data.toString(); output += text; onOutput(text)
    }
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    child.on('error', error => { failure = error })
    child.on('close', (code, terminationSignal) => {
      clearTimeout(timer); clearTimeout(forceTimer); signal.removeEventListener('abort', abort)
      if (failure) reject(failure); else resolve({ code, signal: terminationSignal, output, bytes })
    })
  })
}