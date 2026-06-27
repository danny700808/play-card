/**
 * 外聘老師 Firebase 新流程
 *
 * 放置位置：functions/externalTeacherOnboarding.js
 *
 * 功能：
 * - 外聘老師 LINE 綁定碼
 * - 註冊後直接補資料、上傳身分證明、簽委任契約
 * - 銀行資料可略過，每 3 天提醒補填
 * - 契約條文分條管理
 * - 已簽合約保存快照
 *
 * 這支檔案不使用 Apps Script / .gs。
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');

const REGION = process.env.FUNCTIONS_REGION || 'us-central1';
const DEFAULT_WEB_BASE_URL = 'https://danny700808.github.io/play-card/';
const BOOTSTRAP_ADMIN_EMAILS = new Set(['danny700808@gmail.com']);

function firestore() {
  return admin.firestore();
}

function storageBucket() {
  return admin.storage().bucket();
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function nowTs() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function currentYearEndKey() {
  return `${new Date().getFullYear()}-12-31`;
}

function makeBindCode() {
  return `EXT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function makeToken() {
  return crypto.randomBytes(18).toString('hex');
}

function safeFileName(name) {
  return clean(name || 'file').replace(/[\\/:*?"<>|#%{}]/g, '_').slice(0, 120) || 'file';
}

function webBaseUrl() {
  return clean(process.env.PUBLIC_WEB_BASE_URL || process.env.APP_BASE_URL || DEFAULT_WEB_BASE_URL).replace(/\/?$/, '/');
}

function onboardingUrl(teacherId, token) {
  return `${webBaseUrl()}external-teacher-onboarding.html?teacherId=${encodeURIComponent(teacherId || '')}&token=${encodeURIComponent(token || '')}`;
}

function payrollUrl(teacherId, token) {
  return `${webBaseUrl()}external-teacher-payroll.html?teacherId=${encodeURIComponent(teacherId || '')}&token=${encodeURIComponent(token || '')}`;
}

function isAdminToken(request) {
  const token = request && request.auth && request.auth.token;
  if (!token) return false;
  const role = lower(token.role || token.userRole || token.permissionRole || '');
  return token.admin === true || token.owner === true || ['admin', 'owner', 'manager'].includes(role);
}

function isManagerData(data, docId) {
  data = data || {};
  const role = lower(data.role || data.userRole || data.permissionRole || '');
  const identityType = lower(data.identityType || data.type || data.employmentType || '');
  const level = lower(data.level || '');
  const email = lower(data.email || data.Email || data.mail || data.loginEmail || '');
  return (
    BOOTSTRAP_ADMIN_EMAILS.has(email) ||
    docId === 'PRIMARY_MANAGER_LINE' ||
    ['admin', 'manager', '主管', '管理者'].includes(role) ||
    ['admin', 'manager', '主管', '管理者'].includes(identityType) ||
    ['admin', 'manager'].includes(level) ||
    data.showSettingsZone === true ||
    data.canViewSettings === true ||
    data.isAdmin === true ||
    data.isManager === true
  );
}

async function isAdminRequest(request, data = {}) {
  if (isAdminToken(request)) return true;
  const userId = clean(data.userId || data.adminId || data.employeeId || (request.auth && request.auth.uid));
  if (!userId) return false;
  const snap = await firestore().collection('employees').doc(userId).get();
  return snap.exists && isManagerData(snap.data() || {}, snap.id);
}

async function getSystemSettingValue(keys) {
  const wanted = new Set((keys || []).map(clean).filter(Boolean));
  if (!wanted.size) return '';
  try {
    const snap = await firestore().collection('systemSettings').limit(300).get();
    let found = '';
    snap.forEach((doc) => {
      if (found) return;
      const data = doc.data() || {};
      const key = clean(data.key || data.name || doc.id);
      if (wanted.has(key)) found = clean(data.value || data.token || data.accessToken || data.secret || data.text);
    });
    return found;
  } catch (err) {
    logger.warn('getSystemSettingValue failed', err);
    return '';
  }
}

async function getLineAccessToken() {
  const env = clean(
    process.env.LINE_CHANNEL_ACCESS_TOKEN ||
    process.env.LINE_MESSAGING_ACCESS_TOKEN ||
    process.env.LINE_ACCESS_TOKEN ||
    process.env.LINE_BOT_CHANNEL_ACCESS_TOKEN ||
    ''
  );
  if (env) return env;
  return await getSystemSettingValue([
    'LINE_CHANNEL_ACCESS_TOKEN',
    'LINE Channel Access Token',
    'LINE Messaging API Token',
    'LINE Access Token',
    'LINE Bot Access Token',
    'LINE_TOKEN'
  ]);
}

function lineUserIdFromRow(data = {}) {
  return clean(data.lineUserId || data['LINE User ID'] || data.targetLineUserId || data.lineId || '');
}

async function getPrimaryManagerLineRecipient() {
  const db = firestore();
  const primary = await db.collection('employees').doc('PRIMARY_MANAGER_LINE').get();
  if (primary.exists) {
    const data = primary.data() || {};
    const lineUserId = lineUserIdFromRow(data);
    if (lineUserId) return { lineUserId, name: clean(data.name || data.displayName || '柚子樂器主要管理者') };
  }

  const snap = await db.collection('employees').limit(300).get();
  const candidates = [];
  snap.forEach((doc) => {
    if (doc.id === 'PRIMARY_MANAGER_LINE') return;
    const data = doc.data() || {};
    const lineUserId = lineUserIdFromRow(data);
    if (!lineUserId || !isManagerData(data, doc.id)) return;
    const email = lower(data.email || data.Email || data.mail || data.loginEmail || '');
    candidates.push({
      lineUserId,
      name: clean(data.name || data.displayName || email || doc.id),
      priority: BOOTSTRAP_ADMIN_EMAILS.has(email) ? 0 : (data.lineNotifyEnabled === false ? 2 : 1)
    });
  });
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates[0] || null;
}

async function replyLineMessage(replyToken, text) {
  if (!replyToken) return;
  const token = await getLineAccessToken();
  if (!token) {
    logger.warn('LINE token not configured, reply skipped');
    return;
  }
  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: String(text || '').slice(0, 4900) }] })
  });
  if (!response.ok) logger.warn('LINE reply failed', { status: response.status, body: await response.text().catch(() => '') });
}

async function pushLineMessage(lineUserId, text) {
  const to = clean(lineUserId);
  if (!to) return;
  const token = await getLineAccessToken();
  if (!token) {
    logger.warn('LINE token not configured, push skipped');
    return;
  }
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, messages: [{ type: 'text', text: String(text || '').slice(0, 4900) }] })
  });
  if (!response.ok) logger.warn('LINE push failed', { status: response.status, body: await response.text().catch(() => '') });
}

async function pushAdminMessage(text) {
  const configured = clean(process.env.ADMIN_LINE_USER_ID || process.env.LINE_ADMIN_USER_ID || '');
  let target = configured;
  if (!target) {
    const manager = await getPrimaryManagerLineRecipient().catch(() => null);
    target = manager && manager.lineUserId ? manager.lineUserId : '';
  }
  if (target) await pushLineMessage(target, text);

  await firestore().collection('notificationQueue').add({
    eventCode: 'external_teacher_admin_notice',
    targetRole: 'admin',
    channel: 'line',
    title: '外聘老師通知',
    body: text,
    message: text,
    status: '待發送',
    createdAt: nowTs(),
    source: 'external-teacher-onboarding'
  }).catch((err) => logger.warn('queue admin notice failed', err));
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
  } catch (err) {
    logger.warn('getLineProfile failed', err);
    return {};
  }
}

async function validateTeacherTokenIfNeeded(request, teacherId, token) {
  if (!teacherId) throw new HttpsError('invalid-argument', '缺少 teacherId');
  if (isAdminToken(request)) return;
  if (request.auth && request.auth.uid === teacherId) return;

  const snap = await firestore().collection('employees').doc(teacherId).get();
  if (!snap.exists) throw new HttpsError('not-found', '找不到外聘老師資料');

  const ext = (snap.data() || {}).externalTeacher || {};
  if (!clean(token) || clean(token) !== clean(ext.onboardingToken)) {
    throw new HttpsError('permission-denied', '外聘老師連結已失效，請重新產生簽約連結。');
  }
}

async function saveDataUrlToStorage({ dataUrl, storagePath, fileName, contentType }) {
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new HttpsError('invalid-argument', '檔案格式錯誤');

  const mimeType = contentType || match[1] || 'application/octet-stream';
  const buffer = Buffer.from(match[2], 'base64');
  const downloadToken = crypto.randomUUID();
  const file = storageBucket().file(storagePath);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: mimeType,
      cacheControl: 'private, max-age=0',
      metadata: { firebaseStorageDownloadTokens: downloadToken }
    }
  });

  const encodedPath = encodeURIComponent(storagePath);
  return {
    fileName,
    storagePath,
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${storageBucket().name}/o/${encodedPath}?alt=media&token=${downloadToken}`,
    mimeType
  };
}

async function recordExternalTeacherFile(row) {
  const ref = firestore().collection('externalTeacherFiles').doc();
  await ref.set(Object.assign({}, row, { fileId: ref.id, createdAt: nowTs() }));
  return ref.id;
}

const DEFAULT_CLAUSES = [
  ['第一條', '委任職務', '甲方委任乙方擔任 {{teachingItems}} 課程之外聘才藝教師，乙方同意受任並依本契約約定執行相關教學事務。'],
  ['第二條', '委任期間', '本契約委任期間自 {{contractStartDate}} 起至 {{contractEndDate}} 止。委任期間屆滿後，除雙方另以書面、電子文件或系統紀錄續約外，本契約當然終止。'],
  ['第三條', '委任工作內容', '乙方受甲方委任執行下列教學及相關事項：一、依甲方安排或雙方約定之課程時間、地點及學生名單進行教學。二、依課程性質準備教材、教案、樂譜、講義或其他教學所需資料。三、維持教學品質，依學生程度與學習狀況進行適當教學。四、配合甲方進行學生學習狀況回報、課程進度說明及必要之課程溝通。五、配合甲方處理補課、調課、停課、代課及其他課程異動事項。六、配合甲方維護教室秩序、教學設備及學生安全。七、不得未經甲方同意，私自向甲方學生或家長收取課程費用、另行約課或轉介至甲方以外之場所授課。八、其他經甲乙雙方同意之教學相關事項。'],
  ['第四條', '保密義務', '乙方因執行本契約所知悉或持有甲方之學生資料、家長資料、課表資料、收費資料、營業資料、行政文件、教學資料、管理資料、電腦系統資料、帳號密碼、商業資訊及其他非公開資訊，均負保密義務。乙方非經甲方事前書面同意，不得將前項資料洩漏、公開、散布、交付、轉傳或提供予第三人，亦不得為本契約目的以外之使用。本條保密義務不因本契約終止、解除或期間屆滿而失效。'],
  ['第五條', '教材、教具與著作權', '乙方執行教學所需之教材、教具、樂譜、講義、音檔、影像、圖片、軟體或其他資料，除雙方另有約定外，由乙方自行準備。乙方使用教材、教具或任何教學資料時，應確認其來源合法，不得侵害他人著作權、商標權、專利權、營業秘密或其他智慧財產權。'],
  ['第六條', '鐘點費與給付方式', '甲方依乙方實際授課時數給付鐘點費。乙方鐘點費為每小時新臺幣 {{hourlyRate}} 元整。甲方每月結算乙方前一結算期間之授課時數，並於每月 {{paymentDay}} 日給付乙方鐘點費。乙方薪資或匯款資料得於簽約時填寫；若簽約時未填寫，乙方同意於後續依甲方通知補填。'],
  ['第七條', '保險、稅務及相關義務', '乙方確認其因受任執行本契約所涉個人保險、職業工會、勞健保、所得申報、稅務及其他依法應自行辦理事項，除法令另有強制規定或雙方另有書面約定外，由乙方自行依法處理。如因法令規定或主管機關認定，甲方依法應為乙方辦理相關保險、扣繳、申報或其他事項者，甲乙雙方應依相關法令辦理。'],
  ['第八條', '甲方因經營因素終止契約', '甲方如因停業、歇業、虧損、經營規模縮小、招生不足、學生退課、課程取消、班級停開、教室搬遷、營運調整或其他不可歸責於甲方之經營因素，致無法繼續委任乙方授課者，甲方得終止本契約，並結算乙方已實際完成授課之鐘點費。'],
  ['第九條', '乙方不適任或違反義務時之終止', '乙方如有資料不實、重大違法、違反教學倫理、危害學生安全、損害甲方商譽、洩露甲方業務秘密、未經同意私接學生、無正當理由曠課或違反本契約其他約定且情節重大者，甲方得終止本契約。乙方因此致甲方受有損害者，應負損害賠償責任。'],
  ['第十條', '乙方提前終止契約', '乙方如欲於本契約期間屆滿前提前終止契約，應至少於終止日前三十日以書面、電子文件、系統紀錄或其他可保存方式通知甲方，並配合完成課程交接、學生溝通、補課安排、資料返還及其他未結事項。'],
  ['第十一條', '代課人員', '乙方因個人因素無法親自授課，需安排代課人員者，應事先取得甲方同意。未經甲方同意，乙方不得擅自委由第三人代課。'],
  ['第十二條', '個人資料保護', '乙方因執行本契約而接觸學生、家長、甲方人員或其他第三人之個人資料時，應遵守個人資料保護相關法令及甲方個人資料管理規範。乙方不得將個人資料作為本契約目的以外之使用。'],
  ['第十三條', '契約性質', '甲乙雙方同意，本契約係雙方基於才藝教學事務所成立之委任契約。乙方應依本契約約定及委任本旨處理受任事務，並善盡善良管理人之注意義務。本契約未約定事項，依中華民國民法及相關法令辦理。'],
  ['第十四條', '契約變更', '本契約之變更、補充、修訂或解除，應經甲乙雙方同意後，以書面、電子文件、系統紀錄或其他可供保存及查證之方式為之。'],
  ['第十五條', '準據法與管轄法院', '本契約之成立、效力、解釋、履行及爭議處理，均以中華民國法律為準據法。甲乙雙方因本契約發生爭議而涉訟者，雙方同意以甲方所在地之地方法院為第一審管轄法院。']
];

async function ensureActiveTemplate() {
  const templates = firestore().collection('externalTeacherContractTemplates');
  const active = await templates.where('status', '==', 'active').limit(1).get();
  if (!active.empty) return { id: active.docs[0].id, ...active.docs[0].data() };

  const templateRef = templates.doc('external_teacher_mandate_2026_01');
  await templateRef.set({
    title: '外聘才藝教師委任契約書',
    contractType: 'externalTeacherMandate',
    version: '2026-01',
    status: 'active',
    createdAt: nowTs(),
    updatedAt: nowTs()
  }, { merge: true });

  const batch = firestore().batch();
  DEFAULT_CLAUSES.forEach((row, index) => {
    batch.set(templateRef.collection('clauses').doc(`clause_${String(index + 1).padStart(2, '0')}`), {
      articleNo: row[0],
      title: row[1],
      content: row[2],
      sortOrder: index + 1,
      enabled: true,
      createdAt: nowTs(),
      updatedAt: nowTs()
    }, { merge: true });
  });
  await batch.commit();

  return { id: templateRef.id, title: '外聘才藝教師委任契約書', contractType: 'externalTeacherMandate', version: '2026-01', status: 'active' };
}

async function getActiveTemplateWithClauses() {
  const template = await ensureActiveTemplate();
  const snap = await firestore().collection('externalTeacherContractTemplates').doc(template.id).collection('clauses').get();
  const clauses = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((c) => c.enabled !== false)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  return { template, clauses };
}

function replaceVars(text, values) {
  let out = String(text || '');
  Object.keys(values).forEach((key) => {
    out = out.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), values[key] == null ? '' : String(values[key]));
  });
  return out;
}

function renderContractText({ teacher, template, clauses, contractStartDate, contractEndDate }) {
  const ext = teacher.externalTeacher || {};
  const values = {
    companyName: process.env.COMPANY_NAME || '柚子樂器',
    companyTaxId: process.env.COMPANY_TAX_ID || '',
    companyRepresentative: process.env.COMPANY_REPRESENTATIVE || '',
    companyAddress: process.env.COMPANY_ADDRESS || '',
    teacherName: clean(teacher.name || teacher.displayName || ext.name || ''),
    teacherIdNumber: clean(ext.idNumber || ''),
    teacherBirthDate: clean(ext.birthDate || ''),
    teacherHouseholdAddress: clean(ext.householdAddress || ''),
    teacherMailingAddress: clean(ext.mailingAddress || ''),
    teacherMobile: clean(teacher.mobile || teacher.phone || ext.mobile || ''),
    teacherEmail: clean(teacher.email || ext.email || ''),
    teachingItems: Array.isArray(ext.teachingItems) ? ext.teachingItems.join('、') : clean(ext.teachingItems || ''),
    hourlyRate: ext.hourlyRate || '',
    paymentDay: ext.paymentDay || '',
    contractStartDate,
    contractEndDate
  };

  let text = `${template.title || '外聘才藝教師委任契約書'}\n\n`;
  text += `甲方：${values.companyName}\n`;
  text += `代表人：${values.companyRepresentative}\n`;
  text += `地址：${values.companyAddress}\n\n`;
  text += `乙方：${values.teacherName}\n`;
  text += `身分證字號：${values.teacherIdNumber}\n`;
  text += `通訊地址：${values.teacherMailingAddress}\n`;
  text += `電話：${values.teacherMobile}\n\n`;

  clauses.forEach((clause) => {
    text += `${clause.articleNo || ''}　${clause.title || ''}\n`;
    text += `${replaceVars(clause.content, values)}\n\n`;
  });

  text += `立契約書人：\n\n甲方：${values.companyName}\n代表人：${values.companyRepresentative}\n\n乙方：${values.teacherName}\n簽署日期：${todayKey()}\n`;
  return text;
}

function contractHtml(contractText, signatureUrl) {
  const escaped = String(contractText || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const signature = signatureUrl ? `\n\n乙方簽名：\n<img src="${signatureUrl}" style="max-width:320px;border:1px solid #ccc;padding:8px;background:#fff">` : '';
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>外聘才藝教師委任契約書</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Noto Sans TC','Microsoft JhengHei',sans-serif;line-height:1.85;padding:32px;white-space:pre-wrap;color:#111">${escaped}${signature}</body></html>`;
}

async function saveContractHtml({ teacherId, contractId, contractText, signatureUrl }) {
  const token = crypto.randomUUID();
  const storagePath = `externalTeachers/${teacherId}/contracts/${contractId}.html`;
  const file = storageBucket().file(storagePath);
  await file.save(contractHtml(contractText, signatureUrl), {
    resumable: false,
    metadata: {
      contentType: 'text/html; charset=utf-8',
      cacheControl: 'private, max-age=0',
      metadata: { firebaseStorageDownloadTokens: token }
    }
  });
  return {
    fileName: `${contractId}.html`,
    storagePath,
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${storageBucket().name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`,
    mimeType: 'text/html'
  };
}

function normalizeTeachingItems(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return String(value || '').split(/[、,，]/).map(clean).filter(Boolean);
}

async function handleExternalTeacherLineEvent(event) {
  const text = event && event.message && event.message.type === 'text' ? clean(event.message.text) : '';
  const match = text.match(/^外聘老師綁定\s+([A-Z0-9-]+)$/i);
  if (!match) return false;

  const bindCode = match[1].toUpperCase();
  const replyToken = event.replyToken;
  const lineUserId = event.source && event.source.userId;
  if (!lineUserId) {
    await replyLineMessage(replyToken, 'LINE 綁定失敗：系統無法取得您的 LINE 使用者 ID。');
    return true;
  }

  const bindingRef = firestore().collection('externalTeacherLineBindings').doc(bindCode);
  const bindingSnap = await bindingRef.get();
  if (!bindingSnap.exists) {
    await replyLineMessage(replyToken, '查不到這組外聘老師綁定碼。\n\n請確認您貼上的文字是否完整，例如：\n外聘老師綁定 EXT-123456\n\n如果仍無法綁定，請直接聯絡柚子樂器官方 LINE。');
    return true;
  }

  const binding = bindingSnap.data() || {};
  const teacherId = clean(binding.teacherId || '');
  const token = clean(binding.onboardingToken || '');
  if (!teacherId) {
    await replyLineMessage(replyToken, '這組外聘老師綁定碼資料不完整，請重新產生綁定碼。');
    return true;
  }

  if (binding.expiresAt && binding.expiresAt.toMillis && binding.expiresAt.toMillis() < Date.now()) {
    await bindingRef.set({ status: 'expired', updatedAt: nowTs() }, { merge: true });
    await replyLineMessage(replyToken, '這組外聘老師綁定碼已逾期。\n\n請重新開啟外聘老師資料填寫頁，產生新的綁定碼後再貼到官方 LINE。');
    return true;
  }

  const profile = await getLineProfile(lineUserId);
  const lineDisplayName = clean(profile.displayName || '');
  const teacherRef = firestore().collection('employees').doc(teacherId);
  const teacherSnap = await teacherRef.get();
  if (!teacherSnap.exists) {
    await replyLineMessage(replyToken, '系統找不到此外聘老師資料，請重新開啟填寫連結或聯絡柚子樂器官方 LINE。');
    return true;
  }

  const teacher = teacherSnap.data() || {};
  const ext = teacher.externalTeacher || {};
  const teacherName = clean(teacher.name || teacher.displayName || ext.name || binding.teacherName || '老師');

  await firestore().runTransaction(async (tx) => {
    tx.set(bindingRef, { status: 'bound', lineUserId, lineDisplayName, boundAt: nowTs(), updatedAt: nowTs() }, { merge: true });
    tx.set(teacherRef, {
      role: teacher.role || 'externalTeacher',
      identityType: teacher.identityType || 'external',
      employmentType: teacher.employmentType || 'external',
      lineUserId,
      lineNotifyEnabled: true,
      externalTeacher: Object.assign({}, ext, {
        lineBindStatus: 'bound',
        lineUserId,
        lineDisplayName,
        lineBoundAt: nowTs(),
        bindCode,
        onboardingToken: token || ext.onboardingToken || '',
        profileStatus: 'pendingProfile',
        status: 'pendingProfile',
        updatedAt: nowTs()
      }),
      updatedAt: nowTs()
    }, { merge: true });
  });

  await replyLineMessage(replyToken, `外聘老師 LINE 綁定完成 ✅\n\n您好 ${teacherName}，系統已完成您的 LINE 綁定。\n\n請回到剛剛的外聘老師資料填寫頁，繼續完成基本資料、身分證明文件與契約簽署。\n\n如果頁面沒有自動更新，請重新整理頁面或點選下方連結：\n${onboardingUrl(teacherId, token || ext.onboardingToken)}`);

  await pushAdminMessage(`外聘老師 LINE 綁定完成\n\n姓名：${teacherName}\n電話：${clean(teacher.mobile || teacher.phone || ext.mobile || '')}\n狀態：待填資料`);
  return true;
}

function registerExternalTeacherOnboarding(exportsObj) {
  exportsObj.externalTeacherCreateBindCode = onCall({ region: REGION }, async (request) => {
    const data = request.data || {};
    const name = clean(data.name || '');
    const mobile = clean(data.mobile || data.phone || '');
    const email = clean(data.email || '');
    if (!name) throw new HttpsError('invalid-argument', '請輸入姓名');
    if (!mobile) throw new HttpsError('invalid-argument', '請輸入手機');

    const teacherId = clean(data.teacherId || data.userId || (request.auth && request.auth.uid) || firestore().collection('employees').doc().id);
    const token = makeToken();
    const bindCode = makeBindCode();

    await firestore().collection('employees').doc(teacherId).set({
      employeeId: teacherId,
      id: teacherId,
      name,
      displayName: name,
      mobile,
      phone: mobile,
      email,
      role: 'externalTeacher',
      identityType: 'external',
      employmentType: 'external',
      externalTeacher: {
        name,
        mobile,
        email,
        onboardingToken: token,
        bindCode,
        lineBindStatus: 'pending',
        profileStatus: 'pendingLine',
        status: 'pendingLine',
        payrollInfoStatus: 'pending',
        paymentMethod: 'pending',
        contractStatus: 'unsigned',
        updatedAt: nowTs()
      },
      updatedAt: nowTs(),
      createdAt: nowTs()
    }, { merge: true });

    await firestore().collection('externalTeacherLineBindings').doc(bindCode).set({
      bindCode,
      teacherId,
      teacherName: name,
      mobile,
      email,
      onboardingToken: token,
      status: 'pending',
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: nowTs(),
      updatedAt: nowTs()
    }, { merge: true });

    return { ok: true, teacherId, token, bindCode, bindText: `外聘老師綁定 ${bindCode}`, onboardingUrl: onboardingUrl(teacherId, token) };
  });

  exportsObj.externalTeacherGetOnboarding = onCall({ region: REGION }, async (request) => {
    const data = request.data || {};
    const teacherId = clean(data.teacherId || data.userId || (request.auth && request.auth.uid) || '');
    const token = clean(data.token || '');
    await validateTeacherTokenIfNeeded(request, teacherId, token);

    const snap = await firestore().collection('employees').doc(teacherId).get();
    if (!snap.exists) throw new HttpsError('not-found', '找不到外聘老師資料');
    const teacher = { id: snap.id, ...snap.data() };
    const ext = teacher.externalTeacher || {};
    const contractStartDate = clean(ext.contractStartDate || todayKey());
    const contractEndDate = clean(ext.contractEndDate || currentYearEndKey());
    const { template, clauses } = await getActiveTemplateWithClauses();
    const contractText = renderContractText({ teacher, template, clauses, contractStartDate, contractEndDate });

    return { ok: true, teacher, template, clauses, contractStartDate, contractEndDate, contractText, payrollUrl: payrollUrl(teacherId, token || ext.onboardingToken) };
  });

  exportsObj.externalTeacherSaveProfile = onCall({ region: REGION, timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
    const data = request.data || {};
    const teacherId = clean(data.teacherId || data.userId || (request.auth && request.auth.uid) || '');
    const token = clean(data.token || '');
    await validateTeacherTokenIfNeeded(request, teacherId, token);

    const identityFiles = [];
    const incomingFiles = Array.isArray(data.identityFilesData) ? data.identityFilesData : [];
    for (let i = 0; i < incomingFiles.length; i++) {
      const f = incomingFiles[i] || {};
      if (!f.dataUrl) continue;
      const fileName = safeFileName(f.fileName || `identity_${i + 1}.jpg`);
      const saved = await saveDataUrlToStorage({
        dataUrl: f.dataUrl,
        fileName,
        storagePath: `externalTeachers/${teacherId}/identity/${Date.now()}_${i}_${fileName}`,
        contentType: f.mimeType || ''
      });
      identityFiles.push(saved);
      await recordExternalTeacherFile({ teacherId, contractId: '', fileType: 'identityPhoto', ...saved });
    }

    const skipPayroll = data.skipPayroll === true;
    const hasBank = !!(data.bankName && data.bankAccountName && data.bankAccountNumber);
    const payrollInfoStatus = skipPayroll ? 'pending' : (hasBank ? 'completed' : 'pending');
    const paymentMethod = skipPayroll ? 'pending' : (hasBank ? 'bank' : 'pending');

    const externalTeacherUpdate = {
      name: clean(data.name || ''),
      mobile: clean(data.mobile || data.phone || ''),
      email: clean(data.email || ''),
      idNumber: clean(data.idNumber || ''),
      birthDate: clean(data.birthDate || ''),
      householdAddress: clean(data.householdAddress || ''),
      mailingAddress: clean(data.mailingAddress || ''),
      teachingItems: normalizeTeachingItems(data.teachingItems),
      hourlyRate: Number(data.hourlyRate || 0),
      paymentDay: Number(data.paymentDay || 0),
      identityPhotoStatus: identityFiles.length ? 'uploaded' : (data.keepExistingIdentityFiles ? 'uploaded' : 'pending'),
      payrollInfoStatus,
      paymentMethod,
      bankName: clean(data.bankName || ''),
      bankBranch: clean(data.bankBranch || ''),
      bankAccountName: clean(data.bankAccountName || ''),
      bankAccountNumber: clean(data.bankAccountNumber || ''),
      profileStatus: 'pendingContract',
      status: 'pendingContract',
      updatedAt: nowTs()
    };
    if (identityFiles.length) {
      externalTeacherUpdate.identityFiles = admin.firestore.FieldValue.arrayUnion(...identityFiles);
    }

    const employeeUpdate = {
      name: clean(data.name || ''),
      displayName: clean(data.name || ''),
      mobile: clean(data.mobile || data.phone || ''),
      phone: clean(data.mobile || data.phone || ''),
      email: clean(data.email || ''),
      role: 'externalTeacher',
      identityType: 'external',
      employmentType: 'external',
      updatedAt: nowTs(),
      externalTeacher: externalTeacherUpdate
    };

    await firestore().collection('employees').doc(teacherId).set(employeeUpdate, { merge: true });
    return { ok: true, payrollInfoStatus, paymentMethod, identityFiles };
  });

  exportsObj.externalTeacherCompleteContract = onCall({ region: REGION, timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
    const data = request.data || {};
    const teacherId = clean(data.teacherId || data.userId || (request.auth && request.auth.uid) || '');
    const token = clean(data.token || '');
    await validateTeacherTokenIfNeeded(request, teacherId, token);

    if (data.agreeTerms !== true) throw new HttpsError('failed-precondition', '請先勾選同意契約內容');
    if (!data.signatureDataUrl) throw new HttpsError('invalid-argument', '請先完成簽名');

    const teacherRef = firestore().collection('employees').doc(teacherId);
    const teacherSnap = await teacherRef.get();
    if (!teacherSnap.exists) throw new HttpsError('not-found', '找不到外聘老師資料');

    const teacher = { id: teacherSnap.id, ...teacherSnap.data() };
    const ext = teacher.externalTeacher || {};
    const contractId = makeId('EXTC');
    const contractStartDate = clean(ext.contractStartDate || todayKey());
    const contractEndDate = clean(ext.contractEndDate || currentYearEndKey());
    const { template, clauses } = await getActiveTemplateWithClauses();
    const contractText = renderContractText({ teacher, template, clauses, contractStartDate, contractEndDate });

    const signatureFile = await saveDataUrlToStorage({
      dataUrl: data.signatureDataUrl,
      fileName: `${contractId}_signature.png`,
      storagePath: `externalTeachers/${teacherId}/signatures/${contractId}_signature.png`,
      contentType: 'image/png'
    });
    await recordExternalTeacherFile({ teacherId, contractId, fileType: 'signature', ...signatureFile });

    const contractHtmlFile = await saveContractHtml({ teacherId, contractId, contractText, signatureUrl: signatureFile.downloadUrl });
    await recordExternalTeacherFile({ teacherId, contractId, fileType: 'signedContractHtml', ...contractHtmlFile });

    const contractDoc = {
      contractId,
      teacherId,
      teacherName: clean(teacher.name || ext.name || ''),
      employeeRef: `employees/${teacherId}`,
      templateId: template.id,
      templateVersion: template.version || '',
      contractTitle: template.title || '外聘才藝教師委任契約書',
      contractStartDate,
      contractEndDate,
      teacherSnapshot: teacher,
      clauseSnapshots: clauses,
      fullContractTextSnapshot: contractText,
      signatureFile,
      identityFiles: Array.isArray(ext.identityFiles) ? ext.identityFiles : [],
      contractHtmlFile,
      lineUserId: clean(ext.lineUserId || teacher.lineUserId || ''),
      status: 'active',
      signedAt: nowTs(),
      createdAt: nowTs(),
      updatedAt: nowTs()
    };

    await firestore().collection('externalTeacherContracts').doc(contractId).set(contractDoc);
    await teacherRef.set({
      externalTeacher: {
        contractStatus: 'signed',
        currentContractId: contractId,
        contractStartDate,
        contractEndDate,
        signedAt: nowTs(),
        profileStatus: 'active',
        status: 'active',
        updatedAt: nowTs()
      },
      updatedAt: nowTs()
    }, { merge: true });

    const lineUserId = clean(ext.lineUserId || teacher.lineUserId || '');
    if (lineUserId) {
      await pushLineMessage(lineUserId, `外聘老師資料與契約簽署已完成 ✅\n\n柚子樂器已收到您的資料與簽名。\n\n契約期間：${contractStartDate} 至 ${contractEndDate}\n\n後續通知將透過此官方 LINE 傳送。`);
      if (clean(ext.payrollInfoStatus || 'pending') === 'pending') {
        await pushLineMessage(lineUserId, `提醒您：您的薪資／匯款資料目前尚未補填。\n\n這不影響本次契約簽署完成，但為方便後續鐘點費結算，請之後點選連結補填銀行帳戶資料。\n\n${payrollUrl(teacherId, token || ext.onboardingToken)}`);
      }
    }

    await pushAdminMessage(`外聘老師簽約完成\n\n姓名：${clean(teacher.name || ext.name || '')}\n電話：${clean(teacher.mobile || teacher.phone || ext.mobile || '')}\n授課項目：${Array.isArray(ext.teachingItems) ? ext.teachingItems.join('、') : clean(ext.teachingItems || '')}\n契約期間：${contractStartDate} 至 ${contractEndDate}\n薪資資料：${clean(ext.payrollInfoStatus || 'pending')}\n\n請至管理端查看外聘老師資料與合約紀錄。`);

    return { ok: true, contractId, contractStartDate, contractEndDate, contractHtmlFile };
  });

  exportsObj.externalTeacherSavePayroll = onCall({ region: REGION }, async (request) => {
    const data = request.data || {};
    const teacherId = clean(data.teacherId || data.userId || (request.auth && request.auth.uid) || '');
    const token = clean(data.token || '');
    await validateTeacherTokenIfNeeded(request, teacherId, token);

    if (!data.bankName || !data.bankAccountName || !data.bankAccountNumber) {
      throw new HttpsError('invalid-argument', '請至少填寫銀行名稱、戶名與帳號');
    }

    const teacherRef = firestore().collection('employees').doc(teacherId);
    const teacherSnap = await teacherRef.get();
    const teacher = teacherSnap.exists ? teacherSnap.data() || {} : {};
    const ext = teacher.externalTeacher || {};

    await teacherRef.set({
      externalTeacher: {
        payrollInfoStatus: 'completed',
        paymentMethod: 'bank',
        bankName: clean(data.bankName || ''),
        bankBranch: clean(data.bankBranch || ''),
        bankAccountName: clean(data.bankAccountName || ''),
        bankAccountNumber: clean(data.bankAccountNumber || ''),
        payrollReminderPaused: true,
        updatedAt: nowTs()
      },
      updatedAt: nowTs()
    }, { merge: true });

    const lineUserId = clean(ext.lineUserId || teacher.lineUserId || '');
    if (lineUserId) await pushLineMessage(lineUserId, '薪資／匯款資料已補填完成 ✅\n\n柚子樂器已收到您的銀行帳戶資料，後續鐘點費結算將依系統紀錄辦理。');
    return { ok: true };
  });

  exportsObj.externalTeacherListContractTemplate = onCall({ region: REGION }, async (request) => {
    if (!(await isAdminRequest(request, request.data || {}))) throw new HttpsError('permission-denied', '只有管理者可以修改契約條文');
    const { template, clauses } = await getActiveTemplateWithClauses();
    return { ok: true, template, clauses };
  });

  exportsObj.externalTeacherSaveContractTemplate = onCall({ region: REGION }, async (request) => {
    const data = request.data || {};
    if (!(await isAdminRequest(request, data))) throw new HttpsError('permission-denied', '只有管理者可以修改契約條文');

    const templateId = clean(data.templateId || 'external_teacher_mandate_2026_01');
    const templateRef = firestore().collection('externalTeacherContractTemplates').doc(templateId);
    await templateRef.set({
      title: clean(data.title || '外聘才藝教師委任契約書'),
      contractType: 'externalTeacherMandate',
      version: clean(data.version || '2026-01'),
      status: 'active',
      updatedAt: nowTs(),
      createdAt: nowTs()
    }, { merge: true });

    const existing = await templateRef.collection('clauses').get();
    const batch = firestore().batch();
    existing.docs.forEach((doc) => batch.delete(doc.ref));
    const clauses = Array.isArray(data.clauses) ? data.clauses : [];
    clauses.forEach((c, index) => {
      const ref = templateRef.collection('clauses').doc(clean(c.id) || `clause_${String(index + 1).padStart(2, '0')}`);
      batch.set(ref, {
        articleNo: clean(c.articleNo || ''),
        title: clean(c.title || ''),
        content: clean(c.content || ''),
        sortOrder: Number(c.sortOrder || index + 1),
        enabled: c.enabled !== false,
        createdAt: nowTs(),
        updatedAt: nowTs()
      });
    });
    await batch.commit();
    return { ok: true };
  });

  exportsObj.externalTeacherPayrollReminderEveryDay = onSchedule({
    region: REGION,
    schedule: '0 10 * * *',
    timeZone: 'Asia/Taipei',
    timeoutSeconds: 180,
    memory: '512MiB'
  }, async () => {
    const snap = await firestore().collection('employees')
      .where('externalTeacher.status', '==', 'active')
      .where('externalTeacher.payrollInfoStatus', '==', 'pending')
      .get();

    const now = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    let sent = 0;

    for (const doc of snap.docs) {
      const teacher = doc.data() || {};
      const ext = teacher.externalTeacher || {};
      if (ext.payrollReminderPaused === true) continue;
      const lineUserId = clean(ext.lineUserId || teacher.lineUserId || '');
      if (!lineUserId) continue;
      const last = ext.lastPayrollReminderAt && ext.lastPayrollReminderAt.toMillis ? ext.lastPayrollReminderAt.toMillis() : 0;
      if (last && now - last < threeDaysMs) continue;

      const msg = `柚子樂器提醒您：\n\n您的外聘教師薪資／匯款資料尚未補填。\n為了方便後續鐘點費結算，請點選下方連結補填銀行帳戶資料。\n\n若您已與柚子樂器約定現金或其他付款方式，請聯絡官方 LINE。\n\n補填連結：\n${payrollUrl(doc.id, ext.onboardingToken || '')}`;
      await pushLineMessage(lineUserId, msg);
      await doc.ref.set({
        externalTeacher: {
          lastPayrollReminderAt: nowTs(),
          payrollReminderCount: Number(ext.payrollReminderCount || 0) + 1,
          updatedAt: nowTs()
        },
        updatedAt: nowTs()
      }, { merge: true });
      await firestore().collection('notificationQueue').add({
        eventCode: 'external_teacher_payroll_reminder',
        teacherId: doc.id,
        lineUserId,
        channel: 'line',
        title: '外聘老師薪資資料待補',
        body: msg,
        message: msg,
        status: '已發送',
        sentAt: nowTs(),
        createdAt: nowTs(),
        source: 'external-teacher-payroll-reminder'
      });
      sent++;
    }
    logger.info('externalTeacherPayrollReminderEveryDay completed', { sent });
  });
}

module.exports = {
  registerExternalTeacherOnboarding,
  handleExternalTeacherLineEvent
};
