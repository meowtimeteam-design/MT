// ==========================================
// 🚀 HỆ THỐNG MEOWTIME TOOL - BẢN FULL ĐỒNG BỘ 100% VỚI INDEX.HTML
// ==========================================
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('node:path');
const fs = require('node:fs');
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

// 🟢 Đọc chuẩn file .env trên cả Windows và macOS (tránh lỗi mất kết nối khi đóng gói)
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');

process.on('unhandledRejection', e => console.error('\n🚨 [CRASH NGẦM]:', e));
process.on('uncaughtException', e => console.error('\n🚨 [CRASH TOÀN TẬP]:', e));

let mainWindow = null;

// ==========================================
// 1. CẤU HÌNH GEMINI AI & HẰNG SỐ HỆ THỐNG
// ==========================================
let genAI = null;
if (process.env.GEMINI_API_KEY) {
    try {
        genAI = new GoogleGenerativeAI((process.env.GEMINI_API_KEY || '').trim());
    } catch (e) {}
}

global.droppedPool = [];
const COL = {
    TRUYEN: 0, CHAP: 1,
    TRANS: 3, LUONG_TRANS: 4, DL_TRANS: 5, DONE_TRANS: 6, NOTE_TRANS: 7,
    CLEAN: 8, LUONG_CLEAN: 9, DL_CLEAN: 10, DONE_CLEAN: 11, NOTE_CLEAN: 12,
    TYPE: 13, LUONG_TYPE: 14, DL_TYPE: 15, DONE_TYPE: 16, NOTE_TYPE: 17
};
const COL_TV = { ROLE: 2, CHUOI: 3, NGAY: 4, DISCORD: 5, XU: 6, THE: 7, NGHI: 9, TRE_DL: 10, DOI_DL: 11, LUONG: 13 };
const ROLES = ['TRANS', 'CLEAN', 'TYPE'];
const SPREADSHEET_ID_2 = '1HyRbI9vMUXteJz_te8pGPij5Z5Ey3AhDQp7ozyf5JMI';

// ==========================================
// 2. THIẾT LẬP OAUTH 2.0 & MULTI-TOKEN ANTI-SPAM
// ==========================================
const CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
const refreshTokens = [];

if (process.env.GOOGLE_REFRESH_TOKEN) refreshTokens.push(process.env.GOOGLE_REFRESH_TOKEN.trim());
for (let i = 1; i <= 20; i++) {
    let t = process.env[`GOOGLE_REFRESH_TOKEN_${i}`];
    if (t && t.trim() !== '' && !refreshTokens.includes(t.trim())) {
        refreshTokens.push(t.trim());
    }
}

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, "https://developers.google.com/oauthplayground");
if (refreshTokens.length > 0) oAuth2Client.setCredentials({ refresh_token: refreshTokens[0] });

const sheets = google.sheets({ version: 'v4', auth: oAuth2Client });
const drive = google.drive({ version: 'v3', auth: oAuth2Client });

let currentAccIndex = 0;
function getUploadDrive() {
    if (refreshTokens.length === 0) return { uploadDrive: drive, accNum: 1 };
    const token = refreshTokens[currentAccIndex];
    const accNum = currentAccIndex + 1;
    currentAccIndex = (currentAccIndex + 1) % refreshTokens.length;
    const authClient = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, "https://developers.google.com/oauthplayground");
    authClient.setCredentials({ refresh_token: token });
    return { uploadDrive: google.drive({ version: 'v3', auth: authClient }), accNum: accNum };
}

// ==========================================
// 3. BỘ NHỚ ĐỆM (CACHE) & CÁC HÀM PHỤ TRỢ
// ==========================================
let danhSachTruyenCache = [];
let thongTinMap = {};
let thanhVienMap = {};
let nguocThanhVienMap = {};
let bankDataMap = {};
let bangLuongMap = {};
let bangLuongList = [];
let isDataLoaded = false;

function extractDriveId(url) {
    if (!url) return null;
    const m = url.match(/[-\w]{25,}/);
    return m ? m[0] : null;
}

function getCell(r, i) {
    return (!r || r.length <= i || r[i] === undefined || r[i] === null) ? "" : String(r[i]).trim();
}

function xoaRac(s) {
    return !s ? '' : s.toString().normalize('NFC').toLowerCase().split('(')[0].replace(/[^\p{L}\p{N}]/gu, '');
}

function layNgayVN() {
    return new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
}

function layChuoiNgay(d) {
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function formatDL(d) {
    return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function parseDL(str, baseDate) {
    if (!str) return null;
    let p = str.trim().split(' ');
    let t = p.length >= 2 ? p[0] : "23:59:59";
    let d = p.length >= 2 ? p[1] : p[0];
    let tP = t.split(':');
    let dP = d.split('/');
    if (dP.length < 2) return null;
    let h = parseInt(tP[0]) || 23, m = parseInt(tP[1]) || 59, s = parseInt(tP[2]) || 59;
    let day = parseInt(dP[0]), mon = parseInt(dP[1]) - 1;
    let y = baseDate.getUTCFullYear(), curMon = baseDate.getUTCMonth();
    if (mon === 11 && curMon === 0) y -= 1;
    else if (mon === 0 && curMon === 11) y += 1;
    return new Date(Date.UTC(y, mon, day, h, m, s, 0));
}

function displayDL(s) {
    if (!s) return 'Trống';
    let p = s.trim().split(' ');
    return `ngày ${p.length > 1 ? p[1] : p[0]}`;
}

function layChapChuan(rows, i) {
    let chap = getCell(rows[i] || [], COL.CHAP);
    if (!chap) {
        for (let k = i - 1; k >= 0 && k >= i - 5; k--) {
            let p = getCell(rows[k] || [], COL.CHAP);
            if (p !== "") { chap = p; break; }
        }
    }
    return chap || "(Không rõ)";
}

function buildRowMap(rows) {
    let map = {};
    let run = "";
    for (let i = 1; i < rows.length; i++) {
        let r = rows[i] || [];
        let val = getCell(r, COL.TRUYEN);
        if (val !== "") run = val;
        else {
            let hw = getCell(r, 3) !== "" || getCell(r, 8) !== "" || getCell(r, 13) !== "";
            if (getCell(r, 1) === "" && !hw) run = "";
        }
        if (!run) continue;
        let chap = layChapChuan(rows, i);
        let key = `${xoaRac(run).substring(0, 50)}_${String(chap).toLowerCase().trim()}`;
        map[key] = i + 1;
        ROLES.forEach(role => {
            map[`${key}_${role.toLowerCase()}`] = { rowIndex: i + 1, r: r, truyenRaw: run, chap: chap, role: role };
        });
    }
    return map;
}

function isUserOnLeave(nickname) {
    if (!nickname) return null;
    let dId = nguocThanhVienMap[nickname.toLowerCase().trim()];
    if (!dId) return null;
    let bData = bankDataMap[dId];
    if (!bData || !bData.nghi) return null;
    let parts = bData.nghi.split('/');
    if (parts.length < 3) return null;
    let nghiDate = new Date(Date.UTC(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]), 0, 0, 0, 0));
    let today = layNgayVN();
    today.setUTCHours(0, 0, 0, 0);
    if (nghiDate >= today) {
        let diffTime = nghiDate.getTime() - today.getTime();
        let diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return { name: nickname.trim(), days: diffDays === 0 ? 1 : diffDays, date: bData.nghi };
    }
    return null;
}

function checkRoleOnLeave(assigneeStr) {
    if (!assigneeStr) return null;
    let names = assigneeStr.split(',');
    for (let name of names) {
        let leaveInfo = isUserOnLeave(name);
        if (leaveInfo) return leaveInfo;
    }
    return null;
}

