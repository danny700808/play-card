const { onRequest } = require('firebase-functions/v2/https');
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function paymentInfoUrlForContract(contractId, token) {
  return `${webBaseUrl()}rental-payment-info.html?contractId=${encodeURIComponent(contractId)}&token=${encodeURIComponent(token)}`;
}

function rentalPaymentNoticeMessage(paymentInfoUrl) {
  return [
    '柚子樂器已收到您補填的租賃資料。',
    '',
    '若資料確認無誤，我們會依雙方約定的時間前往安裝／交付設備。',
    '',
    '付款方式與後續說明請點選以下連結查看：',
    paymentInfoUrl,
    '',
    '您可選擇先行匯款並回傳截圖，也可於安裝／自取當下付款。',
    '',
    '店家確認資料與款項後，系統會再傳送正式租賃契約連結給您。',
    '',
    '如資料需補正，柚子樂器會再透過 LINE 與您聯繫。'
  ].join('\n');
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




function todayYmdCompact() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function nowIsoText() {
  return new Date().toISOString();
}

function randomCode(len = 5) {
  return Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, len).padEnd(len, '0');
}

function makeRentalId(prefix = 'RC') {
  return `${prefix}${todayYmdCompact()}${randomCode(5)}`;
}

function makeToken(len = 32) {
  return cryptoRandom(len);
}

