import { HarnessContext } from './context.ts';
import type { Plugin } from './context.ts';
/** Bundle 是有序插件补丁；任何 row 失败都会逆序回滚此前已挂载 rows。 */
export declare class HarnessBundle {
    #private;
    readonly context: HarnessContext;
    mount(plugins: readonly Plugin[]): Promise<void>;
    dispose(): Promise<void>;
}