async function guiThongBaoDiscord(channelId, content) {
    // 🟢 Khớp chuẩn với biến DISCORD_BOT_TOKEN trong .env của sếp
    const token = (process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || '').trim();
    const targetChannel = (channelId || '').trim();

    if (!token) {
        console.error('❌ [DISCORD] Không tìm thấy DISCORD_BOT_TOKEN trong file .env!');
        return;
    }
    if (!targetChannel) {
        console.error('❌ [DISCORD] Chưa truyền ID Kênh (Channel ID) để gửi thông báo!');
        return;
    }

    try {
        // Tự động cắt tin nhắn nếu dài quá 1950 ký tự để Discord không báo lỗi
        const lines = content.split('\n');
        let currentChunk = '';
        const chunks = [];
        for (const line of lines) {
            if (currentChunk.length + line.length + 1 > 1900) {
                chunks.push(currentChunk);
                currentChunk = line;
            } else {
                currentChunk += (currentChunk === '' ? '' : '\n') + line;
            }
        }
        if (currentChunk) chunks.push(currentChunk);

        for (const chunk of chunks) {
            const res = await fetch(`https://discord.com/api/v10/channels/${targetChannel}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ content: chunk })
            });
            if (!res.ok) {
                console.error(`❌ [LỖI GỬI DISCORD KÊNH ${targetChannel}]:`, await res.text());
            }
        }
    } catch (err) {
        console.error('❌ [LỖI KẾT NỐI DISCORD API]:', err.message);
    }
}

// ==========================================
// 4. ĐỒNG BỘ DỮ LIỆU TỪ GOOGLE SHEETS
// ==========================================
async function taiDuLieuHeThong() {
    console.log('[DATA] Đang kết nối tới Google Sheets...');
    try {
        const [rS, rT, rM, rL] = await Promise.all([
            sheets.spreadsheets.get({ spreadsheetId: process.env.SPREADSHEET_ID, fields: 'sheets(properties(sheetId,title),merges)' }),
            sheets.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: 'Thong_Tin_Truyen!A1:N5000' }),
            sheets.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: 'Thanh_Vien!A1:N5000' }),
            sheets.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: 'BẢNG LƯƠNG!B2:G5000' })
        ]);

        if (rT && rT.data) {
            let tD = [], tM = {};
            (rT.data.values || []).forEach(r => {
                if (r[0] && String(r[0]).trim() !== "") {
                    let g = String(r[0]).trim();
                    tD.push(g);
                    tM[xoaRac(g)] = {
                        tenGoc: g,
                        loai: r[1] ? String(r[1]).trim().toLowerCase() : "manhwa",
                        ngonNgu: r[2] ? String(r[2]).trim().toLowerCase() : "",
                        transChinh: r[6] ? String(r[6]).trim() : "",
                        luongTrans: parseInt(String(r[7] || "0").replace(/[^\d]/g, '')) || 0,
                        linkDrive: r[8] ? String(r[8]).trim() : "",
                        cleanChinh: r[9] ? String(r[9]).trim() : "",
                        typeChinh: r[10] ? String(r[10]).trim() : "",
                        luongClean: parseInt(String(r[11] || "0").replace(/[^\d]/g, '')) || 0,
                        luongType: parseInt(String(r[12] || "0").replace(/[^\d]/g, '')) || 0
                    };
                }
            });
            danhSachTruyenCache = [...new Set(tD)];
            thongTinMap = tM;
        }

        if (rM && rM.data) {
            thanhVienMap = {};
            nguocThanhVienMap = {};
            bankDataMap = {};
            (rM.data.values || []).forEach((r, idx) => {
                let dId = getCell(r, COL_TV.DISCORD).replace(/['"\s]/g, '');
                let bD = getCell(r, 1);
                if (dId && bD) {
                    thanhVienMap[dId] = bD;
                    nguocThanhVienMap[bD.toLowerCase()] = dId;
                    bankDataMap[dId] = {
                        row: idx + 1,
                        role: getCell(r, COL_TV.ROLE),
                        chuoi: parseInt(getCell(r, COL_TV.CHUOI)) || 0,
                        ngayCuoi: getCell(r, COL_TV.NGAY),
                        xu: parseInt(getCell(r, COL_TV.XU)) || 0,
                        the: parseInt(getCell(r, COL_TV.THE)) || 0,
                        nghi: getCell(r, COL_TV.NGHI),
                        treDL: parseInt(getCell(r, COL_TV.TRE_DL)) || 0,
                        doiDL: parseInt(getCell(r, COL_TV.DOI_DL)) || 0,
                        luong: parseInt(getCell(r, COL_TV.LUONG)) || 0
                    };
                }
            });
        }

        if (rL && rL.data) {
            bangLuongMap = {};
            bangLuongList = [];
            (rL.data.values || []).forEach(r => {
                let b = getCell(r, 0);
                if (b !== "") {
                    const bL = b.toLowerCase();
                    const sC = parseFloat(getCell(r, 1)) || 0;
                    const lC = getCell(r, 5) || "0";
                    bangLuongMap[bL] = { soChap: sC, luongCuoi: lC, tenHienThi: b };
                    bangLuongList.push({ bDanh: bL, tenHienThi: b, soChap: sC, luongCuoi: lC });
                }
            });
        }

        isDataLoaded = true;
        console.log('[DATA] ✅ Phân tích dữ liệu xong!');
        return true;
    } catch (e) {
        console.error('❌ LỖI TẢI DỮ LIỆU:', e.message);
        isDataLoaded = false;
        return false;
    }
}

// ==========================================
// 5. KHỞI TẠO CỬA SỔ ELECTRON & AUTO-UPDATE
// ==========================================
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 980,
        height: 780,
        title: "Tool Quản Lý Tiến Độ - Meowtime",
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
    createWindow();
    await taiDuLieuHeThong();
    setInterval(taiDuLieuHeThong, 3 * 60 * 1000);

    try {
        autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {}

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ==========================================
// 6. XỬ LÝ CÁC LỆNH IPC TỪ GIAO DIỆN INDEX.HTML
// ==========================================

ipcMain.handle('get-danh-sach-truyen', async () => {
    if (!isDataLoaded) await taiDuLieuHeThong();
    return danhSachTruyenCache;
});

ipcMain.handle('reload-data', async () => {
    const ok = await taiDuLieuHeThong();
    return { success: ok, message: ok ? '✅ Đã làm mới dữ liệu từ Google Sheets!' : '❌ Lỗi kết nối Google Sheets!' };
});

ipcMain.handle('select-file', async (event, options) => {
    const res = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: options && options.filters ? options.filters : [
            { name: 'Files', extensions: ['zip', 'rar', 'png', 'jpg', 'jpeg', 'webp'] }
        ]
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
});

// --- QUÉT CÔNG VIỆC ĐANG ÔM (Hỗ trợ truyền thẳng chuỗi discordId hoặc object) ---
ipcMain.handle('get-pending-tasks', async (event, arg) => {
    if (!isDataLoaded) await taiDuLieuHeThong();
    const rawId = typeof arg === 'string' ? arg : (arg && arg.discordId ? arg.discordId : '');
    const cleanId = String(rawId).replace(/['"\s]/g, '');
    const bietDanh = thanhVienMap[cleanId];
    if (!bietDanh) return { success: false, message: 'Lỗi: ID Discord chưa được đăng ký!' };

    try {
        const resWork = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Bang_Lam_Viec!A1:Z5000'
        });
        const rows = resWork.data.values || [];
        let pTasks = [];
        let runT = "";
        let vnToday = layNgayVN();

        for (let i = 1; i < rows.length; i++) {
            let r = rows[i] || [];
            if (getCell(r, 0)) runT = getCell(r, 0);
            else if (getCell(r, 1) === "" && !getCell(r, 3) && !getCell(r, 8) && !getCell(r, 13)) runT = "";

            if (!runT) continue;
            let chap = layChapChuan(rows, i);
            ROLES.forEach(role => {
                if (
                    getCell(r, COL[role]).toLowerCase() === bietDanh.toLowerCase() &&
                    getCell(r, COL[`DONE_${role}`]).toLowerCase() !== 'x' &&
                    getCell(r, COL[`DONE_${role}`]).toLowerCase() !== 'true'
                ) {
                    let dlStr = getCell(r, COL[`DL_${role}`]);
                    let dlDate = parseDL(dlStr, vnToday);
                    let isOverdue = dlDate ? (vnToday.getTime() > dlDate.getTime()) : false;

                    pTasks.push({
                        id: `${xoaRac(runT).substring(0, 50)}_${chap.toLowerCase().trim()}_${role.toLowerCase()}`,
                        rowIndex: i + 1,
                        role: role,
                        truyenRaw: runT,
                        chap: chap,
                        dlStr: dlStr,
                        isOverdue: isOverdue
                    });
                }
            });
        }
        return { success: true, bietDanh, tasks: pTasks };
    } catch (err) {
        return { success: false, message: '❌ Lỗi tải danh sách việc: ' + err.message };
    }
});

// --- TAB 1: BÁO DONE ---
ipcMain.handle('done', async (event, payload) => {
    try {
        if (!isDataLoaded) await taiDuLieuHeThong();
        const discordId = String(payload.discordId || '').replace(/['"\s]/g, '');
        const bietDanh = thanhVienMap[discordId];
        if (!bietDanh) return { success: false, message: 'Lỗi: ID Discord chưa được đăng ký!' };

        const resWork = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Bang_Lam_Viec!A1:Z5000'
        });
        let rowMap = buildRowMap(resWork.data.values || []);

        const tenTruyenRaw = payload.truyen || payload.tentruyen || '';
        const chapRaw = String(payload.chap || '').trim();
        let targetIds = payload.taskIds || [];

        if (targetIds.length === 0 && tenTruyenRaw && chapRaw) {
            const normTruyen = xoaRac(tenTruyenRaw).substring(0, 50);
            let chapList = chapRaw.includes('-')
                ? (function () {
                    let p = chapRaw.split('-');
                    let a = [];
                    for (let c = parseFloat(p[0]); c <= parseFloat(p[1]); c++) a.push(c.toString());
                    return a;
                })()
                : (chapRaw.includes(',') ? chapRaw.split(',').map(s => s.trim()) : [chapRaw]);

            const roleRaw = String(payload.role || payload.vitri || 'CLEAN').toUpperCase();
            const rolesToDone = (roleRaw === 'EDIT' || roleRaw === 'EDIT_FULL') ? ['CLEAN', 'TYPE'] : [roleRaw];

            for (let c of chapList) {
                for (let r of rolesToDone) {
                    targetIds.push(`${normTruyen}_${c.toLowerCase().trim()}_${r.toLowerCase()}`);
                }
            }
        }

        if (targetIds.length === 0) {
            return { success: false, message: '❌ Vui lòng nhập đầy đủ Tên truyện và Số chap!' };
        }

        let dU = [], rD = [], lC = 0, vnToday = layNgayVN(), tTypeList = [], lateCount = 0, doneCount = 0;

        for (let v of targetIds) {
            let target = rowMap[v];
            if (!target) continue;
            let rI = target.rowIndex;
            let role = target.role;

            let curDone = getCell(target.r, COL[`DONE_${role}`]).toLowerCase();
            if (curDone === 'x' || curDone === 'true') {
                rD.push(`- **[${role}]** ${target.truyenRaw} (C.${target.chap}) - *Đã báo Done từ trước*`);
                continue;
            }

            dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL[`DONE_${role}`])}${rI}`, values: [[true]] });
            doneCount++;

            let info = thongTinMap[xoaRac(target.truyenRaw)];
            if (info) {
                if (role === 'TRANS') lC += info.luongTrans;
                else if (role === 'CLEAN') lC += info.luongClean;
                else if (role === 'TYPE') lC += info.luongType;
            }

            let dl = getCell(target.r, COL[`DL_${role}`]);
            let ns = "Đúng hạn";
            let isLate = false;
            if (dl) {
                let dp = parseDL(dl, vnToday);
                if (dp && vnToday.getTime() > dp.getTime()) {
                    let tS = Math.floor((vnToday.getTime() - dp.getTime()) / 1000);
                    let d = Math.floor(tS / 86400);
                    if (d > 0) { isLate = true; ns = `Trễ ${d} ngày`; lateCount++; }
                }
            }
            dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL[`NOTE_${role}`])}${rI}`, values: [[ns]] });
            rD.push(`- **[${role}]** ${target.truyenRaw} (C.${target.chap}) - *${ns}*`);

            if (isLate && (role === 'TRANS' || role === 'CLEAN')) {
                if (getCell(target.r, COL.TYPE)) {
                    let dDNext = new Date(vnToday.getTime() + 24 * 3600 * 1000);
                    dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL.DL_TYPE)}${rI}`, values: [[formatDL(dDNext)]] });
                    rD.push(`  ↳ ⏰ *(Trễ Domino)* Dời DL **[TYPE]** sang: **${displayDL(formatDL(dDNext))}**`);
                }
            }

            if (role === 'TRANS' || role === 'CLEAN') {
                let typStr = getCell(target.r, COL.TYPE) || (info ? info.typeChinh : "");
                if (typStr) {
                    typStr.split(',').forEach(tName => {
                        let cleanName = tName.trim();
                        let dId = nguocThanhVienMap[cleanName.toLowerCase()];
                        if (dId && dId !== discordId) {
                            if (!tTypeList.includes(`<@${dId}>`)) tTypeList.push(`<@${dId}>`);
                        } else if (cleanName !== "" && cleanName.toLowerCase() !== bietDanh.toLowerCase()) {
                            if (!tTypeList.includes(`**${cleanName}**`)) tTypeList.push(`**${cleanName}**`);
                        }
                    });
                }
            }
        }

        if (doneCount === 0) {
            return { success: false, message: rD.length > 0 ? rD.join('\n') : '❌ Không tìm thấy Chap tương ứng trên Bảng Làm Việc!' };
        }

        let bD = bankDataMap[discordId];
        if (bD) {
            bD.xu += doneCount * 10;
            bD.luong += lC;
            bD.treDL += lateCount;
            dU.push(
                { range: `Thanh_Vien!${String.fromCharCode(65 + COL_TV.XU)}${bD.row}`, values: [[bD.xu]] },
                { range: `Thanh_Vien!${String.fromCharCode(65 + COL_TV.LUONG)}${bD.row}`, values: [[bD.luong]] }
            );
            if (lateCount > 0) {
                dU.push({ range: `Thanh_Vien!${String.fromCharCode(65 + COL_TV.TRE_DL)}${bD.row}`, values: [[bD.treDL]] });
            }
        }

        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: process.env.SPREADSHEET_ID,
            requestBody: { valueInputOption: 'USER_ENTERED', data: dU }
        });

        let finalMsg = `✅ <@${discordId}> (**${bietDanh}**) đã báo DONE:\n${rD.join('\n')}\n💰 Lương: +${lC.toLocaleString()} đ | Xu: +${doneCount * 10}`;
        if (tTypeList.length > 0) finalMsg += `\n⏩ Mời **Type:** ${tTypeList.join(', ')} nhận việc.`;

        // 🟢 Phân luồng kênh Trans và kênh Edit theo đúng .env
        const roleCheck = String(payload.role || payload.vitri || '').toUpperCase();
        const doneChannel = (roleCheck === 'TRANS') 
            ? process.env.CHANNEL_DONE_TRANS 
            : process.env.CHANNEL_DONE_EDIT;

        await guiThongBaoDiscord(doneChannel, finalMsg);
        return { success: true, message: finalMsg };
        if (process.env.NOTIFY_CHANNEL_ID) await guiThongBaoDiscord(process.env.NOTIFY_CHANNEL_ID, finalMsg);
        return { success: true, message: finalMsg };
    } catch (err) {
        return { success: false, message: '❌ Lỗi báo Done: ' + err.message };
    }
});

