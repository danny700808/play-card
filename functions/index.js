const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const crypto = require('crypto');
const admin = require('firebase-admin');

admin.initializeApp();
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

async function replyLineMessage(replyToken, message) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

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
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
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
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
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
    lineConfirmText: `租賃申請 ${applicationNo} ${customerName}`,
    status: data.status || '待店家確認',
    updatedAt: now
  }, { merge: true });

  await replyLineMessage(replyToken, `已收到您的租賃申請：${applicationNo}\n\n柚子樂器會先在 LINE 與您再次確認租用機型、安裝／配送時間與相關費用。\n\n雙方確認完成後，我們會再傳送正式資料填寫連結，請您補填身分證字號、詳細資料並完成 LINE 綁定，後續才可使用續約與租賃紀錄查詢功能。`);

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
      `查看申請資料：${adminUrl}`,
      '',
      '客人 LINE 配對文字：',
      `租賃申請 ${applicationNo} ${customerName}`
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

        const rentalMatch = text.match(/^租賃申請\s+([^\s]+)(?:\s+(.+))?$/i);
        const employeeMatch = text.match(/^柚子員工綁定\s+([^\s]+@[^\s]+)$/i);
        const managerMatch = text.match(/^柚子主管綁定\s+([^\s]+@[^\s]+)$/i);
        const oldMatch = text.match(/^柚子綁定\s+([^\s]+@[^\s]+)$/i);

        if (!lineUserId) {
          await replyLineMessage(replyToken, '無法取得 LINE 使用者 ID，請確認是從一般 LINE 帳號與官方帳號對話。');
          continue;
        }

        if (rentalMatch) {
          await handleRentalApplicationLink({
            applicationKey: normalizeText(rentalMatch[1]),
            declaredName: normalizeText(rentalMatch[2] || ''),
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


/* =========================================================
 * Rental renewal + LINE / Email notification queue
 * 2026-06-14
 *
 * Email provider: SendGrid
 * Required Firebase Functions env vars/secrets:
 *   SENDGRID_API_KEY
 *   SENDGRID_FROM_EMAIL
 * Optional:
 *   SENDGRID_FROM_NAME
 *   PUBLIC_WEB_BASE_URL
 * ========================================================= */

const QUEUE_COLLECTION = 'notificationQueue';
const SENT_STATUSES = new Set(['sent', '已發送', '已送出', 'done', 'completed', 'success']);
const SENDING_STATUSES = new Set(['sending', '發送中']);
const PENDING_STATUSES = new Set(['pending', '待發送', 'queued', 'queue', '待處理', 'retry', '發送失敗']);

function corsJson(req, res, status, data) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  res.status(status).json(data || {});
  return true;
}

function requestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_e) { return {}; }
  }
  return req.body || {};
}

