export class LspRuntimeError extends Error {
    code;
    constructor(message, code) { super(message); this.code = code; }
}
/** 取最终扩展名；foo.d.ts 路由为 .ts，dotfile 不被误判。 */
export function finalExtension(path) {
    const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
    const dot = base.lastIndexOf('.');
    return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}
/** LSP seam 原子保留 provider id 与全部扩展名。 */
export class LspRuntime {
    #ids = new Set();
    #routes = new Map();
    register(provider) {
        if (provider.id.trim() === '' || this.#ids.has(provider.id))
            throw new LspRuntimeError('LSP provider id 无效或冲突', 'LSP_CONFLICT');
        const pending = new Map();
        for (const [raw, languageId] of Object.entries(provider.extensionToLanguage)) {
            const extension = (raw.startsWith('.') ? raw : `.${raw}`).toLowerCase();
            if (!/^\.[^./\\]+$/.test(extension) || languageId.trim() === '' || pending.has(extension)) {
                throw new LspRuntimeError(`LSP 扩展映射无效：${raw}`, 'LSP_INVALID_PROVIDER');
            }
            if (this.#routes.has(extension))
                throw new LspRuntimeError(`LSP 扩展冲突：${extension}`, 'LSP_CONFLICT');
            pending.set(extension, languageId);
        }
        if (pending.size === 0)
            throw new LspRuntimeError('LSP provider 没有扩展映射', 'LSP_INVALID_PROVIDER');
        this.#ids.add(provider.id);
        for (const [extension, languageId] of pending)
            this.#routes.set(extension, { provider, languageId });
        return () => {
            this.#ids.delete(provider.id);
            for (const extension of pending.keys())
                this.#routes.delete(extension);
        };
    }
    async query(request, signal) {
        const route = this.#routes.get(finalExtension(request.filePath));
        if (route === undefined)
            throw new LspRuntimeError(`没有 LSP 处理 ${request.filePath}`, 'LSP_UNAVAILABLE');
        return route.provider.query({ ...request, languageId: route.languageId }, signal);
    }
}
//# sourceMappingURL=lsp-runtime.js.map