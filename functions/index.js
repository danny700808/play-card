const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const ADMIN_EMAILS = new Set(['danny700808@gmail.com']);
const DEFAULT_ADMIN_DOC_ID = 'ADMIN_DANNY';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isBootstrapAdminEmail(email) {
  return ADMIN_EMAILS.has(normalizeEmail(email));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function parseRentalApplicationCommand(text) {
  const raw = normalizeText(text).replace(/\r/g, '\n');
  if (!raw) return null;

  const patterns = [
    /(?:設備租賃申請|租賃申請|租賃申請編號|租賃訂單|訂單編號|申請編號|訂單)\s*[:：]?\s*([A-Za-z0-9_-]{6,})(?:\s+([^\n]+))?/i,
    /(?:編號)\s*[:：]?\s*([A-Za-z0-9_-]{6,})(?:\s+([^\n]+))?/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return {
        applicationKey: normalizeText(match[1]),
        declaredName: normalizeText(match[2] || '')
      };
    }
  }

  return null;
}

async function replyLineMessage(replyToken, message) {
  const token = await getLineAccessToken();

  if (!replyToken) {
    console.log('Missing replyToken. Message:', message);
    return;
  }

  if (!token) {
    console.log('Missing LINE_CHANNEL_ACCESS_TOKEN. Message:', message);
    return;
  }

  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text: message }]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('LINE reply failed:', response.status, body);
  }
}


async function pushLineMessage(lineUserId, message) {
  const token = await getLineAccessToken();
  if (!token || !lineUserId) return;
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: 'text', text: message }]
    })
  });
  if (!response.ok) {
    const body = await response.text();
    console.error('LINE push failed:', response.status, body);
  }
}

async function getLineProfile(lineUserId) {
  const token = await getLineAccessToken();
  if (!token || !lineUserId) return {};
  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) return {};
    return await response.json();
  } catch (error) {
    console.error('getLineProfile failed:', error);
    return {};
  }
}

function webBaseUrl() {
  return String(process.env.PUBLIC_WEB_BASE_URL || 'https://danny700808.github.io/play-card/').replace(/\/?$/, '/');
}

async function findRentalApplication(applicationKey) {
  const key = normalizeText(applicationKey);
  if (!key) return null;

  const byId = await db.collection('rentalApplications').doc(key).get();
  if (byId.exists) return { id: byId.id, ref: byId.ref, data: byId.data() };

  const fields = ['applicationNo', 'applicationId', 'rentalApplicationNo'];
  for (const field of fields) {
    const snap = await db.collection('rentalApplications').where(field, '==', key).limit(1).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      return { id: doc.id, ref: doc.ref, data: doc.data() };
    }
  }
  return null;
}

async function handleRentalApplicationLink({ applicationKey, declaredName, lineUserId, replyToken }) {
  const app = await findRentalApplication(applicationKey);
  if (!app) {
    await replyLineMessage(replyToken, `找不到租賃申請編號：${applicationKey}。請確認是否完整複製表單送出後產生的文字。`);
    return;
  }

  const profile = await getLineProfile(lineUserId);
  const lineDisplayName = normalizeText(profile.displayName || '');
  const data = app.data || {};
  const applicationNo = normalizeText(data.applicationNo || data.applicationId || app.id);
  const customerName = normalizeText(data.customerName || declaredName || '未填姓名');
  const now = admin.firestore.FieldValue.serverTimestamp();

  await app.ref.set({
    lineUserId,
    customerLineUserId: lineUserId,
    lineDisplayName,
    lineLinkStatus: 'linked',
    lineLinkedAt: now,
    lineLinkedAtText: new Date().toISOString(),
    lineConfirmText: `設備租賃申請 ${applicationNo}`, 
    status: data.status || '待店家確認',
    updatedAt: now
  }, { merge: true });

  await replyLineMessage(replyToken, `已收到您的租賃申請：${applicationNo}

柚子樂器會透過此 LINE 先與您確認設備、金額與安裝／交付時間。

確認後會再傳正式資料連結給您。屆時需要填寫身分證字號並上傳身分證照片，請您先準備相關資料。`);

  const managerLineUserId = await getPrimaryManagerLineUserId();
  if (managerLineUserId && managerLineUserId !== lineUserId) {
    const adminUrl = `${webBaseUrl()}rental-admin.html?applicationId=${encodeURIComponent(app.id)}`;
    const equipment = normalizeText(data.otherEquipmentNeed || data.equipmentName || data.rentalType || '');
    const message = [
      '有客人完成租賃 LINE 連結',
      `姓名：${customerName}`,
      `電話：${normalizeText(data.customerPhone || '')}`,
      `申請編號：${applicationNo}`,
      `租用需求：${equipment || '未填寫'}`,
      `希望方式：${normalizeText(data.shippingMethod || '')}`,
      `希望日期：${normalizeText(data.preferredDate || '')} ${normalizeText(data.preferredTime || '')}`.trim(),
      '',
      `查看申請資料：${adminUrl}`
    ].join('\n');
    await pushLineMessage(managerLineUserId, message);
  }
}