// --- TAB 2: THÊM CHAP MỚI (CHAPMOI) ---
ipcMain.handle('chapmoi', async (event, payload) => {
    try {
        if (!isDataLoaded) await taiDuLieuHeThong();
        const tenTruyenInput = xoaRac(payload.truyen || payload.tentruyen);
        const chapInput = String(payload.chap || '').trim();
        const info = thongTinMap[tenTruyenInput];

        if (!info || !info.transChinh) {
            return { success: false, message: `❌ Không tìm thấy truyện hoặc chưa có Trans cứng!` };
        }

        let transLeave = checkRoleOnLeave(info.transChinh);
        let cleanLeave = checkRoleOnLeave(info.cleanChinh);
        let typeLeave = checkRoleOnLeave(info.typeChinh);

        let chapList = chapInput.includes('-')
            ? (function () {
                let p = chapInput.split('-');
                let a = [];
                for (let c = parseFloat(p[0]); c <= parseFloat(p[1]); c++) a.push(c.toString());
                return a;
            })()
            : (chapInput.includes(',') ? chapInput.split(',').map(s => s.trim()) : [chapInput]);
        const numChaps = chapList.length;

        const [resWork, resSheet] = await Promise.all([
            sheets.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: 'Bang_Lam_Viec!A1:Z5000' }),
            sheets.spreadsheets.get({ spreadsheetId: process.env.SPREADSHEET_ID, fields: 'sheets(properties(sheetId,title),merges)' })
        ]);

        const rows = resWork.data.values || [];
        let sheetData = resSheet.data.sheets.find(s => s.properties.title === 'Bang_Lam_Viec');
        let sheetId = sheetData ? sheetData.properties.sheetId : 0;
        let liveMerges = sheetData && sheetData.merges ? sheetData.merges.filter(m => m.startColumnIndex === 0 && m.endColumnIndex === 1) : [];

        let targetRowIndex = -1, startMergeIndex = -1, originalMergeEndIndex = -1, lastRowOfSeries = -1, runningTruyen = "";
        let realLastRow = 1;
        for (let i = rows.length - 1; i >= 1; i--) {
            if (getCell(rows[i], 0) || getCell(rows[i], 3) || getCell(rows[i], 8) || getCell(rows[i], 13)) {
                realLastRow = i;
                break;
            }
        }

        for (let i = 1; i <= realLastRow; i++) {
            let r = rows[i] || [];
            if (getCell(r, 0) !== "") runningTruyen = getCell(r, 0);
            else {
                let hasWorker = getCell(r, 3) !== "" || getCell(r, 8) !== "" || getCell(r, 13) !== "";
                if (getCell(r, 1) === "" && !hasWorker) runningTruyen = "";
            }

            if (runningTruyen !== "" && xoaRac(runningTruyen) === tenTruyenInput) {
                let inMerge = liveMerges.find(m => i >= m.startRowIndex && i < m.endRowIndex);
                if (startMergeIndex === -1 && inMerge) {
                    startMergeIndex = inMerge.startRowIndex;
                    originalMergeEndIndex = inMerge.endRowIndex;
                } else if (startMergeIndex === -1 && !inMerge) {
                    startMergeIndex = i;
                    originalMergeEndIndex = i + 1;
                }
                if (getCell(r, 1) !== "") lastRowOfSeries = i;
                if (getCell(r, 1) === "" && targetRowIndex === -1) targetRowIndex = i + 1;
            }
        }

        let isNewSeries = (startMergeIndex === -1 && lastRowOfSeries === -1);
        let insertIndex = isNewSeries ? realLastRow + 1 : (lastRowOfSeries !== -1 ? lastRowOfSeries + 1 : targetRowIndex - 1);
        let reqs = [];

        if (isNewSeries) {
            reqs.push({ insertDimension: { range: { sheetId: sheetId, dimension: "ROWS", startIndex: insertIndex, endIndex: insertIndex + numChaps + 1 }, inheritFromBefore: false } });
            reqs.push({ repeatCell: { range: { sheetId: sheetId, startRowIndex: insertIndex, endRowIndex: insertIndex + 1 }, cell: { userEnteredFormat: { backgroundColor: { red: 0, green: 0, blue: 0 } } }, fields: "userEnteredFormat.backgroundColor" } });
            reqs.push({ repeatCell: { range: { sheetId: sheetId, startRowIndex: insertIndex + 1, endRowIndex: insertIndex + 1 + numChaps }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } }, fields: "userEnteredFormat.backgroundColor" } });
            if (numChaps > 1) {
                reqs.push({ mergeCells: { range: { sheetId: sheetId, startRowIndex: insertIndex + 1, endRowIndex: insertIndex + 1 + numChaps, startColumnIndex: 0, endColumnIndex: 1 }, mergeType: "MERGE_COLUMNS" } });
            }
        } else {
            if (startMergeIndex !== -1) {
                reqs.push({ unmergeCells: { range: { sheetId: sheetId, startRowIndex: startMergeIndex, endRowIndex: originalMergeEndIndex, startColumnIndex: 0, endColumnIndex: 1 } } });
            }
            reqs.push({ insertDimension: { range: { sheetId: sheetId, dimension: "ROWS", startIndex: insertIndex, endIndex: insertIndex + numChaps }, inheritFromBefore: false } });
            if (startMergeIndex !== -1) {
                reqs.push({ mergeCells: { range: { sheetId: sheetId, startRowIndex: startMergeIndex, endRowIndex: originalMergeEndIndex + numChaps, startColumnIndex: 0, endColumnIndex: 1 }, mergeType: "MERGE_COLUMNS" } });
            }
        }

        try {
            await sheets.spreadsheets.batchUpdate({ spreadsheetId: process.env.SPREADSHEET_ID, requestBody: { requests: reqs } });
        } catch (e) {
            return { success: false, message: '❌ Lỗi Google Sheets API phản hồi chậm, hãy thử lại nhé!' };
        }

        let vn = layNgayVN();
        let dU = [];
        let dlFirstTr = "", dlLastTr = "", dlFirstCl = "", dlLastCl = "", dlFirstTy = "", dlLastTy = "";
        let startDataRow = isNewSeries ? insertIndex + 2 : insertIndex + 1;

        if (isNewSeries) {
            dU.push({ range: `Bang_Lam_Viec!A${startDataRow}`, values: [[info.linkDrive ? `=HYPERLINK("${info.linkDrive}"; "${info.tenGoc}")` : info.tenGoc]] });
        }

        for (let k = 0; k < numChaps; k++) {
            let rI = startDataRow + k;
            let c = chapList[k];
            let dlTr = formatDL(new Date(vn.getTime() + (k + 1) * 86400000));
            let dlTy = formatDL(new Date(vn.getTime() + (k + 2) * 86400000));
            if (k === 0) { dlFirstTr = dlTr; dlFirstCl = dlTr; dlFirstTy = dlTy; }
            if (k === numChaps - 1) { dlLastTr = dlTr; dlLastCl = dlTr; dlLastTy = dlTy; }

            dU.push(
                { range: `Bang_Lam_Viec!B${rI}`, values: [[c]] },
                { range: `Bang_Lam_Viec!D${rI}`, values: [[transLeave ? "" : info.transChinh]] },
                { range: `Bang_Lam_Viec!E${rI}`, values: [[info.luongTrans]] },
                { range: `Bang_Lam_Viec!F${rI}`, values: [[dlTr]] }
            );
            if (info.cleanChinh) {
                dU.push(
                    { range: `Bang_Lam_Viec!I${rI}`, values: [[cleanLeave ? "" : info.cleanChinh]] },
                    { range: `Bang_Lam_Viec!J${rI}`, values: [[info.luongClean]] },
                    { range: `Bang_Lam_Viec!K${rI}`, values: [[dlTr]] }
                );
            }
            if (info.typeChinh) {
                dU.push(
                    { range: `Bang_Lam_Viec!N${rI}`, values: [[typeLeave ? "" : info.typeChinh]] },
                    { range: `Bang_Lam_Viec!O${rI}`, values: [[info.luongType]] },
                    { range: `Bang_Lam_Viec!P${rI}`, values: [[dlTy]] }
                );
            }
        }

        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: process.env.SPREADSHEET_ID,
            requestBody: { valueInputOption: 'USER_ENTERED', data: dU }
        });

        // --- CẮM CHAP BẢNG PHỤ ---
        try {
            const sheet2Tab = (info.loai && info.loai.toLowerCase().includes('manga')) ? 'MANGA' : 'MANHWA';
            const [resWork2, resSheet2] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID_2, range: `${sheet2Tab}!A1:Z5000` }),
                sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID_2, fields: 'sheets(properties(sheetId,title),merges)' })
            ]);
            const rows2 = resWork2.data.values || [];
            let sheetData2 = resSheet2.data.sheets.find(s => s.properties.title === sheet2Tab);
            let sheetId2 = sheetData2 ? sheetData2.properties.sheetId : null;
            let liveMerges2 = sheetData2 && sheetData2.merges ? sheetData2.merges.filter(m => m.startColumnIndex === 1 && m.endColumnIndex === 2) : [];

            let startMergeIndex2 = -1, originalMergeEndIndex2 = -1, lastRowOfSeries2 = -1, runningTruyen2 = "";
            let realLastRow2 = 1;
            for (let i = rows2.length - 1; i >= 1; i--) {
                if (getCell(rows2[i], 1) !== "" || getCell(rows2[i], 4) !== "") { realLastRow2 = i; break; }
            }

            for (let i = 1; i <= realLastRow2; i++) {
                let r = rows2[i] || [];
                if (getCell(r, 1) !== "") runningTruyen2 = getCell(r, 1);
                else if (getCell(r, 4) === "") runningTruyen2 = "";

                if (runningTruyen2 !== "" && xoaRac(runningTruyen2) === tenTruyenInput) {
                    let inMerge = liveMerges2.find(m => i >= m.startRowIndex && i < m.endRowIndex);
                    if (startMergeIndex2 === -1 && inMerge) {
                        startMergeIndex2 = inMerge.startRowIndex;
                        originalMergeEndIndex2 = inMerge.endRowIndex;
                    } else if (startMergeIndex2 === -1 && !inMerge) {
                        startMergeIndex2 = i;
                        originalMergeEndIndex2 = i + 1;
                    }
                    if (getCell(r, 4) !== "") lastRowOfSeries2 = i;
                }
            }

            let isNewSeries2 = (startMergeIndex2 === -1 && lastRowOfSeries2 === -1);
            let insertIndex2 = isNewSeries2 ? realLastRow2 + 1 : lastRowOfSeries2 + 1;
            let reqs2 = [];

            if (sheetId2 !== null) {
                if (isNewSeries2) {
                    reqs2.push({ insertDimension: { range: { sheetId: sheetId2, dimension: "ROWS", startIndex: insertIndex2, endIndex: insertIndex2 + numChaps }, inheritFromBefore: true } });
                    if (numChaps > 1) {
                        reqs2.push({ mergeCells: { range: { sheetId: sheetId2, startRowIndex: insertIndex2, endRowIndex: insertIndex2 + numChaps, startColumnIndex: 1, endColumnIndex: 2 }, mergeType: "MERGE_COLUMNS" } });
                    }
                } else {
                    if (startMergeIndex2 !== -1) {
                        reqs2.push({ unmergeCells: { range: { sheetId: sheetId2, startRowIndex: startMergeIndex2, endRowIndex: originalMergeEndIndex2, startColumnIndex: 1, endColumnIndex: 2 } } });
                    }
                    reqs2.push({ insertDimension: { range: { sheetId: sheetId2, dimension: "ROWS", startIndex: insertIndex2, endIndex: insertIndex2 + numChaps }, inheritFromBefore: true } });
                    if (startMergeIndex2 !== -1) {
                        reqs2.push({ mergeCells: { range: { sheetId: sheetId2, startRowIndex: startMergeIndex2, endRowIndex: originalMergeEndIndex2 + numChaps, startColumnIndex: 1, endColumnIndex: 2 }, mergeType: "MERGE_COLUMNS" } });
                    }
                }
                await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID_2, requestBody: { requests: reqs2 } });

                let dU2 = [];
                if (isNewSeries2) dU2.push({ range: `${sheet2Tab}!B${insertIndex2 + 1}`, values: [[info.tenGoc]] });
                for (let k = 0; k < numChaps; k++) {
                    let rI2 = insertIndex2 + 1 + k;
                    let c = chapList[k];
                    let dlTy = formatDL(new Date(vn.getTime() + (k + 2) * 86400000));
                    dU2.push(
                        { range: `${sheet2Tab}!E${rI2}`, values: [[c]] },
                        { range: `${sheet2Tab}!H${rI2}`, values: [[dlTy]] }
                    );
                }
                await sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID_2,
                    requestBody: { valueInputOption: 'USER_ENTERED', data: dU2 }
                });
            }
        } catch (e) {}

        let getTag = (str) => {
            if (!str) return "Chờ";
            return str.split(',').map(s => {
                let ten = s.trim();
                let id = nguocThanhVienMap[ten.toLowerCase()];
                // Nếu tìm thấy ID Discord trong bảng Thành Viên thì tag xanh <@ID>, ngược lại in đậm tên
                return id ? `<@${id}>` : `**${ten}**`;
            }).join(', ');
        };
        let tagTransStr = transLeave ? `Trống (*${transLeave.name} nghỉ*)` : getTag(info.transChinh);
        let tagCleanStr = info.cleanChinh ? (cleanLeave ? `Trống (*${cleanLeave.name} nghỉ*)` : getTag(info.cleanChinh)) : "Chờ";
        let tagTypeStr = info.typeChinh ? (typeLeave ? `Trống (*${typeLeave.name} nghỉ*)` : getTag(info.typeChinh)) : "Chờ";

        let showDL = (f, l) => numChaps > 1 ? `${displayDL(f)} ➡️ ${displayDL(l)}` : `${displayDL(f)}`;
        let replyMsg = `🎉 **CẬP NHẬT CHAP MỚI** 🎉\n🎬 **${info.tenGoc}** vừa ra lò Chap: **${chapList.join(', ')}**!\n\n🎯 **GỌI TÊN NHẬN HÀNG:**\n- Trans: ${tagTransStr} (DL: **${showDL(dlFirstTr, dlLastTr)}**)\n- Clean: ${tagCleanStr} (DL: **${showDL(dlFirstCl, dlLastCl)}** - Cùng hạn Trans)\n- Type: ${tagTypeStr} (DL: **${showDL(dlFirstTy, dlLastTy)}** - Lệch 1 ngày)\n\n*(Đã thêm ${numChaps} chap vào hệ thống)*`;
        await guiThongBaoDiscord(process.env.CHANNEL_NEW_CHAP, replyMsg);
        return { success: true, message: replyMsg };
        if (process.env.NOTIFY_CHANNEL_ID) await guiThongBaoDiscord(process.env.NOTIFY_CHANNEL_ID, replyMsg);
        return { success: true, message: replyMsg };
    } catch (err) {
        return { success: false, message: '❌ Lỗi thêm chap mới: ' + err.message };
    }
});

