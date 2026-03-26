const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Window control
    expand: () => ipcRenderer.send('expand'),
    collapse: () => ipcRenderer.send('collapse'),
    toggle: () => ipcRenderer.send('toggle'),
    getExpandedState: () => ipcRenderer.invoke('get-expanded-state'),
    onExpansionState: (callback) => {
        ipcRenderer.on('expansion-state', (event, state) => callback(state));
    },

    // Persistent storage (via main process)
    storeGet: (key) => ipcRenderer.invoke('store-get', key),
    storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
    getToggleShortcut: () => ipcRenderer.invoke('get-toggle-shortcut'),
    setToggleShortcut: (shortcut) => ipcRenderer.invoke('set-toggle-shortcut', shortcut),

    // File dialogs
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
    readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
    resizeWindow: (width) => ipcRenderer.send('resize-window', width)
});
