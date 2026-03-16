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
  settings: "系統設定"
};

function doGet(e) {
  try {
    const p = e && e.parameter ? e.parameter : {};
    const action = sanitize_(p.action);
    if (action === 'approveRegistration') return htmlMessage_(approveRegistration_(p));
    if (action === 'approveLeave') return htmlMessage_(approveLeave_(p));
    if (action === 'rejectLeave') return htmlMessage_(rejectLeave_(p));
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
      case 'clock': return jsonOut_(clockAction_(data));
      case 'getClockHistory': return jsonOut_(getClockHistory_(data));
      case 'modifyClockRecord': return jsonOut_(modifyClockRecord_(data));
      case 'leaveRequest': return jsonOut_(createLeaveRequest_(data));
      case 'getLeaveHistory': return jsonOut_(getLeaveHistory_(data));
      case 'parttime': return jsonOut_(createParttime_(data));
      case 'getParttimeHistory': return jsonOut_(getParttimeHistory_(data));
      case 'getEmployeeOptions': return jsonOut_(getEmployeeOptions_(data));
      case 'createTask': return jsonOut_(createTask_(data));
      case 'getTasks': return jsonOut_(getTasks_(data));
      case 'completeTask': return jsonOut_(completeTask_(data));
      default: return jsonOut_({ ok: false, message: '未知 action' });
    }
  } catch (err) {
    return jsonOut_({ ok: false, message: err.message || String(err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function htmlMessage_(result) {
  const ok = !!result.ok;
  const title = result.title || (ok ? '處理完成' : '處理失敗');
  const message = result.message || '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:Arial,"Noto Sans TC",sans-serif;background:#f5f7fb;padding:24px} .box{max-width:560px;margin:40px auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.08)} h1{font-size:24px;margin:0 0 12px} p{line-height:1.8;white-space:pre-wrap}</style></head><body><div class="box"><h1>${title}</h1><p>${message}</p></div></body></html>`;
  return HtmlService.createHtmlOutput(html).setTitle(title);
}
function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }
function sh_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('找不到工作表：' + name);
  return sheet;
}
function sanitize_(v) { return String(v == null ? '' : v).trim(); }
function now_() { return new Date(); }
function nowStr_() { return Utilities.formatDate(now_(), TIMEZONE, 'yyyy-MM-dd HH:mm:ss'); }
function dateStr_(d) { return Utilities.formatDate(new Date(d), TIMEZONE, 'yyyy-MM-dd'); }
function timeStr_(d) { return Utilities.formatDate(new Date(d), TIMEZONE, 'HH:mm:ss'); }
function displayDate_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return Utilities.formatDate(v, TIMEZONE, 'yyyy-MM-dd');
  var s = sanitize_(v);
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var m = s.match(/^(\d{4}-\d{1,2}-\d{1,2})/);
  if (m) return m[1];
  var d = new Date(s);
  if (!isNaN(d)) return Utilities.formatDate(d, TIMEZONE, 'yyyy-MM-dd');
  return s;
}
function displayTime_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v)) return Utilities.formatDate(v, TIMEZONE, 'HH:mm:ss');
  var s = sanitize_(v);
  if (!s) return '';
  var hm = s.match(/(\d{1,2}:\d{2}:\d{2})/);
  if (hm) return hm[1];
  var hm2 = s.match(/(\d{1,2}:\d{2})/);
  if (hm2) return hm2[1] + ':00';
  var d = new Date(s);
  if (!isNaN(d)) return Utilities.formatDate(d, TIMEZONE, 'HH:mm:ss');
  return s;
}
function weekdayZh_(d) { return '日一二三四五六'.charAt(new Date(d).getDay()); }
function uid_(prefix) { return prefix + '_' + Utilities.getUuid().slice(0, 8); }
function boolYes_(v) { return ['yes','true','1','是'].indexOf(sanitize_(v).toLowerCase()) > -1; }
function getWebAppUrl_() { return ScriptApp.getService().getUrl() || '請重新部署 Web App'; }

function getSetting_(name, fallback) {
  const values = sh_(SHEETS.settings).getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (sanitize_(values[i][0]) === name) return values[i][1];
  }
  return fallback;
}

function employeesRows_() {
  return sh_(SHEETS.employees).getDataRange().getValues();
}
function emailToUser_(email) {
  const rows = employeesRows_();
  const target = sanitize_(email).toLowerCase();
  for (let i = 1; i < rows.length; i++) {
    if (sanitize_(rows[i][2]).toLowerCase() === target) {
      return mapEmployeeRow_(rows[i], i + 1);
    }
  }
  return null;
}
function userById_(id) {
  const rows = employeesRows_();
  const target = sanitize_(id);
  for (let i = 1; i < rows.length; i++) {
    if (sanitize_(rows[i][0]) === target) {
      return mapEmployeeRow_(rows[i], i + 1);
    }
  }
  return null;
}
function mapEmployeeRow_(r, row) {
  return {
    row: row,
    id: r[0],
    name: r[1],
    email: r[2],
    password: r[3],
    role: sanitize_(r[4] || 'staff'),
    isPartTime: boolYes_(r[5]),
    accountStatus: sanitize_(r[6] || 'pending').toLowerCase(),
    createdAt: r[7] || '',
    lastLoginAt: r[8] || ''
  };
}

function registerUser_(data) {
  const name = sanitize_(data.name);
  const email = sanitize_(data.email).toLowerCase();
  const password = sanitize_(data.password);
  const isPartTime = boolYes_(data.isPartTime) ? 'yes' : 'no';
  if (!name || !email || !password) return { ok: false, message: '姓名、Email、密碼不可空白' };
  if (emailToUser_(email)) return { ok: false, message: '此 Email 已註冊' };

  const id = uid_('EMP');
  sh_(SHEETS.employees).appendRow([id, name, email, password, 'staff', isPartTime, 'pending', nowStr_(), '']);

  const adminEmail = sanitize_(getSetting_('管理通知信箱', ''));
  const url = getWebAppUrl_();
  const approveUrl = url + '?action=approveRegistration&email=' + encodeURIComponent(email);
  const body = [
    '有新的員工註冊申請',
    '',
    '姓名：' + name,
    'Email：' + email,
    '是否工讀生：' + (isPartTime === 'yes' ? '是' : '否'),
    '申請時間：' + nowStr_(),
    '',
    '核准註冊：',
    approveUrl,
    '',
    '若不核准，可先保持 pending 狀態。'
  ].join('\n');
  if (adminEmail) MailApp.sendEmail(adminEmail, '員工系統｜新註冊申請', body);

  return { ok: true, message: '註冊申請已送出，請等待管理者審核通過後再登入。' };
}

