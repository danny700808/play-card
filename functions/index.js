const { onRequest, onCall } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const HTTPS_CALLABLE_OPTIONS = {
  region: 'us-central1',
  invoker: 'public',
  cors: [
    'https://denny700808.github.io',
    'https://danny700808.github.io',
    'https://youzi-c1b74.web.app',
    'https://youzi-c1b74.firebaseapp.com',
    'http://localhost:5000',
    'http://localhost:5001',
    'http://127.0.0.1:5000',
    'http://127.0.0.1:5001'
  ]
};

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
    lineConfirmText: `租賃申請 ${applicationNo} ${customerName}`,
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
 * LINE / Email 通知佇列發送器
 * 前端會寫入 notificationQueue/{queueId}，這裡才是真正發送 LINE / Email 的 Cloud Functions。
 * ========================================================= */
const QUEUE_COLLECTION = 'notificationQueue';
const SENT_QUEUE_STATUSES = new Set(['sent', '已發送', '已送出', 'done', 'completed', 'success']);
const SENDING_QUEUE_STATUSES = new Set(['sending', '發送中']);
const PENDING_QUEUE_STATUSES = new Set(['pending', '待發送', 'queued', 'queue', '待處理', 'retry', '發送失敗']);

function safeQueueId(value) {
  return normalizeText(value).replace(/[\/#?\[\]]/g, '_').slice(0, 180) || db.collection('_ids').doc().id;
}

function queueStatus(row = {}) {
  return normalizeText(row.status || row['狀態'] || '待發送');
}

function isPendingQueue(row = {}) {
  const status = queueStatus(row);
  if (SENT_QUEUE_STATUSES.has(status) || SENDING_QUEUE_STATUSES.has(status)) return false;
  return !status || PENDING_QUEUE_STATUSES.has(status) || /^fail|失敗|error/i.test(status);
}

function queueChannel(row = {}) {
  return normalizeText(row.channel || row.type || row.notifyType || row['發送方式']).toLowerCase();
}

function queueTargetLineUserId(row = {}) {
  return normalizeText(row.targetLineUserId || row.lineUserId || row.toLineUserId || row['LINE User ID']);
}

function queueTargetEmail(row = {}) {
  return normalizeText(row.targetEmail || row.email || row.toEmail || row['Email']).toLowerCase();
}

function queueTitle(row = {}) {
  return normalizeText(row.title || row.subject || row.eventName || '柚子樂器通知');
}

function queueBody(row = {}) {
  const body = normalizeText(row.body || row.message || row.content || row.text || row['訊息內容']);
  if (body) return body;
  return queueTitle(row) || '您有一則新的通知。';
}

async function getSystemSettingValue(names) {
  const wanted = (Array.isArray(names) ? names : [names]).map(normalizeText).filter(Boolean);
  for (const name of wanted) {
    try {
      const snap = await db.collection('systemSettings').doc(name).get();
      if (snap.exists) {
        const data = snap.data() || {};
        const value = normalizeText(data.value || data.token || data.accessToken || data.secret || data.text);
        if (value) return value;
      }
    } catch (err) {
      // ignore and try list scan below
    }
  }
  try {
    const snap = await db.collection('systemSettings').limit(200).get();
    let found = '';
    snap.forEach((doc) => {
      if (found) return;
      const data = doc.data() || {};
      const key = normalizeText(data.key || data.name || doc.id);
      if (wanted.includes(key)) found = normalizeText(data.value || data.token || data.accessToken || data.secret || data.text);
    });
    return found;
  } catch (err) {
    return '';
  }
}

async function getLineAccessToken() {
  const token = normalizeText(
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

async function sendQueueLinePush(row) {
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
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text: text.slice(0, 4900) }]
    })
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`LINE API ${response.status}：${responseText.slice(0, 500)}`);
  return { provider: 'line-messaging-api', responseStatus: response.status, responseText: responseText.slice(0, 500) };
}

