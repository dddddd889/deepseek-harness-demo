import { HarnessContext } from './context.ts';
import type { Plugin } from './context.ts';
/** 插件包是一组有序插件；任一条目失败时都会逆序回滚此前已挂载的条目。 */
export declare class HarnessBundle {
    #private;
    readonly context: HarnessContext;
    mount(plugins: readonly Plugin[]): Promise<void>;
    dispose(): Promise<void>;
}
