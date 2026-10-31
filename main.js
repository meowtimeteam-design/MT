const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater'); // <--- THÊM DÒNG NÀY VÀO ĐẦU FILE
const path = require('path');
const { google } = require('googleapis');

// Tắt Hardware Acceleration chống lỗi treo GPU Cache
app.disableHardwareAcceleration();

// Load file .env (cả khi Dev và khi đã đóng gói .exe)
const envPath = app.isPackaged ? path.join(process.resourcesPath, '.env') : '.env';
require('dotenv').config({ path: envPath });

// CẤU HÌNH GOOGLE OAUTH
const CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim(); 
const CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
const refreshTokens = [];
if (process.env.GOOGLE_REFRESH_TOKEN) refreshTokens.push(process.env.GOOGLE_REFRESH_TOKEN.trim());

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, "https://developers.google.com/oauthplayground");
if (refreshTokens.length > 0) oAuth2Client.setCredentials({ refresh_token: refreshTokens[0] });

const sheets = google.sheets({ version: 'v4', auth: oAuth2Client });
const drive = google.drive({ version: 'v3', auth: oAuth2Client });

// BIẾN TOÀN CỤC & HẰNG SỐ
let thongTinMap = {}; let thanhVienMap = {}; let nguocThanhVienMap = {}; let bankDataMap = {};
const COL = { TRUYEN: 0, CHAP: 1, TRANS: 3, LUONG_TRANS: 4, DL_TRANS: 5, DONE_TRANS: 6, NOTE_TRANS: 7, CLEAN: 8, LUONG_CLEAN: 9, DL_CLEAN: 10, DONE_CLEAN: 11, NOTE_CLEAN: 12, TYPE: 13, LUONG_TYPE: 14, DL_TYPE: 15, DONE_TYPE: 16, NOTE_TYPE: 17 };
const COL_TV = { ROLE: 2, DISCORD: 5, XU: 6, TRE_DL: 10, LUONG: 13 };

// HÀM TIỆN ÍCH
function getCell(r, i) { return (!r || r.length <= i || r[i] === undefined || r[i] === null) ? "" : String(r[i]).trim(); }
function xoaRac(s) { return !s ? '' : s.toString().toLowerCase().split('(')[0].replace(/[^\p{L}\p{N}]/gu, ''); }
function layNgayVN() { return new Date(new Date().getTime() + 7 * 60 * 60 * 1000); }
function formatDL(d) { return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}`; }
function extractDriveId(url) { if (!url) return null; const m = url.match(/[-\w]{25,}/); return m ? m[0] : null; }
function parseDL(str, baseDate) {
    if(!str) return null; let p = str.trim().split(' '); let d = p.length >= 2 ? p[1] : p[0];
    let dP = d.split('/'); if(dP.length < 2) return null;
    return new Date(Date.UTC(baseDate.getUTCFullYear(), parseInt(dP[1])-1, parseInt(dP[0]), 23, 59, 59, 0));
}
function layChapChuan(rows, i) { let chap = getCell(rows[i]||[], COL.CHAP); if(!chap) { for(let k=i-1; k>=0 && k>=i-5; k--){ let p = getCell(rows[k]||[], COL.CHAP); if(p!==""){ chap=p; break; } } } return chap||"(Không rõ)"; }
function layChuoiNgay(d) { return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`; }

// TẢI DỮ LIỆU TỪ SHEETS
async function taiDuLieuHeThong() {
    try {
        const [rT, rM] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: 'Thong_Tin_Truyen!A1:N5000' }),
            sheets.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: 'Thanh_Vien!A1:N5000' })
        ]);
        if(rT && rT.data) {
            let tM = {};
            (rT.data.values||[]).forEach(r => {
                if(r[0] && String(r[0]).trim()!=="") {
                    let g = String(r[0]).trim();
                    tM[xoaRac(g)] = { 
                        tenGoc: g, 
                        loai: r[1]?String(r[1]).trim().toLowerCase():"manhwa", 
                        ngonNgu: r[4]?String(r[4]).trim().toLowerCase():"", 
                        transChinh: r[6]?String(r[6]).trim():"", 
                        cleanChinh: r[9]?String(r[9]).trim():"", 
                        typeChinh: r[10]?String(r[10]).trim():"", 
                        luongTrans: parseInt(String(r[7]||"0").replace(/[^\d]/g,''))||0, 
                        luongClean: parseInt(String(r[11]||"0").replace(/[^\d]/g,''))||0, 
                        luongType: parseInt(String(r[12]||"0").replace(/[^\d]/g,''))||0, 
                        linkDrive: r[8]?String(r[8]).trim():"" 
                    };
                }
            }); thongTinMap = tM;
        }
        if(rM && rM.data) {
            thanhVienMap={}; nguocThanhVienMap={}; bankDataMap={};
            (rM.data.values||[]).forEach((r, idx) => {
                let dId = getCell(r, COL_TV.DISCORD), bD = getCell(r, 1);
                if(dId && bD) { 
                    thanhVienMap[dId] = bD; 
                    nguocThanhVienMap[bD.toLowerCase()] = dId; 
                    bankDataMap[dId] = { row: idx+1, role: getCell(r, COL_TV.ROLE), xu: parseInt(getCell(r, COL_TV.XU))||0, luong: parseInt(getCell(r, COL_TV.LUONG))||0, treDL: parseInt(getCell(r, COL_TV.TRE_DL))||0 }; 
                }
            });
        }
    } catch(e) { console.error('LỖI TẢI DATA:', e.message); }
}

