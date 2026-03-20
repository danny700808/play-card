const SPREADSHEET_ID = "1krXrvAcpzG0AzvisELlV5wuQyoJDXK2pZPJXyUKtcVI";
const TIMEZONE = "Asia/Taipei";

const SHEETS = {
  employees: "員工資料",
  clock: "打卡紀錄",
  clockFail: "打卡失敗紀錄",
  leaveRequests: "請假申請",
  leaveRecords: "請假紀錄",
  parttime: "工讀時數",
  tasks: "交辦事項",
  taskDone: "任務完成紀錄",
  settings: "系統設定",
  monthlyReportLog: "月報寄送紀錄",
  parttimeMonthlyReportLog: "工讀時數月報寄送紀錄",
  routineTemplates: "定期事項設定",
  routineLogs: "定期事項紀錄",
  trainingCategories: "教育訓練分類",
  trainingItems: "教育訓練教材"
};

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = sanitize_(p.action);

    if (action === 'approveRegistration' && typeof approveRegistration_ === 'function') {
      return htmlMessage_(approveRegistration_(p));
    }
    if (action === 'approveLeave' && typeof approveLeave_ === 'function') {
      return htmlMessage_(approveLeave_(p));
    }
    if (action === 'rejectLeave' && typeof rejectLeave_ === 'function') {
      return htmlMessage_(rejectLeave_(p));
    }

    return jsonOut_({ ok: true, message: 'employee-system-api' });
  } catch (err) {
    return htmlMessage_({ ok: false, title: '系統錯誤', message: err.message || String(err) });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = sanitize_(data.action);

    switch (action) {
      case 'register': return jsonOut_(registerUser_(data));
      case 'login': return jsonOut_(loginUser_(data));
      case 'forgotPassword': return jsonOut_(forgotPassword_(data));

      case 'getPendingRegistrations': return jsonOut_(getPendingRegistrations_(data));
      case 'approveRegistrationApi': return jsonOut_(approveRegistrationApi_(data));
      case 'rejectRegistrationApi': return jsonOut_(rejectRegistrationApi_(data));

      case 'getEmployeeOptions': return jsonOut_(getEmployeeOptions_(data));
      case 'getTasks': return jsonOut_(getTasks_(data));
      case 'createTask': return jsonOut_(createTask_(data));
      case 'deleteTask': return jsonOut_(deleteTask_(data));
      case 'completeTask': return jsonOut_(completeTask_(data));

      case 'getTrainingCategories': return jsonOut_(getTrainingCategories_(data));
      case 'getTrainingPageData': return jsonOut_(getTrainingPageData_(data));
      case 'saveTrainingItem': return jsonOut_(saveTrainingItem_(data));
      case 'saveTrainingVideoLink': return jsonOut_(saveTrainingVideoLink_(data));
      case 'startTrainingVideoUpload': return jsonOut_(startTrainingVideoUpload_(data));
      case 'uploadTrainingVideoChunk': return jsonOut_(uploadTrainingVideoChunk_(data));
      case 'finishTrainingVideoUpload': return jsonOut_(finishTrainingVideoUpload_(data));
      case 'toggleTrainingItem': return jsonOut_(toggleTrainingItem_(data));

      default:
        return jsonOut_({ ok: false, message: '未知 action：' + action });
    }
  } catch (err) {
    return jsonOut_({ ok: false, message: err.message || String(err) });
  }
}

//////////////////////////////////////////////////
// 共用工具
//////////////////////////////////////////////////

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj || {}))
    .setMimeType(ContentService.MimeType.JSON);
}

function htmlMessage_(result) {
  const ok = !!(result && result.ok);
  const title = escHtml_((result && result.title) || (ok ? '處理完成' : '處理失敗'));
  const message = escHtml_((result && result.message) || '');
  const color = ok ? '#1f7a5a' : '#b42318';
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + title + '</title>'
    + '<style>body{font-family:Arial,"Noto Sans TC",sans-serif;background:#f6f8fb;padding:24px;color:#111827}'
    + '.box{max-width:620px;margin:30px auto;background:#fff;border-radius:18px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.06)}'
    + 'h1{margin:0 0 12px;font-size:24px;color:' + color + '}p{margin:0;line-height:1.8;white-space:pre-wrap}</style></head>'
    + '<body><div class="box"><h1>' + title + '</h1><p>' + message + '</p></div></body></html>';
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function sanitize_(v) {
  return String(v == null ? '' : v).trim();
}

function escHtml_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function now_() {
  return new Date();
}

function uuid_(prefix) {
  return (prefix || 'ID_') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

function boolYes_(v) {
  return String(v || '').toLowerCase() === 'true' || v === true || v === '是' || v === 'yes';
}

function yesNo_(v) {
  return boolYes_(v) ? '是' : '否';
}

function fmtDate_(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (String(d) === 'Invalid Date') return String(v || '');
  return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
}

function fmtDateTime_(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (String(d) === 'Invalid Date') return String(v || '');
  return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

function todayKey_() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
}

function ss_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('找不到工作表：' + name);
  return sh;
}

function ensureSheet_(name, headers) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (headers && headers.length && sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

function headerMap_(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) {
    return String(x || '').trim();
  });
  const map = {};
  headers.forEach(function (h, i) { map[h] = i; });
  return { headers: headers, map: map };
}