// --- TAB 3: NỘP SẢN PHẨM (Tích hợp cả Copy Folder Drive, Nộp File Zip & Gắn Link QC Bảng Phụ) ---
ipcMain.handle('nopsanpham', async (event, payload) => {
    try {
        if (!isDataLoaded) await taiDuLieuHeThong();
        const discordId = String(payload.discordId || '').replace(/['"\s]/g, '');
        const bietDanh = thanhVienMap[discordId];
        if (!bietDanh) return { success: false, message: 'Lỗi: ID Discord chưa được đăng ký!' };

        const tenTruyenInput = xoaRac(payload.truyen || payload.tentruyen);
        const chapInput = String(payload.chap || '').trim();
        const rawRole = String(payload.role || payload.vitri || '').toUpperCase();
        const viTriInput = rawRole === 'EDIT_FULL' ? 'EDIT' : rawRole;
        let linkInput = payload.link ? String(payload.link).trim() : '';
        const noteInput = payload.note ? String(payload.note).trim() : '';
        const zipFilePath = payload.filePath || '';

        const thongTin = thongTinMap[tenTruyenInput];
        if (!thongTin) return { success: false, message: '❌ Không tìm thấy thông tin truyện.' };

        // 🟢 NẾU CHỌN ROLE = "QC" -> CHẠY LOGIC GẮN LINK BẢNG PHỤ (NOPLINK)
        if (viTriInput === 'QC') {
            if (!linkInput.startsWith('http')) return { success: false, message: '❌ Link QC phải bắt đầu bằng http!' };
            const sheet2Tab = (thongTin.loai && thongTin.loai.toLowerCase().includes('manga')) ? 'MANGA' : 'MANHWA';
            const [resWork2, resSheet2] = await Promise.all([
                sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID_2, range: `${sheet2Tab}!A1:Z5000` }),
                sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID_2 })
            ]);

            const rows2 = resWork2.data.values || [];
            let targetRow = -1, currentDlStr = "", runningTruyen2 = "";
            for (let i = 2; i < rows2.length; i++) {
                let r = rows2[i] || [];
                if (getCell(r, 1) !== "") runningTruyen2 = getCell(r, 1);
                else if (getCell(r, 4) === "") runningTruyen2 = "";
                if (xoaRac(runningTruyen2) === tenTruyenInput && getCell(r, 4) === chapInput) {
                    targetRow = i;
                    currentDlStr = getCell(r, 7);
                    break;
                }
            }
            if (targetRow === -1) return { success: false, message: `❌ Không tìm thấy Chap ${chapInput} trong Bảng Phụ (${sheet2Tab}).` };

            let linkGon = `=HYPERLINK("${linkInput}"; "Chap ${chapInput}")`;
            let updateValues = [{ range: `${sheet2Tab}!F${targetRow + 1}`, values: [[linkGon]] }];
            if (noteInput !== '') updateValues.push({ range: `${sheet2Tab}!J${targetRow + 1}`, values: [[noteInput]] });

            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID_2,
                requestBody: { valueInputOption: 'USER_ENTERED', data: updateValues }
            });

            let vnToday = layNgayVN(), noteText = "", isLate = false;
            let pureDlStr = currentDlStr.split(' ')[0];
            let dlDate = parseDL(pureDlStr, vnToday);
            if (dlDate) {
                let diffTime = vnToday.getTime() - dlDate.getTime();
                if (diffTime > 0) {
                    let d = Math.floor(Math.floor(diffTime / 1000) / 86400);
                    if (d > 0) { isLate = true; noteText = `Trễ ${d} ngày`; }
                    else noteText = "Đúng hạn";
                } else noteText = "Đúng hạn";
            } else noteText = pureDlStr;

            if (isLate) {
                let bD = bankDataMap[discordId];
                if (bD) {
                    bD.treDL += 1;
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: process.env.SPREADSHEET_ID,
                        range: `Thanh_Vien!${String.fromCharCode(65 + COL_TV.TRE_DL)}${bD.row}`,
                        valueInputOption: 'USER_ENTERED',
                        requestBody: { values: [[bD.treDL]] }
                    });
                }
            }

            let s2SheetData = resSheet2.data.sheets.find(s => s.properties.title === sheet2Tab);
            if (s2SheetData) {
                let bgColor = isLate ? { red: 0.957, green: 0.8, blue: 0.8 } : { red: 0.85, green: 0.917, blue: 0.827 };
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID_2,
                    requestBody: {
                        requests: [{
                            repeatCell: {
                                range: { sheetId: s2SheetData.properties.sheetId, startRowIndex: targetRow, endRowIndex: targetRow + 1, startColumnIndex: 4, endColumnIndex: 5 },
                                cell: { userEnteredFormat: { backgroundColor: bgColor } },
                                fields: "userEnteredFormat.backgroundColor"
                            }
                        }]
                    }
                });
            const qcMsg = `✅ <@${discordId}> (**${bietDanh}**) đã gắn link QC cho **${thongTin.tenGoc} - Chap ${chapInput}**!\nTrạng thái: **${isLate ? "🔴 " + noteText : "🟢 Đúng hạn"}**${noteInput ? `\n📝 Note: ${noteInput}` : ""}\n🔗 Link: ${linkInput}`;
            await guiThongBaoDiscord(process.env.CHANNEL_DONE_QC, qcMsg);
            return { success: true, message: qcMsg };
            }
            return {
                success: true,
                message: `✅ Đã gắn link Bảng Phụ cho **${thongTin.tenGoc} - Chap ${chapInput}** thành công!\nTrạng thái: **${isLate ? "🔴 " + noteText : "🟢 Đúng hạn"}**`
            };
        }

        // 🟢 NẾU LÀ CÁC ROLE KHÁC -> UPLOAD ZIP HOẶC COPY FOLDER DRIVE
        if (!linkInput && !zipFilePath) return { success: false, message: '❌ Vui lòng dán Link Drive hoặc chọn File Zip!' };
        if (linkInput && !linkInput.startsWith('http')) return { success: false, message: '❌ Link phải bắt đầu bằng http!' };

        const parentFolderId = extractDriveId(thongTin.linkDrive);
        if (!parentFolderId) return { success: false, message: '❌ Cột "Link Drive" của truyện này đang trống hoặc không hợp lệ.' };

        const { uploadDrive, accNum } = getUploadDrive();
        let chapFolderId, roleFolderId, roleFolderLink;
        const chapFolderName = `${chapInput}`;
        const roleFolderName = viTriInput === 'FIX' ? 'Đã fix' : viTriInput.toUpperCase();

        try {
            const chapSearch = await uploadDrive.files.list({
                q: `'${parentFolderId}' in parents and name = '${chapFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
                fields: 'files(id)'
            });
            if (chapSearch.data.files && chapSearch.data.files.length > 0) {
                chapFolderId = chapSearch.data.files[0].id;
            } else {
                const folder = await uploadDrive.files.create({
                    resource: { name: chapFolderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentFolderId] },
                    fields: 'id'
                });
                chapFolderId = folder.data.id;
            }

            const roleSearch = await uploadDrive.files.list({
                q: `'${chapFolderId}' in parents and name = '${roleFolderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
                fields: 'files(id, webViewLink)'
            });
            if (roleSearch.data.files && roleSearch.data.files.length > 0) {
                roleFolderId = roleSearch.data.files[0].id;
                roleFolderLink = roleSearch.data.files[0].webViewLink;
            } else {
                const folderRole = await uploadDrive.files.create({
                    resource: { name: roleFolderName, mimeType: 'application/vnd.google-apps.folder', parents: [chapFolderId] },
                    fields: 'id, webViewLink'
                });
                roleFolderId = folderRole.data.id;
                roleFolderLink = folderRole.data.webViewLink;
            }
        } catch (err) {
            return { success: false, message: `❌ Lỗi truy cập/tạo folder Drive: ${err.message}` };
        }

        let msgUpload = "";
        if (zipFilePath) {
            try {
                const fileName = path.basename(zipFilePath);
                const fileStream = fs.createReadStream(zipFilePath);
                await uploadDrive.files.create({
                    requestBody: { name: fileName, parents: [roleFolderId] },
                    media: { mimeType: 'application/zip', body: fileStream }
                });
                msgUpload = `✅ **NỘP SẢN PHẨM THÀNH CÔNG!**\n🤖 Đã tải **${fileName}** vào thư mục **${roleFolderName}**.\n🛡️ *(Acc Upload #${accNum})*\n🔗 Link: ${roleFolderLink}`;
            } catch (err) {
                return { success: false, message: `❌ Lỗi tải file zip: ${err.message}` };
            }
        } else if (linkInput) {
            const sourceFolderId = extractDriveId(linkInput);
            if (!sourceFolderId) return { success: false, message: '❌ Link Folder Drive không hợp lệ.' };
            let filesToCopy = [], sucC = 0, pt = null;
            try {
                do {
                    const res = await uploadDrive.files.list({
                        q: `'${sourceFolderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
                        fields: 'nextPageToken, files(id, name)',
                        pageToken: pt
                    });
                    filesToCopy = filesToCopy.concat(res.data.files);
                    pt = res.data.nextPageToken;
                } while (pt);

                if (filesToCopy.length === 0) {
                    return { success: false, message: `⚠️ Folder nguồn trống hoặc chưa mở quyền xem.\n🔗 Link đích: ${roleFolderLink}` };
                }

                for (let idx = 0; idx < filesToCopy.length; idx++) {
                    const f = filesToCopy[idx];
                    if (mainWindow) {
                        mainWindow.webContents.send('copy-progress', { current: idx + 1, total: filesToCopy.length });
                    }
                    try {
                        await uploadDrive.files.copy({ fileId: f.id, requestBody: { parents: [roleFolderId], name: f.name } });
                        sucC++;
                    } catch (e) {}
                    await new Promise(r => setTimeout(r, 200));
                }
                msgUpload = `✅ **NỘP SẢN PHẨM THÀNH CÔNG!**\n🤖 Đã COPY xong **${sucC}/${filesToCopy.length}** file vào **${roleFolderName}**.\n🛡️ *(Acc Upload #${accNum})*\n🔗 Link: ${roleFolderLink}`;
            } catch (e) {
                return { success: false, message: '❌ Lỗi quét file trên Drive.' };
            }
        }

        // AUTO DONE NẾU VỊ TRÍ KHÁC TRANS VÀ FIX
        if (viTriInput !== 'TRANS' && viTriInput !== 'FIX') {
            const resWork = await sheets.spreadsheets.values.get({
                spreadsheetId: process.env.SPREADSHEET_ID,
                range: 'Bang_Lam_Viec!A1:Z5000'
            });
            let rowMap = buildRowMap(resWork.data.values || []);
            let rolesToDone = viTriInput === 'EDIT' ? ['CLEAN', 'TYPE'] : [viTriInput];
            let baseKey = `${xoaRac(tenTruyenInput).substring(0, 50)}_${chapInput.toLowerCase().trim()}`;
            let dU = [], luongCong = 0, cItems = 0, vnToday = layNgayVN(), rD = [], tTypeList = [], lateCount = 0;

            for (let role of rolesToDone) {
                let target = rowMap[`${baseKey}_${role.toLowerCase()}`];
                if (target) {
                    let { rowIndex: rI, r: rData } = target;
                    if (getCell(rData, COL[`DONE_${role}`]).toLowerCase() === 'x' || getCell(rData, COL[`DONE_${role}`]).toLowerCase() === 'true') {
                        rD.push(`- [${role}] Đã Done`);
                        continue;
                    }

                    dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL[`DONE_${role}`])}${rI}`, values: [[true]] });
                    cItems++;
                    let info = thongTinMap[xoaRac(target.truyenRaw)];
                    if (info) {
                        if (role === 'TRANS') luongCong += info.luongTrans || 0;
                        else if (role === 'CLEAN') luongCong += info.luongClean || 0;
                        else if (role === 'TYPE') luongCong += info.luongType || 0;
                    }

                    let dlStr = getCell(rData, COL[`DL_${role}`]);
                    let nStr = "Đúng hạn";
                    let isLate = false;
                    if (dlStr) {
                        let dD = parseDL(dlStr, vnToday);
                        if (dD && vnToday.getTime() > dD.getTime()) {
                            let tS = Math.floor((vnToday.getTime() - dD.getTime()) / 1000);
                            let d = Math.floor(tS / 86400);
                            if (d > 0) { isLate = true; nStr = `Trễ ${d} ngày`; lateCount++; }
                        }
                    }
                    dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL[`NOTE_${role}`])}${rI}`, values: [[nStr]] });
                    rD.push(`- **[${role}]** Chap ${chapInput} (${nStr})`);

                    if (isLate && (role === 'TRANS' || role === 'CLEAN')) {
                        if (getCell(rData, COL.TYPE)) {
                            let dDNext = new Date(vnToday.getTime() + 24 * 3600 * 1000);
                            dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL.DL_TYPE)}${rI}`, values: [[formatDL(dDNext)]] });
                            rD.push(`  ↳ ⏰ *(Trễ Domino)* Dời DL **[TYPE]** sang: **${displayDL(formatDL(dDNext))}**`);
                        }
                    }

                    if (role === 'TRANS' || role === 'CLEAN') {
                        let typStr = getCell(rData, COL.TYPE) || (info ? info.typeChinh : "");
                        if (typStr) {
                            typStr.split(',').forEach(tName => {
                                let cleanName = tName.trim();
                                let dId = nguocThanhVienMap[cleanName.toLowerCase()];
                                if (dId && dId !== discordId) {
                                    if (!tTypeList.includes(`<@${dId}>`)) tTypeList.push(`<@${dId}>`);
                                } else if (cleanName !== "" && cleanName.toLowerCase() !== bietDanh.toLowerCase()) {
                                    if (!tTypeList.includes(`**${cleanName}**`)) tTypeList.push(`**${cleanName}**`);
                                }
                            });
                        }
                    }
                }
            }

            if (cItems > 0) {
                let bD = bankDataMap[discordId];
                if (bD) {
                    bD.xu += cItems * 10;
                    bD.luong += luongCong;
                    bD.treDL += lateCount;
                    dU.push(
                        { range: `Thanh_Vien!${String.fromCharCode(65 + COL_TV.XU)}${bD.row}`, values: [[bD.xu]] },
                        { range: `Thanh_Vien!${String.fromCharCode(65 + COL_TV.LUONG)}${bD.row}`, values: [[bD.luong]] }
                    );
                    if (lateCount > 0) dU.push({ range: `Thanh_Vien!${String.fromCharCode(65 + COL_TV.TRE_DL)}${bD.row}`, values: [[bD.treDL]] });
                }
                await sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: process.env.SPREADSHEET_ID,
                    requestBody: { valueInputOption: 'USER_ENTERED', data: dU }
                });
                msgUpload += `\n\n🎯 **AUTO DONE:**\n${rD.join('\n')}\n💰 Lương: **+${luongCong.toLocaleString()} đ** | Xu: **+${cItems * 10}**`;
                if (tTypeList.length > 0) msgUpload += `\n⏩ Mời **Type:** ${tTypeList.join(', ')} nhận việc.`;
            }
        } else if (viTriInput === 'FIX') {
            msgUpload += `\n\n*(Đã nộp vào thư mục Đã fix!)*`;
        }
        const nopChannel = (viTriInput === 'TRANS') 
            ? process.env.CHANNEL_DONE_TRANS 
            : process.env.CHANNEL_DONE_EDIT;

        await guiThongBaoDiscord(nopChannel, `📦 <@${discordId}> (**${bietDanh}**) vừa nộp sản phẩm **[${viTriInput}]** truyện **${thongTin.tenGoc} - Chap ${chapInput}**:\n` + msgUpload);
        return { success: true, message: msgUpload };
        return { success: true, message: msgUpload };
    } catch (err) {
        return { success: false, message: '❌ Lỗi nộp sản phẩm: ' + err.message };
    }
    
});

// --- TAB 4: NHẬN VIỆC RANDOM (NHANVIEC) ---
ipcMain.handle('nhanviec', async (event, payload) => {
    try {
        if (!isDataLoaded) await taiDuLieuHeThong();
        const discordId = String(payload.discordId || '').replace(/['"\s]/g, '');
        const bietDanh = thanhVienMap[discordId];
        if (!bietDanh) return { success: false, message: 'Lỗi: ID Discord chưa được đăng ký!' };

        const viTri = String(payload.role || payload.vitri || '').toUpperCase();
        const loai = String(payload.loai || 'all').toLowerCase();
        const soLuong = parseInt(payload.soluong) || 1;

        let bData = bankDataMap[discordId];
        let userRole = bData ? (bData.role || '').toLowerCase() : '';
        if (userRole.includes('edit') && viTri === 'CLEAN') {
            return { success: false, message: `❌ Sếp mang role **Edit Full** thì không được bốc lẻ **Clean** đâu nhé (chỉ được bốc lẻ Type hoặc Edit Full để tránh tồn kho)!` };
        }

        const resWork = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Bang_Lam_Viec!A1:Z5000'
        });
        const rows = resWork.data.values || [];
        let runningTruyen = "";
        let allAvailableJobs = [];
        let poolTypeOnlyForEditFull = [];
        let newDl = formatDL(new Date(layNgayVN().getTime() + 24 * 3600 * 1000));

        for (let i = 1; i < rows.length; i++) {
            let r = rows[i] || [];
            if (getCell(r, 0) !== "") runningTruyen = getCell(r, 0);
            else if (getCell(r, 1) === "" && getCell(r, 3) === "" && getCell(r, 8) === "" && getCell(r, 13) === "") runningTruyen = "";

            if (!runningTruyen) continue;
            if (getCell(r, COL.CHAP) === "") continue;

            const thongTin = thongTinMap[xoaRac(runningTruyen)];
            if (!thongTin) continue;
            if (loai !== 'all' && (!thongTin.loai || !thongTin.loai.toLowerCase().includes(loai))) continue;

            let chap = getCell(r, COL.CHAP);
            let dTr = getCell(r, COL.DONE_TRANS).toLowerCase(); let isDoneTrans = (dTr === 'true' || dTr === 'x');
            let dCl = getCell(r, COL.DONE_CLEAN).toLowerCase(); let isDoneClean = (dCl === 'true' || dCl === 'x');
            let dTy = getCell(r, COL.DONE_TYPE).toLowerCase();  let isDoneType  = (dTy === 'true' || dTy === 'x');

            if (viTri.startsWith('TRANS')) {
                if (getCell(r, COL.TRANS) !== "" || isDoneTrans) continue;
                let reqLang = "";
                if (viTri === 'TRANS_HÀN') reqLang = "hàn";
                else if (viTri === 'TRANS_ANH') reqLang = "anh";
                else if (viTri === 'TRANS_TRUNG') reqLang = "trung";
                else if (viTri === 'TRANS_NHẬT') reqLang = "nhật";

                let jobLang = (thongTin.ngonNgu || "").toLowerCase();
                let normTen = xoaRac(runningTruyen);
                if (normTen === 'oneshot' || normTen === 'dj') {
                    let cStr = chap.toLowerCase();
                    if (cStr.includes('hàn') || cStr.includes('han')) jobLang = 'hàn';
                    else if (cStr.includes('anh')) jobLang = 'anh';
                    else if (cStr.includes('trung')) jobLang = 'trung';
                    else if (cStr.includes('nhật') || cStr.includes('nhat')) jobLang = 'nhật';
                }

                if (!reqLang || jobLang === reqLang) {
                    allAvailableJobs.push({ rI: i + 1, truyen: runningTruyen, chap: chap, roles: ['TRANS'], luong: [thongTin.luongTrans || 0], dls: [newDl] });
                }
            } else if (viTri === 'CLEAN') {
                if (getCell(r, COL.CLEAN) === "" && !isDoneClean) {
                    allAvailableJobs.push({ rI: i + 1, truyen: runningTruyen, chap: chap, roles: ['CLEAN'], luong: [thongTin.luongClean || 0], dls: [newDl] });
                }
            } else if (viTri === 'TYPE') {
                if (getCell(r, COL.TYPE) === "" && !isDoneType && isDoneTrans && isDoneClean) {
                    allAvailableJobs.push({ rI: i + 1, truyen: runningTruyen, chap: chap, roles: ['TYPE'], luong: [thongTin.luongType || 0], dls: [newDl] });
                }
            } else if (viTri === 'EDIT_FULL') {
                let cClean = getCell(r, COL.CLEAN);
                let cType = getCell(r, COL.TYPE);
                if (isDoneClean && isDoneTrans && cType === "" && !isDoneType) {
                    poolTypeOnlyForEditFull.push({ rI: i + 1, truyen: runningTruyen, chap: chap, roles: ['TYPE'], luong: [thongTin.luongType || 0], dls: [newDl] });
                } else if (cClean === "" && cType === "" && !isDoneClean && !isDoneType && isDoneTrans) {
                    allAvailableJobs.push({ rI: i + 1, truyen: runningTruyen, chap: chap, roles: ['CLEAN', 'TYPE'], luong: [thongTin.luongClean || 0, thongTin.luongType || 0], dls: [newDl, newDl] });
                }
            }
        }

        let isRedirectedToType = false;
        if (viTri === 'EDIT_FULL' && poolTypeOnlyForEditFull.length > 0) {
            allAvailableJobs = poolTypeOnlyForEditFull;
            isRedirectedToType = true;
        }

        if (allAvailableJobs.length === 0) {
            return { success: false, message: `❌ Hết hàng rồi sếp ơi! Hiện không có job **${viTri}** (${loai}) nào đang trống.` };
        }

        let groupedJobs = {};
        for (let job of allAvailableJobs) {
            if (!groupedJobs[job.truyen]) groupedJobs[job.truyen] = [];
            groupedJobs[job.truyen].push(job);
        }

        let jobsFound = [];
        let seriesKeys = Object.keys(groupedJobs);
        for (let i = seriesKeys.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [seriesKeys[i], seriesKeys[j]] = [seriesKeys[j], seriesKeys[i]];
        }

        let currentIndex = 0;
        while (jobsFound.length < soLuong && seriesKeys.length > 0) {
            let key = seriesKeys[currentIndex];
            let job = groupedJobs[key].shift();
            jobsFound.push(job);
            if (groupedJobs[key].length === 0) seriesKeys.splice(currentIndex, 1);
            else currentIndex++;
            if (currentIndex >= seriesKeys.length) currentIndex = 0;
        }

        let dU = [], rD = [];
        for (let job of jobsFound) {
            job.roles.forEach((role, idx) => {
                dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL[role])}${job.rI}`, values: [[bietDanh]] });
                dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL['LUONG_' + role])}${job.rI}`, values: [[job.luong[idx]]] });
                if (job.dls[idx]) {
                    dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL['DL_' + role])}${job.rI}`, values: [[job.dls[idx]]] });
                }
            });
            let roleName = job.roles.length === 2 ? 'EDIT FULL' : job.roles[0];
            let dlDisplay = job.dls[0] ? displayDL(job.dls[0]) : "Chưa có hạn";
            rD.push(`- **[${roleName}]** ${job.truyen} (Chap ${job.chap})\n  ⏰ Hạn chót: **${dlDisplay}**`);
        }

        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: process.env.SPREADSHEET_ID,
            requestBody: { valueInputOption: 'USER_ENTERED', data: dU }
        });

        let replyMsg = `✅ **BỐC VIỆC THÀNH CÔNG (${bietDanh}):**\n${rD.join('\n')}`;
        if (isRedirectedToType) {
            replyMsg = `⚠️ **HỆ THỐNG ĐIỀU HƯỚNG:** Đang có chap tồn kho Type, sếp được đẩy sang nhận Type để giải quyết hàng tồn nhé!\n\n` + replyMsg;
        }
        await guiThongBaoDiscord(process.env.CHANNEL_NHAN_DEADLINE, `🎲 <@${discordId}> (**${bietDanh}**) vừa bốc việc:\n${rD.join('\n')}`);
        return { success: true, message: replyMsg };
    } catch (err) {
        return { success: false, message: '❌ Lỗi bốc việc: ' + err.message };
    }
});