// BẮN THÔNG BÁO DISCORD QUA API REST
async function sendDiscordMessage(channelId, message) {
    const botToken = (process.env.DISCORD_BOT_TOKEN || '').trim();
    if (!botToken || !channelId) return;
    try { 
        await fetch(`https://discord.com/api/v10/channels/${channelId.trim()}/messages`, { 
            method: 'POST', 
            headers: { 'Authorization': `Bot ${botToken}`, 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ content: message }) 
        }); 
    } catch (error) { console.error('LỖI GỬI DISCORD:', error); }
}

// KHỞI TẠO APP ELECTRON
function createWindow() {
    const win = new BrowserWindow({ width: 700, height: 750, webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true } });
    win.loadFile('index.html');
}
app.whenReady().then(async () => {
    await taiDuLieuHeThong(); 
    createWindow();

    // <--- THÊM ĐOẠN NÀY ĐỂ KÍCH HOẠT TỰ ĐỘNG CẬP NHẬT --->
    autoUpdater.checkForUpdatesAndNotify();
});

// Lắng nghe sự kiện khi đã tải xong bản update ngầm thì tự động cài đặt
autoUpdater.on('update-downloaded', () => {
    autoUpdater.quitAndInstall(); 
});
// API: LẤY DANH SÁCH TRUYỆN CHO Ô TÌM KIẾM
ipcMain.handle('get-danh-sach-truyen', async () => {
    let retries = 0; while (Object.keys(thongTinMap).length === 0 && retries < 10) { await new Promise(r => setTimeout(r, 500)); retries++; }
    return Object.values(thongTinMap).map(info => info.tenGoc).sort((a, b) => a.localeCompare(b));
});

