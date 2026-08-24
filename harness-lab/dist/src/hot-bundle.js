import { HarnessBundle } from "./bundle.js";
/** 以整套 插件包 为事务边界热替换；候选挂载失败时旧代仍继续服务。 */
export class HotBundle {
    #current;
    #generation = 0;
    get generation() { return this.#generation; }
    use(key) {
        if (!this.#current)
            throw new Error('插件包尚未加载');
        return this.#current.context.get(key);
    }
    async reload(plugins) {
        const candidate = new HarnessBundle();
        await candidate.mount(plugins);
        const previous = this.#current;
        this.#current = candidate;
        this.#generation += 1;
        await previous?.dispose();
        return this.#generation;
    }
    async dispose() {
        const current = this.#current;
        this.#current = undefined;
        await current?.dispose();
    }
}
//# sourceMappingURL=hot-bundle.js.map