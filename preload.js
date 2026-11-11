const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('streamless', {
  desktop: true,
  sources: (thumbs) => ipcRenderer.invoke('sources', !!thumbs),
  browser: {
    create: (o) => ipcRenderer.invoke('b:create', o),
    destroy: (id) => ipcRenderer.invoke('b:destroy', id),
    reload: (id) => ipcRenderer.invoke('b:reload', id),
    onFrame: (cb) => ipcRenderer.on('b:frame', (e, id, w, h, buf) => cb(id, w, h, buf))
  }
});