function approveRegistration_(p) {
  const email = sanitize_(p.email).toLowerCase();
  const user = emailToUser_(email);
  if (!user) return { ok: false, title: '找不到帳號', message: '找不到這個 Email。' };
  if (user.accountStatus === 'active') return { ok: true, title: '已經啟用', message: user.name + ' 的帳號已經是啟用狀態。' };
  sh_(SHEETS.employees).getRange(user.row, 7).setValue('active');
  MailApp.sendEmail(user.email, '員工系統｜帳號審核通過', '您好，' + user.name + '\n您的員工系統帳號已通過管理者審核，現在可以登入使用。');
  return { ok: true, title: '審核完成', message: '已啟用帳號：' + user.name + '（' + user.email + '）' };
}

function loginUser_(data) {
  const email = sanitize_(data.email).toLowerCase();
  const password = sanitize_(data.password);
  const user = emailToUser_(email);
  if (!user) return { ok: false, message: '查無此帳號' };
  if (user.accountStatus !== 'active') return { ok: false, message: '此帳號尚未通過管理者審核' };
  if (user.password !== password) return { ok: false, message: '密碼錯誤' };
  sh_(SHEETS.employees).getRange(user.row, 9).setValue(nowStr_());
  return { ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, isPartTime: user.isPartTime } };
}

function forgotPassword_(data) {
  const email = sanitize_(data.email).toLowerCase();
  const user = emailToUser_(email);
  if (!user) return { ok: false, message: '查無此 Email' };
  MailApp.sendEmail(email, '員工系統｜密碼提醒', '您好，' + user.name + '\n目前你的密碼是：' + user.password + '\n請登入後妥善保存。');
  return { ok: true, message: '已寄送密碼提醒到你的信箱' };
}



function calcClockStatus_(actionName, now, isSupplement, selectedClockType) {
  if (isSupplement) return { status: '補登', lateMinutes: 0 };
  if (sanitize_(selectedClockType) === '特殊打卡') return { status: '正常', lateMinutes: 0 };
  var status = '正常', lateMinutes = 0;
  if (actionName !== '上班打卡') return { status: status, lateMinutes: 0 };
  var day = now.getDay();
  var targetHour = null, targetMinute = null;
  if (day === 1) return { status: '休假日', lateMinutes: 0 };
  if (day >= 2 && day <= 5) { targetHour = 12; targetMinute = 30; }
  else { targetHour = 10; targetMinute = 0; }
  var target = new Date(now);
  target.setHours(targetHour, targetMinute, 0, 0);
  if (now.getTime() > target.getTime()) {
    lateMinutes = Math.floor((now.getTime() - target.getTime()) / 60000);
    status = '遲到';
  }
  return { status: status, lateMinutes: lateMinutes };
}

function getTodayClockCount_(userId, dateText, actionName) {
  const rows = sh_(SHEETS.clock).getDataRange().getValues();
  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    if (sanitize_(rows[i][1]) === userId && sanitize_(rows[i][4]) === dateText && sanitize_(rows[i][7]) === actionName) {
      count++;
    }
  }
  return count;
}


function clockAction_(data) {
  var user = userById_(data.userId);
  if (!user) return { ok: false, message: '找不到員工資料' };
  var actionName = sanitize_(data.actionName);
  var isSupplement = boolYes_(data.isSupplement);
  var secondConfirm = boolYes_(data.secondConfirm);
  var supplementDate = sanitize_(data.supplementDate);
  var supplementTime = sanitize_(data.supplementTime);
  var supplementReason = sanitize_(data.supplementReason);
  var clientIp = sanitize_(data.clientIp);
  var companyIp = sanitize_(getSetting_('公司IP', '125.229.190.123'));
  var selectedClockType = sanitize_(isSupplement ? data.supplementClockType : data.clockType) || (isSupplement ? '標準打卡' : '標準打卡');

  if (!actionName) return { ok: false, message: '缺少打卡動作' };

  var baseDate = now_();
  if (isSupplement) {
    if (!supplementDate || !supplementTime || !supplementReason) {
      return { ok: false, message: '補登需要填寫日期、時間與原因' };
    }
    baseDate = new Date(supplementDate + 'T' + supplementTime + ':00');
    if (String(baseDate) === 'Invalid Date') return { ok: false, message: '補登日期或時間格式錯誤' };
  } else {
    if (baseDate.getDay() === 1) {
      return { ok: false, message: '星期一固定不上班，若有特殊狀況請使用補登打卡。' };
    }
    if (clientIp !== companyIp) {
      sh_(SHEETS.clockFail).appendRow([uid_('CF'), user.id, user.name, user.email, dateStr_(baseDate), '星期' + weekdayZh_(baseDate), selectedClockType, actionName, timeStr_(baseDate), 'IP不符', clientIp, 0, '否', '', nowStr_()]);
      return { ok: false, message: '目前未連接公司指定 Wi‑Fi，無法打卡。' };
    }
  }

  var dateText = dateStr_(baseDate);
  var timeText = timeStr_(baseDate);
  var weekdayText = '星期' + weekdayZh_(baseDate);
  var existingCount = getTodayClockCount_(user.id, dateText, actionName);
  if (!isSupplement && existingCount >= 1 && !secondConfirm) {
    return {
      ok: false,
      needSecondConfirm: true,
      message: '今天已完成' + actionName + '，這是當天第二次打卡嗎？',
      existingCount: existingCount
    };
  }

  var check = calcClockStatus_(actionName, baseDate, isSupplement, selectedClockType);
  var seq = existingCount + 1;
  var noteReason = isSupplement ? supplementReason : '';
  sh_(SHEETS.clock).appendRow([uid_('CLK'), user.id, user.name, user.email, dateText, weekdayText, selectedClockType, actionName, timeText, check.status, check.lateMinutes, clientIp, seq, isSupplement ? '是' : '否', noteReason, nowStr_()]);

  var lines = [
    '姓名：' + user.name,
    '日期：' + dateText,
    '時間：' + timeText,
    '打卡方式：' + selectedClockType,
    '動作：' + actionName,
    '狀態：' + check.status
  ];
  if (actionName === '上班打卡' && !isSupplement && selectedClockType !== '特殊打卡' && check.lateMinutes > 0) lines.push('遲到分鐘：' + check.lateMinutes);
  if (isSupplement) lines.push('補登原因：' + supplementReason);
  if (clientIp) lines.push('IP：' + clientIp);
  lines.push('當日序號：' + seq);
  sendDualMail_(user.email, '打卡通知｜' + user.name + '｜' + actionName, lines.join('\n'));

  var message = actionName + '成功';
  if (isSupplement) message = '補登成功';
  else if (actionName === '上班打卡' && selectedClockType !== '特殊打卡' && check.lateMinutes > 0) message += '，遲到 ' + check.lateMinutes + ' 分鐘';
  return { ok: true, message: message, sequence: seq, status: check.status, lateMinutes: check.lateMinutes };
}


