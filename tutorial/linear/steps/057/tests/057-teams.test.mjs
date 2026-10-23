import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Team } from '../src/teams.mjs'
import { Store } from '../src/storage.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('团队名保留、Lead限制和真实持久任务依赖', async () => {
  const root = mkdtempSync(join(tmpdir(), 'own-team-'))
  try {
    const team = new Team(new Store(join(root, 'team.json')), 'lead', async name => name, () => 'receipt', () => {})
    await team.create('lead', 'reviewer')
    await assert.rejects(team.create('lead', 'reviewer'), /不可复用/)
    team.task('a'); team.task('b', ['a'])
    assert.throws(() => team.claim('b', 'reviewer'), /不可认领/)
    team.claim('a', 'reviewer'); team.complete('a', 'reviewer'); team.claim('b', 'reviewer')
    assert.equal(team.state().tasks.b.owner, 'reviewer')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