async function sendQueueEmail(row) {
  const to = queueTargetEmail(row);
  if (!to) throw new Error('缺少 Email，無法發送 Email。');
  const apiKey = normalizeText(process.env.SENDGRID_API_KEY || '');
  const from = normalizeText(process.env.SENDGRID_FROM_EMAIL || process.env.MAIL_FROM || '');
  const fromName = normalizeText(process.env.SENDGRID_FROM_NAME || '柚子樂器');
  if (!apiKey || !from) throw new Error('Email 尚未設定 SENDGRID_API_KEY / SENDGRID_FROM_EMAIL。');
  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
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

async function appendNotificationLog(queueId, data) {
  const id = `${safeQueueId(queueId)}_${Date.now()}`;
  await db.collection('notificationLogs').doc(id).set(Object.assign({
    logId: id,
    queueId,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, data || {}), { merge: true });
}

async function processNotificationQueueDoc(docRef, row, options = {}) {
  row = row || {};
  const queueId = normalizeText(row.queueId || docRef.id);
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
    attemptCount: admin.firestore.FieldValue.increment(1),
    processor: options.processor || 'cloud-function'
  });
  try {
    const result = channel === 'line' ? await sendQueueLinePush(row) : await sendQueueEmail(row);
    await markQueue(docRef, {
      status: '已發送',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      sentAtText: new Date().toISOString(),
      provider: result.provider,
      responseStatus: result.responseStatus,
      responseText: result.responseText || '',
      lastError: ''
    });
    await appendNotificationLog(queueId, {
      status: '已發送',
      channel,
      provider: result.provider,
      targetName: normalizeText(row.targetName),
      targetEmail: queueTargetEmail(row),
      targetLineUserId: queueTargetLineUserId(row),
      title: queueTitle(row),
      body: queueBody(row)
    });
    return { ok: true, sent: true, channel, queueId };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    await markQueue(docRef, {
      status: '發送失敗',
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
      failedAtText: new Date().toISOString(),
      lastError: msg
    });
    await appendNotificationLog(queueId, {
      status: '發送失敗',
      channel,
      error: msg,
      targetName: normalizeText(row.targetName),
      targetEmail: queueTargetEmail(row),
      targetLineUserId: queueTargetLineUserId(row),
      title: queueTitle(row),
      body: queueBody(row)
    });
    console.error('[notificationQueue send failed]', queueId, msg);
    return { ok: false, error: msg, channel, queueId };
  }
}

exports.sendNotificationQueueOnCreate = onDocumentCreated(`${QUEUE_COLLECTION}/{queueId}`, async (event) => {
  const snap = event.data;
  if (!snap) return null;
  return await processNotificationQueueDoc(snap.ref, snap.data() || {}, { processor: 'onCreate' });
});

exports.flushNotificationQueue = onSchedule({ schedule: 'every 5 minutes', timeoutSeconds: 120, memory: '512MiB' }, async () => {
  const snap = await db.collection(QUEUE_COLLECTION).where('status', 'in', ['待發送', 'pending', 'queued', 'retry', '發送失敗']).limit(50).get();
  const results = [];
  for (const doc of snap.docs) {
    results.push(await processNotificationQueueDoc(doc.ref, doc.data() || {}, { processor: 'scheduler' }));
  }
  return results;
});

exports.processNotificationQueueNow = onCall(Object.assign({}, HTTPS_CALLABLE_OPTIONS, { timeoutSeconds: 120, memory: '512MiB' }), async (request) => {
  const data = request.data || {};
  const queueId = normalizeText(data.queueId || '');
  const limit = Math.max(1, Math.min(Number(data.limit || 20) || 20, 50));
  if (queueId) {
    const ref = db.collection(QUEUE_COLLECTION).doc(queueId);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, message: '找不到通知佇列資料。' };
    const result = await processNotificationQueueDoc(ref, snap.data() || {}, { processor: 'callable' });
    return Object.assign({ ok: result.ok !== false }, result);
  }
  const snap = await db.collection(QUEUE_COLLECTION).where('status', 'in', ['待發送', 'pending', 'queued', 'retry', '發送失敗']).limit(limit).get();
  const results = [];
  for (const doc of snap.docs) {
    results.push(await processNotificationQueueDoc(doc.ref, doc.data() || {}, { processor: 'callable' }));
  }
  return { ok: true, count: results.length, results };
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
