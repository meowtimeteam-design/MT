const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    getDanhSachTruyen: () => ipcRenderer.invoke('get-danh-sach-truyen'),
    submitDone: (data) => ipcRenderer.invoke('submit-done', data),
    addNewChap: (data) => ipcRenderer.invoke('add-new-chap', data),
    submitProduct: (data) => ipcRenderer.invoke('submit-product', data),
    scanJobs: (data) => ipcRenderer.invoke('scan-jobs', data),
    takeJobs: (data) => ipcRenderer.invoke('take-jobs', data),
    getPendingTasks: (discordId) => ipcRenderer.invoke('get-pending-tasks', discordId),
    submitLeave: (data) => ipcRenderer.invoke('submit-leave', data),
    takeRandomJob: (data) => ipcRenderer.invoke('take-random-job', data),
    extendDeadline: (data) => ipcRenderer.invoke('extend-deadline', data),
    onCopyProgress: (callback) => ipcRenderer.on('copy-progress', (event, data) => callback(data))
});