function getClockHistory_(data) {
  var userId = sanitize_(data.userId);
  var rows = sh_(SHEETS.clock).getDataRange().getValues();
  var out = [];
  for (var i = rows.length - 1; i >= 1; i--) {
    if (sanitize_(rows[i][1]) === userId) {
      var clockType = sanitize_(rows[i][6] || '標準打卡');
      var actionName = sanitize_(rows[i][7]);
      var status = sanitize_(rows[i][9]);
      var note = sanitize_(rows[i][14]);
      var originalRef = '';
      if (actionName === '修改紀錄') {
        originalRef = sanitize_(rows[i][5]);
      }
      out.push({
        id: rows[i][0],
        date: displayDate_(rows[i][4]),
        weekday: sanitize_(rows[i][5]),
        clockType: clockType,
        actionName: actionName,
        time: displayTime_(rows[i][8]),
        status: status,
        statusLabel: actionName === '修改紀錄' ? '修改紀錄' : status,
        lateMinutes: Number(rows[i][10] || 0),
        sequence: rows[i][12] || 1,
        isSupplement: sanitize_(rows[i][13]) === '是',
        note: note,
        originalRef: originalRef,
        canModify: actionName !== '修改紀錄'
      });
      if (out.length >= 50) break;
    }
  }
  return { ok: true, rows: out };
}

function modifyClockRecord_(data) {
  var user = userById_(data.userId);
  if (!user) return { ok: false, message: '找不到員工資料' };
  var recordId = sanitize_(data.recordId);
  var newClockType = sanitize_(data.newClockType);
  var note = sanitize_(data.note);
  if (!recordId || !newClockType || !note) return { ok: false, message: '請完整填寫修改資訊' };

  var rows = sh_(SHEETS.clock).getDataRange().getValues();
  var row = null;
  for (var i = 1; i < rows.length; i++) {
    if (sanitize_(rows[i][0]) === recordId && sanitize_(rows[i][1]) === user.id) {
      row = rows[i];
      break;
    }
  }
  if (!row) return { ok: false, message: '找不到原始打卡紀錄' };
  if (sanitize_(row[7]) === '修改紀錄') return { ok: false, message: '修改紀錄不可再次修改' };

  var originalDate = displayDate_(row[4]);
  var originalTime = displayTime_(row[8]);
  sh_(SHEETS.clock).appendRow([
    uid_('CLKM'), user.id, user.name, user.email,
    originalDate,
    '原始紀錄：' + recordId,
    newClockType,
    '修改紀錄',
    timeStr_(now_()),
    '已修改',
    0,
    '',
    row[12] || 1,
    '否',
    note,
    nowStr_()
  ]);

  var adminEmail = sanitize_(getSetting_('管理通知信箱', ''));
  var body = [
    '姓名：' + user.name,
    '原始日期：' + originalDate,
    '原始時間：' + originalTime,
    '原始打卡方式：' + sanitize_(row[6]),
    '原始動作：' + sanitize_(row[7]),
    '修改後打卡方式：' + newClockType,
    '修改備註：' + note
  ].join('\n');
  sendDualMail_(user.email, '打卡修改通知｜' + user.name, body, adminEmail);
  return { ok: true, message: '修改紀錄已送出' };
}

function createLeaveRequest_(data) {
  const user = userById_(data.userId);
  if (!user) return { ok: false, message: '找不到員工資料' };
  const leaveDate = sanitize_(data.leaveDate);
  const hours = sanitize_(data.hours);
  const reason = sanitize_(data.reason);
  const note = sanitize_(data.note);
  const leaveStartTime = sanitize_(data.leaveStartTime);
  const leaveEndTime = sanitize_(data.leaveEndTime);
  const attachment = sanitize_(data.attachment);
  let attachmentFileName = '';
  let attachmentUrl = '';
  if (attachment) {
    const saved = saveBase64File_(attachment, 'leave_' + user.id + '_' + Date.now());
    attachmentFileName = saved.name;
    attachmentUrl = saved.url;
  }
  const requestId = uid_('LRQ');
  appendRecordByHeaders_(sh_(SHEETS.leaveRequests), {
    '申請ID': requestId,
    '員工ID': user.id,
    '姓名': user.name,
    'Email': user.email,
    '請假日期': leaveDate,
    '請假開始時間': leaveStartTime,
    '請假結束時間': leaveEndTime,
    '請假時數': hours,
    '請假原因': reason,
    '備註': note,
    '附件檔名': attachmentFileName,
    '附件網址': attachmentUrl,
    '申請狀態': 'pending',
    '申請時間': nowStr_(),
    '審核人': '',
    '審核時間': ''
  });

  const adminEmail = sanitize_(getSetting_('管理通知信箱', ''));
  const base = getWebAppUrl_();
  const approveUrl = base + '?action=approveLeave&requestId=' + encodeURIComponent(requestId);
  const rejectUrl = base + '?action=rejectLeave&requestId=' + encodeURIComponent(requestId);
  const body = [
    '有新的請假申請單',
    '',
    '申請人：' + user.name,
    'Email：' + user.email,
    '請假日期：' + leaveDate,
    '請假開始時間：' + (leaveStartTime || '未填'),
    '請假結束時間：' + (leaveEndTime || '未填'),
    '請假時數：' + hours,
    '請假原因：' + reason,
    '備註：' + (note || '無'),
    '附件：' + (attachmentUrl || '無'),
    '',
    '同意請假：',
    approveUrl,
    '',
    '不同意請假：',
    rejectUrl
  ].join('\n');
  if (adminEmail) MailApp.sendEmail(adminEmail, '員工系統｜請假申請｜' + user.name, body);
  MailApp.sendEmail(user.email, '員工系統｜請假申請已送出', '您好，' + user.name + '\n你的請假申請已送出，等待主管審核。\n日期：' + leaveDate + '\n時數：' + hours + '\n原因：' + reason);
  return { ok: true, message: '請假申請已送出，等待主管審核。' };
}