// --- TAB 5: XIN NGHỈ PHÉP & KHO HÀNG DROP ---
ipcMain.handle('xinnghi', async (event, payload) => {
    try {
        if (!isDataLoaded) await taiDuLieuHeThong();
        const discordId = String(payload.discordId || '').replace(/['"\s]/g, '');
        const bietDanh = thanhVienMap[discordId];
        let bData = bankDataMap[discordId];
        if (!bietDanh || !bData) return { success: false, message: 'Lỗi: ID Discord chưa được đăng ký!' };

        const soNgay = parseInt(payload.soNgay || payload.songay) || 1;
        const lyDo = payload.lyDo || '';
        const droppedListFromUI = payload.droppedTasks || [];
        const droppedIds = new Set(droppedListFromUI.map(t => typeof t === 'string' ? t : t.id));

        let vnToday = layNgayVN();
        let nghiDate = new Date(vnToday.getTime() + soNgay * 24 * 3600 * 1000);
        let ngayVe = layChuoiNgay(nghiDate);

        await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: `Thanh_Vien!${String.fromCharCode(65 + COL_TV.NGHI)}${bData.row}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[ngayVe]] }
        });
        bData.nghi = ngayVe;

        const resWork = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Bang_Lam_Viec!A1:Z5000'
        });
        const rows = resWork.data.values || [];
        let rowMap = buildRowMap(rows);
        let dU = [], droppedTasks = [];

        for (let t of droppedListFromUI) {
            let taskObj = typeof t === 'object' ? t : null;
            if (!taskObj) continue;
            let rI = rowMap[`${xoaRac(taskObj.truyenRaw).substring(0, 50)}_${String(taskObj.chap).toLowerCase().trim()}`] || taskObj.rowIndex;

            droppedTasks.push({
                id: taskObj.id,
                rowIndex: rI,
                role: taskObj.role,
                truyenRaw: taskObj.truyenRaw,
                chap: taskObj.chap,
                leaveInfo: { name: bietDanh, date: ngayVe }
            });

            dU.push(
                { range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL[taskObj.role])}${rI}`, values: [[""]] },
                { range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL['LUONG_' + taskObj.role])}${rI}`, values: [[""]] },
                { range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL['DL_' + taskObj.role])}${rI}`, values: [[""]] },
                { range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL[`NOTE_${taskObj.role}`])}${rI}`, values: [[""]] }
            );
        }

        // 🟢 BẮN THÔNG BÁO XIN NGHỈ VÀ NHƯỢNG CHAP LÊN DISCORD
        if (droppedTasks.length > 0 && process.env.CHANNEL_NHUONG_CHAP) {
            let msgNhuong = `📢 **CÓ HÀNG DROP TỪ THẦU CỨNG!** 📢\n<@${discordId}> (**${bietDanh}**) đã xin nghỉ phép đến ${ngayVe} và nhượng lại:\n`;
            droppedTasks.forEach(t => { msgNhuong += `- **[${t.role}]** ${t.truyenRaw} (Chap ${t.chap})\n`; });
            await guiThongBaoDiscord(process.env.CHANNEL_NHUONG_CHAP, msgNhuong);
        }

        if (process.env.CHANNEL_XIN_NGHI) {
            const bossTag = process.env.ID_ROLE_BOSS ? `<@&${process.env.ID_ROLE_BOSS.trim()}> ` : '';
            let msgXinNghi = `🏖️ ${bossTag}**ĐƠN XIN NGHỈ PHÉP** 🏖️\n` +
                              `👤 **Nhân sự:** <@${discordId}> (**${bietDanh}**)\n` +
                              `⏳ **Thời gian:** Xin nghỉ ${soNgay} ngày (Dự kiến quay lại: **${ngayVe}**)\n` +
                              `📝 **Lý do:** ${lyDo || 'Không có'}\n` +
                              `📦 **Số chap nhượng lại (Drop):** ${droppedTasks.length} chap`;
            await guiThongBaoDiscord(process.env.CHANNEL_XIN_NGHI, msgXinNghi);
        }
        return {
            success: true,
            message: `🏖️ ✅ Đã chốt đơn nghỉ phép cho **${bietDanh}** đến **${ngayVe}**!\n📦 Đã nhượng **${droppedTasks.length} chap** ra kho hàng Drop.`
        };
    } catch (err) {
        return { success: false, message: '❌ Lỗi xin nghỉ: ' + err.message };
    }
});

// --- KHO HÀNG DROP: Quét chuẩn xác từng dòng, chống mượn nhầm chap ---
// --- 1. KHO HÀNG DROP: Quét và lưu vào bộ nhớ tạm toàn cục ---
ipcMain.handle('get-dropped-tasks', async () => {
    try {
        if (!isDataLoaded) await taiDuLieuHeThong();
        const resWork = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Bang_Lam_Viec!A1:Z5000'
        });
        const rows = resWork.data.values || [];
        let droppedList = [];
        let runningTruyen = "";

        for (let i = 1; i < rows.length; i++) {
            let r = rows[i] || [];
            if (getCell(r, 0) !== "") runningTruyen = getCell(r, 0);
            else if (!getCell(r, 1) && !getCell(r, 3) && !getCell(r, 8) && !getCell(r, 13)) runningTruyen = "";
            if (!runningTruyen) continue;
            
            let chap = getCell(r, COL.CHAP);
            if (!chap || chap === "") continue;

            ROLES.forEach(role => {
                let worker = getCell(r, COL[role]);
                let doneVal = getCell(r, COL[`DONE_${role}`]).toLowerCase();
                let isDone = (doneVal === 'true' || doneVal === 'x');

                if (worker === "" && !isDone) {
                    let dlStr = getCell(r, COL[`DL_${role}`]);
                    droppedList.push({
                        id: `${xoaRac(runningTruyen).substring(0, 50)}_${String(chap).toLowerCase().trim()}_${role.toLowerCase()}_${i + 1}`,
                        rowIndex: i + 1,
                        role: role,
                        truyenRaw: runningTruyen,
                        chap: chap,
                        dlStr: dlStr || 'Chưa có'
                    });
                }
            });
        }

        // 🟢 Lưu trực tiếp danh sách quét được vào biến toàn cục để lệnh hốt nhận diện được
        global.currentDropList = droppedList;
        return { success: true, tasks: droppedList };
    } catch (err) {
        return { success: false, message: '❌ Lỗi quét kho Drop: ' + err.message };
    }
});

// --- HỐT HÀNG DROP: Điền tên lên Sheets và bắn thông báo lên kênh Nhận Deadline ---
ipcMain.handle('nhan-drop', async (event, { discordId, selectedIds }) => {
    try {
        if (!isDataLoaded) await taiDuLieuHeThong();
        const cleanId = String(discordId || '').replace(/['"\s]/g, '');
        const bietDanh = thanhVienMap[cleanId];
        if (!bietDanh) return { success: false, message: 'Lỗi: ID Discord chưa được đăng ký!' };

        let pool = (global.currentDropList && global.currentDropList.length > 0) ? global.currentDropList : global.droppedPool;
        
        let pickedRaw = [];
        pool.forEach(t => {
            if ((selectedIds || []).includes(t.id)) {
                pickedRaw.push(t);
            }
        });

        if (pickedRaw.length === 0) {
            return { success: false, message: '❌ Không tìm thấy dữ liệu chap trong kho Drop! Vui lòng bấm "Xem Hàng Đang Drop" lại trước khi hốt.' };
        }

        let dlStr = formatDL(new Date(layNgayVN().getTime() + 24 * 3600 * 1000));
        let dataToUpdateJob = [], resultStrs = [];

        for (let p of pickedRaw) {
            let tInfo = thongTinMap[xoaRac(p.truyenRaw)] || {};
            let salaryVal = p.role === 'TRANS' ? (tInfo.luongTrans || 0) : (p.role === 'CLEAN' ? (tInfo.luongClean || 0) : (tInfo.luongType || 0));
            let actualRowIndex = p.rowIndex;

            dataToUpdateJob.push(
                { range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL[p.role])}${actualRowIndex}`, values: [[bietDanh]] },
                { range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL['LUONG_' + p.role])}${actualRowIndex}`, values: [[salaryVal]] },
                { range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL['DL_' + p.role])}${actualRowIndex}`, values: [[dlStr]] }
            );
            resultStrs.push(`- **[${p.role}]** ${p.truyenRaw} (Chap ${p.chap})`);
        }

        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: process.env.SPREADSHEET_ID,
            requestBody: { valueInputOption: 'USER_ENTERED', data: dataToUpdateJob }
        });

        // 🟢 BẮN THÔNG BÁO LÊN KÊNH NHẬN DEADLINE TRÊN DISCORD
        let notifyMsg = `⚡ <@${cleanId}> (**${bietDanh}**) vừa hốt thành công các job Drop:\n${resultStrs.join('\n')}\n📅 Hạn DL mới: **${displayDL(dlStr)}**`;
        await guiThongBaoDiscord(process.env.CHANNEL_NHAN_DEADLINE, notifyMsg);

        return {
            success: true,
            message: `✅ **${bietDanh}** đã hốt thành công:\n${resultStrs.join('\n')}\n📅 Hạn DL mới: **${displayDL(dlStr)}**`
        };
    } catch (err) {
        return { success: false, message: '❌ Lỗi nhận hàng Drop: ' + err.message };
    }
});