function rowObjFromValues_(row, headers) {
  const out = {};
  headers.forEach(function (h, i) { out[h] = row[i]; });
  return out;
}

function findRowByValue_(sh, colIndex, value) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  const values = sh.getRange(2, colIndex, lastRow - 1, 1).getValues();
  const target = String(value == null ? '' : value).trim().toLowerCase();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] == null ? '' : values[i][0]).trim().toLowerCase() === target) {
      return i + 2;
    }
  }
  return 0;
}

function getSystemSetting_(name, fallback) {
  try {
    const sh = sheet_(SHEETS.settings);
    const values = sh.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0] || '').trim() === String(name || '').trim()) {
        return values[i][1];
      }
    }
  } catch (e) {}
  return fallback;
}

//////////////////////////////////////////////////
// 員工 / 登入 / 註冊
//////////////////////////////////////////////////

function employeeSheetMeta_() {
  const sh = sheet_(SHEETS.employees);
  const meta = headerMap_(sh);
  return { sh: sh, headers: meta.headers, map: meta.map };
}

function employeeToUser_(obj) {
  return {
    id: obj['員工ID'] || '',
    name: obj['姓名'] || '',
    email: obj['Email'] || '',
    role: String(obj['角色'] || 'staff').trim() || 'staff',
    isPartTime: String(obj['是否工讀生'] || '').toLowerCase() === 'yes' || obj['是否工讀生'] === '是',
    showSettingsZone: boolYes_(obj['是否顯示設定區'])
  };
}

function findEmployeeByEmail_(email) {
  const meta = employeeSheetMeta_();
  const rowIndex = findRowByValue_(meta.sh, meta.map['Email'] + 1, email);
  if (!rowIndex) return null;
  const row = meta.sh.getRange(rowIndex, 1, 1, meta.headers.length).getValues()[0];
  const obj = rowObjFromValues_(row, meta.headers);
  obj.__rowIndex = rowIndex;
  return obj;
}

function registerUser_(data) {
  const name = sanitize_(data.name);
  const email = sanitize_(data.email).toLowerCase();
  const idNumber = sanitize_(data.idNumber).toUpperCase();
  const birthDate = sanitize_(data.birthDate);
  const emergencyContact = sanitize_(data.emergencyContact);
  const emergencyPhone = sanitize_(data.emergencyPhone);
  const password = String(data.password || '');
  const isPartTime = boolYes_(data.isPartTime);

  if (!name || !email || !idNumber || !birthDate || !emergencyContact || !emergencyPhone || !password) {
    return { ok: false, message: '註冊資料不完整，請重新檢查。' };
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password) || password.length < 8) {
    return { ok: false, message: '密碼需為英文加數字，8 碼以上。' };
  }

  const meta = employeeSheetMeta_();
  const existed = findEmployeeByEmail_(email);
  const status = existed ? String(existed['帳號狀態'] || '').trim().toLowerCase() : '';

  if (existed && status === 'active') {
    return { ok: false, message: '這個 Email 已經註冊過了，請直接登入。' };
  }

  const values = new Array(meta.headers.length).fill('');
  const set = function (name, value) {
    if (meta.map[name] != null) values[meta.map[name]] = value;
  };

  set('員工ID', existed ? (existed['員工ID'] || uuid_('EMP_')) : uuid_('EMP_'));
  set('姓名', name);
  set('Email', email);
  set('密碼', password);
  set('角色', existed ? (existed['角色'] || 'staff') : 'staff');
  set('是否工讀生', isPartTime ? 'yes' : 'no');
  set('帳號狀態', 'pending');
  set('建立時間', existed ? (existed['建立時間'] || now_()) : now_());
  set('最後登入時間', existed ? (existed['最後登入時間'] || '') : '');
  set('身分證字號', idNumber);
  set('出生年月日', birthDate ? new Date(birthDate + 'T00:00:00') : '');
  set('緊急聯絡人', emergencyContact);
  set('緊急聯絡人電話', emergencyPhone);
  if (meta.map['是否顯示設定區'] != null && !existed) set('是否顯示設定區', '');

  if (existed && existed.__rowIndex) {
    meta.sh.getRange(existed.__rowIndex, 1, 1, meta.headers.length).setValues([values]);
  } else {
    meta.sh.appendRow(values);
  }

  return { ok: true, message: '註冊申請已送出，請等待主管審核。' };
}

