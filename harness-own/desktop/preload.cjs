const { contextBridge, ipcRenderer } = require('electron')

// Renderer只得到明确允许的能力，没有require、文件系统或任意IPC通道。
contextBridge.exposeInMainWorld('desktop', Object.freeze({ info: () => ipcRenderer.invoke('desktop:info') }))
