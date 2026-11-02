const { contextBridge, ipcRenderer } = require('electron')

// Renderer只得到明确允许的能力，没有require、文件系统或任意IPC通道。
// Main创建窗口时指定本文件；Electron在页面脚本前执行它，而不是由index.html导入。
// contextBridge把desktop接口暴露到页面上下文；普通浏览器打开同一HTML不会获得该接口。
contextBridge.exposeInMainWorld('desktop', Object.freeze({ info: () => ipcRenderer.invoke('desktop:info') }))