// ================== HÀM BÁO DONE TIÊU CHUẨN ==================
async function xuLyBaoDone(data) {
    try {
        const discordId = data.discordId; const biệtDanh = thanhVienMap[discordId];
        if (!biệtDanh) throw new Error("ID Discord chưa được đăng ký!");

        let rolesToProcess = data.role === 'EDIT_FULL' ? ['CLEAN', 'TYPE'] : [data.role];
        const resWork = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: 'Bang_Lam_Viec!A1:Z5000' });
        const rows = resWork.data.values || []; 
        let runT = ""; let foundTask = false; let dU = []; let lC = 0; let vnToday = layNgayVN(); let lateCount = 0; let rD = []; let tagTypeList = [];

        for (let i = 1; i < rows.length; i++) {
            let r = rows[i] || []; 
            if (getCell(r, 0)) runT = getCell(r, 0); else if (getCell(r, 1) === "" && !getCell(r, 3) && !getCell(r, 8) && !getCell(r, 13)) runT = "";
            if (!runT) continue; 
            let chap = layChapChuan(rows, i);

            if (xoaRac(runT) === xoaRac(data.truyen) && chap.toLowerCase() === data.chap.toLowerCase()) {
                let info = thongTinMap[xoaRac(runT)]; 
                rolesToProcess.forEach(role => {
                    let userInCell = getCell(r, COL[role]).toLowerCase();
                    if ((userInCell === biệtDanh.toLowerCase() || data.role === 'EDIT_FULL') && getCell(r, COL[`DONE_${role}`]).toLowerCase() !== 'x' && getCell(r, COL[`DONE_${role}`]).toLowerCase() !== 'true') {
                        foundTask = true;
                        dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL[`DONE_${role}`])}${i + 1}`, values: [[true]] });
                        if (info) { if(role==='TRANS') lC += info.luongTrans; else if(role==='CLEAN') lC += info.luongClean; else if(role==='TYPE') lC += info.luongType; }
                        let dl = getCell(r, COL[`DL_${role}`]); let ns = "Đúng hạn";
                        if (dl) { let dp = parseDL(dl, vnToday); if (dp && vnToday.getTime() > dp.getTime()) { let d = Math.floor((vnToday.getTime() - dp.getTime()) / 86400000); if (d > 0) { ns = `Trễ ${d} ngày`; lateCount++; } } }
                        dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL[`NOTE_${role}`])}${i + 1}`, values: [[ns]] });
                        rD.push(`- **[${role}]** ${runT} (C.${chap}) - *${ns}*`);

                        if (role === 'TRANS' || role === 'CLEAN') {
                            let combinedEdit = [getCell(r, COL.CLEAN) || (info ? info.cleanChinh : ""), getCell(r, COL.TYPE) || (info ? info.typeChinh : "")].filter(Boolean).join(',');
                            if (combinedEdit) {
                                combinedEdit.split(',').forEach(tName => {
                                    let name = tName.trim(); if (name) { let editDiscordId = nguocThanhVienMap[name.toLowerCase()]; tagTypeList.push(editDiscordId ? `<@${editDiscordId}>` : `**${name}**`); }
                                });
                            }
                        }
                    }
                });
            }
        }
        if (!foundTask) throw new Error("Không tìm thấy task dở dang nào khớp với truyện, chap và role bạn chọn!");

        let bD = bankDataMap[discordId];
        if(bD) { 
            bD.xu += (rolesToProcess.length * 10); bD.luong += lC; bD.treDL += lateCount; 
            dU.push({ range: `Thanh_Vien!${String.fromCharCode(65+COL_TV.XU)}${bD.row}`, values: [[bD.xu]] }, { range: `Thanh_Vien!${String.fromCharCode(65+COL_TV.LUONG)}${bD.row}`, values: [[bD.luong]] }); 
            if (lateCount > 0) dU.push({ range: `Thanh_Vien!${String.fromCharCode(65+COL_TV.TRE_DL)}${bD.row}`, values: [[bD.treDL]] }); 
        }

        if(dU.length > 0) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: process.env.SPREADSHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: dU } });

        let finalMsg = `✅ <@${discordId}> đã báo DONE qua App:\n${rD.join('\n')}\n💰 Lương: +${lC.toLocaleString()} đ | Xu: +${rolesToProcess.length * 10}`;
        if (tagTypeList.length > 0) { let uniqueTags = [...new Set(tagTypeList)]; finalMsg += `\n⏩ Mời Edit: ${uniqueTags.join(', ')} vào nhận việc nhé!`; }

        let targetChannelId = process.env.CHANNEL_DONE_EDIT;
        if (rolesToProcess.includes('TRANS')) targetChannelId = process.env.CHANNEL_DONE_TRANS;
        await sendDiscordMessage(targetChannelId, finalMsg);
        
        return { success: true, message: `✅ Báo cáo thành công!\nĐã cập nhật Sheets: ${rD.join(', ')}` };
    } catch (error) { return { success: false, message: 'Lỗi: ' + error.message }; }
}

ipcMain.handle('submit-done', async (event, data) => { return await xuLyBaoDone(data); });

