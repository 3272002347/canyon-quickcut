const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('quickCut', {
  chooseVideo: () => ipcRenderer.invoke('media:choose'),
  inspectVideo: (filePath) => ipcRenderer.invoke('media:inspect', filePath),
  saveProject: (project, knownPath) => ipcRenderer.invoke('project:save', project, knownPath),
  openProject: () => ipcRenderer.invoke('project:open'),
  chooseExportPath: (suggestedName) => ipcRenderer.invoke('export:choose', suggestedName),
  startExport: (request) => ipcRenderer.invoke('export:start', request),
  cancelExport: (jobId) => ipcRenderer.invoke('export:cancel', jobId),
  revealFile: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  getStartupMedia: () => ipcRenderer.invoke('app:startup-media'),
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openReleases: () => ipcRenderer.invoke('update:open-releases'),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state)
    ipcRenderer.on('update:state', listener)
    return () => ipcRenderer.removeListener('update:state', listener)
  },
  onExportProgress: (callback) => {
    const listener = (_event, progress) => callback(progress)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },
})