// --- TAB 7: DỜI DEADLINE (DOIDL & DOIDL_TONG) ---
ipcMain.handle('doidl', async (event, payload) => {
    try {
        if (!isDataLoaded) await taiDuLieuHeThong();
        const discordId = String(payload.discordId || '').replace(/['"\s]/g, '');
        const bietDanh = thanhVienMap[discordId];
        if (!bietDanh) return { success: false, message: 'Lỗi: ID Discord chưa được đăng ký!' };

        const soNgay = parseInt(payload.soNgayDoi || payload.songay) || 1;
        const rawList = payload.selectedTasks || payload.taskIds || [];
        const targetValues = rawList.map(item => typeof item === 'string' ? item : item.id);

        if (targetValues.length === 0) return { success: false, message: '⚠️ Hãy tick chọn ít nhất 1 chap để dời hạn!' };

        const resWork = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Bang_Lam_Viec!A1:Z5000'
        });
        let rowMap = buildRowMap(resWork.data.values || []);
        let vnToday = layNgayVN();
        let dU = [], rD = [];
        let manualType = new Set(), delayedSet = new Set();

        for (let v of targetValues) {
            let t = rowMap[v];
            if (t) manualType.add(`${t.role}_${t.rowIndex}`);
        }

        for (let v of targetValues) {
            let target = rowMap[v];
            if (!target) continue;
            const { rowIndex: rI, r, truyenRaw, chap, role } = target;
            let dlStr = getCell(r, COL[`DL_${role}`]);
            let newDl = "";
            if (dlStr) {
                let dD = parseDL(dlStr, vnToday);
                if (dD) {
                    dD.setTime(dD.getTime() + soNgay * 86400000);
                    newDl = formatDL(dD);
                    dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL[`DL_${role}`])}${rI}`, values: [[newDl]] });
                }
            }
            rD.push(`- **[${role}]** ${truyenRaw} (C.${chap}): ➡️ **${displayDL(newDl)}**`);

            if (role === 'TRANS') {
                if (!manualType.has(`CLEAN_${rI}`) && !delayedSet.has(`CLEAN_${rI}`)) {
                    delayedSet.add(`CLEAN_${rI}`);
                    let dlC = getCell(r, COL.DL_CLEAN);
                    if (dlC) {
                        let dDc = parseDL(dlC, vnToday);
                        if (dDc) {
                            dDc.setTime(dDc.getTime() + soNgay * 86400000);
                            dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL.DL_CLEAN)}${rI}`, values: [[formatDL(dDc)]] });
                            rD.push(`  ↳ *(Kéo theo)* **[CLEAN]**`);
                        }
                    }
                }
                if (!manualType.has(`TYPE_${rI}`) && !delayedSet.has(`TYPE_${rI}`)) {
                    delayedSet.add(`TYPE_${rI}`);
                    let dlT = getCell(r, COL.DL_TYPE);
                    if (dlT) {
                        let dDt = parseDL(dlT, vnToday);
                        if (dDt) {
                            dDt.setTime(dDt.getTime() + soNgay * 86400000);
                            dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL.DL_TYPE)}${rI}`, values: [[formatDL(dDt)]] });
                            rD.push(`  ↳ *(Kéo theo)* **[TYPE]**`);
                        }
                    }
                }
            } else if (role === 'CLEAN') {
                if (!manualType.has(`TYPE_${rI}`) && !delayedSet.has(`TYPE_${rI}`)) {
                    delayedSet.add(`TYPE_${rI}`);
                    let dlT = getCell(r, COL.DL_TYPE);
                    if (dlT) {
                        let dDt = parseDL(dlT, vnToday);
                        if (dDt) {
                            dDt.setTime(dDt.getTime() + soNgay * 86400000);
                            dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL.DL_TYPE)}${rI}`, values: [[formatDL(dDt)]] });
                            rD.push(`  ↳ *(Kéo theo)* **[TYPE]**`);
                        }
                    }
                }
            }
        }

        let bD = bankDataMap[discordId];
        if (bD) {
            bD.doiDL += targetValues.length;
            dU.push({ range: `Thanh_Vien!${String.fromCharCode(65 + COL_TV.DOI_DL)}${bD.row}`, values: [[bD.doiDL]] });
        }

        if (dU.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: process.env.SPREADSHEET_ID,
                requestBody: { valueInputOption: 'USER_ENTERED', data: dU }
            });
        }
        await guiThongBaoDiscord(
            process.env.CHANNEL_DOI_DL,
            `⏰ <@${discordId}> (**${bietDanh}**) vừa dời hạn thêm **${soNgay} ngày**:\n${rD.join('\n')}`
        );
        return { success: true, message: `✅ Đã dời thành công thêm ${soNgay} ngày:\n${rD.join('\n')}` };
    } catch (err) {
        return { success: false, message: '❌ Lỗi dời Deadline: ' + err.message };
    }
});