// ================== API 2: THÊM CHAP MỚI ==================
ipcMain.handle('add-new-chap', async (event, data) => {
    try {
        const tenTruyenInput = xoaRac(data.truyen); const info = thongTinMap[tenTruyenInput]; 
        if (!info) throw new Error("Không tìm thấy thông tin truyện trong hệ thống.");
        
        let chapInput = data.chap.trim(); let chapList = [];
        if (chapInput.includes('-')) { let p = chapInput.split('-'); for(let c = parseFloat(p[0]); c <= parseFloat(p[1]); c++) chapList.push(c.toString()); } 
        else if (chapInput.includes(',')) { chapList = chapInput.split(',').map(s => s.trim()); } 
        else { chapList = [chapInput]; }
        
        const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: process.env.SPREADSHEET_ID });
        const sheetData = sheetMeta.data.sheets.find(s => s.properties.title === 'Bang_Lam_Viec');
        const sheetId = sheetData.properties.sheetId;

        const resWork = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: 'Bang_Lam_Viec!A1:Z' });
        const rows = resWork.data.values || []; 
        let lastRowOfSeries = -1, runningTruyen = "", realLastRow = 1;
        
        for (let i = rows.length - 1; i >= 1; i--) { if (getCell(rows[i], 0) || getCell(rows[i], 1) || getCell(rows[i], 3)) { realLastRow = i; break; } }
        for (let i = 1; i <= realLastRow; i++) {
            let r = rows[i] || [];
            if (getCell(r, 0) !== "") runningTruyen = getCell(r, 0); else if (getCell(r, 1) === "" && getCell(r, 3) === "") runningTruyen = "";
            if (runningTruyen !== "" && xoaRac(runningTruyen) === tenTruyenInput) { if (getCell(r, 1) !== "") lastRowOfSeries = i; }
        }

        let insertIndex = (lastRowOfSeries !== -1 ? lastRowOfSeries + 1 : realLastRow + 1);
        
        // inheritFromBefore = true để giữ nguyên hộp kiểm (Checkbox)
        await sheets.spreadsheets.batchUpdate({ 
            spreadsheetId: process.env.SPREADSHEET_ID, 
            requestBody: { 
                requests: [{ 
                    insertDimension: { 
                        range: { sheetId: sheetId, dimension: "ROWS", startIndex: insertIndex, endIndex: insertIndex + chapList.length }, 
                        inheritFromBefore: true 
                    } 
                }] 
            } 
        });

        let vn = layNgayVN(); let dU = [];
        for (let k = 0; k < chapList.length; k++) {
            let rI = insertIndex + 1 + k; let c = chapList[k];
            let dlTr = formatDL(new Date(vn.getTime() + (k+1)*86400000)); let dlTy = formatDL(new Date(vn.getTime() + (k+2)*86400000));

            if (k === 0 && lastRowOfSeries === -1) dU.push({ range: `Bang_Lam_Viec!A${rI}`, values: [[info.tenGoc]] });
            dU.push( { range: `Bang_Lam_Viec!B${rI}`, values: [[c]] }, { range: `Bang_Lam_Viec!D${rI}`, values: [[info.transChinh]] }, { range: `Bang_Lam_Viec!E${rI}`, values: [[info.luongTrans]] }, { range: `Bang_Lam_Viec!F${rI}`, values: [[dlTr]] } );
            if (info.cleanChinh) dU.push({ range: `Bang_Lam_Viec!I${rI}`, values: [[info.cleanChinh]] }, { range: `Bang_Lam_Viec!J${rI}`, values: [[info.luongClean]] }, { range: `Bang_Lam_Viec!K${rI}`, values: [[dlTr]] });
            if (info.typeChinh) dU.push({ range: `Bang_Lam_Viec!N${rI}`, values: [[info.typeChinh]] }, { range: `Bang_Lam_Viec!O${rI}`, values: [[info.luongType]] }, { range: `Bang_Lam_Viec!P${rI}`, values: [[dlTy]] });
        }
        await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: process.env.SPREADSHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: dU } });

        let transDiscordId = nguocThanhVienMap[(info.transChinh || '').toLowerCase()];
        let transTag = transDiscordId ? `<@${transDiscordId}>` : (info.transChinh ? `**${info.transChinh}**` : "Trống");
        let combinedEdit = [info.cleanChinh, info.typeChinh].filter(Boolean).join(','); let editTags = [];
        if (combinedEdit) { combinedEdit.split(',').forEach(tName => { let name = tName.trim(); if (name) { let editId = nguocThanhVienMap[name.toLowerCase()]; editTags.push(editId ? `<@${editId}>` : `**${name}**`); } }); }
        
        let typeTag = editTags.length > 0 ? [...new Set(editTags)].join(', ') : "Trống";
        let msg = `🎉 **${info.tenGoc}** vừa được mở rộng thêm Chap: **${chapList.join(', ')}**!\n(Đã tự động gán tên Thầu cứng và thiết lập Hạn DL)\n\n🎯 **GỌI TÊN NHẬN HÀNG:**\n- Trans: ${transTag}\n- Edit: ${typeTag}`;
        
        await sendDiscordMessage(process.env.CHANNEL_NEW_CHAP, msg);
        return { success: true, message: `✅ Đã thêm thành công ${chapList.length} chap vào Bảng Làm Việc!` };
    } catch (error) { return { success: false, message: 'Lỗi: ' + error.message }; }
});

