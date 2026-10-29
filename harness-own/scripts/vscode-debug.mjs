/** 当前调试器已在启动时连接；这些地址只属于本进程，不能让子进程抢占。 */
export function clearInspectorEnvironment() {
  delete process.env.BUN_INSPECT
  delete process.env.BUN_INSPECT_NOTIFY
}

// 仅由 VS Code 的 --preload 加载，普通运行不加载此文件。
clearInspectorEnvironment()
