const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { registerExternalTeacherOnboarding, handleExternalTeacherLineEvent } = require('./externalTeacherOnboarding');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

registerExternalTeacherOnboarding(exports);

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
  if (!replyToken) throw new Error('缺少 LINE replyToken，無法回覆客人。');
  const token = await getLineAccessToken();
  if (!token) throw new Error('LINE Channel access token 未設定或部署時未載入。');

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
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`LINE reply API ${response.status}：${responseText.slice(0, 500)}`);
  }
  return { provider: 'line-messaging-api', responseStatus: response.status, responseText: responseText.slice(0, 500) };
}


async function pushLineMessage(lineUserId, message) {
  const to = normalizeText(lineUserId);
  if (!to) throw new Error('缺少 LINE User ID，無法推播。');
  const token = await getLineAccessToken();
  if (!token) throw new Error('LINE Channel access token 未設定或部署時未載入。');
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
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`LINE push API ${response.status}：${responseText.slice(0, 500)}`);
  }
  return { provider: 'line-messaging-api', responseStatus: response.status, responseText: responseText.slice(0, 500) };
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

function rentalAdminApplicationUrl(applicationId) {
  return `${webBaseUrl()}rental-admin.html?applicationId=${encodeURIComponent(applicationId)}`;
}

function externalTeacherContractUrl(contractId, code, verifyEmail = false) {
  return `${webBaseUrl()}external-teacher-onboarding.html?id=${encodeURIComponent(contractId || '')}&code=${encodeURIComponent(code || '')}${verifyEmail ? '&verify=email' : ''}`;
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
    try {
      await replyLineMessage(replyToken, `找不到租賃申請編號：${applicationKey}。請確認是否完整複製表單送出後產生的文字。`);
    } catch (replyErr) {
      console.error('[rental line bind not-found reply failed]', replyErr);
    }
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

  const customerReplyText = `已收到您的租賃申請：${applicationNo}

柚子樂器會透過此 LINE 先與您確認設備、金額與安裝／交付時間。

確認後會再傳正式資料連結給您。屆時需要填寫身分證字號並上傳身分證照片，請您先準備相關資料。`;

  let customerReplyStatus = '已發送';
  let customerReplyError = '';
  try {
    await replyLineMessage(replyToken, customerReplyText);
  } catch (replyErr) {
    customerReplyStatus = '發送失敗';
    customerReplyError = replyErr && replyErr.message ? replyErr.message : String(replyErr);
    console.error('[rental customer bind reply failed]', app.id, customerReplyError);
  }

  let managerNoticeStatus = '未設定';
  let managerNoticeError = '';
  let managerNoticeQueueId = '';
  let managerRecipient = null;
  try {
    managerRecipient = await getPrimaryManagerLineRecipient();
    const adminUrl = rentalAdminApplicationUrl(app.id);
    const equipment = normalizeText(data.otherEquipmentNeed || data.equipmentName || data.rentalType || '');
    const message = [
      '客人已完成租賃 LINE 綁定',
      `姓名：${customerName}`,
      `電話：${normalizeText(data.customerPhone || '')}`,
      `申請編號：${applicationNo}`,
      `租用需求：${equipment || '未填寫'}`,
      `希望方式：${normalizeText(data.shippingMethod || '')}`,
      `希望日期：${normalizeText(data.preferredDate || '')} ${normalizeText(data.preferredTime || '')}`.trim(),
      '',
      '請進入系統處理這一筆租賃申請：',
      adminUrl
    ].join('\n');

    if (!managerRecipient || !managerRecipient.lineUserId) {
      managerNoticeStatus = '發送失敗';
      managerNoticeError = '主管 LINE 收件人尚未設定。';
    } else if (managerRecipient.lineUserId === lineUserId) {
      managerNoticeStatus = '已略過';
      managerNoticeError = '主管 LINE 與客人 LINE 相同，為避免把後台連結傳給客人，已略過管理端推播。';
    } else {
      managerNoticeQueueId = `rental-line-bind-manager-${safeId(app.id)}-${Date.now()}`;
      await createNotificationQueue({
        queueId: managerNoticeQueueId,
        channel: 'line',
        targetLineUserId: managerRecipient.lineUserId,
        targetEmployeeId: managerRecipient.employeeId,
        targetName: managerRecipient.name || '柚子樂器主管',
        title: '客人已完成租賃 LINE 綁定',
        body: message,
        message,
        source: 'rental-line-linked-manager',
        applicationId: app.id,
        status: 'manual_ready'
      });
      const queueRef = db.collection(QUEUE_COLLECTION).doc(managerNoticeQueueId);
      const queueSnap = await queueRef.get();
      const result = queueSnap.exists
        ? await processNotificationQueueDoc(queueRef, queueSnap.data() || {}, { processor: 'rental-line-webhook', force: true })
        : { ok: false, error: '管理端通知佇列建立後讀取失敗。' };
      managerNoticeStatus = result && result.sent ? '已發送' : '發送失敗';
      managerNoticeError = result && result.error ? result.error : (managerNoticeStatus === '已發送' ? '' : 'LINE 管理端推播未成功。');
    }
  } catch (managerErr) {
    managerNoticeStatus = '發送失敗';
    managerNoticeError = managerErr && managerErr.message ? managerErr.message : String(managerErr);
    console.error('[rental manager bind notice failed]', app.id, managerNoticeError);
  }

  const lastError = [
    customerReplyStatus === '發送失敗' ? `客人回覆：${customerReplyError}` : '',
    managerNoticeStatus === '發送失敗' ? `管理端通知：${managerNoticeError}` : ''
  ].filter(Boolean).join('；');

  await app.ref.set({
    customerLineReplyStatus: customerReplyStatus,
    customerLineReplyError: customerReplyError,
    customerLineReplyAtText: nowText(),
    managerLineNoticeStatus: managerNoticeStatus,
    managerLineNoticeError,
    managerLineNoticeQueueId,
    managerLineRecipientId: managerRecipient ? managerRecipient.employeeId : '',
    managerLineRecipientMasked: managerRecipient ? maskLineUserId(managerRecipient.lineUserId) : '',
    managerLineNoticeAtText: nowText(),
    lineLastDeliveryStatus: lastError ? '發送失敗' : '已發送',
    lineLastDeliveryError: lastError,
    lineLastDeliveryCheckedAtText: nowText(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
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

function lineUserIdFromRow(data = {}) {
  return normalizeText(data.lineUserId || data['LINE User ID'] || data.targetLineUserId || data.lineId || '');
}

function maskLineUserId(value) {
  const id = normalizeText(value);
  if (!id) return '';
  if (id.length <= 10) return `${id.slice(0, 3)}***`;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

async function getPrimaryManagerLineRecipient() {
  const primary = await db.collection('employees').doc('PRIMARY_MANAGER_LINE').get();
  if (primary.exists) {
    const data = primary.data() || {};
    const lineUserId = lineUserIdFromRow(data);
    if (lineUserId) {
      return {
        employeeId: primary.id,
        name: normalizeText(data.name || data.displayName || '柚子樂器主要管理者'),
        email: normalizeEmail(data.email || data.Email || ''),
        lineUserId,
        source: 'PRIMARY_MANAGER_LINE'
      };
    }
  }

  const snap = await db.collection('employees').limit(300).get();
  const candidates = [];
  snap.forEach((doc) => {
    if (doc.id === 'PRIMARY_MANAGER_LINE') return;
    const data = doc.data() || {};
    const lineUserId = lineUserIdFromRow(data);
    if (!lineUserId || !isManagerData(data, doc.id)) return;
    const email = normalizeEmail(data.email || data.Email || data.mail || data.loginEmail || '');
    candidates.push({
      employeeId: doc.id,
      name: normalizeText(data.name || data.displayName || email || doc.id),
      email,
      lineUserId,
      source: isBootstrapAdminEmail(email) ? 'bootstrap-admin' : 'manager-fallback',
      priority: isBootstrapAdminEmail(email) ? 0 : (data.lineNotifyEnabled === false ? 2 : 1)
    });
  });
  candidates.sort((a, b) => a.priority - b.priority || a.employeeId.localeCompare(b.employeeId));
  return candidates[0] || null;
}

async function getPrimaryManagerLineUserId() {
  const recipient = await getPrimaryManagerLineRecipient();
  return recipient ? recipient.lineUserId : '';
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

async function findEmployeeByBindCode(bindCode) {
  const code = normalizeText(bindCode).toUpperCase();
  if (!code) return null;
  const bindingRef = db.collection('employeeLineBindings').doc(code);
  const bindingSnap = await bindingRef.get();
  let binding = bindingSnap.exists ? (bindingSnap.data() || {}) : null;
  let employeeId = normalizeText(binding && (binding.employeeId || binding.employeeDocId || binding.targetEmployeeId));
  let applicationId = normalizeText(binding && binding.applicationId);

  if (!employeeId && applicationId) {
    const appSnap = await db.collection('registrationApplications').doc(applicationId).get();
    if (appSnap.exists) {
      const app = appSnap.data() || {};
      employeeId = normalizeText(app.approvedEmployeeDocId || app.approvedEmployeeId || app.linkedEmployeeId || '');
    }
  }

  if (employeeId) {
    const employeeSnap = await db.collection('employees').doc(employeeId).get();
    if (employeeSnap.exists) return { type: 'employee', ref: employeeSnap.ref, id: employeeSnap.id, data: employeeSnap.data() || {}, bindingRef, binding, applicationId };
  }

  if (applicationId) {
    const appSnap = await db.collection('registrationApplications').doc(applicationId).get();
    if (appSnap.exists) return { type: 'application', ref: appSnap.ref, id: appSnap.id, data: appSnap.data() || {}, bindingRef, binding, applicationId };
  }

  const q = await db.collection('registrationApplications').where('employeeBindCode', '==', code).limit(1).get();
  if (!q.empty) {
    const doc = q.docs[0];
    return { type: 'application', ref: doc.ref, id: doc.id, data: doc.data() || {}, bindingRef, binding, applicationId: doc.id };
  }

  return null;
}

async function handleEmployeeCodeBinding({ bindCode, lineUserId, replyToken }) {
  const code = normalizeText(bindCode).toUpperCase();
  const target = await findEmployeeByBindCode(code);
  if (!target) {
    await replyLineMessage(replyToken, `查不到這組人員 LINE 綁定碼：${code}\n\n請確認是否完整複製後再貼上，或請主管從後台重新提供綁定文字。`);
    return;
  }

  const primaryManagerLineUserId = await getPrimaryManagerLineUserId();
  if (primaryManagerLineUserId && primaryManagerLineUserId === lineUserId) {
    await replyLineMessage(replyToken, '這支 LINE 已被設定為主管通知帳號，不能綁定人員帳號。請使用本人自己的手機 LINE 綁定。');
    return;
  }

  const currentEmployeeId = target.type === 'employee' ? target.id : normalizeText(target.data.approvedEmployeeId || target.data.linkedEmployeeId || target.data.employeeId || target.id);
  const isAlreadyBoundElsewhere = await hasThisLineBoundToAnotherEmployee(lineUserId, currentEmployeeId);
  if (isAlreadyBoundElsewhere) {
    await replyLineMessage(replyToken, '這支 LINE 已綁定其他人員，不能重複綁定。請先由主管清除原本的 LINE 綁定。');
    return;
  }

  const profile = await getLineProfile(lineUserId);
  const lineDisplayName = normalizeText(profile.displayName || '');
  const patch = {
    lineUserId,
    lineDisplayName,
    lineNotifyEnabled: true,
    lineBindStatus: 'bound',
    lineBoundAt: admin.firestore.FieldValue.serverTimestamp(),
    lineBoundAtText: new Date().toISOString(),
    employeeBindCode: code,
    employeeBindText: `柚子人員綁定 ${code}`,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: new Date().toISOString()
  };

  await target.ref.set(patch, { merge: true });
  if (target.type === 'application') {
    await target.ref.set({ applicationStatus: 'pending_setup', status: '待主管建檔', currentStep: '等待主管審核', progressStatus: 'LINE 已綁定，等待主管審核' }, { merge: true });
  }
  if (target.bindingRef) {
    await target.bindingRef.set({ status: 'bound', lineUserId, lineDisplayName, boundAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  }

  const externalTeacherContractId = normalizeText(target.binding && (target.binding.externalTeacherContractId || target.binding.teacherId || target.binding.externalTeacherId));
  if (externalTeacherContractId) {
    const externalPatch = {
      ...patch,
      externalTeacherEmployeeId: currentEmployeeId || target.id,
      employeeId: currentEmployeeId || target.id,
      status: 'waiting_contract',
      progressStatus: '綁定完成，等待正式資料填寫'
    };
    await db.collection('externalTeacherContracts').doc(externalTeacherContractId).set(externalPatch, { merge: true });
    await db.collection('externalTeacherProfiles').doc(externalTeacherContractId).set(externalPatch, { merge: true });
  }

  const name = normalizeText(target.data.name || target.data.displayName || target.data.employeeName || target.data.teacherName || target.data.email || code);
  const nextToken = normalizeText(target.binding && (target.binding.onboardingToken || target.binding.bindingCode || target.binding.employeeBindCode)) || code;
  const nextUrl = externalTeacherContractId ? externalTeacherContractUrl(externalTeacherContractId, nextToken, false) : '';
  let replyText = `LINE 綁定成功 ✅\n\n姓名：${name}\n綁定碼：${code}`;
  if (nextUrl) {
    replyText += `\n\n請點選下方下一步連結，繼續完成正式資料填寫：\n${nextUrl}`;
  } else if (target.type === 'application') {
    replyText += '\n\n您的 LINE 驗證已完成，接下來請等待主管審核。';
  }
  await replyLineMessage(replyToken, replyText);
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

async function resolveLineAccessToken() {
  const envCandidates = [
    ['LINE_CHANNEL_ACCESS_TOKEN', process.env.LINE_CHANNEL_ACCESS_TOKEN],
    ['LINE_MESSAGING_ACCESS_TOKEN', process.env.LINE_MESSAGING_ACCESS_TOKEN],
    ['LINE_ACCESS_TOKEN', process.env.LINE_ACCESS_TOKEN],
    ['LINE_BOT_CHANNEL_ACCESS_TOKEN', process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN]
  ];
  for (const [name, value] of envCandidates) {
    const token = clean(value || '');
    if (token) return { token, configured: true, source: `env:${name}` };
  }
  const token = await getSystemSettingValue([
    'LINE_CHANNEL_ACCESS_TOKEN',
    'LINE Channel Access Token',
    'LINE Messaging API Token',
    'LINE Access Token',
    'LINE Bot Access Token',
    'LINE_TOKEN'
  ]);
  return token
    ? { token, configured: true, source: 'firestore:systemSettings' }
    : { token: '', configured: false, source: '' };
}

async function getLineAccessToken() {
  const resolved = await resolveLineAccessToken();
  return resolved.token;
}

function queueStatus(row = {}) {
  return clean(row.status || row['狀態'] || '待發送');
}

function isPendingQueue(row = {}) {
  const status = queueStatus(row);
  if (SENT_STATUSES.has(status) || SENDING_STATUSES.has(status)) return false;
  return !status || PENDING_STATUSES.has(status) || /^fail|失敗|error/i.test(status);
}

function queueScheduledAtMillis(row = {}) {
  const raw = row.sendAfterAt || row.scheduledAt || row.notBeforeAt || row.deliverAfterAt;
  if (!raw) return 0;
  if (typeof raw.toDate === 'function') return raw.toDate().getTime();
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDateTimeTextFromMillis(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function queueChannel(row = {}) {
  return clean(row.channel || row.type || row.notifyType || row['發送方式']).toLowerCase();
}

function queueTargetLineUserId(row = {}) {
  return clean(row.targetLineUserId || row.lineUserId || row.toLineUserId || row.customerLineUserId || row['LINE User ID']);
}

function isValidLinePushTargetId(value) {
  const v = clean(value);
  // LINE push 的收件人應為 User/Group/Room ID；租賃客人正常會是 U 開頭的 User ID。
  return /^[UCR][A-Za-z0-9_-]{20,}$/.test(v);
}

function isValidCustomerLineUserId(value) {
  const v = clean(value);
  return /^U[A-Za-z0-9_-]{20,}$/.test(v);
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


function queueTextBlob(row = {}) {
  return [
    row.source,
    row.eventCode,
    row.eventKey,
    row.type,
    row.notificationType,
    row.featureCode,
    row.title,
    row.subject,
    row.body,
    row.text,
    row.message,
    row.content
  ].map((v) => clean(v).toLowerCase()).filter(Boolean).join('|');
}

function isEmployeeClockAutoReminder(row = {}) {
  const blob = queueTextBlob(row);
  if (!blob) return false;
  if (/clockauto|clock\.work|clock\.late|clock\.off|parttime\.hours|attendance.*reminder|punch.*reminder/.test(blob)) return true;
  return /上班前提醒|上班後未打卡提醒|下班後未打卡提醒|表定下班時間提醒|上下班打卡自動提醒|上班打卡提醒|下班打卡提醒|請打上班卡|請打下班卡|未打上班卡|未打下班卡|工讀下班後未填時數/.test(blob);
}

function queueTargetEmployeeId(row = {}) {
  return clean(row.targetEmployeeId || row.employeeId || row.employeeDocId || row.userId || row.uid || row['員工ID']);
}

async function queueTargetIsAdminOrManager(row = {}) {
  const email = normalizeEmail(queueTargetEmail(row) || row.emailTo || row.to || row.loginEmail || '');
  if (isBootstrapAdminEmail(email)) return true;

  const employeeId = queueTargetEmployeeId(row);
  if (employeeId === 'PRIMARY_MANAGER_LINE' || employeeId === DEFAULT_ADMIN_DOC_ID) return true;

  const targetLine = queueTargetLineUserId(row);
  if (targetLine) {
    try {
      const primaryLine = await getPrimaryManagerLineUserId();
      if (primaryLine && primaryLine === targetLine) return true;
    } catch (err) {
      // ignore and continue with employee lookup
    }
  }

  if (employeeId) {
    try {
      const snap = await db.collection('employees').doc(employeeId).get();
      if (snap.exists) {
        const data = snap.data() || {};
        if (isManagerData(data, snap.id)) return true;
        if (isBootstrapAdminEmail(data.email || data.Email || data.loginEmail || '')) return true;
      }
    } catch (err) {
      // if lookup fails, do not block normal employee notifications
    }
  }
  return false;
}

async function shouldSuppressQueueDelivery(row = {}) {
  if (!isEmployeeClockAutoReminder(row)) return false;
  return await queueTargetIsAdminOrManager(row);
}

function normalizeNotificationPreference(value, hasEmail) {
  const v = clean(value).toLowerCase();
  if (['email', 'email_only', 'email-only', 'mail', '只用email', '只用 email', '只用信箱', '信箱'].includes(v)) return 'email';
  if (['line', 'line_only', 'line-only', '只用line', '只用 line'].includes(v)) return 'line';
  if (['both', 'line_email', 'line+email', 'line + email', 'all', '雙軌'].includes(v)) return 'both';
  return hasEmail ? 'both' : 'line';
}
function wantsLineByPreference(pref) {
  return pref === 'line' || pref === 'both';
}
function wantsEmailByPreference(pref) {
  return pref === 'email' || pref === 'both';
}
function isCustomerEmailVerified(row = {}) {
  return row.emailVerified === true || clean(row.emailLinkStatus).toLowerCase() === 'verified' || !!clean(row.emailVerifiedAtText);
}
function customerEmailOf(row = {}) {
  return queueTargetEmail(row);
}
async function createCustomerNotificationQueues({ row, title, body, source, contractId, applicationId, sendAfterAt, sendAfterMs, signUrl, officialContractUrl, initialStatus }) {
  row = row || {};
  const email = customerEmailOf(row);
  const pref = normalizeNotificationPreference(row.notificationPreference || row.preferredContactMethod, email);
  const rawLineId = queueTargetLineUserId(row);
  const lineId = isValidCustomerLineUserId(rawLineId) ? rawLineId : '';
  const targetName = clean(row.customerName || row.partyAName || row.targetName || '客人');
  const baseId = `${safeId(source || 'rental-customer-notice')}-${safeId(contractId || applicationId || row.contractId || row.applicationId || 'rental')}-${Date.now()}`;
  const results = {
    line: false,
    email: false,
    count: 0,
    queueIds: [],
    preference: pref,
    lineRequested: wantsLineByPreference(pref),
    emailRequested: wantsEmailByPreference(pref),
    lineTargetFound: !!lineId,
    emailTargetFound: !!email,
    lineSkippedReason: '',
    emailSkippedReason: ''
  };
  const common = stripUndefined({
    targetName,
    title,
    body,
    message: body,
    status: clean(initialStatus) || '待發送',
    sendAfterAt,
    sendAfterMs,
    source,
    contractId,
    applicationId,
    notificationPreference: pref,
    emailVerified: isCustomerEmailVerified(row),
    signUrl,
    officialContractUrl,
  });
  if (wantsLineByPreference(pref) && lineId) {
    const queueId = `${baseId}-line`;
    await createNotificationQueue(Object.assign({}, common, {
      queueId,
      channel: 'line',
      targetLineUserId: lineId,
      targetEmail: email,
    }));
    results.line = true;
    results.count += 1;
    results.queueIds.push(queueId);
  } else if (wantsLineByPreference(pref)) {
    results.lineSkippedReason = rawLineId
      ? '客人 LINE 配對資料格式不正確，請重新配對 LINE。'
      : '客人尚未完成 LINE 配對，契約內沒有 LINE User ID。';
  }
  if (wantsEmailByPreference(pref) && email) {
    const queueId = `${baseId}-email`;
    await createNotificationQueue(Object.assign({}, common, {
      queueId,
      channel: 'email',
      targetEmail: email,
      targetLineUserId: lineId,
    }));
    results.email = true;
    results.count += 1;
    results.queueIds.push(queueId);
  } else if (wantsEmailByPreference(pref)) {
    results.emailSkippedReason = '客人沒有 Email。';
  }
  return results;
}


function lineImageUrlFromQueue(row = {}) {
  const url = clean(row.lineImageUrl || row.paymentImageUrl || row.imageUrl || row.imageOriginalUrl || row.originalContentUrl);
  if (!url) return '';
  if (!/^https:\/\//i.test(url)) return '';
  return url;
}

async function sendLinePush(row) {
  const to = queueTargetLineUserId(row);
  if (!to) throw new Error('缺少 LINE User ID，無法發送 LINE。');
  if (!isValidLinePushTargetId(to)) throw new Error('LINE 收件人資料不正確，請重新完成 LINE 配對。');
  const token = await getLineAccessToken();
  if (!token) throw new Error('缺少 LINE_CHANNEL_ACCESS_TOKEN，尚未設定 LINE Messaging API Channel access token。');

  const title = queueTitle(row);
  const body = queueBody(row);
  const directLineText = clean(row.lineText || row.lineMessage || row.lineBody);
  const text = directLineText || (title && body && title !== body ? `${title}\n${body}` : (body || title || '柚子樂器通知'));
  const messages = [{ type: 'text', text: text.slice(0, 4900) }];
  const imageUrl = lineImageUrlFromQueue(row);
  if (imageUrl) {
    messages.push({
      type: 'image',
      originalContentUrl: imageUrl,
      previewImageUrl: clean(row.linePreviewImageUrl || row.previewImageUrl) || imageUrl,
    });
  }

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      to,
      messages,
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
  const currentStatus = queueStatus(row);
  const attemptCount = Number(row.attemptCount || 0) || 0;
  if (options.force !== true && /發送失敗|fail|error/i.test(currentStatus) && attemptCount >= 5) {
    return { ok: false, skipped: true, reason: '已達自動重試上限 5 次。', queueId, channel: queueChannel(row) };
  }
  if (options.force !== true && !isPendingQueue(row)) return { ok: true, skipped: true, reason: `狀態不是待發送：${currentStatus}` };

  const scheduledAt = queueScheduledAtMillis(row);
  const nowMs = Date.now();
  if (scheduledAt && scheduledAt > nowMs) {
    const delayMs = scheduledAt - nowMs;
    await markQueue(docRef, {
      queueId,
      status: '待發送',
      scheduledForText: formatDateTimeTextFromMillis(scheduledAt),
      scheduledRemainingMs: delayMs,
      schedulerNote: '尚未到預定發送時間，先保留待發送。',
    });
    if (options.processor === 'onCreate' && delayMs <= 90000) {
      await sleep(delayMs);
      const freshSnap = await docRef.get();
      if (!freshSnap.exists) return { ok: true, skipped: true, reason: 'queue-deleted-before-scheduled-time' };
      row = freshSnap.data() || {};
      if (!isPendingQueue(row)) return { ok: true, skipped: true, reason: `等待期間狀態已變更：${queueStatus(row)}` };
    } else {
      return { ok: true, skipped: true, scheduled: true, queueId, sendAfterAt: formatDateTimeTextFromMillis(scheduledAt) };
    }
  }

  const channel = queueChannel(row);
  if (!['line', 'email'].includes(channel)) {
    await markQueue(docRef, { status: '發送失敗', lastError: `不支援的發送方式：${channel || '(空白)'}` });
    return { ok: false, skipped: true, reason: 'unsupported-channel' };
  }

  if (await shouldSuppressQueueDelivery(row)) {
    await markQueue(docRef, {
      queueId,
      status: '已略過',
      skippedAt: admin.firestore.FieldValue.serverTimestamp(),
      skippedAtText: nowText(),
      lastError: '管理者 / 主管帳號不接收員工上班打卡自動提醒。',
      processor: options.processor || 'cloud-function',
    });
    await appendNotificationLog(queueId, {
      status: '已略過',
      channel,
      provider: 'suppressed',
      targetEmployeeId: queueTargetEmployeeId(row),
      targetName: clean(row.targetName),
      targetEmail: queueTargetEmail(row),
      targetLineUserId: queueTargetLineUserId(row),
      title: queueTitle(row),
      body: queueBody(row),
      reason: 'admin-manager-clock-reminder-suppressed',
    });
    return { ok: true, skipped: true, reason: 'admin-manager-clock-reminder-suppressed', queueId, channel };
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

function buildRenewalReturnUrl(contract) {
  const base = webBaseUrl();
  const token = clean(contract.renewalToken || contract.officialContractToken || contract.customerToken || contract.signToken || contract.token);
  return `${base}rental-renewal.html?contractId=${encodeURIComponent(clean(contract.contractId || contract.__id))}&token=${encodeURIComponent(token)}`;
}

function todayYmdTaipei() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = {};
  parts.forEach((p) => { if (p.type !== 'literal') map[p.type] = p.value; });
  return `${map.year}-${map.month}-${map.day}`;
}

function daysBetweenYmd(startYmd, endYmd) {
  const a = Date.parse(`${clean(startYmd)}T00:00:00Z`);
  const b = Date.parse(`${clean(endYmd)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 999999;
  return Math.round((b - a) / 86400000);
}

async function ensureRenewalToken(docRef, contract) {
  let token = clean(contract.renewalToken || contract.officialContractToken || contract.customerToken || contract.signToken || contract.token);
  if (token) return token;
  token = randomToken(18);
  await docRef.set({ renewalToken: token, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedAtText: nowText() }, { merge: true });
  contract.renewalToken = token;
  return token;
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

exports.sendNotificationQueueOnCreate = onDocumentCreated({
  document: `${QUEUE_COLLECTION}/{queueId}`,
  region: 'us-central1',
  timeoutSeconds: 180,
  memory: '512MiB',
}, async (event) => {
  const snap = event.data;
  if (!snap) return null;
  return await processNotificationQueueDoc(snap.ref, snap.data() || {}, { processor: 'onCreate' });
});

exports.flushNotificationQueue = onSchedule({ schedule: 'every 5 minutes', region: 'us-central1', timeoutSeconds: 120, memory: '512MiB' }, async () => {
  const snap = await db.collection(QUEUE_COLLECTION).where('status', 'in', ['待發送', 'pending', 'queued', 'retry', '發送失敗']).limit(50).get();
  const results = [];
  for (const doc of snap.docs) {
    results.push(await processNotificationQueueDoc(doc.ref, doc.data() || {}, { processor: 'scheduler' }));
  }
  return results;
});

exports.rentalExpiryReminderDaily = onSchedule({ schedule: '0 10 * * *', timeZone: 'Asia/Taipei', region: 'us-central1', timeoutSeconds: 180, memory: '512MiB' }, async () => {
  const activeStatuses = ['租賃中', '到期提醒中', '續約待確認', '續約待付款'];
  const today = todayYmdTaipei();
  const snap = await db.collection('rentalContracts').where('status', 'in', activeStatuses).limit(300).get();
  const results = [];
  for (const doc of snap.docs) {
    const contract = Object.assign({ __id: doc.id, contractId: doc.id }, doc.data() || {});
    const endDate = clean(contract.endDate || contract.officialEndDate || contract.currentEndDate);
    const left = daysBetweenYmd(today, endDate);
    if (left < 0 || left > 5) continue;
    if (clean(contract.expiryReminderSentForEndDate) === endDate) {
      results.push({ contractId: doc.id, skipped: true, reason: 'already-sent-for-endDate', endDate });
      continue;
    }
    await ensureRenewalToken(doc.ref, contract);
    const url = buildRenewalReturnUrl(contract);
    const body = [`續約與退租提醒`, ``, `您的租賃目前到期日：${endDate || '未設定'}`, ``, `請點選以下連結，選擇「續約」或「退租」：`, url].join('\n');
    const notifyResult = await createCustomerNotificationQueues({
      row: Object.assign({}, contract, { contractId: doc.id }),
      title: '續約與退租提醒',
      body,
      source: 'rental-expiry-renewal-return-reminder',
      contractId: doc.id,
      officialContractUrl: url,
    });
    await doc.ref.set({
      status: clean(contract.status) === '租賃中' ? '到期提醒中' : clean(contract.status || '到期提醒中'),
      renewalReturnLinkUrl: url,
      expiryReminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
      expiryReminderSentAtText: nowText(),
      expiryReminderSentForEndDate: endDate,
      expiryReminderDaysLeft: left,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtText: nowText(),
    }, { merge: true });
    results.push({ contractId: doc.id, endDate, daysLeft: left, notificationResult: notifyResult });
  }
  return { today, count: results.length, results };
});

exports.rentalLineRuntimeStatusHttp = httpEndpoint(async () => {
  const tokenInfo = await resolveLineAccessToken();
  const managerRecipient = await getPrimaryManagerLineRecipient();
  let latestLineFailure = null;
  try {
    const snap = await db.collection(QUEUE_COLLECTION).limit(120).get();
    const failures = [];
    snap.forEach((doc) => {
      const row = Object.assign({ queueId: doc.id }, doc.data() || {});
      if (queueChannel(row) !== 'line') return;
      const status = queueStatus(row);
      if (!/發送失敗|fail|error/i.test(status)) return;
      failures.push({
        queueId: clean(row.queueId || doc.id),
        source: clean(row.source),
        status,
        lastError: clean(row.lastError),
        atText: clean(row.failedAtText || row.updatedAtText || row.createdAtText)
      });
    });
    failures.sort((a, b) => clean(b.atText).localeCompare(clean(a.atText)));
    latestLineFailure = failures[0] || null;
  } catch (err) {
    latestLineFailure = { status: '讀取失敗', lastError: err && err.message ? err.message : String(err), atText: nowText() };
  }
  return {
    lineTokenConfigured: tokenInfo.configured,
    lineTokenSource: tokenInfo.source,
    managerLineConfigured: !!(managerRecipient && managerRecipient.lineUserId),
    managerRecipientName: managerRecipient ? managerRecipient.name : '',
    managerRecipientId: managerRecipient ? managerRecipient.employeeId : '',
    managerLineUserIdMasked: managerRecipient ? maskLineUserId(managerRecipient.lineUserId) : '',
    latestLineFailure
  };
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
  const customerEmail = normalizeEmail(data.customerEmail || data.email || '');
  const notificationPreference = normalizeNotificationPreference(data.notificationPreference || data.preferredContactMethod, customerEmail);
  const applicationNo = clean(data.applicationNo || applicationId);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const ref = db.collection('rentalApplications').doc(applicationId);
  const currentSnap = await ref.get();
  const current = currentSnap.exists ? (currentSnap.data() || {}) : {};
  const exists = currentSnap.exists;
  const emailVerifyToken = clean(data.emailVerifyToken || current.emailVerifyToken) || randomToken(18);
  const emailVerificationUrl = `${webBaseUrl()}rental-email-verify.html?applicationId=${encodeURIComponent(applicationId)}&token=${encodeURIComponent(emailVerifyToken)}`;
  const wantsLine = wantsLineByPreference(notificationPreference);
  const wantsEmail = wantsEmailByPreference(notificationPreference);
  const row = stripUndefined(Object.assign({}, data, {
    applicationId,
    applicationNo,
    customerName,
    customerEmail,
    notificationPreference,
    preferredContactMethod: notificationPreference,
    emailVerifyToken,
    emailVerificationUrl,
    emailVerified: current.emailVerified === true ? true : false,
    emailLinkStatus: wantsEmail ? (current.emailVerified === true ? 'verified' : clean(current.emailLinkStatus || 'pending')) : 'not_required',
    lineConfirmText: clean(data.lineConfirmText) || `設備租賃申請 ${applicationNo}`,
    lineLinkStatus: wantsLine ? clean(data.lineLinkStatus || current.lineLinkStatus || 'pending') : 'not_required',
    status: clean(data.status || '待店家確認'),
    updatedAt: now,
    updatedAtText: nowText(),
  }));
  if (!exists) {
    row.createdAt = now;
    row.createdAtText = clean(data.createdAtText || nowText());
  }
  await ref.set(row, { merge: true });

  let emailVerificationQueued = false;
  try {
    const body = [
      '收到新的設備租賃申請',
      `姓名：${customerName}`,
      `電話：${clean(data.customerPhone || '')}`,
      `Email：${customerEmail || '未填'}`,
      `通知方式：${notificationPreference === 'email' ? '只用 Email' : notificationPreference === 'line' ? '只用 LINE' : 'LINE + Email'}`,
      `設備需求：${clean(data.otherEquipmentNeed || data.equipmentName || data.rentalType || '未填寫')}`,
      `希望方式：${clean(data.shippingMethod || '')}`,
      `希望日期：${clean(data.preferredDate || '')} ${clean(data.preferredTime || '')}`.trim(),
      '',
      `申請編號：${applicationNo}`,
      '',
      wantsLine ? `LINE 配對文字：設備租賃申請 ${applicationNo}` : '客人選擇不使用 LINE 配對。'
    ].join('\n');
    await queueManagerNotification({ title: '新的設備租賃申請', body, source: 'rental-application', applicationId });
  } catch (err) {
    console.error('[rentalSubmitApplicationHttp queue manager notice failed]', err);
  }

  if (wantsEmail && customerEmail) {
    try {
      const verifyBody = [
        `${customerName} 您好，柚子樂器已收到您的設備租賃申請。`,
        '',
        `申請編號：${applicationNo}`,
        '',
        '打開這封信本身不會自動確認；請點選以下連結確認 Email，連到確認頁後才會完成確認：',
        emailVerificationUrl,
        '',
        wantsLine ? `若您也要使用 LINE 通知，請到柚子樂器官方 LINE 貼上：設備租賃申請 ${applicationNo}` : '您已選擇只用 Email 通知，不需要完成 LINE 配對。',
        '',
        '柚子樂器官網：https://www.mingtinghuang.com/',
      ].join('\n');
      await createNotificationQueue({
        queueId: `rental-email-verify-${safeId(applicationId)}-${Date.now()}`,
        channel: 'email',
        targetEmail: customerEmail,
        targetName: customerName,
        title: '請確認柚子樂器租賃通知 Email',
        body: verifyBody,
        message: verifyBody,
        source: 'rental-email-verify',
        applicationId,
        notificationPreference,
        emailVerificationUrl,
      });
      emailVerificationQueued = true;
      await ref.set({ emailVerificationQueuedAtText: nowText() }, { merge: true });
    } catch (err) {
      console.error('[rentalSubmitApplicationHttp queue email verification failed]', err);
      await ref.set({ emailVerificationQueueError: err && err.message ? err.message : String(err) }, { merge: true });
    }
  }

  return { applicationId, applicationNo, lineConfirmText: row.lineConfirmText, notificationPreference, emailVerificationQueued, emailVerificationUrl: wantsEmail ? emailVerificationUrl : '' };
});

exports.rentalVerifyEmailHttp = httpEndpoint(async (data) => {
  const applicationId = clean(data.applicationId || data.id || data.applicationNo);
  const token = clean(data.token || data.emailVerifyToken);
  if (!applicationId || !token) throw new Error('Email 確認連結不完整。');
  const ref = db.collection('rentalApplications').doc(applicationId);
  let snap = await ref.get();
  if (!snap.exists) {
    const found = await findRentalApplication(applicationId);
    if (!found) throw new Error('找不到租賃申請資料。');
    snap = await found.ref.get();
  }
  const app = Object.assign({ __id: snap.id }, snap.data() || {});
  if (clean(app.emailVerifyToken) !== token) throw new Error('Email 確認連結驗證失敗。');
  const update = {
    emailVerified: true,
    emailLinkStatus: 'verified',
    emailVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    emailVerifiedAtText: nowText(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: nowText(),
  };
  await snap.ref.set(update, { merge: true });
  const contractSnap = await db.collection('rentalContracts').where('applicationId', '==', snap.id).limit(5).get();
  const batch = db.batch();
  contractSnap.forEach((doc) => batch.set(doc.ref, update, { merge: true }));
  if (!contractSnap.empty) await batch.commit();
  try {
    const adminUrl = rentalAdminApplicationUrl(snap.id);
    await queueManagerNotification({
      title: '租賃客人已完成 Email 確認',
      body: [
        `姓名：${clean(app.customerName)}`,
        `Email：${clean(app.customerEmail)}`,
        `申請編號：${clean(app.applicationNo || snap.id)}`,
        '',
        '請進入系統處理這一筆租賃申請：',
        adminUrl
      ].join('\n'),
      source: 'rental-email-verified',
      applicationId: snap.id,
    });
  } catch (err) {
    console.warn('queue manager notification for rentalVerifyEmailHttp failed:', err);
  }
  return { applicationId: snap.id, applicationNo: clean(app.applicationNo || snap.id), customerEmail: clean(app.customerEmail) };
});


const RENTAL_INLINE_ASSET_FIELDS = [
  'customerSignatureDataUrl',
  'signatureDataUrl',
  'signDataUrl',
  'customerIdImageWatermarkedDataUrl',
  'idImageWatermarkedDataUrl',
  'customerIdImageDataUrl',
  'idImageDataUrl',
  'idCardImageDataUrl'
];
function isRentalDataUrl(value) {
  return /^data:/i.test(String(value || ''));
}
function rentalFirstClean(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return '';
}
function rentalAssetUrls(row) {
  row = row || {};
  const signatureUrl = rentalFirstClean(
    row.customerSignatureUrl,
    row.signatureUrl,
    !isRentalDataUrl(row.customerSignatureDataUrl) ? row.customerSignatureDataUrl : '',
    !isRentalDataUrl(row.signatureDataUrl) ? row.signatureDataUrl : ''
  );
  const idImageUrl = rentalFirstClean(
    row.customerIdImageUrl,
    row.idImageUrl,
    row.idCardImageUrl,
    !isRentalDataUrl(row.customerIdImageWatermarkedDataUrl) ? row.customerIdImageWatermarkedDataUrl : '',
    !isRentalDataUrl(row.idImageWatermarkedDataUrl) ? row.idImageWatermarkedDataUrl : ''
  );
  return { signatureUrl, idImageUrl };
}
function stripRentalInlineAssets(row, options = {}) {
  const out = Object.assign({}, row || {});
  const urls = rentalAssetUrls(out);
  if (urls.signatureUrl) {
    out.customerSignatureUrl = urls.signatureUrl;
    out.signatureUrl = urls.signatureUrl;
  }
  if (urls.idImageUrl) {
    out.customerIdImageUrl = urls.idImageUrl;
    out.idImageUrl = urls.idImageUrl;
  }
  RENTAL_INLINE_ASSET_FIELDS.forEach((key) => { delete out[key]; });
  if (options.deleteInline) {
    const del = admin.firestore.FieldValue.delete();
    RENTAL_INLINE_ASSET_FIELDS.forEach((key) => { out[key] = del; });
  }
  return out;
}

exports.rentalSaveContractHttp = httpEndpoint(async (data) => {
  const incomingId = clean(data.contractId || data.id || data.__id);
  const contractId = incomingId || randomId('RC');
  const ref = db.collection('rentalContracts').doc(contractId);
  const currentSnap = await ref.get();
  const current = currentSnap.exists ? stripRentalInlineAssets(currentSnap.data() || {}) : {};
  const signToken = clean(data.signToken || current.signToken || current.token) || randomToken(18);
  const customerToken = clean(data.customerToken || current.customerToken) || randomToken(18);
  const officialContractToken = clean(data.officialContractToken || current.officialContractToken) || randomToken(18);
  const contractNo = clean(data.contractNo || current.contractNo || contractId);
  const status = data.makeSignLink ? '待客人補資料' : clean(data.status || current.status || '草稿');
  const now = admin.firestore.FieldValue.serverTimestamp();
  const safeData = stripRentalInlineAssets(data || {});
  const row = stripUndefined(Object.assign({}, current, safeData, {
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


exports.rentalSendSignLinkHttp = httpEndpoint(async (data) => {
  const contractId = clean(data.contractId || data.id || data.__id);
  if (!contractId) throw new Error('缺少契約編號，無法傳送正式資料填寫連結。');

  const ref = db.collection('rentalContracts').doc(contractId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('找不到契約資料，無法傳送正式資料填寫連結。');

  const current = Object.assign({ __id: snap.id, contractId: snap.id }, snap.data() || {});
  const signToken = clean(current.signToken || current.token) || randomToken(18);
  const customerToken = clean(current.customerToken) || randomToken(18);
  const officialContractToken = clean(current.officialContractToken) || randomToken(18);
  const contractNo = clean(current.contractNo || snap.id);
  const signUrl = buildSignUrl({ contractId: snap.id, signToken });
  const officialContractUrl = buildOfficialContractUrl({ contractId: snap.id, officialContractToken, customerToken, signToken });
  const customerName = clean(current.customerName || current.partyAName || '客人');

  const normalized = stripUndefined({
    contractId: snap.id,
    contractNo,
    signToken,
    token: signToken,
    customerToken,
    officialContractToken,
    signUrl,
    officialContractUrl,
    status: '待客人補資料',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: nowText(),
  });
  await ref.set(normalized, { merge: true });

  const row = Object.assign({}, current, normalized, { __id: snap.id, contractId: snap.id });
  const body = [
    `${customerName} 您好，請點選以下連結，補填身分證字號、上傳身分證照片，並完成簽名確認：`,
    '',
    signUrl,
    '',
    '送出後，柚子樂器會再確認資料，並依約定時間安裝／交付設備。',
  ].join('\n');

  const notificationResult = await createCustomerNotificationQueues({
    row,
    title: '租賃正式資料填寫連結',
    body,
    source: 'rental-sign-link',
    contractId: snap.id,
    applicationId: clean(row.applicationId),
    signUrl,
    initialStatus: 'manual_ready',
  });

  const sendResults = [];
  for (const queueId of notificationResult.queueIds || []) {
    const queueRef = db.collection(QUEUE_COLLECTION).doc(queueId);
    const queueSnap = await queueRef.get();
    if (queueSnap.exists) {
      sendResults.push(await processNotificationQueueDoc(queueRef, queueSnap.data() || {}, { processor: 'rental-sign-link-http', force: true }));
    }
  }
  notificationResult.sendResults = sendResults;
  notificationResult.sentCount = sendResults.filter((r) => r && r.sent).length;
  notificationResult.failedCount = sendResults.filter((r) => r && r.ok === false).length;
  const lineResult = sendResults.find((r) => r && r.channel === 'line') || null;
  const emailResult = sendResults.find((r) => r && r.channel === 'email') || null;
  notificationResult.lineSent = !!(lineResult && lineResult.sent);
  notificationResult.emailSent = !!(emailResult && emailResult.sent);
  notificationResult.lineFailed = !!(notificationResult.lineRequested && !notificationResult.lineSent);
  notificationResult.emailFailed = !!(notificationResult.emailRequested && !notificationResult.emailSent);
  notificationResult.lineError = clean((lineResult && lineResult.error) || notificationResult.lineSkippedReason || '');
  notificationResult.emailError = clean((emailResult && emailResult.error) || notificationResult.emailSkippedReason || '');

  await ref.set({
    signLinkNoticeQueueCreated: notificationResult.count > 0,
    signLinkNoticeQueueCreatedAt: notificationResult.count ? nowText() : '',
    signLinkLineQueueCreated: notificationResult.line,
    signLinkEmailQueueCreated: notificationResult.email,
    signLinkNoticeQueueIds: notificationResult.queueIds,
    signLinkNoticeSendResults: sendResults,
    signLinkNoticeSentCount: notificationResult.sentCount,
    signLinkNoticeFailedCount: notificationResult.failedCount,
    signLinkLineSent: notificationResult.lineSent,
    signLinkLineError: notificationResult.lineError,
    signLinkEmailSent: notificationResult.emailSent,
    signLinkEmailError: notificationResult.emailError,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: nowText(),
  }, { merge: true });

  return { contractId: snap.id, contractNo, signUrl, officialContractUrl, notificationResult };
});

exports.rentalSignContractHttp = httpEndpoint(async (data) => {
  const contractId = clean(data.contractId || data.id);
  const token = clean(data.token || data.signToken);
  const { ref, contract } = await getContractForToken(contractId, token);
  const incoming = Object.assign({}, contract || {}, data || {});
  const urls = rentalAssetUrls(incoming);
  if (!urls.signatureUrl) throw new Error('缺少簽名圖片網址。請先將簽名上傳到 Firebase Storage。');
  if (!urls.idImageUrl) throw new Error('缺少身分證圖片網址。請先將身分證圖片上傳到 Firebase Storage。');
  const update = stripUndefined(stripRentalInlineAssets({
    customerIdNumber: clean(data.customerIdNumber || contract.customerIdNumber),
    customerIdImageUrl: urls.idImageUrl,
    idImageUrl: urls.idImageUrl,
    customerSignatureUrl: urls.signatureUrl,
    signatureUrl: urls.signatureUrl,
    notificationPreference: clean(data.notificationPreference || contract.notificationPreference || contract.preferredContactMethod),
    emailVerified: contract.emailVerified === true,
    customerSubmittedFormalAt: clean(data.customerSubmittedFormalAt || nowText()),
    customerSignedAt: clean(data.customerSignedAt || nowText()),
    formalReceivedNoticeText: clean(data.formalReceivedNoticeText || contract.formalReceivedNoticeText),
    customerFormalAssetsStoredInStorage: true,
    customerFormalAssetsStoredAt: clean(data.customerFormalAssetsStoredAt || nowText()),
    status: '待付款確認',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtText: nowText(),
  }, { deleteInline: true }));
  await ref.set(update, { merge: true });
  try {
    const customerName = clean(contract.customerName || contract.partyAName || contract.name || '客人');
    const adminUrl = `${webBaseUrl()}rental-admin.html?contractId=${encodeURIComponent(contract.contractId || contract.__id || contractId)}&filter=payment`;
    const body = [
      `租賃資料已補完，待確認付款。`,
      `姓名：${customerName}`,
      `電話：${clean(contract.customerPhone || contract.phone || '') || '未填'}`,
      `設備：${clean(contract.equipmentName || contract.rentalItem || contract.equipmentCategory || contract.rentalType || '') || '未填'}`,
      `契約編號：${clean(contract.contractNo || contract.contractId || contractId)}`,
      `狀態：待付款確認`,
      ``,
      `客人已完成身分資料、證件照片與簽名。請確認是否已收到款項，確認後再成立正式契約。`,
      ``,
      `管理連結：`,
      adminUrl,
    ].join('\n');
    await queueManagerNotification({
      title: '租賃資料已補完，待確認付款',
      body,
      source: 'rental-formal-signed',
      contractId,
      applicationId: clean(contract.applicationId),
    });
  } catch (notifyErr) {
    console.warn('queue manager notification for rentalSignContractHttp failed:', notifyErr);
  }
  return { contractId, status: '待付款確認' };
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

  const body = [`您的租賃設備已完成退租收回。`, `契約編號：${clean(contract.contractNo || contract.contractId || snap.id)}`, `完成時間：${nowText()}`, '', '感謝您使用柚子樂器設備租賃服務。'].join('\n');
  const notifyResult = await createCustomerNotificationQueues({
    row: Object.assign({}, contract, { contractId }),
    title: '租賃退租完成通知',
    body,
    source: 'rental-complete-return',
    contractId,
  });
  return { contractId, status: '已退租', queueId: notifyResult.queueIds[0] || '', notificationResult: notifyResult };
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

        if (await handleExternalTeacherLineEvent(event)) {
          continue;
        }

        const rentalCommand = parseRentalApplicationCommand(text);
        const employeeCodeMatch = text.match(/^柚子人員綁定\s+([A-Z0-9-]+)$/i);
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

        if (employeeCodeMatch) {
          await handleEmployeeCodeBinding({
            bindCode: employeeCodeMatch[1],
            lineUserId,
            replyToken
          });
          continue;
        }

        if (oldMatch) {
          await replyLineMessage(replyToken, '舊版綁定指令已停用。人員請輸入：柚子人員綁定 EMP-編號；主管請輸入：柚子主管綁定 your@email.com');
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
          await replyLineMessage(replyToken, '綁定格式錯誤。人員請輸入：柚子人員綁定 EMP-編號；主管請輸入：柚子主管綁定 your@email.com');
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
