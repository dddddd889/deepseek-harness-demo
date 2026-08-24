import { HarnessContext } from "./context.js";
/** Bundle 是有序插件补丁；任何 row 失败都会逆序回滚此前已挂载 rows。 */
export class HarnessBundle {
    context = new HarnessContext();
    #disposers = [];
    #mounted = false;
    async mount(plugins) {
        if (this.#mounted)
            throw new Error('Bundle 已挂载');
        this.#mounted = true;
        try {
            for (const plugin of plugins)
                this.#disposers.push(await this.context.mount(plugin));
        }
        catch (error) {
            await this.dispose();
            throw error;
        }
    }
    async dispose() {
        const errors = [];
        for (const dispose of this.#disposers.reverse()) {
            try {
                await dispose();
            }
            catch (error) {
                errors.push(error);
            }
        }
        this.#disposers.length = 0;
        if (errors.length > 0)
            throw new AggregateError(errors, 'Bundle 清理失败');
    }
}
//# sourceMappingURL=bundle.js.map