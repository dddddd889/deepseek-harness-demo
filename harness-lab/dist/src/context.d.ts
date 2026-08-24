export type Disposer = () => void | Promise<void>;
export type EffectBody = () => void | Disposer | Promise<void | Disposer>;
export type EventListener = (...args: readonly unknown[]) => void;
export interface Plugin {
    readonly name: string;
    apply(context: PluginContext): void | Promise<void>;
}
/** 一个插件自己的生命周期作用域；插件只能释放自己登记的资源。 */
export declare class PluginContext {
    #private;
    constructor(root: HarnessContext, pluginName: string);
    /** 注册一个可逆副作用，并保存对应的清理函数。 */
    effect(body: EffectBody): Promise<void>;
    /** 发布服务；插件卸载时只撤销自己发布的那个实例。 */
    provide<T>(key: string, value: T): Promise<void>;
    /** 订阅事件；底层订阅会自动转成当前插件的副作用。 */
    on(event: string, listener: EventListener): Promise<void>;
    /** 获取已发布服务；调用方通过稳定键，而不是具体实现类耦合。 */
    get<T>(key: string): T;
    /** 逆序释放资源，保证后注册的依赖先被清理。 */
    dispose(): Promise<void>;
}
/** 最小框架容器：管理服务、事件和插件生命周期。 */
export declare class HarnessContext {
    #private;
    /** 挂载插件；启动失败时回滚已经注册的全部副作用。 */
    mount(plugin: Plugin): Promise<Disposer>;
    /** 按注册顺序广播同步事件。 */
    emit(event: string, ...args: readonly unknown[]): void;
    /** 获取服务；缺失时立即失败，避免把依赖错误拖到业务深处。 */
    get<T>(key: string): T;
    /** 输出只读诊断快照，供测试和调试器检查。 */
    inspect(): {
        services: readonly string[];
        plugins: readonly string[];
        listeners: Readonly<Record<string, number>>;
    };
    /** 内部发布服务，并返回带实例身份检查的撤销函数。 */
    provide<T>(owner: string, key: string, value: T): Disposer;
    /** 内部登记监听器，并返回幂等撤销函数。 */
    subscribe(event: string, listener: EventListener): Disposer;
}
