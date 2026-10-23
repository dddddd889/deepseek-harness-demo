import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Terminal } from '../src/terminal.mjs'
import { Scope } from '../src/scope.mjs'
import { mkdtemp, readFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('真实PTY具有TTY属性、输出游标和退出事件', async () => {
  const scope = new Scope()
  const terminal = new Terminal(scope, process.execPath, ['-e', 'console.log("TTY="+process.stdout.isTTY);setTimeout(()=>process.exit(0),50)'], { cwd: process.cwd(), env: process.env })
  try {
    terminal.resize(100, 30)
    await terminal.closed
    assert.match(terminal.read().text, /TTY=true/)
    assert.equal(terminal.read(terminal.offset).text, '')
  } finally { await scope.close() }
}, 5000)

test('真实Vim通过PTY接收按键，保存文件并退出', async () => {
  // 依赖本机Vim；缺失时明确失败，不把跳过当作演示成功。
  const vim = Bun.which('vim')
  assert.ok(vim, '请先安装Vim，并确认终端可以运行vim --version')
  const root = await mkdtemp(join(tmpdir(), 'harness-vim-027-')) // 隔离演示文件。
  const scope = new Scope() // 持有PTY及其进程的清理函数。
  let timer // 演示自身的超时保护，失败时仍进入finally回收。
  try {
    const terminal = new Terminal(scope, vim, [
      '-N', '-u', 'NONE', '-i', 'NONE', '-n',
      // VimEnter发生后才通知测试：编辑器已就绪；不靠固定sleep猜启动时间。
      '-c', "autocmd VimEnter * call writefile(['ready'], '.vim-ready')",
      'demo.txt',
    ], { cwd: root, env: process.env })
    const interaction = async () => {
      const deadline = Date.now() + 3000 // 等待明确的就绪文件，限制等待时间。
      for (;;) {
        try { await access(join(root, '.vim-ready')); break }
        catch (error) { if (error.code !== 'ENOENT') throw error }
        assert.ok(Date.now() < deadline, 'Vim没有触发VimEnter就绪通知')
        await Bun.sleep(10) // 仅降低就绪检查频率，时间过去不代表就绪。
      }
      // i进入插入模式；Esc离开插入模式；:wq加回车保存退出。
      terminal.write('ihello from PTY\x1b:wq\r')
      assert.equal((await terminal.closed).exitCode, 0)
      assert.equal(await readFile(join(root, 'demo.txt'), 'utf8'), 'hello from PTY\n')
      assert.ok(terminal.read().text.length > 0, '应收到Vim的原始终端输出')
    }
    await Promise.race([
      interaction(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Vim演示超时')), 4000) }),
    ])
  } finally {
    clearTimeout(timer)
    await scope.close()
    await rm(root, { recursive: true, force: true })
  }
}, 6000)
