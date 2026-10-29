import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Tools } from './tools';
// effect 返回清理函数；中途安装失败时，已经安装的资源反向撤销。
export class Kernel {
  private cleanups: (() => void)[] = [];
  // 逐个 effect 登记，保证插件在第二个 effect 失败时也能回滚第一个。
  install(setup: (effect: (create: () => () => void) => void) => void) {
    const added: (() => void)[] = [];
    try { setup(create => added.push(create())); this.cleanups.push(...added); }
    catch (error) { for (const dispose of added.reverse()) dispose(); throw error; }
  }
  dispose() { for (const dispose of this.cleanups.splice(0).reverse()) dispose(); }
}
// 本教程固定装载一个 Skill 和一份人工维护的记忆，避免目录自动发现掩盖主调用链。
export async function readInstructions(workspace: string) {
  const read = async (name: string) => {
    try {
      const text = await readFile(join(workspace, name), 'utf8');
      if (text.length > 8000) throw new Error(name + ' 超过 8000 字符');
      return text;
    } catch (error: any) { if (error.code === 'ENOENT') return ''; throw error; }
  };
  return [await read('AGENTS.md'), await read('skills/review/SKILL.md'), await read('MEMORY.md')].filter(Boolean).join('\n\n');
}
// 工具扩展依靠同一个注册口，而不是给 Loop 再加一套分支。
export function installClock(kernel: Kernel, tools: Tools) {
  kernel.install(effect => effect(() => tools.register({ name: 'clock', description: '返回当前 ISO 时间', mutates: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async run(_args, signal) { signal.throwIfAborted(); return new Date().toISOString(); } })));
}