// ================== API 3: NỘP SẢN PHẨM (TÍCH HỢP BẢNG QLY & ĐÃ FIX) ==================
// ================== API 3: NỘP SẢN PHẨM (TỐI ƯU PROGRESS) ==================
ipcMain.handle('submit-product', async (event, data) => {
    try {
        const thongTin = thongTinMap[xoaRac(data.truyen)]; 
        if (!thongTin) throw new Error("Không tìm thấy thông tin truyện trên bảng hệ thống.");
        
        const QLY_SPREADSHEET_ID = '1HyRbI9vMUXteJz_te8pGPij5Z5Ey3AhDQp7ozyf5JMI';
        let targetSheetName = (thongTin.loai && thongTin.loai.includes('manga')) ? 'MANGA' : 'MANHWA';
        let targetRow = -1;

        // 1. DÒ BẢNG TRƯỚC KHI COPY (Tránh việc copy mất 2 phút xong mới báo lỗi sai tên)
        if (data.role === 'QC') {
            const resWork = await sheets.spreadsheets.values.get({ spreadsheetId: QLY_SPREADSHEET_ID, range: `${targetSheetName}!A1:Z5000` });
            const rows = resWork.data.values || []; 
            let runT = "";
            for (let i = 1; i < rows.length; i++) {
                let r = rows[i] || []; 
                let tenTruyenHienTai = getCell(r, 1); 
                if (tenTruyenHienTai !== "") runT = tenTruyenHienTai; 
                else if (getCell(r, 4) === "") runT = ""; 
                
                if (!runT) continue; 
                let chapStr = getCell(r, 4); 
                if (xoaRac(runT) === xoaRac(data.truyen) && chapStr.toLowerCase() === data.chap.toLowerCase()) { 
                    targetRow = i + 1; break; 
                }
            }
            if (targetRow === -1) throw new Error(`Lỗi: Không tìm thấy truyện ${data.truyen} (Chap ${data.chap}) trên tab ${targetSheetName} của bảng QLY.`);
        }

        // 2. KHỞI TẠO THƯ MỤC VÀ TIẾN HÀNH SAO CHÉP
        const parentFolderId = extractDriveId(thongTin.linkDrive); 
        if (!parentFolderId) throw new Error("Truyện này chưa có Link Drive Gốc trong bảng Thong_Tin_Truyen.");
        const sourceFolderId = extractDriveId(data.link);
        if (!sourceFolderId) throw new Error("Link Drive bạn nộp không hợp lệ!");

        const chapFolderName = `${data.chap.trim()}`; 
        let roleFolderName = data.role;
        if (data.role === 'EDIT_FULL') roleFolderName = 'EDIT';
        
        let chapFolderId, roleFolderId;
        const chapSearch = await drive.files.list({ q: `'${parentFolderId}' in parents and name = '${chapFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, fields: 'files(id)' });
        if (chapSearch.data.files.length > 0) chapFolderId = chapSearch.data.files[0].id; 
        else { const folder = await drive.files.create({ resource: { name: chapFolderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentFolderId] }, fields: 'id' }); chapFolderId = folder.data.id; }
        
        const roleSearch = await drive.files.list({ q: `'${chapFolderId}' in parents and name = '${roleFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, fields: 'files(id)' });
        if (roleSearch.data.files.length > 0) roleFolderId = roleSearch.data.files[0].id; 
        else { const folderRole = await drive.files.create({ resource: { name: roleFolderName, mimeType: 'application/vnd.google-apps.folder', parents: [chapFolderId] }, fields: 'id' }); roleFolderId = folderRole.data.id; }

        let filesToCopy = []; let pt = null;
        do {
            const res = await drive.files.list({ q: `'${sourceFolderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`, fields: 'nextPageToken, files(id, name)', pageToken: pt });
            filesToCopy = filesToCopy.concat(res.data.files); pt = res.data.nextPageToken;
        } while (pt);
        if (filesToCopy.length === 0) throw new Error("Link Drive bạn nộp đang trống không có ảnh nào!");

        let sucC = 0;
        for (const f of filesToCopy) {
            try { 
                await drive.files.copy({ fileId: f.id, requestBody: { parents: [roleFolderId], name: f.name } }); 
                sucC++; 
                // LIÊN TỤC BẮN TIẾN ĐỘ VỀ GIAO DIỆN ĐỂ SẾP KHÔNG TƯỞNG APP BỊ TREO
                event.sender.send('copy-progress', { current: sucC, total: filesToCopy.length });
            } catch (e) {}
            await new Promise(r => setTimeout(r, 200)); 
        }

        const destFolderLink = `https://drive.google.com/drive/folders/${roleFolderId}`;

        // 3. CHỐT LINK VÀO BẢNG
        if (data.role === 'QC') {
            let dU = [];
            let shortLinkFormula = `=HYPERLINK("${destFolderLink}", "Chap ${data.chap}")`;
            dU.push({ range: `${targetSheetName}!F${targetRow}`, values: [[shortLinkFormula]] });            if (data.note) {
                dU.push({ range: `${targetSheetName}!J${targetRow}`, values: [[data.note]] });
            }
            
            await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: QLY_SPREADSHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: dU } });
            
            let channelQC = process.env.CHANNEL_DONE_QC || process.env.CHANNEL_DONE_EDIT;
            let msgQC = `✅ <@${data.discordId}> đã nộp sản phẩm **QC** cho **${data.truyen}** (Chap ${data.chap})\n🔗 Link thư mục chứa ảnh: ${destFolderLink}`;
            if (data.note) msgQC += `\n📝 Note: ${data.note}`;
            
            await sendDiscordMessage(channelQC, msgQC);
            return { success: true, message: `✅ Đã sao chép ${sucC} file vào Drive Team!\n✅ Đã gắn Link QC vào bảng QLY thành công!` };
        } 
        else if (data.role === 'FIX') {
            await sendDiscordMessage(process.env.CHANNEL_DONE_EDIT, `🛠️ <@${data.discordId}> vừa úp xong file **ĐÃ FIX** cho **${data.truyen}** (Chap ${data.chap}) lên Drive Team!\n🔗 Folder Fix: ${destFolderLink}`);
            return { success: true, message: `✅ Đã Copy thành công ${sucC}/${filesToCopy.length} file FIX vào Drive!` };
        } 
        else {
            let doneResult = await xuLyBaoDone(data);
            return { success: true, message: `✅ Đã Copy thành công ${sucC}/${filesToCopy.length} file vào Drive!\n${doneResult.message}` };
        }
    } catch (error) { return { success: false, message: 'Lỗi: ' + error.message }; }
});