function loginUser_(data) {
  const email = sanitize_(data.email).toLowerCase();
  const password = String(data.password || '');

  if (!email || !password) return { ok: false, message: '請輸入 Email 與密碼。' };

  const meta = employeeSheetMeta_();
  const emp = findEmployeeByEmail_(email);
  if (!emp) return { ok: false, message: '查無此帳號，請先註冊。' };

  const status = String(emp['帳號狀態'] || '').trim().toLowerCase();
  if (status === 'pending') return { ok: false, message: '此帳號尚未通過主管審核。' };
  if (status && status !== 'active') return { ok: false, message: '此帳號目前無法登入。' };

  if (String(emp['密碼'] || '') !== password) {
    return { ok: false, message: '密碼錯誤，請重新輸入。' };
  }

  if (meta.map['最後登入時間'] != null && emp.__rowIndex) {
    meta.sh.getRange(emp.__rowIndex, meta.map['最後登入時間'] + 1).setValue(now_());
  }

  return {
    ok: true,
    message: '登入成功',
    user: employeeToUser_(emp)
  };
}

function forgotPassword_(data) {
  const email = sanitize_(data.email).toLowerCase();
  if (!email) return { ok: false, message: '請先輸入 Email。' };

  const emp = findEmployeeByEmail_(email);
  if (!emp) return { ok: false, message: '查無此 Email。' };

  const status = String(emp['帳號狀態'] || '').trim().toLowerCase();
  if (status !== 'active') {
    return { ok: false, message: '這個帳號尚未啟用，暫時不能寄送密碼。' };
  }

  const password = String(emp['密碼'] || '');
  try {
    MailApp.sendEmail({
      to: email,
      subject: '柚子員工系統｜密碼提醒',
      htmlBody: '<div style="font-family:Arial,Noto Sans TC,sans-serif;line-height:1.8">'
        + '<p>' + escHtml_(emp['姓名'] || '您好') + '：</p>'
        + '<p>你的登入密碼是：<strong>' + escHtml_(password) + '</strong></p>'
        + '<p>請登入後妥善保管。</p></div>'
    });
    return { ok: true, message: '密碼已寄到你的 Email。' };
  } catch (err) {
    return { ok: false, message: '寄送失敗：' + (err.message || String(err)) };
  }
}

function getPendingRegistrations_(data) {
  const me = requireAdminByUserId_(data.userId);
  const meta = employeeSheetMeta_();
  const values = meta.sh.getDataRange().getValues();
  const rows = [];
  for (var i = 1; i < values.length; i++) {
    const obj = rowObjFromValues_(values[i], meta.headers);
    if (String(obj['帳號狀態'] || '').trim().toLowerCase() !== 'pending') continue;
    rows.push({
      id: obj['員工ID'] || '',
      name: obj['姓名'] || '',
      email: obj['Email'] || '',
      isPartTime: String(obj['是否工讀生'] || '').toLowerCase() === 'yes' || obj['是否工讀生'] === '是',
      idNumber: obj['身分證字號'] || '',
      birthDate: fmtDate_(obj['出生年月日']),
      emergencyContact: obj['緊急聯絡人'] || '',
      emergencyPhone: obj['緊急聯絡人電話'] || '',
      createdAt: fmtDateTime_(obj['建立時間'])
    });
  }
  return { ok: true, rows: rows, list: rows, message: rows.length ? '' : '目前沒有待審核註冊' };
}

function approveRegistrationApi_(data) {
  requireAdminByUserId_(data.userId);
  const email = sanitize_(data.email).toLowerCase();
  const emp = findEmployeeByEmail_(email);
  if (!emp || !emp.__rowIndex) return { ok: false, message: '找不到這筆註冊申請。' };

  const meta = employeeSheetMeta_();
  if (meta.map['帳號狀態'] != null) meta.sh.getRange(emp.__rowIndex, meta.map['帳號狀態'] + 1).setValue('active');
  if (meta.map['角色'] != null && !sanitize_(emp['角色'])) meta.sh.getRange(emp.__rowIndex, meta.map['角色'] + 1).setValue('staff');

  return { ok: true, message: '已同意註冊。' };
}

