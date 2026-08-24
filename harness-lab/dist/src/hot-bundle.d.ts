import type { Plugin } from './context.ts';
/** 以整套 Bundle 为事务边界热替换；候选挂载失败时旧代仍继续服务。 */
export declare class HotBundle {
    #private;
    get generation(): number;
    use<T>(key: string): T;
    reload(plugins: readonly Plugin[]): Promise<number>;
    dispose(): Promise<void>;
}