// ================== HÀM QUÉT VIỆC CHUNG (DÙNG CHO TAB 5, 6, 7) ==================
ipcMain.handle('get-pending-tasks', async (event, discordId) => {
    try {
        const biệtDanh = thanhVienMap[discordId];
        if (!biệtDanh) throw new Error("ID Discord chưa được đăng ký trong hệ thống!");
        
        const resWork = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: 'Bang_Lam_Viec!A1:Z5000' });
        const rows = resWork.data.values || []; 
        let pendingTasks = []; let runT = ""; let vnToday = layNgayVN(); 

        for (let i = 1; i < rows.length; i++) {
            let r = rows[i] || []; 
            if (getCell(r, 0)) runT = getCell(r, 0); else if (getCell(r, 1) === "" && !getCell(r, 3) && !getCell(r, 8) && !getCell(r, 13)) runT = "";
            if (!runT) continue; 
            
            let chap = layChapChuan(rows, i);
            ['TRANS', 'CLEAN', 'TYPE'].forEach(role => {
                let userInCell = getCell(r, COL[role]); 
                let isDone = getCell(r, COL[`DONE_${role}`]).toLowerCase();
                
                if (userInCell.toLowerCase() === biệtDanh.toLowerCase() && isDone !== 'true' && isDone !== 'x') {
                    let dlStr = getCell(r, COL[`DL_${role}`]); 
                    let dlTime = Infinity; 
                    let isOverdue = false;
                    
                    if (dlStr) { 
                        let dp = parseDL(dlStr, vnToday); 
                        if (dp) { 
                            dlTime = dp.getTime(); 
                            if (vnToday.getTime() > dlTime) isOverdue = true; 
                        } 
                    }
                    
                    pendingTasks.push({ 
                        rowIndex: i + 1, role: role, truyenRaw: runT, chap: chap, 
                        dlStr: dlStr || 'Chưa có', dlTime: dlTime, isOverdue: isOverdue 
                    });
                }
            });
        }
        
        // Sắp xếp: Job nào gần đến hạn nhất (hoặc trễ hạn) sẽ trồi lên trên cùng
        pendingTasks.sort((a, b) => a.dlTime - b.dlTime);
        return { success: true, tasks: pendingTasks };
    } catch (error) { return { success: false, message: 'Lỗi: ' + error.message }; }
});