function cryptoRandom(len = 32) {
  try {
    return require('crypto').randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
  } catch (e) {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
}

function signUrlForContract(contractId, token) {
  return `${webBaseUrl()}rental-sign.html?contractId=${encodeURIComponent(contractId)}&token=${encodeURIComponent(token)}`;
}

function officialUrlForContract(contractId, token) {
  return `${webBaseUrl()}rental-contract.html?contractId=${encodeURIComponent(contractId)}&token=${encodeURIComponent(token)}`;
}

function safePublicBody(req) {
  if (req.method === 'OPTIONS') return null;
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function sendCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function findRentalContract(contractId) {
  const id = normalizeText(contractId);
  if (!id) return null;
  const ref = db.collection('rentalContracts').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return { id, ref, data: snap.data() || {} };
}

function assertContractToken(data, token) {
  const expected = normalizeText(data.officialContractToken || data.customerToken || data.signToken || data.token);
  const actual = normalizeText(token);
  return !expected || expected === actual;
}

exports.rentalSubmitApplicationHttp = onRequest(
  { region: 'us-central1', cors: true, timeoutSeconds: 60 },
  async (req, res) => {
    try {
      sendCors(res);
      if (req.method === 'OPTIONS') return res.status(204).send('');
      if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method Not Allowed' });

      const body = safePublicBody(req);
      const customerName = normalizeText(body.customerName);
      const customerPhone = normalizeText(body.customerPhone);
      if (!customerName) return res.status(400).json({ ok: false, message: '請填寫姓名。' });
      if (!customerPhone) return res.status(400).json({ ok: false, message: '請填寫電話。' });

      let applicationId = makeRentalId('RC');
      let ref = db.collection('rentalApplications').doc(applicationId);
      // 極低機率撞號時重產一次。
      const exists = await ref.get();
      if (exists.exists) {
        applicationId = makeRentalId('RC');
        ref = db.collection('rentalApplications').doc(applicationId);
      }

      const lineConfirmText = `租賃申請 ${applicationId} ${customerName}`;
      const now = admin.firestore.FieldValue.serverTimestamp();
      const data = {
        ...body,
        applicationId,
        applicationNo: applicationId,
        rentalApplicationNo: applicationId,
        customerName,
        customerPhone,
        customerEmail: normalizeText(body.customerEmail),
        customerAddress: normalizeText(body.customerAddress),
        rentalType: normalizeText(body.rentalType),
        periods: normalizeText(body.periods),
        otherEquipmentNeed: normalizeText(body.otherEquipmentNeed),
        shippingMethod: normalizeText(body.shippingMethod),
        preferredDate: normalizeText(body.preferredDate),
        preferredTime: normalizeText(body.preferredTime),
        floorNote: normalizeText(body.floorNote),
        note: normalizeText(body.note),
        source: normalizeText(body.source || 'customer-inquiry-web'),
        status: '待店家確認',
        stage: 'inquiry',
        lineLinkStatus: 'pending',
        lineConfirmText,
        createdAt: now,
        updatedAt: now,
        createdAtText: nowIsoText(),
        updatedAtText: nowIsoText()
      };
      await ref.set(data, { merge: true });

      const managerLineUserId = await getPrimaryManagerLineUserId();
      if (managerLineUserId) {
        const adminUrl = `${webBaseUrl()}rental-admin.html?applicationId=${encodeURIComponent(applicationId)}`;
        const msg = [
          '有新的設備租賃申請',
          `姓名：${customerName}`,
          `電話：${customerPhone}`,
          `申請編號：${applicationId}`,
          `租用需求：${normalizeText(body.otherEquipmentNeed || body.rentalType || '') || '未填寫'}`,
          `希望方式：${normalizeText(body.shippingMethod) || '未填寫'}`,
          `希望日期：${`${normalizeText(body.preferredDate)} ${normalizeText(body.preferredTime)}`.trim() || '未填寫'}`,
          '',
          `查看申請資料：${adminUrl}`,
          '',
          '客人 LINE 配對文字：',
          lineConfirmText
        ].join('\n');
        await pushLineMessage(managerLineUserId, msg);
      }

      res.status(200).json({ ok: true, applicationId, applicationNo: applicationId, lineConfirmText });
    } catch (error) {
      console.error('rentalSubmitApplicationHttp error:', error);
      res.status(500).json({ ok: false, message: error && error.message ? error.message : '送出失敗' });
    }
  }
);

exports.rentalSaveContractHttp = onRequest(
  { region: 'us-central1', cors: true, timeoutSeconds: 90 },
  async (req, res) => {
    try {
      sendCors(res);
      if (req.method === 'OPTIONS') return res.status(204).send('');
      if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method Not Allowed' });
      const body = safePublicBody(req);
      const contractId = normalizeText(body.contractId) || makeRentalId('RC');
      const token = normalizeText(body.signToken || body.customerToken || body.token) || makeToken(32);
      let customerLineUserId = normalizeText(body.customerLineUserId || body.lineUserId);

      const applicationId = normalizeText(body.applicationId);
      if (applicationId && !customerLineUserId) {
        const appSnap = await db.collection('rentalApplications').doc(applicationId).get();
        if (appSnap.exists) {
          const app = appSnap.data() || {};
          customerLineUserId = normalizeText(app.customerLineUserId || app.lineUserId);
        }
      }

      const makeSignLink = !!body.makeSignLink;
      const status = makeSignLink ? '待客人補資料' : normalizeText(body.status || '草稿');
      const payload = {
        ...body,
        contractId,
        status,
        customerLineUserId,
        lineUserId: customerLineUserId || normalizeText(body.lineUserId),
        signToken: token,
        customerToken: normalizeText(body.customerToken) || token,
        token: normalizeText(body.token) || token,
        signUrl: signUrlForContract(contractId, token),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: nowIsoText()
      };
      if (!body.createdAtText) {
        payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
        payload.createdAtText = nowIsoText();
      }
      await db.collection('rentalContracts').doc(contractId).set(payload, { merge: true });

      if (applicationId) {
        await db.collection('rentalApplications').doc(applicationId).set({
          status: '已轉正式契約',
          linkedContractId: contractId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtText: nowIsoText()
        }, { merge: true });
      }

      res.status(200).json({ ok: true, contractId, signToken: token, customerToken: token, token, signUrl: payload.signUrl });
    } catch (error) {
      console.error('rentalSaveContractHttp error:', error);
      res.status(500).json({ ok: false, message: error && error.message ? error.message : '儲存合約失敗' });
    }
  }
);

exports.rentalSendContractToCustomerHttp = onRequest(
  { region: 'us-central1', cors: true, timeoutSeconds: 90 },
  async (req, res) => {
    try {
      sendCors(res);
      if (req.method === 'OPTIONS') return res.status(204).send('');
      if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method Not Allowed' });
      const body = safePublicBody(req);
      const found = await findRentalContract(body.contractId);
      if (!found) return res.status(404).json({ ok: false, message: '找不到合約資料' });
      const c = found.data;
      const token = normalizeText(c.signToken || c.customerToken || c.token) || makeToken(32);
      const url = signUrlForContract(found.id, token);
      const lineUserId = normalizeText(c.customerLineUserId || c.lineUserId);
      const msg = [
        '柚子樂器租賃資料填寫連結',
        '',
        '請點選以下連結，補填身分證字號、上傳身分證證明圖片並完成簽名。',
        url,
        '',
        '填寫完成後，店家會依雙方約定的時間前往安裝／交付設備。'
      ].join('\n');
      let sent = false;
      if (lineUserId) {
        await pushLineMessage(lineUserId, msg);
        sent = true;
      }
      await found.ref.set({
        signToken: token,
        customerToken: normalizeText(c.customerToken) || token,
        token: normalizeText(c.token) || token,
        signUrl: url,
        signLinkSentAt: admin.firestore.FieldValue.serverTimestamp(),
        signLinkSentAtText: nowIsoText(),
        signLinkSentByFunction: sent,
        status: '待客人補資料',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: nowIsoText()
      }, { merge: true });
      res.status(200).json({ ok: true, sent, url, signUrl: url });
    } catch (error) {
      console.error('rentalSendContractToCustomerHttp error:', error);
      res.status(500).json({ ok: false, message: error && error.message ? error.message : '傳送合約連結失敗' });
    }
  }
);

exports.rentalCompleteReturnHttp = onRequest(
  { region: 'us-central1', cors: true, timeoutSeconds: 60 },
  async (req, res) => {
    try {
      sendCors(res);
      if (req.method === 'OPTIONS') return res.status(204).send('');
      if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method Not Allowed' });
      const found = await findRentalContract((req.body || {}).contractId);
      if (!found) return res.status(404).json({ ok: false, message: '找不到合約資料' });
      await found.ref.set({ status: '已退租', returnedAt: admin.firestore.FieldValue.serverTimestamp(), returnedAtText: nowIsoText(), updatedAtText: nowIsoText() }, { merge: true });
      const lineUserId = normalizeText(found.data.customerLineUserId || found.data.lineUserId);
      if (lineUserId) await pushLineMessage(lineUserId, '柚子樂器已完成設備退租紀錄。感謝您的租用。');
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error('rentalCompleteReturnHttp error:', error);
      res.status(500).json({ ok: false, message: error && error.message ? error.message : '退租處理失敗' });
    }
  }
);

exports.rentalSubmitRenewalRequestHttp = onRequest(
  { region: 'us-central1', cors: true, timeoutSeconds: 60 },
  async (req, res) => {
    try {
      sendCors(res);
      if (req.method === 'OPTIONS') return res.status(204).send('');
      if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method Not Allowed' });
      const body = safePublicBody(req);
      const found = await findRentalContract(body.contractId);
      if (!found) return res.status(404).json({ ok: false, message: '找不到合約資料' });
      if (!assertContractToken(found.data, body.token)) return res.status(403).json({ ok: false, message: '連結驗證失敗' });
      await found.ref.set({
        status: '續約待確認',
        customerRenewalRequest: { periods: normalizeText(body.periods || '1'), note: normalizeText(body.note), requestedAtText: nowIsoText() },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: nowIsoText()
      }, { merge: true });
      const managerLineUserId = await getPrimaryManagerLineUserId();
      if (managerLineUserId) await pushLineMessage(managerLineUserId, `客人提出租賃續約申請\n合約：${found.id}\n姓名：${normalizeText(found.data.customerName)}\n期數：${normalizeText(body.periods || '1')}\n備註：${normalizeText(body.note) || '無'}`);
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error('rentalSubmitRenewalRequestHttp error:', error);
      res.status(500).json({ ok: false, message: error && error.message ? error.message : '續約申請送出失敗' });
    }
  }
);

exports.rentalSubmitReturnRequestHttp = onRequest(
  { region: 'us-central1', cors: true, timeoutSeconds: 60 },
  async (req, res) => {
    try {
      sendCors(res);
      if (req.method === 'OPTIONS') return res.status(204).send('');
      if (req.method !== 'POST') return res.status(405).json({ ok: false, message: 'Method Not Allowed' });
      const body = safePublicBody(req);
      const found = await findRentalContract(body.contractId);
      if (!found) return res.status(404).json({ ok: false, message: '找不到合約資料' });
      if (!assertContractToken(found.data, body.token)) return res.status(403).json({ ok: false, message: '連結驗證失敗' });
      await found.ref.set({
        status: '待歸還',
        customerReturnRequest: { returnDate: normalizeText(body.returnDate), returnTime: normalizeText(body.returnTime), note: normalizeText(body.note), requestedAtText: nowIsoText() },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtText: nowIsoText()
      }, { merge: true });
      const managerLineUserId = await getPrimaryManagerLineUserId();
      if (managerLineUserId) await pushLineMessage(managerLineUserId, `客人提出退租申請\n合約：${found.id}\n姓名：${normalizeText(found.data.customerName)}\n希望退租：${normalizeText(body.returnDate)} ${normalizeText(body.returnTime)}\n備註：${normalizeText(body.note) || '無'}`);
      res.status(200).json({ ok: true });
    } catch (error) {
      console.error('rentalSubmitReturnRequestHttp error:', error);
      res.status(500).json({ ok: false, message: error && error.message ? error.message : '退租申請送出失敗' });
    }
  }
);

exports.rentalSignContractHttp = onRequest(
  {
    region: 'us-central1',
    cors: true,
    timeoutSeconds: 120
  },
  async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
      }
      if (req.method !== 'POST') {
        res.status(405).json({ ok: false, message: 'Method Not Allowed' });
        return;
      }

      const body = req.body || {};
      const contractId = normalizeText(body.contractId);
      const token = normalizeText(body.token);
      if (!contractId || !token) {
        res.status(400).json({ ok: false, message: '缺少合約編號或驗證碼' });
        return;
      }

      const ref = db.collection('rentalContracts').doc(contractId);
      const snap = await ref.get();
      if (!snap.exists) {
        res.status(404).json({ ok: false, message: '找不到合約資料' });
        return;
      }

      const data = snap.data() || {};
      const validToken = normalizeText(data.signToken || data.token || data.customerToken || data.officialContractToken);
      if (validToken && validToken !== token) {
        res.status(403).json({ ok: false, message: '合約連結驗證失敗' });
        return;
      }

      const paymentInfoUrl = normalizeText(body.paymentInfoUrl) || paymentInfoUrlForContract(contractId, token);
      const formalReceivedNoticeText = rentalPaymentNoticeMessage(paymentInfoUrl);

      const update = {
        customerIdNumber: normalizeText(body.customerIdNumber || data.customerIdNumber),
        customerSubmittedFormalAt: admin.firestore.FieldValue.serverTimestamp(),
        customerSignedAt: admin.firestore.FieldValue.serverTimestamp(),
        customerSubmittedFormalAtText: new Date().toISOString(),
        formalReceivedNoticeText,
        formalReceivedNoticeQueuedAt: admin.firestore.FieldValue.serverTimestamp(),
        formalReceivedNoticeQueuedAtText: new Date().toISOString(),
        paymentInfoUrl,
        paymentInfoNoticeDelaySeconds: 60,
        status: '待店家確認'
      };

      if (body.signatureDataUrl) {
        update.customerSignatureDataUrl = body.signatureDataUrl;
        update.signatureDataUrl = body.signatureDataUrl;
      }
      if (body.customerIdImageWatermarkedDataUrl) {
        update.customerIdImageWatermarkedDataUrl = body.customerIdImageWatermarkedDataUrl;
        update.idImageWatermarkedDataUrl = body.customerIdImageWatermarkedDataUrl;
      }

      await ref.set(update, { merge: true });

      const freshSnap = await ref.get();
      const fresh = freshSnap.data() || data;
      const lineUserId = normalizeText(fresh.customerLineUserId || fresh.lineUserId);

      res.status(200).json({ ok: true, paymentInfoUrl, lineNoticeDelaySeconds: 60 });

      if (lineUserId) {
        setTimeout(async () => {
          try {
            await pushLineMessage(lineUserId, formalReceivedNoticeText);
            await ref.set({
              formalReceivedNoticeSentAt: admin.firestore.FieldValue.serverTimestamp(),
              formalReceivedNoticeSentAtText: new Date().toISOString(),
              paymentInfoSentAt: admin.firestore.FieldValue.serverTimestamp(),
              paymentInfoSentAtText: new Date().toISOString()
            }, { merge: true });
          } catch (e) {
            console.error('delayed rental payment LINE failed:', e);
          }
        }, 60000);
      }
    } catch (error) {
      console.error('rentalSignContractHttp error:', error);
      res.status(500).json({ ok: false, message: error && error.message ? error.message : '送出失敗' });
    }
  }
);

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
