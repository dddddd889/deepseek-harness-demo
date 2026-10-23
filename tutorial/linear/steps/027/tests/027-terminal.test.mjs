import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Terminal } from '../src/terminal.mjs'
import { Scope } from '../src/scope.mjs'

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