function approveLeave_(p) {
  return processLeaveApproval_(sanitize_(p.requestId), true);
}
function rejectLeave_(p) {
  return processLeaveApproval_(sanitize_(p.requestId), false);
}
function processLeaveApproval_(requestId, approved) {
  const sheet = sh_(SHEETS.leaveRequests);
  const rows = sheet.getDataRange().getValues();
  const adminEmail = sanitize_(getSetting_('管理通知信箱', '主管'));
  for (let i = 1; i < rows.length; i++) {
    if (sanitize_(rows[i][0]) === requestId) {
      const status = sanitize_(rows[i][10]).toLowerCase();
      if (status === 'approved' || status === 'rejected') {
        return { ok: true, title: '已處理過', message: '這張請假申請已經處理過了。' };
      }
      const employeeEmail = sanitize_(rows[i][3]);
      const employeeName = sanitize_(rows[i][2]);
      const leaveDate = sanitize_(rows[i][4]);
      const reqHeaderMap = getHeaderMap_(sheet);
      const leaveStartTime = sanitize_(getRowValueByHeaders_(rows[i], reqHeaderMap, ['請假開始時間']));
      const leaveEndTime = sanitize_(getRowValueByHeaders_(rows[i], reqHeaderMap, ['請假結束時間']));
      const leaveHours = sanitize_(getRowValueByHeaders_(rows[i], reqHeaderMap, ['請假時數']));
      const reason = sanitize_(getRowValueByHeaders_(rows[i], reqHeaderMap, ['請假原因']));
      const note = sanitize_(getRowValueByHeaders_(rows[i], reqHeaderMap, ['備註']));
      const fileName = sanitize_(getRowValueByHeaders_(rows[i], reqHeaderMap, ['附件檔名']));
      const fileUrl = sanitize_(getRowValueByHeaders_(rows[i], reqHeaderMap, ['附件網址']));
      const rowIndex = i + 1;
      if (approved) {
        sheet.getRange(rowIndex, 11, 1, 4).setValues([['approved', nowStr_(), adminEmail, nowStr_()]]);
        appendRecordByHeaders_(sh_(SHEETS.leaveRecords), {
          '紀錄ID': uid_('LEA'),
          '申請ID': requestId,
          '員工ID': rows[i][1],
          '姓名': employeeName,
          '請假日期': leaveDate,
          '請假開始時間': leaveStartTime,
          '請假結束時間': leaveEndTime,
          '請假時數': leaveHours,
          '請假原因': reason,
          '備註': note,
          '附件檔名': fileName,
          '附件網址': fileUrl,
          '核准人': adminEmail,
          '核准時間': nowStr_(),
          '建立時間': nowStr_()
        });
        MailApp.sendEmail(employeeEmail, '員工系統｜請假已核准', '您好，' + employeeName + '\n你的請假申請已核准。\n日期：' + leaveDate + '\n時數：' + leaveHours + '\n原因：' + reason);
        return { ok: true, title: '已核准', message: '已核准請假申請：' + employeeName + '｜' + leaveDate + '｜' + leaveHours };
      }
      sheet.getRange(rowIndex, 11, 1, 4).setValues([['rejected', nowStr_(), adminEmail, nowStr_()]]);
      MailApp.sendEmail(employeeEmail, '員工系統｜請假未核准', '您好，' + employeeName + '\n你的請假申請未通過。\n日期：' + leaveDate + '\n時數：' + leaveHours + '\n原因：' + reason);
      return { ok: true, title: '已拒絕', message: '已拒絕請假申請：' + employeeName + '｜' + leaveDate + '｜' + leaveHours };
    }
  }
  return { ok: false, title: '找不到申請', message: '找不到這筆請假申請。' };
}

function getLeaveHistory_(data) {
  const userId = sanitize_(data.userId);
  const reqRows = sh_(SHEETS.leaveRequests).getDataRange().getValues();
  const out = [];
  for (let i = reqRows.length - 1; i >= 1; i--) {
    if (sanitize_(reqRows[i][1]) === userId) {
      out.push({
        requestId: reqRows[i][0],
        leaveDate: reqRows[i][4],
        leaveStartTime: getRowValueByHeaders_(reqRows[i], getHeaderMap_(sh_(SHEETS.leaveRequests)), ['請假開始時間']),
        leaveEndTime: getRowValueByHeaders_(reqRows[i], getHeaderMap_(sh_(SHEETS.leaveRequests)), ['請假結束時間']),
        hours: getRowValueByHeaders_(reqRows[i], getHeaderMap_(sh_(SHEETS.leaveRequests)), ['請假時數']),
        reason: getRowValueByHeaders_(reqRows[i], getHeaderMap_(sh_(SHEETS.leaveRequests)), ['請假原因']),
        note: getRowValueByHeaders_(reqRows[i], getHeaderMap_(sh_(SHEETS.leaveRequests)), ['備註']),
        attachmentFileName: getRowValueByHeaders_(reqRows[i], getHeaderMap_(sh_(SHEETS.leaveRequests)), ['附件檔名']),
        attachmentUrl: getRowValueByHeaders_(reqRows[i], getHeaderMap_(sh_(SHEETS.leaveRequests)), ['附件網址']),
        status: getRowValueByHeaders_(reqRows[i], getHeaderMap_(sh_(SHEETS.leaveRequests)), ['申請狀態']),
        requestedAt: getRowValueByHeaders_(reqRows[i], getHeaderMap_(sh_(SHEETS.leaveRequests)), ['申請時間']),
        reviewer: getRowValueByHeaders_(reqRows[i], getHeaderMap_(sh_(SHEETS.leaveRequests)), ['審核人']),
        reviewedAt: getRowValueByHeaders_(reqRows[i], getHeaderMap_(sh_(SHEETS.leaveRequests)), ['審核時間'])
      });
      if (out.length >= 50) break;
    }
  }
  return { ok: true, rows: out };
}

