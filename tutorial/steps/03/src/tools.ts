import { realpath, stat, readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import type { ToolCall, ToolSpec } from './domain';
// 工具定义既包含给模型的 Schema，也包含本机执行函数和权限分类。
export type Tool = ToolSpec & { mutates: boolean; run: (args: any, signal: AbortSignal) => Promise<string> };
export class Tools {
  private entries = new Map<string, Tool>();
  register(tool: Tool) {
    if (this.entries.has(tool.name)) throw new Error('工具重名：' + tool.name);
    this.entries.set(tool.name, tool);
    return () => { this.entries.delete(tool.name); };
  }
  get(name: string) {
    const tool = this.entries.get(name);
    if (!tool) throw new Error('未知工具：' + name);
    return tool;
  }
  specs() { return [...this.entries.values()].map(({ name, description, parameters }) => ({ name, description, parameters })); }
  async execute(call: ToolCall, signal: AbortSignal) {
    signal.throwIfAborted();
    const args = JSON.parse(call.function.arguments);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象');
    return this.get(call.function.name).run(args, signal);
  }
}
// 同时检查词法路径与 realpath，拦住 ../ 和指向工作区外的符号链接。
export async function workspacePath(root: string, name: unknown) {
  if (typeof name !== 'string' || !name || isAbsolute(name)) throw new Error('需要工作区相对路径');
  const base = await realpath(root);
  const path = resolve(base, name);
  const inside = (candidate: string) => {
    const rel = relative(base, candidate);
    if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) throw new Error('路径越界');
  };
  inside(path);
  inside(await realpath(path));
  return path;
}
// 读工具限制文件大小，避免把整个依赖目录或巨型日志灌进模型。
export function registerRead(tools: Tools, root: string) {
  return tools.register({ name: 'read', description: '读取工作区内的 UTF-8 文本文件', mutates: false,
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    async run(args, signal) {
      const path = await workspacePath(root, args.path);
      const info = await stat(path);
      if (!info.isFile() || info.size > 64_000) throw new Error('只能读取不超过 64KB 的普通文件');
      return readFile(path, { encoding: 'utf8', signal });
    } });
}
