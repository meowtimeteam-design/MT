const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Các hàm khớp 100% với index.html hiện tại của bạn
    getDanhSachTruyen: () => ipcRenderer.invoke('get-danh-sach-truyen'),
    getPendingTasks: (discordId) => ipcRenderer.invoke('get-pending-tasks', discordId),
    submitDone: (data) => ipcRenderer.invoke('done', data),
    addNewChap: (data) => ipcRenderer.invoke('chapmoi', data),
    submitProduct: (data) => ipcRenderer.invoke('nopsanpham', data),
    takeRandomJob: (data) => ipcRenderer.invoke('nhanviec', data),
    submitLeave: (data) => ipcRenderer.invoke('xinnghi', data),
    extendDeadline: (data) => ipcRenderer.invoke('doidl', data),

    // Lắng nghe tiến trình copy file Drive theo thời gian thực
    onCopyProgress: (callback) => {
        ipcRenderer.removeAllListeners('copy-progress');
        ipcRenderer.on('copy-progress', (event, data) => callback(data));
    },

    // Các hàm bổ sung từ Bot Discord (Chọn file Zip/Ảnh, Nhượng chap, Ngân hàng, Quản trị, AI)
    selectFile: (options) => ipcRenderer.invoke('select-file', options),
    getDroppedTasks: () => ipcRenderer.invoke('get-dropped-tasks'),
    claimDroppedTasks: (data) => ipcRenderer.invoke('nhan-drop', data),
    getBankInfo: (discordId) => ipcRenderer.invoke('nganhang', discordId),
    getLeaderboard: () => ipcRenderer.invoke('bangxephang'),
    checkAllDeadlines: () => ipcRenderer.invoke('checkhan'),
    cleanDoneQC: () => ipcRenderer.invoke('dondep'),
    syncSalary: () => ipcRenderer.invoke('dongbo'),
    extendAllDeadlines: (soNgay) => ipcRenderer.invoke('doidl_tong', soNgay),
    reloadData: () => ipcRenderer.invoke('reload-data'),
// Thêm vào contextBridge.exposeInMainWorld
    chonAnhRaw: () => ipcRenderer.invoke('chonAnhRaw'),
    // Bộ 3 công cụ AI
    askAI: (cauhoi) => ipcRenderer.invoke('ai', { cauhoi }),
    translateAI: (data) => ipcRenderer.invoke('dichthu', data),
    ocrRawAI: (data) => ipcRenderer.invoke('docraw', data)
});