const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const ADMIN_EMAILS = new Set(['danny700808@gmail.com']);
const DEFAULT_ADMIN_DOC_ID = 'ADMIN_DANNY';
const RENTAL_CUSTOMERS = 'rentalCustomers';
const RENTAL_APPLICATIONS = 'rentalApplications';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePhone(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function isBootstrapAdminEmail(email) {
  return ADMIN_EMAILS.has(normalizeEmail(email));
}

function nowIdPart() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function safeDocId(value) {
  return String(value || '').replace(/[\/#?\[\]]/g, '_').slice(0, 180) || db.collection('_ids').doc().id;
}

function ymd(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function asNumber(value, fallback = 0) {
  const n = Number(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

async function getLineAccessToken() {
  return normalizeText(
    process.env.LINE_CHANNEL_ACCESS_TOKEN ||
    process.env.LINE_MESSAGING_ACCESS_TOKEN ||
    process.env.LINE_ACCESS_TOKEN ||
    ''
  );
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
      messages: [{ type: 'text', text: String(message || '').slice(0, 4900) }]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('LINE reply failed:', response.status, body);
  }
}

async function pushLineMessage(to, message) {
  const token = await getLineAccessToken();
  if (!token || !to) return false;
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      to,
      messages: [{ type: 'text', text: String(message || '').slice(0, 4900) }]
    })
  });
  if (!response.ok) {
    const body = await response.text();
    console.error('LINE push failed:', response.status, body);
    return false;
  }
  return true;
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

async function handleRentalBinding({ rawKey, lineUserId, replyToken }) {
  const key = normalizeText(rawKey);
  const phone = normalizePhone(key);
  const email = normalizeEmail(key.includes('@') ? key : '');
  if (!phone && !email) {
    await replyLineMessage(replyToken, '租賃綁定格式錯誤。請輸入：柚子租賃綁定 你的手機號碼，例如：柚子租賃綁定 0912345678');
    return;
  }
  const docId = phone ? `phone_${phone}` : `email_${safeDocId(email)}`;
  const ref = db.collection(RENTAL_CUSTOMERS).doc(docId);
  const existing = await ref.get();
  const old = existing.exists ? existing.data() || {} : {};
  if (old.lineUserId && old.lineUserId !== lineUserId) {
    await replyLineMessage(replyToken, '這組租賃聯絡資料已綁定其他 LINE。若要重新綁定，請聯絡柚子樂器協助清除。');
    return;
  }
  await ref.set({
    rentalCustomerId: docId,
    phone,
    email,
    bindKey: key,
    lineUserId,
    lineNotifyEnabled: true,
    lineBindingRole: 'rentalCustomer',
    lineBoundAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: old.createdAt || admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await replyLineMessage(replyToken, `租賃 LINE 綁定成功。申請表請填同一組${phone ? '手機號碼' : 'Email'}：${phone || email}`);
}

async function findRentalCustomerByPhoneOrEmail(phoneRaw, emailRaw) {
  const phone = normalizePhone(phoneRaw);
  const email = normalizeEmail(emailRaw);
  if (phone) {
    const doc = await db.collection(RENTAL_CUSTOMERS).doc(`phone_${phone}`).get();
    if (doc.exists) return { id: doc.id, data: doc.data() || {} };
    const snap = await db.collection(RENTAL_CUSTOMERS).where('phone', '==', phone).limit(1).get();
    if (!snap.empty) return { id: snap.docs[0].id, data: snap.docs[0].data() || {} };
  }
  if (email) {
    const doc = await db.collection(RENTAL_CUSTOMERS).doc(`email_${safeDocId(email)}`).get();
    if (doc.exists) return { id: doc.id, data: doc.data() || {} };
    const snap = await db.collection(RENTAL_CUSTOMERS).where('email', '==', email).limit(1).get();
    if (!snap.empty) return { id: snap.docs[0].id, data: snap.docs[0].data() || {} };
  }
  return null;
}

async function handleCheckRentalLine(data, res) {
  const customer = await findRentalCustomerByPhoneOrEmail(data.phone || data.customerPhone, data.email || data.customerEmail);
  const bound = !!(customer && customer.data && customer.data.lineUserId);
  res.status(200).json({
    ok: true,
    bound,
    customerId: customer ? customer.id : '',
    lineDisplayName: customer && customer.data ? (customer.data.lineDisplayName || '') : '',
    message: bound ? '已完成租賃 LINE 綁定。' : '尚未完成租賃 LINE 綁定。請先在官方 LINE 輸入：柚子租賃綁定 你的手機號碼'
  });
}

function validateRentalApplication(payload) {
  const errors = [];
  if (!normalizeText(payload.rentalType)) errors.push('請選擇租用設備類型。');
  if (!normalizeText(payload.customerName)) errors.push('請填寫姓名 / 公司名稱。');
  if (!normalizePhone(payload.customerPhone)) errors.push('請填寫聯絡行動電話。');
  if (!normalizeEmail(payload.customerEmail)) errors.push('請填寫 Email 信箱。');
  if (!normalizeText(payload.customerAddress)) errors.push('請填寫地址。');
  if (!normalizeText(payload.preferredDate)) errors.push('請選擇希望配送 / 自取日期。');
  if (!normalizeText(payload.preferredTime)) errors.push('請選擇希望時段。');
  if (!normalizeText(payload.idImageWatermarkedDataUrl)) errors.push('請上傳身分證證明圖片。');
  return errors;
}

async function createQueue(data) {
  const id = `NQ_${nowIdPart()}_${Math.random().toString(36).slice(2, 8)}`;
  await db.collection('notificationQueue').doc(id).set({
    queueId: id,
    status: '待發送',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtText: new Date().toISOString(),
    ...data
  }, { merge: true });
  return id;
}

async function handleSubmitRentalApplication(data, res) {
  const payload = data.payload || data;
  const errors = validateRentalApplication(payload);
  if (errors.length) {
    res.status(400).json({ ok: false, message: errors.join('\n') });
    return;
  }

  const customer = await findRentalCustomerByPhoneOrEmail(payload.customerPhone, payload.customerEmail);
  if (!customer || !customer.data || !customer.data.lineUserId) {
    res.status(400).json({ ok: false, message: '送出前必須先完成租賃 LINE 綁定。請在官方 LINE 輸入：柚子租賃綁定 你的手機號碼，完成後再回來送出。' });
    return;
  }

  const applicationNo = `RY${nowIdPart()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const applicationId = applicationNo;
  const periods = Math.max(1, Math.min(asNumber(payload.periods, 1), 10));
  const rentalType = normalizeText(payload.rentalType);
  const record = {
    applicationId,
    applicationNo,
    status: '新申請',
    rentalType,
    periods,
    periodDays: 90,
    otherEquipmentNeed: normalizeText(payload.otherEquipmentNeed),
    customerName: normalizeText(payload.customerName),
    customerPhone: normalizeText(payload.customerPhone),
    customerPhoneNormalized: normalizePhone(payload.customerPhone),
    customerEmail: normalizeEmail(payload.customerEmail),
    lineDisplayName: normalizeText(payload.lineDisplayName),
    customerLineUserId: customer.data.lineUserId,
    rentalCustomerId: customer.id,
    customerIdNumber: normalizeText(payload.customerIdNumber),
    customerAddress: normalizeText(payload.customerAddress),
    shippingMethod: normalizeText(payload.shippingMethod),
    shippingAddress: normalizeText(payload.shippingAddress || payload.customerAddress),
    preferredDate: normalizeText(payload.preferredDate),
    preferredTime: normalizeText(payload.preferredTime),
    floorNote: normalizeText(payload.floorNote),
    note: normalizeText(payload.note),
    idImageWatermarkedDataUrl: normalizeText(payload.idImageWatermarkedDataUrl),
    idImageFileName: normalizeText(payload.idImageFileName),
    idImageWatermarkText: '限柚子樂器設備租用使用',
    source: 'rental-order-web-phase1',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtText: new Date().toISOString(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: new Date().toISOString()
  };

  await db.collection(RENTAL_APPLICATIONS).doc(applicationId).set(record, { merge: true });

  const managerDoc = await db.collection('employees').doc('PRIMARY_MANAGER_LINE').get();
  const manager = managerDoc.exists ? managerDoc.data() || {} : {};
  const title = '新的設備租賃申請';
  const body = `申請編號：${applicationNo}\n客人：${record.customerName}\n電話：${record.customerPhone}\n設備：${record.rentalType}\n希望日期：${record.preferredDate} ${record.preferredTime}\n請到設備租賃管理查看。`;

  if (manager.lineUserId) {
    await createQueue({
      channel: 'line',
      targetEmployeeId: 'PRIMARY_MANAGER_LINE',
      targetName: manager.name || '主管',
      targetEmail: manager.email || '',
      targetLineUserId: manager.lineUserId,
      title,
      body,
      source: 'rental-application-created',
      rentalApplicationId: applicationId
    });
    await pushLineMessage(manager.lineUserId, `${title}\n${body}`);
  }

  await pushLineMessage(record.customerLineUserId, `柚子樂器已收到您的設備租賃申請。\n申請編號：${applicationNo}\n主管確認後會再傳正式合約連結給您。`);

  res.status(200).json({ ok: true, applicationId, applicationNo, message: '租賃申請已送出。' });
}

async function handleBrowserAction(req, res) {
  const data = req.body || {};
  const action = normalizeText(data.action);
  if (action === 'checkRentalLine') return await handleCheckRentalLine(data, res);
  if (action === 'submitRentalApplication') return await handleSubmitRentalApplication(data, res);
  return false;
}

exports.lineWebhook = onRequest(
  {
    region: 'us-central1',
    cors: true
  },
  async (req, res) => {
    try {
      if (req.method === 'GET') {
        res.status(200).send('LINE webhook is ready. Strict role binding is active. Rental binding is active.');
        return;
      }

      if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
      }

      if (req.body && req.body.action) {
        const handled = await handleBrowserAction(req, res);
        if (handled !== false) return;
      }

      const events = Array.isArray(req.body && req.body.events) ? req.body.events : [];

      for (const event of events) {
        if (event.type !== 'message') continue;
        if (!event.message || event.message.type !== 'text') continue;

        const text = normalizeText(event.message.text);
        const lineUserId = event.source && event.source.userId;
        const replyToken = event.replyToken;

        const employeeMatch = text.match(/^柚子員工綁定\s+([^\s]+@[^\s]+)$/i);
        const managerMatch = text.match(/^柚子主管綁定\s+([^\s]+@[^\s]+)$/i);
        const rentalMatch = text.match(/^柚子租賃綁定\s+(.+)$/i);
        const oldMatch = text.match(/^柚子綁定\s+([^\s]+@[^\s]+)$/i);

        if (!lineUserId) {
          await replyLineMessage(replyToken, '無法取得 LINE 使用者 ID，請確認是從一般 LINE 帳號與官方帳號對話。');
          continue;
        }

        if (oldMatch) {
          await replyLineMessage(replyToken, '舊版綁定指令已停用。員工請輸入：柚子員工綁定 your@email.com；主管請輸入：柚子主管綁定 your@email.com；租賃客人請輸入：柚子租賃綁定 你的手機號碼');
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

        if (rentalMatch) {
          await handleRentalBinding({
            rawKey: rentalMatch[1],
            lineUserId,
            replyToken
          });
          continue;
        }

        if (text.includes('綁定')) {
          await replyLineMessage(replyToken, '綁定格式錯誤。員工：柚子員工綁定 your@email.com；主管：柚子主管綁定 your@email.com；租賃客人：柚子租賃綁定 你的手機號碼');
        }
      }

      res.status(200).send('OK');
    } catch (error) {
      console.error('lineWebhook error:', error);
      res.status(200).send('OK');
    }
  }
);
