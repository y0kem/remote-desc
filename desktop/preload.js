const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  getServerInfo: () => ipcRenderer.invoke('get-server-info'),
  getQrCode: (ip) => ipcRenderer.invoke('get-qr-code', ip),
  toggleCursor: () => ipcRenderer.invoke('toggle-cursor'),
  toggleMagnifier: () => ipcRenderer.invoke('toggle-magnifier'),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (_event, data) => callback(data));
  }
});
