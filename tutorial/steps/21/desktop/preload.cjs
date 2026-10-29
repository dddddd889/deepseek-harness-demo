const { contextBridge, ipcRenderer } = require('electron');
// 只暴露一个固定方法，不把 ipcRenderer、文件系统或任意通道交给网页。
contextBridge.exposeInMainWorld('harnessDesktop', Object.freeze({ info: () => ipcRenderer.invoke('harness:info') }));
