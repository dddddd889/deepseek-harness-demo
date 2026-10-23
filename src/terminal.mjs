/** Bun 原生 PTY：交互终端与上一部的管道 Shell 分开管理。 */
export class Terminal {
  chunks = [] // 保留带游标的文本窗口。
  offset = 0 // 游标按解码后的字符数累计。
  constructor(scope, command, args, options = {}) {
    const decoder = new TextDecoder() // 连续解码，避免中文跨字节块时变成乱码。
    /** 将完整文本追加到有界窗口。 */
    const append = text => {
      if (!text) return
      this.chunks.push({ offset: this.offset, text }); this.offset += text.length
      while (this.chunks.length > 1000) this.chunks.shift()
    }
    let finishOutput // PTY 的 EOF 与子进程退出是两个不同事件。
    const outputClosed = new Promise(resolve => { finishOutput = resolve })
    this.process = Bun.spawn([command, ...args], {
      cwd: options.cwd,
      env: { ...(options.env ?? process.env), TERM: options.name ?? 'xterm-256color' },
      terminal: {
        cols: options.cols ?? 80, rows: options.rows ?? 24,
        data: (_terminal, bytes) => append(decoder.decode(bytes, { stream: true })),
        exit: () => { append(decoder.decode()); finishOutput() }
      }
    })
    // 同时等进程与输出结束，不能为了尽早返回而丢掉末尾文字。
    this.closed = Promise.all([this.process.exited, outputClosed]).then(([exitCode]) => ({ exitCode }))
    scope.own(async () => {
      try { this.process.kill() } catch {}
      await this.closed
      this.process.terminal.close()
    })
  }
  /** 游标落后于保留窗口时明确报告，不能静默丢失输出。 */
  read(after = 0) {
    if (after < (this.chunks[0]?.offset ?? 0)) throw Error('终端游标已过期')
    return { offset: this.offset, text: this.chunks.filter(chunk => chunk.offset + chunk.text.length > after).map(chunk => chunk.text.slice(Math.max(0, after - chunk.offset))).join('') }
  }
  /** 写入同一 PTY 的键盘输入。 */
  write(text) { this.process.terminal.write(text) }
  /** 调整同一 PTY 的窗口尺寸。 */
  resize(cols, rows) { if (cols < 1 || rows < 1) throw Error('终端尺寸不合法'); this.process.terminal.resize(cols, rows) }
  /** 给终端子进程发送信号。 */
  signal(name = 'SIGINT') { this.process.kill(name) }
}