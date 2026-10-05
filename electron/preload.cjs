const { ipcRenderer, contextBridge } = require('electron');

console.log('[Preload] Initializing electron bridge into window.electron...');

contextBridge.exposeInMainWorld('electron', {
    close: () => {
        console.log('[Preload] Sending window-close IPC');
        ipcRenderer.send('window-close');
    },
    minimize: () => {
        console.log('[Preload] Sending window-minimize IPC');
        ipcRenderer.send('window-minimize');
    },
    togglePin: (isPinned) => {
        console.log(`[Preload] Sending window-pin IPC: ${isPinned}`);
        ipcRenderer.send('window-pin', isPinned);
    },
    resize: (data) => ipcRenderer.send('window-resize', data),
    musicCommand: (command) => ipcRenderer.send('music-command', command),
    openExternal: (url) => ipcRenderer.send('open-external', url),
});

console.log('[Preload] window.electron bridge exposed successfully.');