function createParttime_(data) {
  const user = userById_(data.userId);
  if (!user) return { ok: false, message: '找不到員工資料' };
  const workDate = sanitize_(data.workDate);
  const hours = Number(data.hours || 0);
  const halfHour = boolYes_(data.halfHour) ? 0.5 : 0;
  const totalHours = hours + halfHour;
  const hourRate = Number(getSetting_('時薪', 196));
  const dailyPay = totalHours * hourRate;
  const note = sanitize_(data.note);
  sh_(SHEETS.parttime).appendRow([uid_('PT'), user.id, user.name, user.email, workDate, hours, halfHour, totalHours, hourRate, dailyPay, note, nowStr_()]);
  sendDualMail_(user.email, '工讀時數通知｜' + user.name, [
    '姓名：' + user.name,
    '日期：' + workDate,
    '時數：' + hours,
    '半小時：' + halfHour,
    '總時數：' + totalHours,
    '當日薪資：' + dailyPay,
    '備註：' + (note || '無')
  ].join('\n'));
  return { ok: true, message: '已送出，今日薪資 $' + dailyPay };
}

function getParttimeHistory_(data) {
  const userId = sanitize_(data.userId);
  const rows = sh_(SHEETS.parttime).getDataRange().getValues();
  const out = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    if (sanitize_(rows[i][1]) === userId) {
      out.push({ id: rows[i][0], date: rows[i][4], hours: rows[i][5], halfHour: rows[i][6], totalHours: rows[i][7], hourlyRate: rows[i][8], dailyPay: rows[i][9], note: rows[i][10] });
      if (out.length >= 50) break;
    }
  }
  return { ok: true, rows: out };
}


function getEmployeeOptions_() {
  const rows = employeesRows_();
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const role = sanitize_(rows[i][4] || 'staff');
    const status = sanitize_(rows[i][6] || 'pending').toLowerCase();
    if (status !== 'active') continue;
    out.push({ id: rows[i][0], name: rows[i][1], email: rows[i][2], role: role });
  }
  out.sort(function(a,b){ return a.name.localeCompare(b.name, 'zh-Hant'); });
  return { ok: true, rows: out };
}


function getHeaderMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  if (!lastCol) return {};
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  for (var i = 0; i < headers.length; i++) {
    map[sanitize_(headers[i])] = i + 1;
  }
  return map;
}

function findHeaderCol_(headerMap, aliases) {
  for (var i = 0; i < aliases.length; i++) {
    var key = sanitize_(aliases[i]);
    if (headerMap[key]) return headerMap[key];
  }
  return 0;
}

function getRowValueByHeaders_(row, headerMap, aliases) {
  var col = findHeaderCol_(headerMap, aliases);
  return col ? row[col - 1] : '';
}

function setRowValueByHeaders_(row, headerMap, aliases, value) {
  var col = findHeaderCol_(headerMap, aliases);
  if (col) row[col - 1] = value;
}

function appendRecordByHeaders_(sheet, record) {
  var headerMap = getHeaderMap_(sheet);
  var row = new Array(sheet.getLastColumn()).fill('');
  Object.keys(record).forEach(function(key) {
    var col = headerMap[key];
    if (col) row[col - 1] = record[key];
  });
  sheet.appendRow(row);
}



function createTask_(data) {
  const creator = userById_(data.creatorId);
  if (!creator || creator.role !== 'admin') return { ok: false, message: '只有管理者可以建立任務' };

  const assignee = userById_(data.assigneeId) || emailToUser_(data.assigneeEmail);
  if (!assignee) return { ok: false, message: '找不到被指派員工' };

  const title = sanitize_(data.title);
  const content = sanitize_(data.content);
  const dueDate = sanitize_(data.dueDate);
  const dueTime = sanitize_(data.dueTime);
  const dueMode = sanitize_(data.dueMode || '');
  const dueLabel = sanitize_(data.dueLabel || '');
  if (!title) return { ok: false, message: '請輸入任務標題' };

  let taskImageObj = null;
  let taskAudioObj = null;
  if (sanitize_(data.taskImage)) {
    taskImageObj = saveBase64File_(sanitize_(data.taskImage), 'task_image_' + Date.now(), 'task');
  }
  if (sanitize_(data.taskAudio)) {
    taskAudioObj = saveBase64File_(sanitize_(data.taskAudio), 'task_audio_' + Date.now(), 'task');
  }

  const taskId = uid_('TSK');
  const taskSheet = sh_(SHEETS.tasks);
  appendRecordByHeaders_(taskSheet, {
    '任務ID': taskId,
    '標題': title,
    '內容': content,
    '指派員工ID': assignee.id,
    '指派員工姓名': assignee.name,
    '指派員工Email': assignee.email,
    '截止日期': dueDate,
    '截止時間': dueTime,
    '完成回報需求': sanitize_(data.requirePhotoReturn || '否'),
    '提醒頻率': sanitize_(data.remindFreq || '一般提醒'),
    '狀態': '待處理',
    '建立時間': nowStr_(),
    '建立者ID': creator.id,
    '建立者姓名': creator.name,
    '任務圖片檔名': taskImageObj ? taskImageObj.name : '',
    '任務圖片網址': taskImageObj ? taskImageObj.rawUrl : '',
    '任務錄音檔名': taskAudioObj ? taskAudioObj.name : '',
    '任務錄音網址': taskAudioObj ? taskAudioObj.rawUrl : '',
    '期限模式': dueMode,
    '期限標籤': dueLabel
  });

  var dueText = sanitize_(dueLabel || (dueDate + ' ' + dueTime).trim());
  var taskPageUrl = getTaskPageUrl_(taskId);
  var commonText = [
    '任務ID：' + taskId,
    '標題：' + title,
    '內容：' + content,
    '指派給：' + assignee.name,
    '期限：' + dueText,
    '完成回報：' + sanitize_(data.requirePhotoReturn || '否'),
    '提醒頻率：' + sanitize_(data.remindFreq || '一般提醒'),
    '任務頁：' + taskPageUrl,
    '任務照片：' + (taskImageObj ? taskImageObj.viewUrl : '無'),
    '任務錄音：' + (taskAudioObj ? taskAudioObj.viewUrl : '無')
  ].join('\n');
  var commonHtml = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans TC,sans-serif;line-height:1.75;color:#203040">',
    '<p><strong>任務ID：</strong>' + taskId + '<br>',
    '<strong>標題：</strong>' + title + '<br>',
    '<strong>內容：</strong>' + content + '<br>',
    '<strong>指派給：</strong>' + assignee.name + '<br>',
    '<strong>期限：</strong>' + dueText + '<br>',
    '<strong>完成回報：</strong>' + sanitize_(data.requirePhotoReturn || '否') + '<br>',
    '<strong>提醒頻率：</strong>' + sanitize_(data.remindFreq || '一般提醒') + '</p>',
    linkHtml_('前往任務頁', taskPageUrl),
    taskImageObj ? linkHtml_('任務照片', taskImageObj.viewUrl) : '',
    taskAudioObj ? linkHtml_('任務錄音', taskAudioObj.viewUrl) : '',
    '</div>'
  ].join('');
  sendMailWithHtml_(assignee.email, '【員工待辦】你有新的交辦事項｜' + title, commonText, commonHtml);
  var adminEmail = sanitize_(getSetting_('管理通知信箱', ''));
  if (adminEmail && adminEmail.toLowerCase() !== assignee.email.toLowerCase()) {
    sendMailWithHtml_(adminEmail, '【管理通知】新交辦事項｜' + title, commonText, commonHtml);
  }
  return { ok: true, message: '交辦事項已建立' };
}