function rejectRegistrationApi_(data) {
  requireAdminByUserId_(data.userId);
  const email = sanitize_(data.email).toLowerCase();
  const emp = findEmployeeByEmail_(email);
  if (!emp || !emp.__rowIndex) return { ok: false, message: '找不到這筆註冊申請。' };

  const meta = employeeSheetMeta_();
  if (meta.map['帳號狀態'] != null) meta.sh.getRange(emp.__rowIndex, meta.map['帳號狀態'] + 1).setValue('rejected');

  return { ok: true, message: '已駁回註冊。' };
}

function approveRegistration_(p) {
  return approveRegistrationApi_({ userId: p.userId, email: p.email });
}

//////////////////////////////////////////////////
// 權限
//////////////////////////////////////////////////

function requireUserById_(userId) {
  const id = sanitize_(userId);
  if (!id) throw new Error('缺少 userId');
  const meta = employeeSheetMeta_();
  const rowIndex = findRowByValue_(meta.sh, meta.map['員工ID'] + 1, id);
  if (!rowIndex) throw new Error('找不到使用者');
  const row = meta.sh.getRange(rowIndex, 1, 1, meta.headers.length).getValues()[0];
  const obj = rowObjFromValues_(row, meta.headers);
  obj.__rowIndex = rowIndex;
  return obj;
}

function requireAdminByUserId_(userId) {
  const user = requireUserById_(userId);
  const role = String(user['角色'] || '').trim().toLowerCase();
  const allow = role === 'admin' || boolYes_(user['是否顯示設定區']);
  if (!allow) throw new Error('你沒有權限執行這個操作');
  return user;
}

//////////////////////////////////////////////////
// 員工選單 / 任務
//////////////////////////////////////////////////

function getEmployeeOptions_(data) {
  requireAdminByUserId_(data.userId || data.adminId || data.requestUserId || findFirstAdminId_());
  const meta = employeeSheetMeta_();
  const values = meta.sh.getDataRange().getValues();
  const rows = [];
  for (var i = 1; i < values.length; i++) {
    const obj = rowObjFromValues_(values[i], meta.headers);
    if (String(obj['帳號狀態'] || '').trim().toLowerCase() !== 'active') continue;
    rows.push({
      id: obj['員工ID'] || '',
      name: obj['姓名'] || '',
      email: obj['Email'] || '',
      isPartTime: String(obj['是否工讀生'] || '').toLowerCase() === 'yes' || obj['是否工讀生'] === '是'
    });
  }
  return { ok: true, rows: rows };
}

function findFirstAdminId_() {
  const meta = employeeSheetMeta_();
  const values = meta.sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    const obj = rowObjFromValues_(values[i], meta.headers);
    if (String(obj['角色'] || '').trim().toLowerCase() === 'admin') return obj['員工ID'] || '';
  }
  return '';
}

function taskSheetMeta_() {
  const sh = ensureSheet_(SHEETS.tasks, ['任務ID', '標題', '內容', '指派員工ID', '指派員工姓名', '指派員工Email', '截止日期', '截止時間', '完成回報需求', '提醒頻率', '狀態', '建立時間', '建立者ID', '建立者姓名', '任務圖片檔名', '任務圖片網址', '任務錄音檔名', '任務錄音網址', '期限模式', '期限標籤', '完成時間']);
  const meta = headerMap_(sh);
  return { sh: sh, headers: meta.headers, map: meta.map };
}

function taskDoneSheetMeta_() {
  const sh = ensureSheet_(SHEETS.taskDone, ['完成ID', '任務ID', '員工ID', '姓名', 'Email', '完成時間', '完成備註', '完成照片檔名', '完成照片網址', '完成錄音檔名', '完成錄音網址']);
  const meta = headerMap_(sh);
  return { sh: sh, headers: meta.headers, map: meta.map };
}

function taskRowToClient_(obj) {
  return {
    id: obj['任務ID'] || '',
    title: obj['標題'] || '',
    content: obj['內容'] || '',
    assigneeId: obj['指派員工ID'] || '',
    assigneeName: obj['指派員工姓名'] || '',
    assigneeEmail: obj['指派員工Email'] || '',
    dueDate: fmtDate_(obj['截止日期']),
    dueTime: obj['截止時間'] ? Utilities.formatDate(new Date('1970-01-01T' + Utilities.formatDate(new Date(obj['截止時間']), TIMEZONE, 'HH:mm:ss')), TIMEZONE, 'HH:mm') : String(obj['截止時間'] || '').slice(0,5),
    requirePhotoReturn: obj['完成回報需求'] || '否',
    remindFreq: obj['提醒頻率'] || '',
    status: obj['狀態'] || '待處理',
    createdAt: fmtDateTime_(obj['建立時間']),
    createdById: obj['建立者ID'] || '',
    createdByName: obj['建立者姓名'] || '',
    taskImageUrl: obj['任務圖片網址'] || '',
    taskAudioUrl: obj['任務錄音網址'] || '',
    dueMode: obj['期限模式'] || '',
    dueLabel: obj['期限標籤'] || '',
    completedAt: fmtDateTime_(obj['完成時間'])
  };
}