ipcMain.handle('doidl_tong', async (event, arg) => {
    try {
        const soNgay = parseInt(typeof arg === 'object' ? arg.songay : arg) || 0;
        if (soNgay === 0) return { success: false, message: '❌ Số ngày dời phải khác 0!' };
        const resWork = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Bang_Lam_Viec!A1:Z5000'
        });
        const rows = resWork.data.values || [];
        let vnToday = layNgayVN(), dU = [], countUpdate = 0;

        for (let i = 1; i < rows.length; i++) {
            let r = rows[i] || [];
            ROLES.forEach(role => {
                let dlStr = getCell(r, COL[`DL_${role}`]);
                let doneStr = getCell(r, COL[`DONE_${role}`]);
                let isDone = doneStr && (doneStr.toLowerCase() === 'true' || doneStr.toLowerCase() === 'x');
                let assignee = getCell(r, COL[role]);
                if (assignee && dlStr && !isDone) {
                    let dlDate = parseDL(dlStr, vnToday);
                    if (dlDate) {
                        dlDate.setTime(dlDate.getTime() + soNgay * 24 * 3600 * 1000);
                        dU.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL[`DL_${role}`])}${i + 1}`, values: [[formatDL(dlDate)]] });
                        countUpdate++;
                    }
                }
            });
        }

        if (dU.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: process.env.SPREADSHEET_ID,
                requestBody: { valueInputOption: 'USER_ENTERED', data: dU }
            });
            
            return { success: true, message: `✅ **THÀNH CÔNG:** Đã dời đồng loạt **${countUpdate}** deadline thêm **${soNgay} ngày**!` };
        }
        return { success: true, message: `🤷 Hiện tại không có công việc nào đang chạy!` };
    } catch (err) {
        return { success: false, message: '❌ Lỗi dời DL tổng: ' + err.message };
    }
});

// --- CÁC TÍNH NĂNG MỞ RỘNG TỪ BOT: CHECK HẠN TỔNG, DỌN DẸP, ĐỒNG BỘ, NGÂN HÀNG, BXH, AI ---
ipcMain.handle('checkhan', async () => {
    try {
        const resWork = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Bang_Lam_Viec!A1:Z5000'
        });
        const rows = resWork.data.values || [];
        let vnToday = layNgayVN(), treDL = [], denHan = [], runningTruyen = "";

        for (let i = 1; i < rows.length; i++) {
            let r = rows[i] || [];
            if (getCell(r, 0) !== "") runningTruyen = getCell(r, 0);
            else if (!getCell(r, 1) && !getCell(r, 3) && !getCell(r, 8) && !getCell(r, 13)) runningTruyen = "";
            if (!runningTruyen) continue;
            let chap = layChapChuan(rows, i);

            ROLES.forEach(role => {
                let uN = getCell(r, COL[role]);
                let dlStr = getCell(r, COL[`DL_${role}`]);
                let d = getCell(r, COL[`DONE_${role}`]);
                if (uN && dlStr && !(d && (d.toLowerCase() === 'true' || d.toLowerCase() === 'x'))) {
                    let dlDate = parseDL(dlStr, vnToday);
                    if (dlDate) {
                        if (dlDate < vnToday) treDL.push(`- **${uN}**: ${runningTruyen} - C.${chap} (${role} - Hạn ${dlStr})`);
                        else if (
                            dlDate.getUTCFullYear() === vnToday.getUTCFullYear() &&
                            dlDate.getUTCMonth() === vnToday.getUTCMonth() &&
                            dlDate.getUTCDate() === vnToday.getUTCDate()
                        ) {
                            denHan.push(`- **${uN}**: ${runningTruyen} - C.${chap} (${role})`);
                        }
                    }
                }
            });
        }

        if (treDL.length === 0 && denHan.length === 0) return { success: true, message: "🎉 Không ai trễ hạn hoặc đến hạn hôm nay!" };
        let msg = `⏰ **TỔNG KẾT DEADLINE TOÀN TEAM (${layChuoiNgay(vnToday)})**\n\n`;
        if (treDL.length > 0) msg += `🚨 **DANH SÁCH TRỄ HẠN (${treDL.length}):**\n${treDL.join('\n')}\n\n`;
        if (denHan.length > 0) msg += `⚠️ **ĐẾN HẠN HÔM NAY (${denHan.length}):**\n${denHan.join('\n')}`;
        return { success: true, message: msg };
    } catch (err) {
        return { success: false, message: '❌ Lỗi kiểm tra hạn: ' + err.message };
    }
});

ipcMain.handle('dondep', async () => {
    try {
        const resWork = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Bang_Lam_Viec!A1:Z5000'
        });
        const rows = resWork.data.values || [];
        let blocks = [], start = -1;

        for (let i = 1; i < rows.length; i++) {
            let vA = getCell(rows[i] || [], 0), vB = getCell(rows[i] || [], 1), vC = getCell(rows[i] || [], 2);
            let isE = (vA === "" && vB === "" && vC === "" && getCell(rows[i] || [], 3) === "");
            if (vA !== "") {
                if (start !== -1) blocks.push({ s: start, e: i - 1 });
                start = i;
            } else if (isE) {
                if (start !== -1) { blocks.push({ s: start, e: i - 1 }); start = -1; }
            } else {
                if (start === -1) start = i;
            }
        }
        if (start !== -1) blocks.push({ s: start, e: rows.length - 1 });

        let dataToUpdateJob = [], total = 0;
        for (let b of blocks) {
            let kept = [], delCount = 0;
            for (let r = b.s; r <= b.e; r++) {
                let row = rows[r] || [];
                let status = getCell(row, 2).trim().toLowerCase();
                if (status === 'done qc') { delCount++; total++; }
                else kept.push(row);
            }
            if (delCount > 0) {
                let newValues = [];
                for (let i = 0; i < (b.e - b.s + 1); i++) {
                    let rd = [];
                    if (i < kept.length) {
                        for (let c = 1; c <= 25; c++) rd.push(kept[i][c] !== undefined ? kept[i][c] : "");
                    } else {
                        rd = Array(25).fill("");
                    }
                    newValues.push(rd);
                }
                dataToUpdateJob.push({ range: `Bang_Lam_Viec!B${b.s + 1}:Z${b.e + 1}`, values: newValues });
            }
        }

        if (dataToUpdateJob.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: process.env.SPREADSHEET_ID,
                requestBody: { valueInputOption: 'USER_ENTERED', data: dataToUpdateJob }
            });
            return { success: true, message: `✅ **DỌN DẸP HOÀN TẤT!**\n🧹 Đã xóa và đẩy lên thành công **${total} chap** ("Done QC").` };
        }
        return { success: true, message: `🤷 Không tìm thấy chap nào mang trạng thái "Done QC" để dọn dẹp!` };
    } catch (err) {
        return { success: false, message: '❌ Lỗi dọn dẹp: ' + err.message };
    }
});

ipcMain.handle('dongbo', async () => {
    try {
        if (!isDataLoaded) await taiDuLieuHeThong();
        const resWork = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Bang_Lam_Viec!A1:Z5000'
        });
        const rows = resWork.data.values || [];
        let dataToUpdate = [], updatedRowsCount = 0, runningTruyen = "";

        for (let i = 1; i < rows.length; i++) {
            let r = rows[i] || [];
            if (getCell(r, 0) !== "") runningTruyen = getCell(r, 0);
            else if (!getCell(r, 3) && !getCell(r, 8) && !getCell(r, 13)) runningTruyen = "";
            if (!runningTruyen) continue;
            const thongTin = thongTinMap[xoaRac(runningTruyen)];
            if (!thongTin || !getCell(r, COL.CHAP)) continue;

            let rowUpdated = false;
            let transName = getCell(r, COL.TRANS);
            if (transName && getCell(r, COL.LUONG_TRANS) === "" && thongTin.luongTrans > 0) {
                dataToUpdate.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL.LUONG_TRANS)}${i + 1}`, values: [[thongTin.luongTrans]] });
                rowUpdated = true;
            }
            let cleanName = getCell(r, COL.CLEAN);
            if (cleanName && getCell(r, COL.LUONG_CLEAN) === "" && thongTin.luongClean > 0) {
                dataToUpdate.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL.LUONG_CLEAN)}${i + 1}`, values: [[thongTin.luongClean]] });
                rowUpdated = true;
            } else if (!cleanName && transName && thongTin.cleanChinh) {
                dataToUpdate.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL.CLEAN)}${i + 1}`, values: [[thongTin.cleanChinh]] });
                if (thongTin.luongClean > 0) dataToUpdate.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL.LUONG_CLEAN)}${i + 1}`, values: [[thongTin.luongClean]] });
                rowUpdated = true;
            }
            let typeName = getCell(r, COL.TYPE);
            if (typeName && getCell(r, COL.LUONG_TYPE) === "" && thongTin.luongType > 0) {
                dataToUpdate.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL.LUONG_TYPE)}${i + 1}`, values: [[thongTin.luongType]] });
                rowUpdated = true;
            } else if (!typeName && transName && thongTin.typeChinh) {
                dataToUpdate.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL.TYPE)}${i + 1}`, values: [[thongTin.typeChinh]] });
                if (thongTin.luongType > 0) dataToUpdate.push({ range: `Bang_Lam_Viec!${String.fromCharCode(65 + COL.LUONG_TYPE)}${i + 1}`, values: [[thongTin.luongType]] });
                rowUpdated = true;
            }
            if (rowUpdated) updatedRowsCount++;
        }

        if (dataToUpdate.length > 0) {
            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: process.env.SPREADSHEET_ID,
                requestBody: { valueInputOption: 'USER_ENTERED', data: dataToUpdate }
            });
        }
        return { success: true, message: `✅ **ĐỒNG BỘ XONG!** Đã tự động điền bù Lương/Thầu chính cho **${updatedRowsCount}** dòng.` };
    } catch (err) {
        return { success: false, message: '❌ Lỗi đồng bộ: ' + err.message };
    }
});

ipcMain.handle('nganhang', async (event, arg) => {
    if (!isDataLoaded) await taiDuLieuHeThong();
    const rawId = typeof arg === 'string' ? arg : (arg && arg.discordId ? arg.discordId : '');
    const cleanId = String(rawId).replace(/['"\s]/g, '');
    const bietDanh = thanhVienMap[cleanId];
    let bData = bankDataMap[cleanId];
    if (!bietDanh || !bData) return { success: false, message: 'Lỗi: ID Discord chưa được đăng ký!' };
    let blData = bangLuongMap[bietDanh.toLowerCase()];
    return {
        success: true,
        message: `💳 **THẺ THÀNH VIÊN: ${bietDanh}**\n📈 Lương Bảng Lương: **${blData ? blData.luongCuoi : "0"}**\n💰 Lương tích lũy: **${bData.luong.toLocaleString()} đ**\n🪙 Xu: **${bData.xu}** | 🔥 Chuỗi: **${bData.chuoi}**\n⏰ Trễ DL: **${bData.treDL} lần** | 📅 Dời DL: **${bData.doiDL} lần**`
    };
});

ipcMain.handle('bangxephang', async () => {
    if (!isDataLoaded) await taiDuLieuHeThong();
    let sortedList = [...bangLuongList].sort((a, b) => b.soChap - a.soChap).slice(0, 10);
    let msg = `🏆 **BẢNG XẾP HẠNG TOP 10** 🏆\n\n`;
    sortedList.forEach((item, index) => {
        msg += `**#${index + 1}** ${item.tenHienThi} — **${item.soChap} job** (Lương: ${item.luongCuoi})\n`;
    });
    return { success: true, message: msg };
});

