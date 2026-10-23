import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Skills } from '../src/skills.mjs'
import { Events } from '../src/events.mjs'

test('同名Skill后层胜出，修改原文件不改变已记录上下文', async () => {
  const root = await mkdtemp(join(tmpdir(), 'own-skill-'))
  try {
    for (const name of ['user', 'project']) { await mkdir(join(root, name, 'review'), { recursive: true }); await writeFile(join(root, name, 'review', 'SKILL.md'), name) }
    const skills = new Skills([join(root, 'user'), join(root, 'project')]), session = new Events()
    assert.deepEqual(await skills.discover(), ['review'])
    assert.equal(await skills.load('review', session), 'project')
    await writeFile(join(root, 'project/review/SKILL.md'), 'changed')
    assert.equal(session.read()[0].data.content, 'project')
  } finally { await rm(root, { recursive: true, force: true }) }
})