function getTasks_(data) {
  const user = requireUserById_(data.userId);
  const role = sanitize_(data.role).toLowerCase();
  const meta = taskSheetMeta_();
  const values = meta.sh.getDataRange().getValues();
  const rows = [];

  for (var i = 1; i < values.length; i++) {
    const obj = rowObjFromValues_(values[i], meta.headers);
    if (!sanitize_(obj['任務ID'])) continue;

    if (role === 'admin') {
      if (!(String(user['角色'] || '').trim().toLowerCase() === 'admin' || boolYes_(user['是否顯示設定區']))) {
        throw new Error('沒有管理任務權限');
      }
      rows.push(taskRowToClient_(obj));
    } else {
      const sameId = String(obj['指派員工ID'] || '') === String(user['員工ID'] || '');
      const sameEmail = String(obj['指派員工Email'] || '').trim().toLowerCase() === String(user['Email'] || '').trim().toLowerCase();
      if (sameId || sameEmail) rows.push(taskRowToClient_(obj));
    }
  }

  rows.sort(function (a, b) {
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });

  return { ok: true, rows: rows };
}

function createTask_(data) {
  const admin = requireAdminByUserId_(data.creatorId);
  const assigneeId = sanitize_(data.assigneeId);
  const title = sanitize_(data.title);
  if (!assigneeId || !title) return { ok: false, message: '請先輸入標題並選擇員工。' };

  const assignee = requireUserById_(assigneeId);
  const meta = taskSheetMeta_();
  const row = new Array(meta.headers.length).fill('');
  const set = function (name, value) { if (meta.map[name] != null) row[meta.map[name]] = value; };

  let imageInfo = { name: '', url: sanitize_(data.taskImageUrl || '') };
  let audioInfo = { name: '', url: sanitize_(data.taskAudioUrl || '') };
  if (!imageInfo.url && sanitize_(data.taskImage)) imageInfo = saveDataUrlToDrive_(data.taskImage, 'task_image_' + Date.now() + '.jpg', taskFolder_());
  if (!audioInfo.url && sanitize_(data.taskAudio)) audioInfo = saveDataUrlToDrive_(data.taskAudio, 'task_audio_' + Date.now() + '.webm', taskFolder_());

  set('任務ID', uuid_('TSK_'));
  set('標題', title);
  set('內容', sanitize_(data.content));
  set('指派員工ID', assignee['員工ID'] || '');
  set('指派員工姓名', assignee['姓名'] || '');
  set('指派員工Email', assignee['Email'] || '');
  set('截止日期', sanitize_(data.dueDate) ? new Date(sanitize_(data.dueDate) + 'T00:00:00') : '');
  set('截止時間', sanitize_(data.dueTime));
  set('完成回報需求', yesNo_(data.requirePhotoReturn));
  set('提醒頻率', sanitize_(data.remindFreq));
  set('狀態', '待處理');
  set('建立時間', now_());
  set('建立者ID', admin['員工ID'] || '');
  set('建立者姓名', admin['姓名'] || '');
  set('任務圖片檔名', imageInfo.name);
  set('任務圖片網址', imageInfo.url);
  set('任務錄音檔名', audioInfo.name);
  set('任務錄音網址', audioInfo.url);
  set('期限模式', sanitize_(data.dueMode));
  set('期限標籤', sanitize_(data.dueLabel));
  set('完成時間', '');

  meta.sh.appendRow(row);
  return { ok: true, message: '任務已建立。' };
}

function deleteTask_(data) {
  requireAdminByUserId_(data.userId);
  const taskId = sanitize_(data.taskId);
  const meta = taskSheetMeta_();
  const rowIndex = findRowByValue_(meta.sh, meta.map['任務ID'] + 1, taskId);
  if (!rowIndex) return { ok: false, message: '找不到任務。' };
  meta.sh.deleteRow(rowIndex);
  return { ok: true, message: '任務已刪除。' };
}

