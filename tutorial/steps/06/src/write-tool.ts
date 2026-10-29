import { realpath, lstat, writeFile } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { Tools, workspacePath } from './tools';
// 本步只允许向已存在的工作区目录写文件，不跟随末端符号链接。
export function registerWrite(tools: Tools, root: string) {
  return tools.register({ name: 'write', description: '写入文本文件，需要用户逐次批准', mutates: true,
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'], additionalProperties: false },
    async run(args, signal) {
      if (typeof args.content !== 'string' || Buffer.byteLength(args.content) > 64_000) throw new Error('写入内容需小于 64KB');
      if (typeof args.path !== 'string' || !args.path || args.path.startsWith('/') || args.path.includes('\\')) throw new Error('文件路径非法');
      const parent = await workspacePath(root, dirname(args.path));
      const path = join(await realpath(parent), basename(args.path));
      const existing = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new Error('不能覆盖链接或非普通文件');
      signal.throwIfAborted();
      await writeFile(path, args.content, { encoding: 'utf8', signal });
      return '已写入 ' + args.path;
    } });
}