function getTasks_(data) {
  const role = sanitize_(data.role || 'staff');
  const userId = sanitize_(data.userId);
  const email = sanitize_(data.email).toLowerCase();
  const sheet = sh_(SHEETS.tasks);
  const rows = sheet.getDataRange().getValues();
  const headerMap = getHeaderMap_(sheet);
  const out = [];
  for (let i = rows.length - 1; i >= 1; i--) {
    const rowArr = rows[i];
    const row = {
      id: getRowValueByHeaders_(rowArr, headerMap, ['任務ID']),
      title: getRowValueByHeaders_(rowArr, headerMap, ['標題']),
      content: getRowValueByHeaders_(rowArr, headerMap, ['內容']),
      assigneeId: getRowValueByHeaders_(rowArr, headerMap, ['指派員工ID']),
      assigneeName: getRowValueByHeaders_(rowArr, headerMap, ['指派員工姓名']),
      assigneeEmail: getRowValueByHeaders_(rowArr, headerMap, ['指派員工Email']),
      dueDate: getRowValueByHeaders_(rowArr, headerMap, ['截止日期']),
      dueTime: getRowValueByHeaders_(rowArr, headerMap, ['截止時間']),
      requirePhotoReturn: getRowValueByHeaders_(rowArr, headerMap, ['完成回報需求']),
      remindFreq: getRowValueByHeaders_(rowArr, headerMap, ['提醒頻率']),
      status: getRowValueByHeaders_(rowArr, headerMap, ['狀態']),
      createdAt: getRowValueByHeaders_(rowArr, headerMap, ['建立時間']),
      createdById: getRowValueByHeaders_(rowArr, headerMap, ['建立者ID']),
      createdByName: getRowValueByHeaders_(rowArr, headerMap, ['建立者姓名']),
      taskImageName: getRowValueByHeaders_(rowArr, headerMap, ['任務圖片檔名']),
      taskImageUrl: getRowValueByHeaders_(rowArr, headerMap, ['任務圖片網址']),
      taskAudioName: getRowValueByHeaders_(rowArr, headerMap, ['任務錄音檔名']),
      taskAudioUrl: getRowValueByHeaders_(rowArr, headerMap, ['任務錄音網址']),
      dueMode: getRowValueByHeaders_(rowArr, headerMap, ['期限模式']),
      dueLabel: getRowValueByHeaders_(rowArr, headerMap, ['期限標籤'])
    };
    if (role === 'admin' || sanitize_(row.assigneeId) === userId || String(row.assigneeEmail || '').toLowerCase() === email) out.push(row);
  }
  return { ok: true, rows: out };
}


function completeTask_(data) {
  const user = userById_(data.userId);
  if (!user) return { ok: false, message: '找不到員工資料' };

  const taskId = sanitize_(data.taskId);
  const note = sanitize_(data.note);
  const photo = sanitize_(data.photo);
  const taskSheet = sh_(SHEETS.tasks);
  const rows = taskSheet.getDataRange().getValues();
  const taskHeaderMap = getHeaderMap_(taskSheet);
  let rowIndex = -1;
  let task = null;

  for (let i = 1; i < rows.length; i++) {
    if (sanitize_(getRowValueByHeaders_(rows[i], taskHeaderMap, ['任務ID'])) === taskId) {
      rowIndex = i + 1;
      task = rows[i];
      break;
    }
  }
  if (rowIndex < 0) return { ok: false, message: '找不到任務ID' };

  const assigneeId = sanitize_(getRowValueByHeaders_(task, taskHeaderMap, ['指派員工ID']));
  const assigneeEmail = sanitize_(getRowValueByHeaders_(task, taskHeaderMap, ['指派員工Email'])).toLowerCase();
  if (assigneeId !== user.id && assigneeEmail !== user.email.toLowerCase() && user.role !== 'admin') {
    return { ok: false, message: '這個任務不是你的' };
  }

  let photoObj = null;
  if (photo) {
    photoObj = saveBase64File_(photo, 'task_' + taskId + '_' + Date.now(), 'done');
  }

  const doneSheet = sh_(SHEETS.taskDone);
  appendRecordByHeaders_(doneSheet, {
    '完成ID': uid_('DONE'),
    '任務ID': taskId,
    '員工ID': user.id,
    '姓名': user.name,
    'Email': user.email,
    '完成時間': nowStr_(),
    '完成備註': note,
    '完成說明': note,
    '完成照片檔名': photoObj ? photoObj.name : '',
    '完成照片網址': photoObj ? photoObj.rawUrl : '',
    '照片檔名': photoObj ? photoObj.name : '',
    '照片網址': photoObj ? photoObj.rawUrl : '',
    '完成錄音檔名': '',
    '完成錄音網址': ''
  });

  var statusCol = findHeaderCol_(taskHeaderMap, ['狀態']);
  if (statusCol) taskSheet.getRange(rowIndex, statusCol).setValue('已完成');
  var doneAtCol = findHeaderCol_(taskHeaderMap, ['完成時間']);
  if (doneAtCol) taskSheet.getRange(rowIndex, doneAtCol).setValue(nowStr_());

  var doneTitle = sanitize_(getRowValueByHeaders_(task, taskHeaderMap, ['標題']));
  var doneText = [
    '任務ID：' + taskId,
    '標題：' + doneTitle,
    '完成者：' + user.name,
    '完成時間：' + nowStr_(),
    '備註：' + (note || '無'),
    '照片：' + (photoObj ? photoObj.viewUrl : '無'),
    '任務頁：' + getTaskPageUrl_(taskId)
  ].join('\n');
  var doneHtml = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans TC,sans-serif;line-height:1.75;color:#203040">',
    '<p><strong>任務ID：</strong>' + taskId + '<br>',
    '<strong>標題：</strong>' + doneTitle + '<br>',
    '<strong>完成者：</strong>' + user.name + '<br>',
    '<strong>完成時間：</strong>' + nowStr_() + '<br>',
    '<strong>備註：</strong>' + (note || '無') + '</p>',
    linkHtml_('前往任務頁', getTaskPageUrl_(taskId)),
    photoObj ? linkHtml_('完成照片', photoObj.viewUrl) : '',
    '</div>'
  ].join('');
  sendMailWithHtml_(user.email, '【員工通知】任務完成送出成功｜' + doneTitle, doneText, doneHtml);
  var adminEmail = sanitize_(getSetting_('管理通知信箱', ''));
  if (adminEmail && adminEmail.toLowerCase() !== user.email.toLowerCase()) {
    sendMailWithHtml_(adminEmail, '【管理通知】任務已完成｜' + doneTitle, doneText, doneHtml);
  }
  return { ok: true, message: '任務已完成' };
}