function completeTask_(data) {
  const user = requireUserById_(data.userId);
  const taskId = sanitize_(data.taskId);
  const taskMeta = taskSheetMeta_();
  const rowIndex = findRowByValue_(taskMeta.sh, taskMeta.map['任務ID'] + 1, taskId);
  if (!rowIndex) return { ok: false, message: '找不到任務。' };

  const row = taskMeta.sh.getRange(rowIndex, 1, 1, taskMeta.headers.length).getValues()[0];
  const obj = rowObjFromValues_(row, taskMeta.headers);
  const taskAssigneeId = String(obj['指派員工ID'] || '');
  const taskAssigneeEmail = String(obj['指派員工Email'] || '').trim().toLowerCase();
  const meId = String(user['員工ID'] || '');
  const meEmail = String(user['Email'] || '').trim().toLowerCase();
  if (taskAssigneeId !== meId && taskAssigneeEmail !== meEmail) {
    return { ok: false, message: '這筆任務不是指派給你的。' };
  }

  const photoUrls = Array.isArray(data.photoUrls) ? data.photoUrls.map(function (x) { return sanitize_(x); }).filter(Boolean) : [];
  const photos = Array.isArray(data.photos) ? data.photos : [];
  const folder = taskFolder_();
  const uploaded = photoUrls.length
    ? photoUrls.map(function (url, idx) { return { name: 'cloudinary_task_' + (idx + 1), url: url }; })
    : photos.map(function (d, idx) {
        return saveDataUrlToDrive_(d, 'task_' + taskId + '_' + (idx + 1) + '_' + Date.now() + '.jpg', folder);
      });

  if (taskMeta.map['狀態'] != null) taskMeta.sh.getRange(rowIndex, taskMeta.map['狀態'] + 1).setValue('已完成');
  if (taskMeta.map['完成時間'] != null) taskMeta.sh.getRange(rowIndex, taskMeta.map['完成時間'] + 1).setValue(now_());

  const doneMeta = taskDoneSheetMeta_();
  const doneRow = new Array(doneMeta.headers.length).fill('');
  const set = function (name, value) { if (doneMeta.map[name] != null) doneRow[doneMeta.map[name]] = value; };
  set('完成ID', uuid_('DONE_'));
  set('任務ID', taskId);
  set('員工ID', user['員工ID'] || '');
  set('姓名', user['姓名'] || '');
  set('Email', user['Email'] || '');
  set('完成時間', now_());
  set('完成備註', sanitize_(data.note));
  set('完成照片檔名', uploaded.map(function (x) { return x.name; }).join('\n'));
  set('完成照片網址', uploaded.map(function (x) { return x.url; }).join('\n'));
  set('完成錄音檔名', '');
  set('完成錄音網址', '');
  doneMeta.sh.appendRow(doneRow);

  return { ok: true, message: '完成任務送出成功。' };
}

function taskFolder_() {
  const folderId = sanitize_(getSystemSetting_('任務附件資料夾ID', ''));
  if (folderId) {
    try { return DriveApp.getFolderById(folderId); } catch (e) {}
  }
  return getOrCreateRootFolder_('員工系統_任務附件');
}

//////////////////////////////////////////////////
// 教育訓練
//////////////////////////////////////////////////

function getTrainingCategories_(data) {
  try {
    const includeDisabled = boolYes_(data && data.includeDisabled);
    const rows = _trainingReadCategoryRows_();

    const categories = rows
      .filter(function (r) { return includeDisabled || r.enabled; })
      .sort(function (a, b) {
        return (a.sortOrder - b.sortOrder) || String(a.name).localeCompare(String(b.name), 'zh-Hant');
      });

    return {
      ok: true,
      categories: categories,
      list: categories,
      trainingCategories: categories
    };
  } catch (err) {
    return {
      ok: false,
      message: err.message || String(err),
      categories: [],
      list: [],
      trainingCategories: []
    };
  }
}

function getTrainingPageData_(data) {
  try {
    const includeDisabled = boolYes_(data && data.includeDisabled) || boolYes_(data && data.adminMode);

    const categories = _trainingReadCategoryRows_()
      .filter(function (r) { return includeDisabled || r.enabled; })
      .sort(function (a, b) {
        return (a.sortOrder - b.sortOrder) || String(a.name).localeCompare(String(b.name), 'zh-Hant');
      });

    const categoryMap = {};
    categories.forEach(function (c) { categoryMap[c.id] = c; });

    const items = _trainingReadItemRows_()
      .filter(function (r) {
        if (!includeDisabled && !r.enabled) return false;
        if (!r.categoryId) return false;
        if (!includeDisabled && !categoryMap[r.categoryId]) return false;
        return true;
      })
      .map(function (r) {
        return Object.assign({}, r, { categoryName: (categoryMap[r.categoryId] || {}).name || '' });
      })
      .sort(function (a, b) {
        const ca = (categoryMap[a.categoryId] || {}).sortOrder || 999999;
        const cb = (categoryMap[b.categoryId] || {}).sortOrder || 999999;
        return ca - cb || a.sortOrder - b.sortOrder;
      });

    return {
      ok: true,
      categories: categories,
      items: items,
      list: categories,
      trainingCategories: categories,
      trainingItems: items,
      trainingItemCount: items.length
    };
  } catch (err) {
    return {
      ok: false,
      message: err.message || String(err),
      categories: [],
      items: [],
      trainingItemCount: 0
    };
  }
}

