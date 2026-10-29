import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Credentials, Workspaces } from '../src/storage.mjs'

test('凭据描述不泄露明文，产品数据真实重启恢复', () => {
  const root = mkdtempSync(join(tmpdir(), 'own-storage-'))
  try {
    const credentials = new Credentials(join(root, 'credentials.json'))
    credentials.set('MODEL_KEY', 'secret-never-send')
    assert.ok(!JSON.stringify(credentials.list()).includes('secret-never-send'))
    assert.equal(new Credentials(join(root, 'credentials.json')).resolve('MODEL_KEY'), 'secret-never-send')
    const workspaces = new Workspaces(join(root, 'workspaces.json')), id = workspaces.add(root, 'demo')
    workspaces.update(id, { archived: true })
    assert.equal(new Workspaces(join(root, 'workspaces.json')).list()[0].archived, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
