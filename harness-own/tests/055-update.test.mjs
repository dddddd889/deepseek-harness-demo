import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Updates } from '../src/update.mjs'

test('真实Ed25519签名、hash与失败保留旧版状态', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-update-')), keys = generateKeyPairSync('ed25519'), bytes = Buffer.from('new-app')
  try {
    const update = new Updates(join(root, 'state.json'), keys.publicKey, 'mac-arm64')
    const raw = JSON.stringify({ version: '1.1.0', target: 'mac-arm64', sha256: createHash('sha256').update(bytes).digest('hex') }), signature = sign(null, Buffer.from(raw), keys.privateKey).toString('base64')
    assert.throws(() => update.admit(raw + ' ', signature, '1.0.0'), /签名/)
    update.admit(raw, signature, '1.0.0')
    await assert.rejects(update.apply(bytes, async () => { throw Error('installer failed') }), /installer/)
    assert.equal(update.store.read().status, 'failed-keep-old')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