function saveTrainingItem_(data) {
  requireAdminByUserId_(data.userId);
  const sh = ensureSheet_(SHEETS.trainingItems, ['教材ID', '分類ID', '主題名稱', '關鍵字', '內容說明', '影片連結', '文件連結', '音檔連結', '排序', '是否啟用', '建立人員ID', '建立時間', '最後更新時間']);
  const meta = headerMap_(sh);
  const itemId = sanitize_(data.itemId) || uuid_('TRN_');
  const rowIndex = findRowByValue_(sh, meta.map['教材ID'] + 1, itemId);
  const existing = rowIndex ? rowObjFromValues_(sh.getRange(rowIndex, 1, 1, meta.headers.length).getValues()[0], meta.headers) : {};

  const folder = getOrCreateRootFolder_('員工系統_教育訓練');
  const video = sanitize_(data.videoUrl)
    ? sanitize_(data.videoUrl)
    : (sanitize_(data.videoData)
      ? saveDataUrlToDrive_(data.videoData, 'training_video_' + Date.now(), folder).url
      : (existing['影片連結'] || ''));
  const docs = Array.isArray(data.docUrls) && data.docUrls.length
    ? data.docUrls.map(function (x) { return sanitize_(x); }).filter(Boolean).join('\n')
    : (Array.isArray(data.docDataList) && data.docDataList.length
      ? data.docDataList.map(function (d, idx) { return saveDataUrlToDrive_(d, 'training_doc_' + Date.now() + '_' + (idx + 1), folder).url; }).join('\n')
      : (existing['文件連結'] || ''));
  const audio = sanitize_(data.audioUrl)
    ? sanitize_(data.audioUrl)
    : (sanitize_(data.audioData)
      ? saveDataUrlToDrive_(data.audioData, 'training_audio_' + Date.now(), folder).url
      : (existing['音檔連結'] || ''));

  const row = new Array(meta.headers.length).fill('');
  const set = function (name, value) { if (meta.map[name] != null) row[meta.map[name]] = value; };
  set('教材ID', itemId);
  set('分類ID', sanitize_(data.categoryId));
  set('主題名稱', sanitize_(data.title));
  set('關鍵字', sanitize_(data.keywords));
  set('內容說明', sanitize_(data.description));
  set('影片連結', video);
  set('文件連結', docs);
  set('音檔連結', audio);
  set('排序', Number(data.sortOrder) || 999);
  set('是否啟用', yesNo_(data.enabled));
  set('建立人員ID', existing['建立人員ID'] || sanitize_(data.userId));
  set('建立時間', existing['建立時間'] || now_());
  set('最後更新時間', now_());

  if (rowIndex) sh.getRange(rowIndex, 1, 1, meta.headers.length).setValues([row]);
  else sh.appendRow(row);

  return { ok: true, itemId: itemId, message: rowIndex ? '教材已更新。' : '教材已建立。' };
}

function saveTrainingVideoLink_(data) {
  requireAdminByUserId_(data.userId);
  const itemId = sanitize_(data.itemId);
  const videoUrl = sanitize_(data.videoUrl);
  if (!itemId) return { ok: false, message: '缺少 itemId' };
  if (!videoUrl) return { ok: false, message: '缺少 videoUrl' };
  const sh = ensureSheet_(SHEETS.trainingItems, ['教材ID', '分類ID', '主題名稱', '關鍵字', '內容說明', '影片連結', '文件連結', '音檔連結', '排序', '是否啟用', '建立人員ID', '建立時間', '最後更新時間']);
  const meta = headerMap_(sh);
  const rowIndex = findRowByValue_(sh, meta.map['教材ID'] + 1, itemId);
  if (!rowIndex) return { ok: false, message: '找不到教材' };
  if (meta.map['影片連結'] != null) sh.getRange(rowIndex, meta.map['影片連結'] + 1).setValue(videoUrl);
  if (meta.map['最後更新時間'] != null) sh.getRange(rowIndex, meta.map['最後更新時間'] + 1).setValue(now_());
  return { ok: true, message: '影片連結已寫入。' };
}

