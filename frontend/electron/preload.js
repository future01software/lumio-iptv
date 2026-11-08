const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  windowControl: (action) => ipcRenderer.send('window-control', action),
  onWindowMaximizeChange: (callback) => ipcRenderer.on('window-maximize-change', (_event, isMaximized) => callback(isMaximized)),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  onFullscreenChange: (callback) => ipcRenderer.on('fullscreen-change', (_event, isFullscreen) => callback(isFullscreen)),
  cacheRead: (key) => ipcRenderer.invoke('cache-read', key),
  cacheWrite: (key, data) => ipcRenderer.invoke('cache-write', key, data),
  cacheDelete: (key) => ipcRenderer.invoke('cache-delete', key),
  appVersion: () => ipcRenderer.invoke('app-version'),
  // The installed exe's version (package.json), read once at startup.
  installedVersion: ipcRenderer.sendSync('app-version-sync'),
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateDownload: () => ipcRenderer.invoke('update-download'),
  updateInstall: () => ipcRenderer.invoke('update-install'),
  onUpdateProgress: (callback) => {
    const listener = (_event, fraction) => callback(fraction);
    ipcRenderer.on('update-progress', listener);
    return () => ipcRenderer.removeListener('update-progress', listener);
  },
  backupSave: (data, defaultName) => ipcRenderer.invoke('backup-save', data, defaultName),
  backupOpen: () => ipcRenderer.invoke('backup-open'),
  notify: (title, body, tag) => ipcRenderer.send('notify', title, body, tag),
  onNotificationClick: (callback) => ipcRenderer.on('notification-click', (_event, tag) => callback(tag))
});