function safeDocId(value) {
  return normalizeText(value).replace(/[\/#?\[\]]/g, '_').slice(0, 180) || db.collection('_ids').doc().id;
}

function ymd(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(dateText, days) {
  const d = new Date(`${normalizeText(dateText)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + Number(days || 0));
  return ymd(d);
}

function calcEndDate(startDate, periods, daysPerPeriod) {
  const days = Math.max(1, Number(periods || 1) * Number(daysPerPeriod || 90));
  return addDays(startDate, days - 1);
}

function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

function publicUrl(page, params) {
  const url = new URL(page, webBaseUrl());
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && normalizeText(value)) url.searchParams.set(key, normalizeText(value));
  });
  return url.toString();
}

function contractTokenValues(contract) {
  return [contract.renewalToken, contract.officialContractToken, contract.customerToken, contract.signToken, contract.token]
    .map(normalizeText).filter(Boolean);
}

function validateContractToken(contract, token) {
  const t = normalizeText(token);
  return !!t && contractTokenValues(contract).includes(t);
}

function getContractLineUserId(contract) {
  return normalizeText(contract.customerLineUserId || contract.lineUserId);
}

function getContractEmail(contract) {
  return normalizeEmail(contract.customerEmail || contract.email || contract.Email);
}

function getContractName(contract) {
  return normalizeText(contract.customerName || contract.name || contract.partyAName);
}

function getEquipmentText(contract) {
  if (Array.isArray(contract.equipmentItems) && contract.equipmentItems.length) {
    return contract.equipmentItems.map((item) => normalizeText(item.name || item.equipmentName || item.title)).filter(Boolean).join('、');
  }
  return normalizeText(contract.equipmentName || contract.modelName || contract.itemName || contract.rentalType);
}

async function setQueueDoc(id, data) {
  await db.collection(QUEUE_COLLECTION).doc(id).set(Object.assign({
    queueId: id,
    status: '待發送',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtText: new Date().toISOString()
  }, data || {}), { merge: true });
}

async function queueLineAndEmailForContract(contract, title, body, source, extra = {}) {
  const contractId = normalizeText(contract.contractId || contract.__id || contract.id);
  const baseId = `${source || 'rental'}-${safeDocId(contractId)}-${Date.now()}`;
  let count = 0;
  const base = Object.assign({
    contractId,
    targetName: getContractName(contract),
    targetEmail: getContractEmail(contract),
    title,
    body,
    message: body,
    source: source || 'rental-notification'
  }, extra || {});

  const lineUserId = getContractLineUserId(contract);
  if (lineUserId) {
    await setQueueDoc(`${baseId}-line`, Object.assign({}, base, {
      channel: 'line',
      targetLineUserId: lineUserId
    }));
    count += 1;
  }

  const email = getContractEmail(contract);
  if (email) {
    await setQueueDoc(`${baseId}-email`, Object.assign({}, base, {
      channel: 'email',
      targetEmail: email,
      targetLineUserId: ''
    }));
    count += 1;
  }
  return { count };
}

async function queueManagerNotice(title, body, source, extra = {}) {
  const now = Date.now();
  let count = 0;
  try {
    const manager = await db.collection('employees').doc('PRIMARY_MANAGER_LINE').get();
    if (manager.exists && normalizeText(manager.data().lineUserId)) {
      await setQueueDoc(`${source || 'manager'}-${now}-line`, Object.assign({}, extra, {
        channel: 'line',
        targetLineUserId: normalizeText(manager.data().lineUserId),
        targetName: normalizeText(manager.data().name || '主管'),
        title,
        body,
        message: body,
        source: source || 'manager-notice'
      }));
      count += 1;
    }
  } catch (err) {
    console.warn('queueManagerNotice line skipped:', err && err.message ? err.message : err);
  }

  for (const email of ADMIN_EMAILS) {
    await setQueueDoc(`${source || 'manager'}-${now}-${safeDocId(email)}-email`, Object.assign({}, extra, {
      channel: 'email',
      targetEmail: email,
      targetName: '柚子樂器管理者',
      title,
      body,
      message: body,
      source: source || 'manager-notice'
    }));
    count += 1;
  }
  return { count };
}

function queueStatus(row = {}) {
  return normalizeText(row.status || row['狀態'] || '待發送');
}

function isPendingQueue(row = {}) {
  const status = queueStatus(row);
  if (SENT_STATUSES.has(status) || SENDING_STATUSES.has(status)) return false;
  return !status || PENDING_STATUSES.has(status) || /^fail|失敗|error/i.test(status);
}

function queueChannel(row = {}) {
  return normalizeText(row.channel || row.type || row.notifyType || row['發送方式']).toLowerCase();
}

function queueTargetLineUserId(row = {}) {
  return normalizeText(row.targetLineUserId || row.lineUserId || row.toLineUserId || row['LINE User ID']);
}

function queueTargetEmail(row = {}) {
  return normalizeEmail(row.targetEmail || row.email || row.toEmail || row['Email']);
}

function queueTitle(row = {}) {
  return normalizeText(row.title || row.subject || row.eventName || '柚子樂器通知');
}

function queueBody(row = {}) {
  return normalizeText(row.body || row.message || row.content || row.text || row['訊息內容']) || queueTitle(row) || '您有一則新的通知。';
}

async function sendLineQueue(row) {
  const to = queueTargetLineUserId(row);
  if (!to) throw new Error('缺少 LINE User ID，無法發送 LINE。');
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('缺少 LINE_CHANNEL_ACCESS_TOKEN，尚未設定 LINE Messaging API Channel access token。');

  const title = queueTitle(row);
  const body = queueBody(row);
  const text = title && body && title !== body ? `${title}\n${body}` : (body || title || '柚子樂器通知');
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: text.slice(0, 4900) }] })
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`LINE API ${response.status}：${responseText.slice(0, 500)}`);
  return { provider: 'line-messaging-api', responseStatus: response.status, responseText: responseText.slice(0, 500) };
}

async function sendEmailQueue(row) {
  const to = queueTargetEmail(row);
  if (!to) throw new Error('缺少 Email，無法發送 Email。');
  const apiKey = normalizeText(process.env.SENDGRID_API_KEY || '');
  const from = normalizeEmail(process.env.SENDGRID_FROM_EMAIL || process.env.MAIL_FROM || '');
  const fromName = normalizeText(process.env.SENDGRID_FROM_NAME || '柚子樂器');
  if (!apiKey || !from) throw new Error('Email 尚未設定 SENDGRID_API_KEY / SENDGRID_FROM_EMAIL。');

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to, name: normalizeText(row.targetName) || undefined }] }],
      from: { email: from, name: fromName },
      subject: queueTitle(row),
      content: [{ type: 'text/plain', value: queueBody(row) }]
    })
  });
  const responseText = await response.text();
  if (response.status < 200 || response.status >= 300) throw new Error(`SendGrid API ${response.status}：${responseText.slice(0, 500)}`);
  return { provider: 'sendgrid', responseStatus: response.status, responseText: responseText.slice(0, 500) };
}

async function markQueue(docRef, data) {
  await docRef.set(Object.assign({}, data, { updatedAt: admin.firestore.FieldValue.serverTimestamp() }), { merge: true });
}

async function logNotification(queueId, data) {
  const id = `${safeDocId(queueId)}_${Date.now()}`;
  await db.collection('notificationLogs').doc(id).set(Object.assign({
    logId: id,
    queueId,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, data || {}), { merge: true });
}

async function processNotificationQueueDoc(docRef, row, processor = 'cloud-function') {
  row = row || {};
  const queueId = normalizeText(row.queueId || docRef.id);
  const channel = queueChannel(row);
  if (!isPendingQueue(row)) return { ok: true, skipped: true, reason: `not-pending:${queueStatus(row)}` };
  if (!['line', 'email'].includes(channel)) {
    await markQueue(docRef, { status: '發送失敗', lastError: `不支援的發送方式：${channel || '(空白)'}` });
    return { ok: false, skipped: true, reason: 'unsupported-channel' };
  }

  await markQueue(docRef, {
    queueId,
    status: '發送中',
    sendStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    attemptCount: admin.firestore.FieldValue.increment(1),
    processor
  });

  try {
    const result = channel === 'line' ? await sendLineQueue(row) : await sendEmailQueue(row);
    await markQueue(docRef, {
      status: '已發送',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      sentAtText: new Date().toISOString(),
      provider: result.provider,
      responseStatus: result.responseStatus,
      responseText: result.responseText || '',
      lastError: ''
    });
    await logNotification(queueId, {
      status: '已發送',
      channel,
      provider: result.provider,
      targetEmail: queueTargetEmail(row),
      targetLineUserId: queueTargetLineUserId(row),
      targetName: normalizeText(row.targetName),
      title: queueTitle(row),
      body: queueBody(row)
    });
    return { ok: true, sent: true, channel, queueId };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    await markQueue(docRef, {
      status: '發送失敗',
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
      failedAtText: new Date().toISOString(),
      lastError: message
    });
    await logNotification(queueId, {
      status: '發送失敗',
      channel,
      error: message,
      targetEmail: queueTargetEmail(row),
      targetLineUserId: queueTargetLineUserId(row),
      targetName: normalizeText(row.targetName),
      title: queueTitle(row),
      body: queueBody(row)
    });
    console.error('[notificationQueue send failed]', queueId, message);
    return { ok: false, error: message, channel, queueId };
  }
}

exports.sendNotificationQueueOnCreate = onDocumentCreated(`${QUEUE_COLLECTION}/{queueId}`, async (event) => {
  const snap = event.data;
  if (!snap) return null;
  return await processNotificationQueueDoc(snap.ref, snap.data() || {}, 'onCreate');
});

exports.flushNotificationQueue = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Asia/Taipei', timeoutSeconds: 120, memory: '512MiB' }, async () => {
  const snap = await db.collection(QUEUE_COLLECTION).where('status', 'in', ['待發送', 'pending', 'queued', 'retry', '發送失敗']).limit(50).get();
  const results = [];
  for (const doc of snap.docs) results.push(await processNotificationQueueDoc(doc.ref, doc.data() || {}, 'scheduler'));
  return results;
});

exports.emailSendCheckHttp = onRequest({ region: 'us-central1', cors: true }, async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return corsJson(req, res, 204, {});
    const data = requestBody(req);
    const to = normalizeEmail(data.to || data.email || '');
    if (!to) return corsJson(req, res, 400, { ok: false, message: '請提供測試收件 Email。' });
    const id = `email-check-${safeDocId(to)}-${Date.now()}`;
    await setQueueDoc(id, {
      channel: 'email',
      targetEmail: to,
      targetName: normalizeText(data.name || '測試收件人'),
      title: normalizeText(data.title || '柚子樂器 Email 測試'),
      body: normalizeText(data.body || `這是一封 Email 發送測試。建立時間：${new Date().toISOString()}`),
      message: normalizeText(data.body || `這是一封 Email 發送測試。建立時間：${new Date().toISOString()}`),
      source: 'email-send-check'
    });
    return corsJson(req, res, 200, { ok: true, queueId: id, message: '已建立 Email 測試佇列，請到 notificationQueue 或測試頁查看發送狀態。' });
  } catch (err) {
    return corsJson(req, res, 500, { ok: false, message: err && err.message ? err.message : String(err) });
  }
});

exports.rentalAutoRenewalReminder = onSchedule({ schedule: 'every day 10:00', timeZone: 'Asia/Taipei', timeoutSeconds: 180, memory: '512MiB' }, async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const max = new Date(today);
  max.setDate(max.getDate() + 7);
  const snap = await db.collection('rentalContracts').limit(800).get();
  let queued = 0;
  for (const doc of snap.docs) {
    const c = Object.assign({ __id: doc.id, contractId: doc.id }, doc.data() || {});
    const status = normalizeText(c.status || c.contractStatus);
    if (!['租賃中', '租用中', '已簽署', '待配送 / 待安裝', '續約詢問中'].includes(status)) continue;
    if (!c.endDate) continue;
    const end = new Date(`${normalizeText(c.endDate)}T00:00:00`);
    if (Number.isNaN(end.getTime())) continue;
    if (end < today || end > max) continue;
    if (normalizeText(c.renewalQuestionForEndDate) === normalizeText(c.endDate)) continue;
    if (['續約待付款', '續約待確認', '退租申請中', '待歸還', '已退租'].includes(status)) continue;

    const token = normalizeText(c.renewalToken || c.officialContractToken || c.customerToken || c.signToken || c.token) || newToken();
    const renewalUrl = publicUrl('rental-renewal.html', { contractId: doc.id, token });
    const body = [
      '柚子樂器租賃到期提醒',
      '',
      `您的租賃設備「${getEquipmentText(c) || '租賃設備'}」將於 ${normalizeText(c.endDate)} 到期。`,
      '請點選下方連結，選擇「我要續租」或「我要退租」：',
      renewalUrl,
      '',
      '若選擇續租，請依頁面匯款資訊付款並上傳付款截圖；若選擇退租，柚子樂器會再與您約定設備收回時間。'
    ].join('\n');

    await doc.ref.set({
      renewalToken: token,
      status: status === '租賃中' ? '續約詢問中' : status,
      renewalQuestionSentAt: new Date().toISOString(),
      renewalQuestionForEndDate: normalizeText(c.endDate),
      renewalUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: new Date().toISOString()
    }, { merge: true });

    const result = await queueLineAndEmailForContract(Object.assign({}, c, { contractId: doc.id, renewalToken: token }), '租賃續租 / 退租確認', body, 'rental-auto-renewal-reminder', { renewalUrl });
    queued += result.count;
  }
  return { ok: true, queued };
});

exports.rentalSubmitApplicationHttp = onRequest({ region: 'us-central1', cors: true }, async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return corsJson(req, res, 204, {});
    if (req.method !== 'POST') return corsJson(req, res, 405, { ok: false, message: 'Method Not Allowed' });
    const data = requestBody(req);
    const id = `RAPP_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const applicationNo = `RA${ymd(new Date()).replace(/-/g, '')}${String(Date.now()).slice(-5)}`;
    const row = Object.assign({}, data || {}, {
      applicationId: id,
      applicationNo,
      status: normalizeText(data.status || '待店家確認'),
      stage: normalizeText(data.stage || 'inquiry'),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtText: new Date().toISOString(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: new Date().toISOString()
    });
    await db.collection('rentalApplications').doc(id).set(row, { merge: true });
    const adminUrl = publicUrl('rental-admin.html', { applicationId: id });
    await queueManagerNotice('新的設備租賃申請', [
      '有新的設備租賃申請',
      `申請編號：${applicationNo}`,
      `姓名：${normalizeText(row.customerName)}`,
      `電話：${normalizeText(row.customerPhone)}`,
      `Email：${normalizeText(row.customerEmail)}`,
      `需求：${normalizeText(row.otherEquipmentNeed || row.equipmentName || row.rentalType)}`,
      '',
      adminUrl
    ].join('\n'), 'rental-new-application', { applicationId: id, adminUrl });
    return corsJson(req, res, 200, { ok: true, applicationId: id, applicationNo, message: '租賃申請已送出。' });
  } catch (err) {
    return corsJson(req, res, 500, { ok: false, message: err && err.message ? err.message : String(err) });
  }
});

exports.rentalSaveContractHttp = onRequest({ region: 'us-central1', cors: true }, async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return corsJson(req, res, 204, {});
    if (req.method !== 'POST') return corsJson(req, res, 405, { ok: false, message: 'Method Not Allowed' });
    const data = requestBody(req);
    const id = normalizeText(data.contractId) || `RCON_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const existing = await db.collection('rentalContracts').doc(id).get();
    const old = existing.exists ? existing.data() || {} : {};
    const signToken = normalizeText(data.signToken || data.customerToken || data.token || old.signToken || old.customerToken || old.token) || newToken();
    const row = Object.assign({}, old, data || {}, {
      contractId: id,
      signToken,
      customerToken: normalizeText(data.customerToken || old.customerToken || signToken),
      token: normalizeText(data.token || old.token || signToken),
      status: data.makeSignLink ? '待客人補資料' : normalizeText(data.status || old.status || '草稿'),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: new Date().toISOString()
    });
    if (!existing.exists) {
      row.createdAt = admin.firestore.FieldValue.serverTimestamp();
      row.createdAtText = new Date().toISOString();
    }
    if (data.makeSignLink) {
      row.signUrl = publicUrl('rental-sign.html', { contractId: id, token: signToken });
    }
    await db.collection('rentalContracts').doc(id).set(row, { merge: true });
    if (normalizeText(data.applicationId)) {
      await db.collection('rentalApplications').doc(normalizeText(data.applicationId)).set({
        status: '已轉正式契約',
        linkedContractId: id,
        contractId: id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: new Date().toISOString()
      }, { merge: true });
    }
    if (data.makeSignLink) {
      const body = [
        '柚子樂器設備租賃資料填寫',
        '',
        '請點選下方連結補填正式契約資料、身分證字號與簽名：',
        row.signUrl
      ].join('\n');
      await queueLineAndEmailForContract(row, '設備租賃資料填寫連結', body, 'rental-sign-link', { signUrl: row.signUrl });
    }
    return corsJson(req, res, 200, { ok: true, contractId: id, signToken, signUrl: row.signUrl || '', message: '租賃契約已儲存。' });
  } catch (err) {
    return corsJson(req, res, 500, { ok: false, message: err && err.message ? err.message : String(err) });
  }
});

exports.rentalSubmitRenewalRequestHttp = onRequest({ region: 'us-central1', cors: true }, async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return corsJson(req, res, 204, {});
    if (req.method !== 'POST') return corsJson(req, res, 405, { ok: false, message: 'Method Not Allowed' });
    const data = requestBody(req);
    const id = normalizeText(data.contractId);
    const token = normalizeText(data.token);
    if (!id || !token) return corsJson(req, res, 400, { ok: false, message: '契約連結不完整。' });
    const ref = db.collection('rentalContracts').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return corsJson(req, res, 404, { ok: false, message: '找不到契約。' });
    const contract = Object.assign({ contractId: id }, snap.data() || {});
    if (!validateContractToken(contract, token)) return corsJson(req, res, 403, { ok: false, message: '連結驗證失敗。' });
    const periods = Math.max(1, Math.min(12, Number(data.periods || 1) || 1));
    const periodDays = Math.max(1, Number(contract.periodDays || 90) || 90);
    const startDate = addDays(contract.endDate, 1) || ymd(new Date());
    const endDate = calcEndDate(startDate, periods, periodDays);
    const rentFee = Number(String(contract.renewalRentFee || contract.rentFee || 0).replace(/[^0-9.-]/g, '')) * periods;
    const pendingRenewal = {
      decision: 'renew',
      source: 'customer-function',
      periods,
      startDate,
      endDate,
      days: periods * periodDays,
      rentFee: rentFee || '',
      customerNote: normalizeText(data.note || data.customerNote || ''),
      customerSubmittedAt: new Date().toISOString(),
      status: '續約待確認'
    };
    await ref.set({ pendingRenewal, status: '續約待確認', customerRenewalSubmittedAt: new Date().toISOString(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAtText: new Date().toISOString() }, { merge: true });
    const adminUrl = publicUrl('rental-admin.html', { contractId: id });
    await queueManagerNotice('客人送出續租申請', [`客人送出續租申請`, `姓名：${getContractName(contract)}`, `設備：${getEquipmentText(contract)}`, `續租期間：${startDate} ～ ${endDate}`, `續租金額：${rentFee || '待確認'}`, '', adminUrl].join('\n'), 'rental-renewal-request', { contractId: id, adminUrl });
    await queueLineAndEmailForContract(contract, '已收到續租申請', `已收到您的續租申請。\n\n續租期間：${startDate} ～ ${endDate}\n柚子樂器確認後會再通知您。`, 'rental-renewal-request-ack');
    return corsJson(req, res, 200, { ok: true, message: '續租申請已送出。' });
  } catch (err) {
    return corsJson(req, res, 500, { ok: false, message: err && err.message ? err.message : String(err) });
  }
});

exports.rentalSubmitReturnRequestHttp = onRequest({ region: 'us-central1', cors: true }, async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return corsJson(req, res, 204, {});
    if (req.method !== 'POST') return corsJson(req, res, 405, { ok: false, message: 'Method Not Allowed' });
    const data = requestBody(req);
    const id = normalizeText(data.contractId);
    const token = normalizeText(data.token);
    if (!id || !token) return corsJson(req, res, 400, { ok: false, message: '契約連結不完整。' });
    const ref = db.collection('rentalContracts').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return corsJson(req, res, 404, { ok: false, message: '找不到契約。' });
    const contract = Object.assign({ contractId: id }, snap.data() || {});
    if (!validateContractToken(contract, token)) return corsJson(req, res, 403, { ok: false, message: '連結驗證失敗。' });
    const returnRequest = { decision: 'return', source: 'customer-function', returnDate: normalizeText(data.returnDate), returnTime: normalizeText(data.returnTime), note: normalizeText(data.note), customerSubmittedAt: new Date().toISOString(), status: '退租申請中' };
    await ref.set({ returnRequest, status: '退租申請中', customerReturnSubmittedAt: new Date().toISOString(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAtText: new Date().toISOString() }, { merge: true });
    const adminUrl = publicUrl('rental-admin.html', { contractId: id });
    await queueManagerNotice('客人選擇退租', [`客人選擇退租`, `姓名：${getContractName(contract)}`, `設備：${getEquipmentText(contract)}`, `希望日期：${returnRequest.returnDate}`, `希望時段：${returnRequest.returnTime || '未指定'}`, `備註：${returnRequest.note || ''}`, '', adminUrl].join('\n'), 'rental-return-request', { contractId: id, adminUrl });
    await queueLineAndEmailForContract(contract, '已收到退租回覆', `已收到您的退租回覆。\n\n柚子樂器會再與您聯繫約定設備取回 / 歸還時間，謝謝。`, 'rental-return-request-ack');
    return corsJson(req, res, 200, { ok: true, message: '退租回覆已送出。' });
  } catch (err) {
    return corsJson(req, res, 500, { ok: false, message: err && err.message ? err.message : String(err) });
  }
});

exports.rentalCompleteReturnHttp = onRequest({ region: 'us-central1', cors: true }, async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return corsJson(req, res, 204, {});
    if (req.method !== 'POST') return corsJson(req, res, 405, { ok: false, message: 'Method Not Allowed' });
    const data = requestBody(req);
    const id = normalizeText(data.contractId);
    if (!id) return corsJson(req, res, 400, { ok: false, message: '缺少 contractId。' });
    const ref = db.collection('rentalContracts').doc(id);
    const snap = await ref.get();
    if (!snap.exists) return corsJson(req, res, 404, { ok: false, message: '找不到契約。' });
    const contract = Object.assign({ contractId: id }, snap.data() || {});
    await ref.set({ status: '已退租', returnedAt: new Date().toISOString(), updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAtText: new Date().toISOString() }, { merge: true });
    await queueLineAndEmailForContract(contract, '租賃退租已完成', '您的租賃設備已完成退租結案，謝謝。', 'rental-return-completed');
    return corsJson(req, res, 200, { ok: true, message: '已完成退租。' });
  } catch (err) {
    return corsJson(req, res, 500, { ok: false, message: err && err.message ? err.message : String(err) });
  }
});
