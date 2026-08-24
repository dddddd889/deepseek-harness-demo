import { HarnessContext } from "./context.js";
/** 插件包是一组有序插件；任一条目失败时都会逆序回滚此前已挂载的条目。 */
export class HarnessBundle {
    context = new HarnessContext();
    #disposers = [];
    #mounted = false;
    async mount(plugins) {
        if (this.#mounted)
            throw new Error('插件包已挂载');
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
            throw new AggregateError(errors, '插件包清理失败');
    }
}
//# sourceMappingURL=bundle.js.map