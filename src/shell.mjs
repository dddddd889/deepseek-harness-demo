import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/** 持久 Bash 的 cwd/环境跨调用保留；每个 Shell 只有一个顺序命令队列。 */
export class Shell {
  tail = Promise.resolve()
  constructor(cwd) {
    // 使用当前环境快照，避免调试器启动时的缓存地址经 Shell 传给后续 Bun 命令。
    this.child = spawn('/bin/bash', ['--noprofile', '--norc'], { cwd, env: { ...process.env }, detached: true, stdio: 'pipe' })
    this.child.on('error', () => {})
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8')
    this.closed = new Promise(resolve => this.child.once('close', resolve))
  }
  /** 随机结束标记只用于边界，工具输出不能决定下一条宿主命令。 */
  run(command, signal) {
    const pending = this.tail.then(() => new Promise((resolve, reject) => {
      signal.throwIfAborted()
      const marker = '__HARNESS_' + randomUUID().replaceAll('-', '') + '__'
      let output = ''
      const finish = (value, error) => {
        clearTimeout(timer); signal.removeEventListener('abort', abort)
        this.child.stdout.off('data', data); this.child.stderr.off('data', data); this.child.off('close', closed)
        if (error) reject(error); else resolve(value)
      }
      const abort = () => { this.kill(); finish(undefined, Error('Shell 已取消')) }
      const closed = () => finish(undefined, Error('Shell 已退出'))
      const data = bytes => {
        output += bytes.toString()
        const match = new RegExp(marker + ':(\\d+)\\n').exec(output)
        if (match) finish({ code: Number(match[1]), output: output.slice(0, match.index) })
        else if (Buffer.byteLength(output) > 1024 * 1024) { this.kill(); finish(undefined, Error('Shell 输出超限')) }
      }
      const timer = setTimeout(() => { this.kill(); finish(undefined, Error('Shell 超时')) }, 5000)
      signal.addEventListener('abort', abort, { once: true })
      this.child.stdout.on('data', data); this.child.stderr.on('data', data); this.child.once('close', closed)
      this.child.stdin.write(command + '\nprintf "' + marker + ':%s\\n" "$?"\n')
    }))
    this.tail = pending.catch(() => {})
    return pending
  }
  /** 关闭整个进程组，等 close 而不是发完信号就假定已经退出。 */
  kill() { try { process.kill(-this.child.pid, 'SIGKILL') } catch {} }
  async close() { this.kill(); await this.closed }
}