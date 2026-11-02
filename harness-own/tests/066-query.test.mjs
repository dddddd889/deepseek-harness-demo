import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { Query, exportSession, importSession } from '../src/query.mjs'
import { Events } from '../src/events.mjs'

test('真实SQLite FTS增量去重、授权过滤、ZIP往返与TypeScript消费者', () => {
  const session = new Events('s'), query = new Query(':memory:')
  try {
    session.append('message/user', { role: 'user', content: 'cancel task' })
    query.index('s', session.read()); query.index('s', session.read())
    assert.equal(query.search('cancel', new Set(['s'])).length, 1)
    assert.equal(query.search('cancel', new Set(['stranger'])).length, 0)
    assert.deepEqual(importSession(exportSession({ id: 's' }, session.read())).events, session.read())
    // 编译器是另一个 Bun 进程，显式传环境，避免调试时争抢父进程 Inspector。
    const checked = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--skipLibCheck', 'tests/types-sdk.mts'], { env: { ...process.env }, encoding: 'utf8' })
    assert.equal(checked.status, 0, checked.stdout + checked.stderr)
  } finally { query.close() }
})