function saveBase64File_(dataUrl, name, targetType) {
  if (!dataUrl) return null;
  const m = String(dataUrl).match(/^data:(.+?);base64,(.+)$/);
  if (!m) throw new Error('附件格式錯誤');
  const contentType = String(m[1] || '').split(';')[0].trim().toLowerCase();
  const bytes = Utilities.base64Decode(m[2]);
  const extMap = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/webm': '.webm',
    'audio/ogg': '.ogg'
  };
  const ext = extMap[contentType] || '';
  if (!ext) throw new Error('不支援的任務附件格式：' + contentType);
  const folderSetting = targetType === 'done' ? '完成附件資料夾ID' : '任務附件資料夾ID';
  const folderId = sanitize_(getSetting_(folderSetting, ''));
  let folder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();
  const file = folder.createFile(Utilities.newBlob(bytes, contentType, name + ext));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return {
    name: file.getName(),
    url: file.getUrl(),
    id: file.getId(),
    viewUrl: 'https://drive.google.com/file/d/' + file.getId() + '/view',
    rawUrl: 'https://drive.google.com/uc?export=view&id=' + file.getId()
  };
}


function getTaskPageBaseUrl_() {
  return sanitize_(getSetting_('任務頁網址', 'https://danny700808.github.io/play-card/task.html')) || 'https://danny700808.github.io/play-card/task.html';
}
function getTaskPageUrl_(taskId) {
  var base = getTaskPageBaseUrl_();
  if (!sanitize_(taskId)) return base;
  return base + (base.indexOf('?') > -1 ? '&' : '?') + 'taskId=' + encodeURIComponent(taskId);
}
function linkHtml_(label, url) {
  if (!sanitize_(url)) return '';
  return '<div style="margin:10px 0"><a href="' + url + '" style="display:inline-block;padding:10px 16px;background:#1f7a5a;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700">' + label + '</a></div>';
}
function sendMailWithHtml_(to, subject, textBody, htmlBody) {
  if (!sanitize_(to)) return;
  MailApp.sendEmail({to: to, subject: subject, body: textBody || '', htmlBody: htmlBody || undefined});
}

function sendDualMail_(userEmail, subject, body, extraEmail) {
  var adminEmail = sanitize_(extraEmail || getSetting_('管理通知信箱', ''));
  sendMailWithHtml_(userEmail, subject, body, '');
  if (adminEmail && adminEmail.toLowerCase() !== String(userEmail || '').toLowerCase()) sendMailWithHtml_(adminEmail, subject, body, '');
}



function fixedWorkWindowForDate_(d) {
  var day = new Date(d).getDay();
  if (day === 1) return null;
  var dateText = dateStr_(d);
  if (day >= 2 && day <= 5) return { start: dateText + ' 12:30:00', end: dateText + ' 21:00:00' };
  return { start: dateText + ' 10:00:00', end: dateText + ' 21:00:00' };
}

function parseDateTimeLocal_(dateText, timeText) {
  if (!sanitize_(dateText) || !sanitize_(timeText)) return null;
  var hhmm = sanitize_(timeText).slice(0,5);
  var d = new Date(dateText + 'T' + hhmm + ':00');
  return isNaN(d) ? null : d;
}

function getApprovedLeaveWindowsForDate_(userId, dateText) {
  var sheet = sh_(SHEETS.leaveRecords);
  var rows = sheet.getDataRange().getValues();
  var headerMap = getHeaderMap_(sheet);
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    if (sanitize_(getRowValueByHeaders_(rows[i], headerMap, ['員工ID'])) !== sanitize_(userId)) continue;
    if (sanitize_(getRowValueByHeaders_(rows[i], headerMap, ['請假日期'])) !== sanitize_(dateText)) continue;
    out.push({
      start: sanitize_(getRowValueByHeaders_(rows[i], headerMap, ['請假開始時間'])),
      end: sanitize_(getRowValueByHeaders_(rows[i], headerMap, ['請假結束時間'])),
      hours: sanitize_(getRowValueByHeaders_(rows[i], headerMap, ['請假時數'])),
      reason: sanitize_(getRowValueByHeaders_(rows[i], headerMap, ['請假原因'])),
      note: sanitize_(getRowValueByHeaders_(rows[i], headerMap, ['備註']))
    });
  }
  return out;
}

function isFullDayLeave_(leaveRow) {
  var hours = Number(leaveRow.hours || 0);
  var text = (sanitize_(leaveRow.reason) + ' ' + sanitize_(leaveRow.note)).toLowerCase();
  return hours >= 8 || text.indexOf('全天') > -1 || text.indexOf('整天') > -1;
}

