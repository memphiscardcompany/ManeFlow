const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('maneFlowDesktop', {
  platform: process.platform,
  mode: 'local-beta',
  version: () => ipcRenderer.invoke('app:version'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
  openEbayAuthorization: () => ipcRenderer.invoke('ebay:oauth-open'),
  exchangeEbayAuthorizationCode: (code) => ipcRenderer.invoke('ebay:oauth-exchange', code),
  disconnectEbaySeller: () => ipcRenderer.invoke('ebay:disconnect'),
  testPsaConnection: (certNumber) => ipcRenderer.invoke('psa:test', certNumber),
  serviceStatus: () => ipcRenderer.invoke('services:status'),
  restartServices: () => ipcRenderer.invoke('services:restart'),
  selectRicohFolder: () => ipcRenderer.invoke('folder:select-ricoh'),
  saveFile: (payload) => ipcRenderer.invoke('file:save', payload),
  createDiagnostics: () => ipcRenderer.invoke('diagnostics:create'),
  openDataFolder: () => ipcRenderer.invoke('app:open-data'),
  openLogs: () => ipcRenderer.invoke('app:open-logs'),
  onStartupProgress: (callback) => subscribe('startup:progress', callback),
  onServiceStatus: (callback) => subscribe('services:status-changed', callback),
});
