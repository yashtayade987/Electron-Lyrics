const { ipcRenderer, contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    close: () => ipcRenderer.send('window-close'),
    minimize: () => ipcRenderer.send('window-minimize'),
    togglePin: (isPinned) => ipcRenderer.send('window-pin', isPinned),
    resize: (data) => ipcRenderer.send('window-resize', data),
    musicCommand: (command) => ipcRenderer.send('music-command', command),
});
