import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Attachments, present } from '../src/attachments.mjs'
import { Events } from '../src/events.mjs'

test('真实内容寻址与交付快照不随原文件改变', async () => {
  const root = await mkdtemp(join(tmpdir(), 'own-attachment-'))
  try {
    const path = join(root, 'result.txt'), store = new Attachments(join(root, 'data')), session = new Events()
    await writeFile(path, 'first'); const ref = await present(session, store, path, 'text/plain')
    await writeFile(path, 'second')
    assert.equal((await store.read(ref)).toString(), 'first')
    await assert.rejects(store.read({ id: '../secret' }), /不合法/)
  } finally { await rm(root, { recursive: true, force: true }) }
})