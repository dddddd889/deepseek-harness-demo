export class WebRuntimeError extends Error {
    code;
    constructor(message, code) {
        super(message);
        this.code = code;
    }
}
/** Web seam 在执行时选择 provider，绝不依赖注册顺序。 */
export class WebRuntime {
    #search = new Map();
    #fetch = new Map();
    #searchProvider;
    #fetchProvider;
    constructor(config = {}) {
        this.#searchProvider = config.searchProvider;
        this.#fetchProvider = config.fetchProvider;
    }
    registerSearch(provider) {
        return this.#register(this.#search, provider);
    }
    registerFetch(provider) {
        return this.#register(this.#fetch, provider);
    }
    async search(query, maxResults, signal) {
        const result = await this.#resolve(this.#search, this.#searchProvider).search(query, maxResults, signal);
        return result.sources.length <= maxResults
            ? result
            : { ...result, sources: result.sources.slice(0, maxResults), truncated: true };
    }
    async fetch(url, signal) {
        return this.#resolve(this.#fetch, this.#fetchProvider).fetch(url, signal);
    }
    #register(store, provider) {
        if (store.has(provider.id))
            throw new WebRuntimeError(`Web provider 重复：${provider.id}`, 'WEB_DUPLICATE_PROVIDER');
        store.set(provider.id, provider);
        return () => store.delete(provider.id);
    }
    #resolve(store, configured) {
        if (configured !== undefined) {
            const provider = store.get(configured);
            if (provider === undefined)
                throw new WebRuntimeError(`配置的 provider 未注册：${configured}`, 'WEB_PROVIDER_CONFIGURED_MISSING');
            if (!provider.available())
                throw new WebRuntimeError(`配置的 provider 不可用：${configured}`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE');
            return provider;
        }
        const available = [...store.values()].filter(provider => provider.available());
        if (available.length === 0)
            throw new WebRuntimeError('没有可用 Web provider', 'WEB_PROVIDER_UNAVAILABLE');
        if (available.length > 1)
            throw new WebRuntimeError('存在多个 Web provider，必须显式选择', 'WEB_PROVIDER_AMBIGUOUS');
        return available[0];
    }
}
//# sourceMappingURL=web-runtime.js.map