import { mkdir, lstat, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
export class WorkspaceFsError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.name = 'WorkspaceFsError';
        this.code = code;
    }
}
/** 只允许访问一个 规范化工作区；所有返回路径均为相对路径。 */
export class WorkspaceFs {
    root;
    #maxReadBytes;
    #maxWriteBytes;
    #maxSearchResults;
    #maxOutputChars;
    constructor(root, options) {
        this.root = root;
        this.#maxReadBytes = options.maxReadBytes ?? 1_000_000;
        this.#maxWriteBytes = options.maxWriteBytes ?? 1_000_000;
        this.#maxSearchResults = options.maxSearchResults ?? 200;
        this.#maxOutputChars = options.maxOutputChars ?? 20_000;
    }
    static async open(root, options = {}) {
        const canonical = await realpath(root);
        const info = await stat(canonical);
        if (!info.isDirectory())
            throw new WorkspaceFsError('工作区必须是目录', 'WORKSPACE_NOT_DIRECTORY');
        return new WorkspaceFs(canonical, options);
    }
    async readText(path) {
        const target = await this.resolveExisting(path);
        const info = await stat(target);
        if (!info.isFile())
            throw new WorkspaceFsError(`${path} 不是文件`, 'NOT_A_FILE');
        if (info.size > this.#maxReadBytes)
            throw new WorkspaceFsError(`${path} 超过读取上限`, 'READ_LIMIT_EXCEEDED');
        const content = await readFile(target, 'utf8');
        const clipped = clip(content, this.#maxOutputChars);
        return { path: this.display(target), content: clipped.text, truncated: clipped.truncated };
    }
    async writeText(path, content) {
        const bytes = Buffer.byteLength(content);
        if (bytes > this.#maxWriteBytes)
            throw new WorkspaceFsError(`${path} 超过写入上限`, 'WRITE_LIMIT_EXCEEDED');
        const target = this.resolveLexical(path);
        await this.ensureWritableParent(dirname(target));
        // 同目录临时文件 + 重命名，避免进程中断留下半写文件。
        const temporary = resolve(dirname(target), `.${basename(target)}.${crypto.randomUUID()}.tmp`);
        try {
            await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
            await rename(temporary, target);
        }
        finally {
            await rm(temporary, { force: true });
        }
        return { path: this.display(target), bytes };
    }
    async list(path = '.') {
        const target = await this.resolveExisting(path);
        const info = await stat(target);
        if (!info.isDirectory())
            throw new WorkspaceFsError(`${path} 不是目录`, 'NOT_A_DIRECTORY');
        const entries = await readdir(target, { withFileTypes: true });
        return {
            path: this.display(target),
            entries: entries.sort((a, b) => a.name.localeCompare(b.name)).map(entry => ({ name: entry.name, type: direntType(entry) })),
        };
    }
    async search(query, path = '.') {
        const root = await this.resolveExisting(path);
        const matches = [];
        let outputChars = 0;
        let truncated = false;
        const pending = [root];
        while (pending.length > 0 && !truncated) {
            const current = pending.pop();
            if (!current)
                break;
            const entries = await readdir(current, { withFileTypes: true });
            for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name))) {
                const absolute = resolve(current, entry.name);
                if (entry.isSymbolicLink())
                    continue;
                if (entry.isDirectory()) {
                    pending.push(absolute);
                    continue;
                }
                if (!entry.isFile())
                    continue;
                const info = await stat(absolute);
                if (info.size > this.#maxReadBytes)
                    continue;
                const text = await readFile(absolute, 'utf8');
                let lineNumber = 0;
                for (const line of text.split(/\r?\n/u)) {
                    lineNumber += 1;
                    if (!line.includes(query))
                        continue;
                    const row = { path: this.display(absolute), line: lineNumber, text: line };
                    outputChars += row.path.length + row.text.length;
                    if (matches.length >= this.#maxSearchResults || outputChars > this.#maxOutputChars) {
                        truncated = true;
                        break;
                    }
                    matches.push(row);
                }
                if (truncated)
                    break;
            }
        }
        return { matches, truncated };
    }
    /** 词法检查拒绝绝对路径和 ..；真实路径检查另行阻断符号链接逃逸。 */
    resolveLexical(path) {
        if (isAbsolute(path))
            throw new WorkspaceFsError(`拒绝绝对路径：${path}`, 'PATH_OUTSIDE_WORKSPACE');
        const target = resolve(this.root, path);
        this.assertInside(target);
        return target;
    }
    async resolveExisting(path) {
        const lexical = this.resolveLexical(path);
        let canonical;
        try {
            canonical = await realpath(lexical);
        }
        catch (error) {
            if (nodeCode(error) === 'ENOENT')
                throw new WorkspaceFsError(`路径不存在：${path}`, 'PATH_NOT_FOUND');
            throw error;
        }
        this.assertInside(canonical);
        return canonical;
    }
    /** 创建缺失目录前先验证最近存在祖先的真实路径，防止父级符号链接逃逸。 */
    async ensureWritableParent(parent) {
        let ancestor = parent;
        while (true) {
            try {
                const canonical = await realpath(ancestor);
                this.assertInside(canonical);
                break;
            }
            catch (error) {
                if (nodeCode(error) !== 'ENOENT')
                    throw error;
                const next = dirname(ancestor);
                if (next === ancestor)
                    throw new WorkspaceFsError('找不到工作区内的祖先目录', 'PATH_OUTSIDE_WORKSPACE');
                ancestor = next;
            }
        }
        await mkdir(parent, { recursive: true });
        this.assertInside(await realpath(parent));
    }
    assertInside(target) {
        const rel = relative(this.root, target);
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
            throw new WorkspaceFsError(`路径逃逸工作区：${target}`, 'PATH_OUTSIDE_WORKSPACE');
        }
    }
    display(target) {
        const value = relative(this.root, target);
        return value === '' ? '.' : value.split(sep).join('/');
    }
}
/** 将工作区文件系统能力包装成四个普通工具，不让智能体循环依赖本地文件接口。 */
export function createWorkspaceFsTools(fs) {
    return [
        {
            name: 'fs_read', description: '读取工作区内的文本文件',
            parameters: objectSchema({ path: { type: 'string' } }, ['path']),
            isConcurrencySafe: () => true,
            effect: () => ({ minimumMode: 'read-only', reason: '读取工作区文件' }),
            execute: async (args) => fs.readText(stringArg(args, 'path')),
        },
        {
            name: 'fs_write', description: '以原子方式写入工作区内的文本文件',
            parameters: objectSchema({
                path: { type: 'string' }, content: { type: 'string' },
                sandbox_permissions: { enum: ['workspace-write', 'danger-full-access'] },
                justification: { type: 'string', minLength: 1 },
            }, ['path', 'content']),
            effect: () => ({ minimumMode: 'workspace-write', reason: '写入工作区文件' }),
            execute: async (args) => fs.writeText(stringArg(args, 'path'), stringArg(args, 'content')),
        },
        {
            name: 'fs_list', description: '列出工作区内的目录',
            parameters: objectSchema({ path: { type: 'string' } }),
            isConcurrencySafe: () => true,
            effect: () => ({ minimumMode: 'read-only', reason: '列出工作区目录' }),
            execute: async (args) => fs.list(optionalStringArg(args, 'path') ?? '.'),
        },
        {
            name: 'fs_search', description: '在工作区文本文件中搜索字面字符串',
            parameters: objectSchema({ query: { type: 'string', minLength: 1 }, path: { type: 'string' } }, ['query']),
            isConcurrencySafe: () => true,
            effect: () => ({ minimumMode: 'read-only', reason: '搜索工作区文件' }),
            execute: async (args) => fs.search(stringArg(args, 'query'), optionalStringArg(args, 'path') ?? '.'),
        },
    ];
}
/** 创建严格 对象模式。 */
function objectSchema(properties, required = []) {
    return { type: 'object', properties, required, additionalProperties: false };
}
/** 从已校验参数读取字符串。 */
function stringArg(args, name) {
    const value = optionalStringArg(args, name);
    if (value === undefined)
        throw new WorkspaceFsError(`缺少参数 ${name}`, 'INVALID_ARGUMENTS');
    return value;
}
/** 从已校验参数读取可选字符串。 */
function optionalStringArg(args, name) {
    if (typeof args !== 'object' || args === null || Array.isArray(args))
        return undefined;
    const value = args[name];
    return typeof value === 'string' ? value : undefined;
}
/** 输出按字符裁剪，并显式标记，避免静默丢失。 */
function clip(text, maximum) {
    return text.length <= maximum ? { text, truncated: false } : { text: text.slice(0, maximum), truncated: true };
}
/** 将 目录项 映射为稳定类型词汇。 */
function direntType(entry) {
    if (entry.isDirectory())
        return 'directory';
    if (entry.isFile())
        return 'file';
    if (entry.isSymbolicLink())
        return 'symlink';
    return 'other';
}
/** 读取 系统错误码。 */
function nodeCode(error) {
    return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}
//# sourceMappingURL=workspace-fs.js.map