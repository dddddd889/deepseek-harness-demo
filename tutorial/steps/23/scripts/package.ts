import { mkdir } from 'node:fs/promises';
// 编译当前操作系统/架构的 Host，自带运行时；跨平台包要在对应平台重新构建。
await mkdir('desktop/host', { recursive: true });
const output = 'desktop/host/' + (process.platform === 'win32' ? 'harness-host.exe' : 'harness-host');
const build = Bun.spawnSync([process.execPath, 'build', 'src/launcher.ts', '--compile', '--outfile', output], { stdout: 'inherit', stderr: 'inherit' });
if (build.exitCode) throw new Error('Host 编译失败');
console.log('Host 已准备：' + output);
