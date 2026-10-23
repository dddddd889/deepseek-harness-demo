import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Worktrees } from '../src/worktree.mjs'

test('未拥有的worktree不能归档或删除；名称/ref不能变成git选项', async () => {
  const manager = new Worktrees(process.cwd(), '/private/tmp/own-worktrees')
  await assert.rejects(manager.archive('someone-else', '/tmp/a.tar.gz', new AbortController().signal), /拥有/)
  await assert.rejects(manager.create('../escape', 'HEAD', new AbortController().signal), /不合法/)
  await assert.rejects(manager.create('safe', '--exec=bad', new AbortController().signal), /不合法/)
})