function toggleTrainingItem_(data) {
  requireAdminByUserId_(data.userId);
  const sh = sheet_(SHEETS.trainingItems);
  const meta = headerMap_(sh);
  const rowIndex = findRowByValue_(sh, meta.map['教材ID'] + 1, sanitize_(data.itemId));
  if (!rowIndex) return { ok: false, message: '找不到教材。' };
  if (meta.map['是否啟用'] != null) sh.getRange(rowIndex, meta.map['是否啟用'] + 1).setValue(yesNo_(data.enabled));
  if (meta.map['最後更新時間'] != null) sh.getRange(rowIndex, meta.map['最後更新時間'] + 1).setValue(now_());
  return { ok: true, message: boolYes_(data.enabled) ? '教材已啟用。' : '教材已停用。' };
}

function _trainingReadCategoryRows_() {
  const sh = sheet_(SHEETS.trainingCategories);
  const values = sh.getDataRange().getValues();
  return values.slice(1).map(function (r) {
    return {
      id: r[0],
      name: r[1],
      sortOrder: Number(r[2]) || 0,
      enabled: String(r[3]) === '是',
      description: r[4]
    };
  }).filter(function (x) { return x.id || x.name; });
}

function _trainingReadItemRows_() {
  const sh = sheet_(SHEETS.trainingItems);
  const values = sh.getDataRange().getValues();
  return values.slice(1).map(function (r) {
    return {
      id: r[0],
      categoryId: r[1],
      title: r[2],
      keywords: r[3],
      description: r[4],
      videoUrl: r[5],
      docUrl: r[6],
      audioUrl: r[7],
      sortOrder: Number(r[8]) || 0,
      enabled: String(r[9]) === '是',
      createdById: r[10],
      createdAt: fmtDateTime_(r[11]),
      updatedAt: fmtDateTime_(r[12])
    };
  }).filter(function (x) { return x.id || x.title; });
}

//////////////////////////////////////////////////
// Drive 上傳
//////////////////////////////////////////////////

function getOrCreateRootFolder_(name) {
  const it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(name);
}

function saveDataUrlToDrive_(dataUrl, defaultName, folder) {
  const raw = String(dataUrl || '');
  if (!raw) return { name: '', url: '' };

  if (!/^data:/i.test(raw)) {
    return { name: defaultName || '', url: raw };
  }

  const parsed = parseDataUrl_(raw);
  const mime = parsed.mime || 'application/octet-stream';
  const bytes = Utilities.base64Decode(parsed.base64 || '');
  const ext = extensionByMime_(mime, defaultName);
  const filename = buildFilename_(defaultName, ext);
  const blob = Utilities.newBlob(bytes, mime, filename);
  const file = (folder || DriveApp.getRootFolder()).createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {}
  return {
    name: file.getName(),
    url: 'https://drive.google.com/uc?export=view&id=' + file.getId()
  };
}

function parseDataUrl_(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^data:([^,]*?),(.*)$/i);
  if (!m) throw new Error('附件格式錯誤，無法解析 data URL');

  const meta = String(m[1] || '');
  const body = String(m[2] || '');
  const parts = meta.split(';').map(function (x) { return String(x || '').trim(); }).filter(Boolean);
  let mime = 'application/octet-stream';
  let isBase64 = false;

  if (parts.length && parts[0].indexOf('=') === -1 && parts[0].indexOf('/') > -1) {
    mime = parts.shift().toLowerCase();
  }
  parts.forEach(function (part) {
    if (part.toLowerCase() === 'base64') isBase64 = true;
  });
  if (!isBase64) throw new Error('附件格式錯誤，缺少 base64 標記');
  if (!body) throw new Error('附件內容是空的');

  return { mime: mime, base64: body };
}

function buildFilename_(defaultName, ext) {
  let name = sanitize_(defaultName) || ('file_' + Date.now());
  if (!/\.[A-Za-z0-9]{2,6}$/.test(name) && ext) name += '.' + ext;
  return name;
}

function extensionByMime_(mime, defaultName) {
  const lower = String(mime || '').toLowerCase();
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'audio/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'application/pdf': 'pdf',
    'text/plain': 'txt'
  };

  if (map[lower]) return map[lower];

  const hasExt = /\.([A-Za-z0-9]{2,6})$/.exec(String(defaultName || ''));
  if (hasExt) return hasExt[1];

  return 'bin';
}