ipcMain.handle('ai', async (event, { cauhoi }) => {
    try {
        if (!genAI) return { success: false, message: '❌ Chưa cấu hình GEMINI_API_KEY trong file .env!' };
        const result = await genAI.getGenerativeModel({ model: "gemini-3.8-flash" }).generateContent(cauhoi);
        return { success: true, message: (await result.response).text() };
    } catch (err) {
        return { success: false, message: '❌ Lỗi AI: ' + err.message };
    }
});

ipcMain.handle('dichthu', async (event, { doanvan, ghichu }) => {
    try {
        if (!genAI) return { success: false, message: '❌ Chưa cấu hình GEMINI_API_KEY trong file .env!' };
        const prompt = `Dịch đoạn văn RAW manga/manhwa sau sang tiếng Việt tự nhiên:\nRAW: "${doanvan}"\nNgữ cảnh: "${ghichu || 'Không có'}"`;
        const result = await genAI.getGenerativeModel({ model: "gemini-3.8-flash" }).generateContent(prompt);
        return { success: true, message: (await result.response).text() };
    } catch (err) {
        return { success: false, message: '❌ Lỗi dịch thuật AI: ' + err.message };
    }
});
// Thêm vào trong main.js
ipcMain.handle('chonAnhRaw', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    });
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});
ipcMain.handle('docraw', async (event, { filePath, note }) => {
    try {
        if (!genAI) return { success: false, message: '❌ Chưa cấu hình GEMINI_API_KEY trong file .env!' };
        if (!filePath) return { success: false, message: '❌ Vui lòng chọn file hình ảnh RAW!' };
        
        const imgBase64 = fs.readFileSync(filePath).toString('base64');
        let mime = 'image/png';
        if (filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.jpeg')) mime = 'image/jpeg';
        else if (filePath.toLowerCase().endsWith('.webp')) mime = 'image/webp';

        // 🟢 Tạo câu lệnh prompt thông minh kết hợp ghi chú của sếp
        let promptText = "Đọc văn bản trong ảnh RAW này (bao gồm bong bóng thoại, box tự sự, SFX) và dịch thô sang tiếng Việt theo từng khu vực rõ ràng.";
        if (note && note.trim() !== "") {
            promptText += `\n\n📌 GHI CHÚ / HƯỚNG DẪN TỪ QUẢN TRỊ VIÊN:\n"${note.trim()}"\nHãy đặc biệt lưu ý và ưu tiên thực hiện theo hướng dẫn này khi phân tích và dịch ảnh!`;
        }

        const result = await genAI.getGenerativeModel({ model: "gemini-3.8-flash" }).generateContent([
            promptText,
            { inlineData: { data: imgBase64, mimeType: mime } }
        ]);

        return { success: true, message: (await result.response).text() };
    } catch (err) {
        return { success: false, message: '❌ Lỗi đọc ảnh RAW: ' + err.message };
    }
});