function applyLeavesToWindow_(window, leaves, dateText) {
  if (!window) return null;
  var start = parseDateTimeLocal_(dateText, window.start.split(' ')[1]);
  var end = parseDateTimeLocal_(dateText, window.end.split(' ')[1]);
  if (!start || !end) return null;
  for (var i = 0; i < leaves.length; i++) {
    var leave = leaves[i];
    if (isFullDayLeave_(leave)) return null;
    var ls = parseDateTimeLocal_(dateText, leave.start);
    var le = parseDateTimeLocal_(dateText, leave.end);
    if (!ls || !le) continue;
    if (ls <= start && le >= end) return null;
    if (ls <= start && le > start && le < end) start = le;
    if (le >= end && ls > start && ls < end) end = ls;
  }
  if (start >= end) return null;
  return { start: Utilities.formatDate(start, TIMEZONE, 'yyyy-MM-dd HH:mm:ss'), end: Utilities.formatDate(end, TIMEZONE, 'yyyy-MM-dd HH:mm:ss') };
}

function getEffectiveWorkWindowForUser_(user, d) {
  if (!user || user.isPartTime) return null;
  var dateText = dateStr_(d);
  var baseWindow = fixedWorkWindowForDate_(d);
  if (!baseWindow) return null;
  var leaves = getApprovedLeaveWindowsForDate_(user.id, dateText);
  return applyLeavesToWindow_(baseWindow, leaves, dateText);
}

function hasClockedActionForDate_(userId, dateText, actionName) {
  var rows = sh_(SHEETS.clock).getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (sanitize_(rows[i][1]) === sanitize_(userId) && sanitize_(rows[i][4]) === sanitize_(dateText) && sanitize_(rows[i][7]) === sanitize_(actionName)) return true;
  }
  return false;
}

function shouldSendClockReminderKey_(key) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(key)) return false;
  props.setProperty(key, nowStr_());
  return true;
}

function sendClockReminderEmails() {
  var now = now_();
  var users = employeesRows_();
  for (var i = 1; i < users.length; i++) {
    var user = mapEmployeeRow_(users[i], i + 1);
    if (user.accountStatus !== 'active') continue;
    if (user.isPartTime) continue;
    var window = getEffectiveWorkWindowForUser_(user, now);
    if (!window) continue;
    var start = new Date(window.start.replace(' ', 'T'));
    var end = new Date(window.end.replace(' ', 'T'));
    var inReminder = new Date(start.getTime() - 10 * 60000);
    var dateText = dateStr_(now);
    if (Math.abs(now.getTime() - inReminder.getTime()) <= 4 * 60000 && !hasClockedActionForDate_(user.id, dateText, '上班打卡')) {
      var inKey = 'clock_remind_in_' + user.id + '_' + dateText + '_' + Utilities.formatDate(inReminder, TIMEZONE, 'HHmm');
      if (shouldSendClockReminderKey_(inKey)) {
        sendMailWithHtml_(user.email, '【打卡提醒】請記得上班打卡',
          '你好，現在接近上班時間，請記得完成上班打卡。\n若你今天是特殊班，請依實際上班時間完成打卡。\n若已完成打卡，請忽略此提醒。', '');
      }
    }
    if (Math.abs(now.getTime() - end.getTime()) <= 4 * 60000 && !hasClockedActionForDate_(user.id, dateText, '下班打卡')) {
      var outKey = 'clock_remind_out_' + user.id + '_' + dateText + '_' + Utilities.formatDate(end, TIMEZONE, 'HHmm');
      if (shouldSendClockReminderKey_(outKey)) {
        sendMailWithHtml_(user.email, '【打卡提醒】請記得下班打卡',
          '你好，現在已到下班時間，請記得完成下班打卡。\n若你今天是特殊班，請依實際下班時間完成打卡。\n若已完成打卡，請忽略此提醒。', '');
      }
    }
  }
  return 'ok';
}

function setupClockReminderTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendClockReminderEmails') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('sendClockReminderEmails').timeBased().everyMinutes(5).create();
}

function setupSheets() {
  const defs = [
    [SHEETS.employees, ['員工ID','姓名','Email','密碼','角色','是否工讀生','帳號狀態','建立時間','最後登入時間']],
    [SHEETS.clock, ['紀錄ID','員工ID','姓名','Email','日期','星期','打卡方式','動作','時間','狀態','遲到分鐘','回報IP','當日序號','是否補登','補登原因','建立時間']],
    [SHEETS.clockFail, ['紀錄ID','員工ID','姓名','Email','日期','星期','打卡方式','動作','時間','失敗原因','回報IP','當日序號','是否補登','補登原因','建立時間']],
    [SHEETS.leaveRequests, ['申請ID','員工ID','姓名','Email','請假日期','請假開始時間','請假結束時間','請假時數','請假原因','備註','附件檔名','附件網址','申請狀態','申請時間','審核人','審核時間']],
    [SHEETS.leaveRecords, ['紀錄ID','申請ID','員工ID','姓名','請假日期','請假開始時間','請假結束時間','請假時數','請假原因','備註','附件檔名','附件網址','核准人','核准時間','建立時間']],
    [SHEETS.parttime, ['紀錄ID','員工ID','姓名','Email','日期','時數','半小時','總時數','時薪','當日薪資','備註','建立時間']],
    [SHEETS.tasks, ['任務ID','標題','內容','指派員工ID','指派員工姓名','指派員工Email','截止日期','截止時間','完成回報需求','提醒頻率','狀態','建立時間','建立者ID','建立者姓名','任務圖片檔名','任務圖片網址','任務錄音檔名','任務錄音網址','期限模式','期限標籤']],
    [SHEETS.taskDone, ['完成ID','任務ID','員工ID','姓名','Email','完成時間','完成備註','完成照片檔名','完成照片網址','完成錄音檔名','完成錄音網址']],
    [SHEETS.settings, ['設定名稱','設定值']]
  ];
  const ss = ss_();
  defs.forEach(function(def) {
    let sheet = ss.getSheetByName(def[0]);
    if (!sheet) {
      sheet = ss.insertSheet(def[0]);
      sheet.getRange(1, 1, 1, def[1].length).setValues([def[1]]);
      return;
    }
    var existing = getHeaderMap_(sheet);
    def[1].forEach(function(h) {
      if (!existing[h]) {
        sheet.insertColumnAfter(sheet.getLastColumn() || 1);
        sheet.getRange(1, sheet.getLastColumn()).setValue(h);
      }
    });
  });
}


function testMail() {
  MailApp.sendEmail('danny700808@gmail.com', '員工系統測試信', '這是一封測試信');
}

function testDriveWrite() {
  const folderId = '1q-iXAO8D6UI4lYHfeNKQVkI0mDeX399o';
  const folder = DriveApp.getFolderById(folderId);
  const file = folder.createFile('drive-test.txt', 'Drive write test');
  Logger.log(file.getUrl());
}
