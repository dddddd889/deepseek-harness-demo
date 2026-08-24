import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalProcessRuntime } from './local-process.ts'
import { LocalShell } from './local-shell.ts'
import { WorkspaceFs } from './workspace-fs.ts'

const root = await mkdtemp(join(tmpdir(), 'harness-local-demo-'))
const runtime = await LocalProcessRuntime.create()
try {
  const fs = await WorkspaceFs.open(root)
  await fs.writeText('src/hello.txt', 'hello local capability\n')
  console.log('read:', await fs.readText('src/hello.txt'))
  console.log('search:', await fs.search('local'))

  const shell = new LocalShell(runtime, root)
  console.log('shell:', await shell.run({ command: 'wc -c src/hello.txt; printf warning >&2' }))
} finally {
  await runtime.dispose()
  await rm(root, { recursive: true, force: true })
}