// ================== API 4: BỐC VIỆC RANDOM ==================
ipcMain.handle('take-random-job', async (event, data) => {
    try {
        const discordId = data.discordId; const biệtDanh = thanhVienMap[discordId];
        if (!biệtDanh) throw new Error("ID Discord chưa được đăng ký!");
        let bD = bankDataMap[discordId]; let userRole = bD ? (bD.role || '').toLowerCase() : '';
        if (userRole.includes('edit') && data.role === 'CLEAN') throw new Error("Lỗi: Role Edit Full không được bốc lẻ Clean.");

        const resWork = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: 'Bang_Lam_Viec!A1:Z5000' });
        const rows = resWork.data.values || []; 
        let availableJobs = []; let runT = "";

        for (let i = 1; i < rows.length; i++) {
            let r = rows[i] || []; 
            if (getCell(r, 0)) runT = getCell(r, 0); else if (getCell(r, 1) === "" && !getCell(r, 3) && !getCell(r, 8) && !getCell(r, 13)) runT = "";
            if (!runT) continue; 
            
            let chap = getCell(r, COL.CHAP); 
            if (!chap) continue;
            let info = thongTinMap[xoaRac(runT)]; if (!info) continue;
            if (data.loai !== 'all' && info.loai && !info.loai.includes(data.loai)) continue;

            let dTr = getCell(r, COL.DONE_TRANS).toLowerCase(); let isDoneTrans = (dTr === 'true' || dTr === 'x');
            let dCl = getCell(r, COL.DONE_CLEAN).toLowerCase(); let isDoneClean = (dCl === 'true' || dCl === 'x');
            let dTy = getCell(r, COL.DONE_TYPE).toLowerCase();  let isDoneType  = (dTy === 'true' || dTy === 'x');
            
            let cTrans = getCell(r, COL.TRANS); let cClean = getCell(r, COL.CLEAN); let cType = getCell(r, COL.TYPE);

            if (data.role.startsWith('TRANS')) {
                if (cTrans === "" && !isDoneTrans) {
                    let reqLang = data.role.split('_')[1].toLowerCase(); let jobLang = info.ngonNgu || ""; let normTen = xoaRac(runT);
                    if (normTen === 'oneshot' || normTen === 'dj') { let cStr = chap.toLowerCase(); if (cStr.includes('hàn') || cStr.includes('han')) jobLang = 'hàn'; else if (cStr.includes('anh')) jobLang = 'anh'; else if (cStr.includes('trung')) jobLang = 'trung'; else if (cStr.includes('nhật') || cStr.includes('nhat')) jobLang = 'nhật'; }
                    if (jobLang.includes(reqLang)) availableJobs.push({ rowIndex: i + 1, displayRole: 'TRANS', roles: ['TRANS'], truyenRaw: runT, chap: chap, luong: info.luongTrans || 0 });
                }
            } else if (data.role === 'CLEAN') {
                if (cClean === "" && !isDoneClean) availableJobs.push({ rowIndex: i + 1, displayRole: 'CLEAN', roles: ['CLEAN'], truyenRaw: runT, chap: chap, luong: info.luongClean || 0 });
            } else if (data.role === 'TYPE') {
                if (cType === "" && !isDoneType && isDoneTrans && isDoneClean) availableJobs.push({ rowIndex: i + 1, displayRole: 'TYPE', roles: ['TYPE'], truyenRaw: runT, chap: chap, luong: info.luongType || 0 });
            } else if (data.role === 'EDIT_FULL') {
                if (isDoneClean && isDoneTrans && cType === "" && !isDoneType) availableJobs.push({ rowIndex: i + 1, displayRole: 'TYPE', roles: ['TYPE'], truyenRaw: runT, chap: chap, luong: info.luongType || 0, note: '(Xử lý hàng tồn kho Type)' });
                else if (cClean === "" && cType === "" && !isDoneClean && !isDoneType && isDoneTrans) availableJobs.push({ rowIndex: i + 1, displayRole: 'EDIT FULL', roles: ['CLEAN', 'TYPE'], truyenRaw: runT, chap: chap, luong: (info.luongClean || 0) + (info.luongType || 0), luongLe: [info.luongClean || 0, info.luongType || 0] });
            }
        }
        
        if (availableJobs.length === 0) throw new Error("😭 Khoang này đang trống trơn, không có chap nào phù hợp để bốc!");
        
        const job = availableJobs[Math.floor(Math.random() * availableJobs.length)];
        let dU = []; let dlStr = formatDL(new Date(layNgayVN().getTime() + 24 * 3600 * 1000));
        
        job.roles.forEach((role, idx) => {
            dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL[role])}${job.rowIndex}`, values: [[biệtDanh]] });
            dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL['LUONG_' + role])}${job.rowIndex}`, values: [[job.roles.length === 2 ? job.luongLe[idx] : job.luong]] });
            dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL['DL_' + role])}${job.rowIndex}`, values: [[dlStr]] });
        });
        
        if(dU.length > 0) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: process.env.SPREADSHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: dU } });
        
        // Bắn vào kênh Nhận Deadline (nếu cấu hình), nếu không cấu hình thì bắn tạm qua kênh Done
        let targetChannelId = process.env.CHANNEL_NHAN_DEADLINE || process.env.CHANNEL_DONE_EDIT;
        await sendDiscordMessage(targetChannelId, `🎲 <@${discordId}> vừa nhân phẩm bốc trúng:\n- **[${job.displayRole}]** ${job.truyenRaw} (Chap ${job.chap})\n⏰ Hạn nộp mới là: **${dlStr}**`);
        
        return { success: true, message: `🎉 Bốc trúng:\n[${job.displayRole}] ${job.truyenRaw} (Chap ${job.chap})\n⏰ Hạn chót của sếp: ${dlStr}` };
    } catch (error) { return { success: false, message: error.message }; }
});

// ================== API 5: NỘP ĐƠN XIN NGHỈ ==================
ipcMain.handle('submit-leave', async (event, data) => {
    try {
        const discordId = data.discordId; const biệtDanh = thanhVienMap[discordId];
        if (!biệtDanh) throw new Error("ID Discord chưa được đăng ký!");
        
        let ngayVe = layChuoiNgay(new Date(layNgayVN().getTime() + data.soNgay * 86400000));
        let msgDon = `📜 **ĐƠN XIN NGHỈ PHÉP** 📜\n👤 **Nhân sự:** <@${discordId}> (${biệtDanh})\n⏳ **Thời gian:** Xin nghỉ ${data.soNgay} ngày (Dự kiến quay lại: **${ngayVe}**)\n📝 **Lý do:** ${data.lyDo}\n\n📦 **Danh sách Chap xin Nhượng (Drop):**\n`;
        
        if (data.droppedTasks && data.droppedTasks.length > 0) { 
            data.droppedTasks.forEach(task => { msgDon += `- **[${task.role}]** ${task.truyenRaw} (Chap ${task.chap})\n`; }); 
        } else { 
            msgDon += `*(Không drop chap nào / Xin giữ lại toàn bộ việc)*\n`; 
        }
        
        let roleTag = process.env.ID_ROLE_BOSS ? `<@&${process.env.ID_ROLE_BOSS}>` : "Boss / Quản Lý";
        msgDon += `\n🔔 Kính gửi ${roleTag} xem xét đơn.`;
        
        if (!process.env.CHANNEL_XIN_NGHI) throw new Error("Chưa cấu hình CHANNEL_XIN_NGHI trong .env");
        await sendDiscordMessage(process.env.CHANNEL_XIN_NGHI, msgDon);
        
        return { success: true, message: `✅ Đã nộp Đơn Xin Nghỉ lên kênh Discord!` };
    } catch (error) { return { success: false, message: 'Lỗi: ' + error.message }; }
});

// ================== API 6: DỜI DEADLINE ==================
// ================== API 6: DỜI DEADLINE ==================
ipcMain.handle('extend-deadline', async (event, data) => {
    try {
        const discordId = data.discordId; const biệtDanh = thanhVienMap[discordId];
        if (!biệtDanh) throw new Error("ID Discord chưa được đăng ký!");

        let dU = []; let rD = []; let vnToday = layNgayVN();

        data.selectedTasks.forEach(task => {
            let currentDate = parseDL(task.dlStr, vnToday);
            if (!currentDate) currentDate = vnToday; // Nếu ô trống/lỗi thì tính từ hôm nay
            
            // Cộng thêm số ngày xin dời
            currentDate.setDate(currentDate.getDate() + data.soNgayDoi);
            let newDlStr = formatDL(currentDate);

            dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL['DL_' + task.role])}${task.rowIndex}`, values: [[newDlStr]] });
            rD.push(`- **[${task.role}]** ${task.truyenRaw} (Chap ${task.chap}) ➔ Hạn mới: **${newDlStr}**`);
        });

        if(dU.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: process.env.SPREADSHEET_ID, requestBody: { valueInputOption: 'USER_ENTERED', data: dU } });
        }

        // 🟢 BẮN VÀO ĐÚNG KÊNH DỜI DEADLINE ĐÃ CẤU HÌNH TRONG .ENV
        let channelThongBao = process.env.CHANNEL_DOI_DL;
        if (!channelThongBao) throw new Error("Chưa cấu hình CHANNEL_DOI_DL trong file .env");
        
        await sendDiscordMessage(channelThongBao, `🗓️ <@${discordId}> đã tự dời hạn thêm **${data.soNgayDoi} ngày** cho các việc sau:\n${rD.join('\n')}`);

        return { success: true, message: `✅ Đã dời deadline thành công trên Bảng!` };
    } catch (error) { return { success: false, message: 'Lỗi: ' + error.message }; }
});