async function findEmployeeByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  const fields = ['email', 'Email', 'mail', 'loginEmail'];

  for (const field of fields) {
    const snap = await db
      .collection('employees')
      .where(field, '==', normalizedEmail)
      .limit(1)
      .get();

    if (!snap.empty) {
      const doc = snap.docs[0];
      return { id: doc.id, ref: doc.ref, data: doc.data() };
    }
  }

  return null;
}


async function ensureBootstrapAdmin(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!isBootstrapAdminEmail(normalizedEmail)) return null;

  const existing = await findEmployeeByEmail(normalizedEmail);
  if (existing) {
    await existing.ref.set(
      {
        email: normalizedEmail,
        role: 'admin',
        identityType: 'admin',
        canViewSettings: true,
        showSettingsZone: true,
        lineNotifyEnabled: true,
        status: 'active',
        adminBootstrap: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    return {
      id: existing.id,
      ref: existing.ref,
      data: {
        ...existing.data,
        email: normalizedEmail,
        role: 'admin',
        identityType: 'admin',
        canViewSettings: true,
        showSettingsZone: true,
        lineNotifyEnabled: true,
        status: 'active',
        adminBootstrap: true
      }
    };
  }

  const ref = db.collection('employees').doc(DEFAULT_ADMIN_DOC_ID);
  const data = {
    name: '黃銘廷',
    email: normalizedEmail,
    role: 'admin',
    identityType: 'admin',
    canViewSettings: true,
    showSettingsZone: true,
    lineNotifyEnabled: true,
    status: 'active',
    adminBootstrap: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await ref.set(data, { merge: true });
  return { id: DEFAULT_ADMIN_DOC_ID, ref, data };
}

function isManagerData(data, docId) {
  if (!data) return false;

  const role = String(data.role || data.userRole || data.permissionRole || '').toLowerCase();
  const identityType = String(data.identityType || data.type || '').toLowerCase();
  const level = String(data.level || '').toLowerCase();
  const email = normalizeEmail(data.email || data.Email || data.mail || data.loginEmail || '');

  return (
    isBootstrapAdminEmail(email) ||
    docId === 'PRIMARY_MANAGER_LINE' ||
    role === 'admin' ||
    role === 'manager' ||
    role === '主管' ||
    role === '管理者' ||
    identityType === 'admin' ||
    identityType === 'manager' ||
    identityType === '主管' ||
    identityType === '管理者' ||
    level === 'admin' ||
    level === 'manager' ||
    data.showSettingsZone === true ||
    data.canViewSettings === true ||
    data.isAdmin === true ||
    data.isManager === true
  );
}

async function getPrimaryManagerLineUserId() {
  const doc = await db.collection('employees').doc('PRIMARY_MANAGER_LINE').get();
  if (!doc.exists) return '';
  return String(doc.data().lineUserId || '');
}

async function hasThisLineBoundToAnotherEmployee(lineUserId, currentEmployeeId) {
  if (!lineUserId) return false;

  const snap = await db
    .collection('employees')
    .where('lineUserId', '==', lineUserId)
    .limit(5)
    .get();

  return snap.docs.some((doc) => doc.id !== currentEmployeeId && doc.id !== 'PRIMARY_MANAGER_LINE');
}

async function handleEmployeeBinding({ email, lineUserId, replyToken }) {
  if (isBootstrapAdminEmail(email)) {
    await replyLineMessage(replyToken, '這個 Email 已設定為系統管理者，不能使用員工綁定指令。主管請使用：柚子主管綁定 your@email.com');
    return;
  }

  const employee = await findEmployeeByEmail(email);

  if (!employee) {
    await replyLineMessage(replyToken, `找不到這個員工 Email：${email}`);
    return;
  }

  if (isManagerData(employee.data, employee.id)) {
    await replyLineMessage(replyToken, '這個帳號是主管或管理者帳號，不能使用員工綁定指令。主管請使用：柚子主管綁定 your@email.com');
    return;
  }

  const primaryManagerLineUserId = await getPrimaryManagerLineUserId();
  if (primaryManagerLineUserId && primaryManagerLineUserId === lineUserId) {
    await replyLineMessage(replyToken, '這支 LINE 已被設定為主管通知帳號，不能綁定員工帳號。請員工使用自己的手機 LINE 綁定。');
    return;
  }

  if (employee.data.lineUserId && employee.data.lineUserId !== lineUserId) {
    await replyLineMessage(replyToken, '這位員工已綁定其他 LINE。若要重新綁定，請先由主管到員工管理清除此員工 LINE 綁定。');
    return;
  }

  const isAlreadyBoundElsewhere = await hasThisLineBoundToAnotherEmployee(lineUserId, employee.id);
  if (isAlreadyBoundElsewhere) {
    await replyLineMessage(replyToken, '這支 LINE 已綁定其他員工帳號，不能重複綁定。請先由主管清除原本的 LINE 綁定。');
    return;
  }

  await employee.ref.set(
    {
      lineUserId,
      lineNotifyEnabled: true,
      lineBoundAt: admin.firestore.FieldValue.serverTimestamp(),
      lineBindingEmail: email,
      lineBindingRole: 'employee'
    },
    { merge: true }
  );

  await replyLineMessage(replyToken, `員工 LINE 綁定成功：${employee.data.name || employee.data.displayName || email}`);
}

async function handleManagerBinding({ email, lineUserId, replyToken }) {
  const employee = isBootstrapAdminEmail(email)
    ? await ensureBootstrapAdmin(email)
    : await findEmployeeByEmail(email);

  if (!employee || !isManagerData(employee.data, employee.id)) {
    await replyLineMessage(replyToken, '這個 Email 不是主管或管理者帳號，不能設定為主管 LINE。');
    return;
  }

  await db.collection('employees').doc('PRIMARY_MANAGER_LINE').set(
    {
      lineUserId,
      email,
      name: employee.data.name || employee.data.displayName || email,
      lineNotifyEnabled: true,
      lineBoundAt: admin.firestore.FieldValue.serverTimestamp(),
      lineBindingRole: 'manager'
    },
    { merge: true }
  );

  await replyLineMessage(replyToken, `主管 LINE 綁定成功：${employee.data.name || employee.data.displayName || email}`);
}


/* =========================================================
 * 設備租賃 HTTP API 與通知佇列發送器
 * ---------------------------------------------------------
 * 重要：firebase.json 部署的是 functions/ 目錄。
 * rental-*.html 會呼叫這些 HTTPS Function，並將 LINE / Email 通知寫入
 * notificationQueue；這裡負責把佇列真的送出去。
 * ========================================================= */

const QUEUE_COLLECTION = 'notificationQueue';
const SENT_STATUSES = new Set(['sent', '已發送', '已送出', 'done', 'completed', 'success']);
const SENDING_STATUSES = new Set(['sending', '發送中']);
const PENDING_STATUSES = new Set(['pending', '待發送', 'queued', 'queue', '待處理', 'retry', '發送失敗']);
const HTTP_OPTIONS = { region: 'us-central1', cors: true, timeoutSeconds: 120, memory: '512MiB' };

function clean(value) {
  return normalizeText(value);
}

function nowText() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function dateKey() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function randomToken(bytes = 18) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomId(prefix) {
  return `${prefix}${dateKey()}${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function safeId(value) {
  return clean(value).replace(/[\/#?\[\]]/g, '_').slice(0, 180) || db.collection('_ids').doc().id;
}

function stripUndefined(value) {
  if (value === undefined) return null;
  if (value == null) return value;
  if (value && typeof value.toDate === 'function') return value;
  if (value && typeof value.isEqual === 'function') return value;
  if (value && value._methodName) return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => {
      if (value[key] !== undefined) out[key] = stripUndefined(value[key]);
    });
    return out;
  }
  return value;
}

function setCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

function sendJson(res, status, body) {
  setCorsHeaders(res);
  res.status(status).json(body || {});
}

function requestData(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : '';
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    return {};
  }
}

function httpEndpoint(handler, options = {}) {
  return onRequest(Object.assign({}, HTTP_OPTIONS, options), async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, message: 'Method Not Allowed' });
      return;
    }
    try {
      const result = await handler(requestData(req), req);
      sendJson(res, 200, Object.assign({ ok: true }, result || {}));
    } catch (error) {
      console.error('[httpEndpoint error]', error);
      sendJson(res, 400, { ok: false, message: error && error.message ? error.message : String(error) });
    }
  });
}

async function getSystemSettingValue(names) {
  const wanted = (Array.isArray(names) ? names : [names]).map(clean).filter(Boolean);
  for (const name of wanted) {
    try {
      const snap = await db.collection('systemSettings').doc(name).get();
      if (snap.exists) {
        const data = snap.data() || {};
        const value = clean(data.value || data.token || data.accessToken || data.secret || data.text);
        if (value) return value;
      }
    } catch (err) {
      // keep trying below
    }
  }
  try {
    const snap = await db.collection('systemSettings').limit(200).get();
    let found = '';
    snap.forEach((doc) => {
      if (found) return;
      const data = doc.data() || {};
      const key = clean(data.key || data.name || doc.id);
      if (wanted.includes(key)) found = clean(data.value || data.token || data.accessToken || data.secret || data.text);
    });
    return found;
  } catch (err) {
    return '';
  }
}

async function getLineAccessToken() {
  const token = clean(
    process.env.LINE_CHANNEL_ACCESS_TOKEN ||
    process.env.LINE_MESSAGING_ACCESS_TOKEN ||
    process.env.LINE_ACCESS_TOKEN ||
    process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN ||
    ''
  );
  if (token) return token;
  return await getSystemSettingValue([
    'LINE_CHANNEL_ACCESS_TOKEN',
    'LINE Channel Access Token',
    'LINE Messaging API Token',
    'LINE Access Token',
    'LINE Bot Access Token',
    'LINE_TOKEN'
  ]);
}

function queueStatus(row = {}) {
  return clean(row.status || row['狀態'] || '待發送');
}

function isPendingQueue(row = {}) {
  const status = queueStatus(row);
  if (SENT_STATUSES.has(status) || SENDING_STATUSES.has(status)) return false;
  return !status || PENDING_STATUSES.has(status) || /^fail|失敗|error/i.test(status);
}

function queueChannel(row = {}) {
  return clean(row.channel || row.type || row.notifyType || row['發送方式']).toLowerCase();
}

function queueTargetLineUserId(row = {}) {
  return clean(row.targetLineUserId || row.lineUserId || row.toLineUserId || row.customerLineUserId || row['LINE User ID']);
}

function queueTargetEmail(row = {}) {
  return clean(row.targetEmail || row.email || row.toEmail || row.customerEmail || row['Email']).toLowerCase();
}

function queueTitle(row = {}) {
  return clean(row.title || row.subject || row.eventName || '柚子樂器通知');
}

function queueBody(row = {}) {
  const body = clean(row.body || row.message || row.content || row.text || row['訊息內容']);
  if (body) return body;
  return queueTitle(row) || '您有一則新的通知。';
}

async function sendLinePush(row) {
  const to = queueTargetLineUserId(row);
  if (!to) throw new Error('缺少 LINE User ID，無法發送 LINE。');
  const token = await getLineAccessToken();
  if (!token) throw new Error('缺少 LINE_CHANNEL_ACCESS_TOKEN，尚未設定 LINE Messaging API Channel access token。');

  const title = queueTitle(row);
  const body = queueBody(row);
  const text = title && body && title !== body ? `${title}\n${body}` : (body || title || '柚子樂器通知');
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text: text.slice(0, 4900) }],
    }),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`LINE API ${response.status}：${responseText.slice(0, 500)}`);
  }
  return { provider: 'line-messaging-api', responseStatus: response.status, responseText: responseText.slice(0, 500) };
}

async function sendEmailViaGmail(row) {
  const to = queueTargetEmail(row);
  if (!to) throw new Error('缺少 Email，無法發送 Email。');

  const gmailUser = clean(process.env.GMAIL_USER || '');
  const gmailAppPassword = clean(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
  const from = clean(process.env.EMAIL_FROM || '') || `柚子樂器 <${gmailUser}>`;

  if (!gmailUser || !gmailAppPassword) {
    throw new Error('Gmail 尚未設定 GMAIL_USER / GMAIL_APP_PASSWORD。');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailAppPassword,
    },
  });

  const subject = queueTitle(row) || '柚子樂器通知';
  const body = queueBody(row) || '';
  const html = clean(row.html || row.htmlBody || '') || body.replace(/\n/g, '<br>');

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text: body || subject,
    html,
  });

  return {
    provider: 'gmail',
    responseStatus: 200,
    responseText: clean(info && info.messageId ? info.messageId : ''),
  };
}

async function sendEmailViaSendGrid(row) {
  // 保留舊函式名稱，讓 notificationQueue 的原本流程不用重寫。
  // 實際寄信已改為 Gmail SMTP。
  return await sendEmailViaGmail(row);
}

async function markQueue(docRef, data) {
  await docRef.set(Object.assign({}, data, { updatedAt: admin.firestore.FieldValue.serverTimestamp() }), { merge: true });
}

async function appendNotificationLog(queueId, data) {
  const id = `${safeId(queueId)}_${Date.now()}`;
  await db.collection('notificationLogs').doc(id).set(Object.assign({
    logId: id,
    queueId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtText: nowText(),
  }, data || {}), { merge: true });
}

async function processNotificationQueueDoc(docRef, row, options = {}) {
  row = row || {};
  const queueId = clean(row.queueId || docRef.id);
  const channel = queueChannel(row);
  if (!isPendingQueue(row)) return { ok: true, skipped: true, reason: `狀態不是待發送：${queueStatus(row)}` };
  if (!['line', 'email'].includes(channel)) {
    await markQueue(docRef, { status: '發送失敗', lastError: `不支援的發送方式：${channel || '(空白)'}` });
    return { ok: false, skipped: true, reason: 'unsupported-channel' };
  }

  await markQueue(docRef, {
    queueId,
    status: '發送中',
    sendStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    sendStartedAtText: nowText(),
    attemptCount: admin.firestore.FieldValue.increment(1),
    processor: options.processor || 'cloud-function',
  });

  try {
    const result = channel === 'line' ? await sendLinePush(row) : await sendEmailViaSendGrid(row);
    await markQueue(docRef, {
      status: '已發送',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      sentAtText: nowText(),
      provider: result.provider,
      responseStatus: result.responseStatus,
      responseText: result.responseText || '',
      lastError: '',
    });
    await appendNotificationLog(queueId, {
      status: '已發送',
      channel,
      provider: result.provider,
      targetEmployeeId: clean(row.targetEmployeeId),
      targetName: clean(row.targetName),
      targetEmail: queueTargetEmail(row),
      targetLineUserId: queueTargetLineUserId(row),
      title: queueTitle(row),
      body: queueBody(row),
    });
    return { ok: true, sent: true, channel, queueId };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await markQueue(docRef, {
      status: '發送失敗',
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
      failedAtText: nowText(),
      lastError: msg,
    });
    await appendNotificationLog(queueId, {
      status: '發送失敗',
      channel,
      error: msg,
      targetEmployeeId: clean(row.targetEmployeeId),
      targetName: clean(row.targetName),
      targetEmail: queueTargetEmail(row),
      targetLineUserId: queueTargetLineUserId(row),
      title: queueTitle(row),
      body: queueBody(row),
    });
    console.error('[notificationQueue send failed]', queueId, msg);
    return { ok: false, error: msg, channel, queueId };
  }
}

async function createNotificationQueue(row) {
  const queueId = clean(row.queueId) || `queue-${Date.now()}-${randomToken(4)}`;
  await db.collection(QUEUE_COLLECTION).doc(queueId).set(stripUndefined(Object.assign({
    queueId,
    status: '待發送',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtText: nowText(),
  }, row || {})), { merge: true });
  return queueId;
}

async function queueManagerNotification({ title, body, source, contractId, applicationId }) {
  const managerLineUserId = await getPrimaryManagerLineUserId();
  if (managerLineUserId) {
    return await createNotificationQueue({
      channel: 'line',
      targetLineUserId: managerLineUserId,
      targetName: '柚子樂器主管',
      title,
      body,
      message: body,
      source,
      contractId,
      applicationId,
    });
  }
  return await createNotificationQueue({
    channel: 'email',
    targetEmail: 'danny700808@gmail.com',
    targetName: '柚子樂器管理者',
    title,
    body,
    message: body,
    source,
    contractId,
    applicationId,
  });
}

function buildSignUrl(contract) {
  const base = webBaseUrl();
  return `${base}rental-sign.html?contractId=${encodeURIComponent(clean(contract.contractId || contract.__id))}&token=${encodeURIComponent(clean(contract.signToken || contract.token))}`;
}

function buildOfficialContractUrl(contract) {
  const base = webBaseUrl();
  const token = clean(contract.officialContractToken || contract.customerToken || contract.signToken || contract.token);
  return `${base}rental-contract.html?contractId=${encodeURIComponent(clean(contract.contractId || contract.__id))}&token=${encodeURIComponent(token)}`;
}

async function getContractForToken(contractId, token, options = {}) {
  const id = clean(contractId);
  if (!id) throw new Error('缺少契約編號。');
  const snap = await db.collection('rentalContracts').doc(id).get();
  if (!snap.exists) throw new Error('找不到契約資料。');
  const contract = Object.assign({ __id: snap.id }, snap.data() || {});
  const allowed = [contract.officialContractToken, contract.customerToken, contract.signToken, contract.token]
    .map(clean)
    .filter(Boolean);
  if (options.allowNoToken !== true && (!clean(token) || !allowed.includes(clean(token)))) {
    throw new Error('契約連結驗證失敗。');
  }
  return { ref: snap.ref, contract };
}

exports.sendNotificationQueueOnCreate = onDocumentCreated(`${QUEUE_COLLECTION}/{queueId}`, async (event) => {
  const snap = event.data;
  if (!snap) return null;
  return await processNotificationQueueDoc(snap.ref, snap.data() || {}, { processor: 'onCreate' });
});

exports.flushNotificationQueue = onSchedule({ schedule: 'every 5 minutes', region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' }, async () => {
  const snap = await db.collection(QUEUE_COLLECTION).where('status', 'in', ['待發送', 'pending', 'queued', 'retry']).limit(50).get();
  const results = [];
  for (const doc of snap.docs) {
    results.push(await processNotificationQueueDoc(doc.ref, doc.data() || {}, { processor: 'scheduler' }));
  }
  return results;
});

exports.processNotificationQueueNowHttp = httpEndpoint(async (data) => {
  const queueId = clean(data.queueId || '');
  const limit = Math.max(1, Math.min(Number(data.limit || 20) || 20, 50));
  if (queueId) {
    const ref = db.collection(QUEUE_COLLECTION).doc(queueId);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('找不到通知佇列資料。');
    const result = await processNotificationQueueDoc(ref, snap.data() || {}, { processor: 'manual-http' });
    return Object.assign({ ok: result.ok !== false }, result);
  }
  const snap = await db.collection(QUEUE_COLLECTION).where('status', 'in', ['待發送', 'pending', 'queued', 'retry', '發送失敗']).limit(limit).get();
  const results = [];
  for (const doc of snap.docs) {
    results.push(await processNotificationQueueDoc(doc.ref, doc.data() || {}, { processor: 'manual-http' }));
  }
  return { count: results.length, results };
});

exports.emailSendCheckHttp = httpEndpoint(async (data) => {
  const to = clean(data.to || data.email || data.targetEmail);
  if (!to) throw new Error('請輸入測試收件 Email。');
  const title = clean(data.title || '柚子樂器 Email 發送測試');
  const body = clean(data.body || '這是一封柚子樂器系統 Email 發送測試。');
  const queueId = await createNotificationQueue({
    queueId: `email-send-check-${Date.now()}`,
    channel: 'email',
    targetEmail: to,
    targetName: clean(data.targetName || '測試收件人'),
    title,
    body,
    message: body,
    source: 'email-send-check',
  });
  return { queueId, message: '已建立 Email 測試佇列。' };
});

exports.rentalSubmitApplicationHttp = httpEndpoint(async (data) => {
  const applicationId = clean(data.applicationId || data.applicationNo) || randomId('RA');
  const customerName = clean(data.customerName || data.partyAName || '未填姓名');
  const applicationNo = clean(data.applicationNo || applicationId);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const ref = db.collection('rentalApplications').doc(applicationId);
  const exists = (await ref.get()).exists;
  const row = stripUndefined(Object.assign({}, data, {
    applicationId,
    applicationNo,
    customerName,
    lineConfirmText: clean(data.lineConfirmText) || `設備租賃申請 ${applicationNo}`, 
    lineLinkStatus: clean(data.lineLinkStatus || 'pending'),
    status: clean(data.status || '待店家確認'),
    updatedAt: now,
    updatedAtText: nowText(),
  }));
  if (!exists) {
    row.createdAt = now;
    row.createdAtText = clean(data.createdAtText || nowText());
  }
  await ref.set(row, { merge: true });

  try {
    const adminUrl = `${webBaseUrl()}rental-admin.html?applicationId=${encodeURIComponent(applicationId)}`;
    const body = [
      '收到新的設備租賃申請',
      `姓名：${customerName}`,
      `電話：${clean(data.customerPhone || '')}`,
      `設備需求：${clean(data.otherEquipmentNeed || data.equipmentName || data.rentalType || '未填寫')}`,
      `希望方式：${clean(data.shippingMethod || '')}`,
      `希望日期：${clean(data.preferredDate || '')} ${clean(data.preferredTime || '')}`.trim(),
      '',
      `申請編號：${applicationNo}`,
      `查看申請資料：${adminUrl}`,
      '',
      `請客人加入官方 LINE 後貼上：設備租賃申請 ${applicationNo}`
    ].join('\n');
    await queueManagerNotification({ title: '新的設備租賃申請', body, source: 'rental-application', applicationId });
  } catch (err) {
    console.error('[rentalSubmitApplicationHttp queue manager notice failed]', err);
  }

  return { applicationId, applicationNo, lineConfirmText: row.lineConfirmText };
});

exports.rentalSaveContractHttp = httpEndpoint(async (data) => {
  const incomingId = clean(data.contractId || data.id || data.__id);
  const contractId = incomingId || randomId('RC');
  const ref = db.collection('rentalContracts').doc(contractId);
  const currentSnap = await ref.get();
  const current = currentSnap.exists ? (currentSnap.data() || {}) : {};
  const signToken = clean(data.signToken || current.signToken || current.token) || randomToken(18);
  const customerToken = clean(data.customerToken || current.customerToken) || randomToken(18);
  const officialContractToken = clean(data.officialContractToken || current.officialContractToken) || randomToken(18);
  const contractNo = clean(data.contractNo || current.contractNo || contractId);
  const status = data.makeSignLink ? '待客人補資料' : clean(data.status || current.status || '草稿');
  const now = admin.firestore.FieldValue.serverTimestamp();
  const row = stripUndefined(Object.assign({}, current, data, {
    contractId,
    contractNo,
    signToken,
    token: signToken,
    customerToken,
    officialContractToken,
    signUrl: buildSignUrl({ contractId, signToken }),
    officialContractUrl: buildOfficialContractUrl({ contractId, officialContractToken, customerToken, signToken }),
    status,
    updatedAt: now,
    updatedAtText: nowText(),
  }));
  if (!currentSnap.exists) {
    row.createdAt = now;
    row.createdAtText = clean(data.createdAtText || nowText());
  }
  await ref.set(row, { merge: true });

  const applicationId = clean(data.applicationId || current.applicationId);
  if (applicationId) {
    await db.collection('rentalApplications').doc(applicationId).set({
      status: '已轉正式契約',
      linkedContractId: contractId,
      contractId,
      updatedAt: now,
      updatedAtText: nowText(),
    }, { merge: true });
  }

  return {
    contractId,
    contractNo,
    signToken,
    token: signToken,
    customerToken,
    officialContractToken,
    signUrl: row.signUrl,
    officialContractUrl: row.officialContractUrl,
  };
});

exports.rentalSignContractHttp = httpEndpoint(async (data) => {
  const contractId = clean(data.contractId || data.id);
  const token = clean(data.token || data.signToken);
  const { ref, contract } = await getContractForToken(contractId, token);
  const signatureDataUrl = clean(data.signatureDataUrl || data.customerSignatureDataUrl || contract.signatureDataUrl || contract.customerSignatureDataUrl);
  if (!signatureDataUrl) throw new Error('缺少簽名資料。');
  const update = stripUndefined({
    customerIdNumber: clean(data.customerIdNumber || contract.customerIdNumber),
    customerIdImageWatermarkedDataUrl: clean(data.customerIdImageWatermarkedDataUrl || data.idImageWatermarkedDataUrl || contract.customerIdImageWatermarkedDataUrl),
    idImageWatermarkedDataUrl: clean(data.customerIdImageWatermarkedDataUrl || data.idImageWatermarkedDataUrl || contract.idImageWatermarkedDataUrl),
    signatureDataUrl,
    customerSignatureDataUrl: signatureDataUrl,
    customerSubmittedFormalAt: clean(data.customerSubmittedFormalAt || nowText()),
    customerSignedAt: clean(data.customerSignedAt || nowText()),
    formalReceivedNoticeText: clean(data.formalReceivedNoticeText || contract.formalReceivedNoticeText),
    status: '待店家確認',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: nowText(),
  });
  await ref.set(update, { merge: true });
  return { contractId, status: '待店家確認' };
});

exports.rentalGetContractHttp = httpEndpoint(async (data) => {
  const { contract } = await getContractForToken(data.contractId || data.id, data.token || data.signToken);
  return { contract };
});

exports.rentalSubmitRenewalRequestHttp = httpEndpoint(async (data) => {
  const { ref, contract } = await getContractForToken(data.contractId || data.id, data.token || data.customerToken || data.signToken);
  const requestId = clean(data.requestId) || randomId('RR');
  const periods = Math.max(1, Math.min(10, Number(data.periods || 1) || 1));
  const note = clean(data.note || data.renewNote || '');
  const row = stripUndefined({
    requestId,
    contractId: contract.contractId || contract.__id,
    contractNo: contract.contractNo || '',
    customerName: contract.customerName || '',
    customerPhone: contract.customerPhone || '',
    customerEmail: contract.customerEmail || '',
    customerLineUserId: contract.customerLineUserId || contract.lineUserId || '',
    periods,
    note,
    status: '待店家確認',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtText: nowText(),
    source: 'rental-renewal',
  });
  await db.collection('rentalRenewalRequests').doc(requestId).set(row, { merge: true });
  await ref.set({ status: '續約詢問中', latestRenewalRequestId: requestId, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAtText: nowText() }, { merge: true });
  const adminUrl = `${webBaseUrl()}rental-admin.html?contractId=${encodeURIComponent(contract.contractId || contract.__id)}`;
  await queueManagerNotification({
    title: '租賃續約申請',
    body: [`客人送出續約申請`, `姓名：${clean(contract.customerName)}`, `契約：${clean(contract.contractNo || contract.contractId || contract.__id)}`, `續約期數：${periods}`, `備註：${note || '無'}`, '', `查看契約：${adminUrl}`].join('\n'),
    source: 'rental-renewal-request',
    contractId: contract.contractId || contract.__id,
  });
  return { requestId };
});

exports.rentalSubmitReturnRequestHttp = httpEndpoint(async (data) => {
  const { ref, contract } = await getContractForToken(data.contractId || data.id, data.token || data.customerToken || data.signToken);
  const requestId = clean(data.requestId) || randomId('RT');
  const returnDate = clean(data.returnDate || data.date);
  if (!returnDate) throw new Error('請選擇希望退租日期。');
  const returnTime = clean(data.returnTime || data.time);
  const note = clean(data.note || data.returnNote || '');
  const row = stripUndefined({
    requestId,
    contractId: contract.contractId || contract.__id,
    contractNo: contract.contractNo || '',
    customerName: contract.customerName || '',
    customerPhone: contract.customerPhone || '',
    customerEmail: contract.customerEmail || '',
    customerLineUserId: contract.customerLineUserId || contract.lineUserId || '',
    returnDate,
    returnTime,
    note,
    status: '待店家確認',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtText: nowText(),
    source: 'rental-return',
  });
  await db.collection('rentalReturnRequests').doc(requestId).set(row, { merge: true });
  await ref.set({ status: '退租申請中', latestReturnRequestId: requestId, requestedReturnDate: returnDate, requestedReturnTime: returnTime, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAtText: nowText() }, { merge: true });
  const adminUrl = `${webBaseUrl()}rental-admin.html?contractId=${encodeURIComponent(contract.contractId || contract.__id)}`;
  await queueManagerNotification({
    title: '租賃退租申請',
    body: [`客人送出退租申請`, `姓名：${clean(contract.customerName)}`, `契約：${clean(contract.contractNo || contract.contractId || contract.__id)}`, `希望日期：${returnDate} ${returnTime}`.trim(), `備註：${note || '無'}`, '', `查看契約：${adminUrl}`].join('\n'),
    source: 'rental-return-request',
    contractId: contract.contractId || contract.__id,
  });
  return { requestId };
});

exports.rentalCompleteReturnHttp = httpEndpoint(async (data) => {
  const contractId = clean(data.contractId || data.id);
  if (!contractId) throw new Error('缺少契約編號。');
  const ref = db.collection('rentalContracts').doc(contractId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('找不到契約資料。');
  const contract = Object.assign({ __id: snap.id }, snap.data() || {});
  await ref.set({
    status: '已退租',
    returnedAt: admin.firestore.FieldValue.serverTimestamp(),
    returnedAtText: nowText(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: nowText(),
  }, { merge: true });

  let queueId = '';
  const lineId = clean(contract.customerLineUserId || contract.lineUserId);
  if (lineId) {
    const body = [`您的租賃設備已完成退租收回。`, `契約編號：${clean(contract.contractNo || contract.contractId || snap.id)}`, `完成時間：${nowText()}`, '', '感謝您使用柚子樂器設備租賃服務。'].join('\n');
    queueId = await createNotificationQueue({
      channel: 'line',
      targetLineUserId: lineId,
      targetName: clean(contract.customerName),
      targetEmail: clean(contract.customerEmail),
      title: '租賃退租完成通知',
      body,
      message: body,
      source: 'rental-complete-return',
      contractId,
    });
  }
  return { contractId, status: '已退租', queueId };
});

exports.lineWebhook = onRequest(
  {
    region: 'us-central1',
    cors: false
  },
  async (req, res) => {
    try {
      if (req.method === 'GET') {
        res.status(200).send('LINE webhook is ready. Strict role binding is active.');
        return;
      }

      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      const events = Array.isArray(req.body && req.body.events) ? req.body.events : [];

      for (const event of events) {
        if (event.type !== 'message') continue;
        if (!event.message || event.message.type !== 'text') continue;

        const text = normalizeText(event.message.text);
        const lineUserId = event.source && event.source.userId;
        const replyToken = event.replyToken;

        const rentalCommand = parseRentalApplicationCommand(text);
        const employeeMatch = text.match(/^柚子員工綁定\s+([^\s]+@[^\s]+)$/i);
        const managerMatch = text.match(/^柚子主管綁定\s+([^\s]+@[^\s]+)$/i);
        const oldMatch = text.match(/^柚子綁定\s+([^\s]+@[^\s]+)$/i);

        if (!lineUserId) {
          await replyLineMessage(replyToken, '無法取得 LINE 使用者 ID，請確認是從一般 LINE 帳號與官方帳號對話。');
          continue;
        }

        if (rentalCommand) {
          await handleRentalApplicationLink({
            applicationKey: rentalCommand.applicationKey,
            declaredName: rentalCommand.declaredName,
            lineUserId,
            replyToken
          });
          continue;
        }

        if (oldMatch) {
          await replyLineMessage(replyToken, '舊版綁定指令已停用。員工請輸入：柚子員工綁定 your@email.com；主管請輸入：柚子主管綁定 your@email.com');
          continue;
        }

        if (employeeMatch) {
          await handleEmployeeBinding({
            email: normalizeEmail(employeeMatch[1]),
            lineUserId,
            replyToken
          });
          continue;
        }

        if (managerMatch) {
          await handleManagerBinding({
            email: normalizeEmail(managerMatch[1]),
            lineUserId,
            replyToken
          });
          continue;
        }

        if (text.includes('綁定')) {
          await replyLineMessage(replyToken, '綁定格式錯誤。員工請輸入：柚子員工綁定 your@email.com；主管請輸入：柚子主管綁定 your@email.com');
        }
      }

      res.status(200).send('OK');
    } catch (error) {
      console.error('lineWebhook error:', error);
      res.status(200).send('OK');
    }
  }
);


exports.sendGmailTestEmail = onCall({ region: 'us-central1' }, async (request) => {
  const data = (request && request.data) || {};
  const to = clean((data && (data.to || data.email)) || '');
  if (!to) {
    throw new HttpsError('invalid-argument', '請提供測試收件人 Email。');
  }
  try {
    const result = await sendEmailViaGmail({
      channel: 'email',
      targetEmail: to,
      title: '柚子樂器 Gmail 寄信測試',
      body: [
        '這是一封 Gmail SMTP 測試信。',
        '',
        '如果你收到這封信，代表 Firebase Functions 已經可以透過 Gmail 寄信。',
        '寄出時間：' + nowText(),
      ].join('\n'),
    });
    return { ok: true, result };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error('[sendGmailTestEmail failed]', msg);
    throw new HttpsError('internal', msg);
  }
});
