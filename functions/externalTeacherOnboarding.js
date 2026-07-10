/**
 * 外聘老師獨立簽約模組
 *
 * 原則：
 * - 不寫入租賃集合，不修改 rental* 資料。
 * - 外聘老師資料獨立存在 externalTeacherProfiles。
 * - 合約紀錄獨立存在 externalTeacherContracts。
 * - 合約模板獨立存在 externalTeacherContractTemplates。
 * - 身分證、簽名、合約 HTML 存 Firebase Storage，Firestore 只存 URL 與摘要。
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('crypto');

const REGION = process.env.FUNCTIONS_REGION || 'us-central1';
const DEFAULT_WEB_BASE_URL = 'https://danny700808.github.io/play-card/';
const BOOTSTRAP_ADMIN_EMAILS = new Set(['danny700808@gmail.com']);

function db() {
  return admin.firestore();
}

function bucket() {
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

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function todayKey() {
  return dateKey(new Date());
}

function currentGregorianYear() {
  return new Date().getFullYear();
}

function rocYear(gregorianYear) {
  return Number(gregorianYear || currentGregorianYear()) - 1911;
}

function isDec15OrLater(date = new Date()) {
  return date.getMonth() > 11 || (date.getMonth() === 11 && date.getDate() >= 15);
}

function nextYearOpenDate(gregorianYear) {
  return `${Number(gregorianYear || currentGregorianYear())}-12-15`;
}

function normalizeContractGregorianYear(value) {
  const raw = clean(value);
  if (!raw) return currentGregorianYear();
  const n = Number(raw.replace(/[^0-9]/g, ''));
  if (!Number.isFinite(n) || !n) return currentGregorianYear();
  return n < 1911 ? n + 1911 : n;
}

function contractDatesFromData(data = {}, existing = {}) {
  const targetYear = normalizeContractGregorianYear(data.contractYear || data.contractGregorianYear || data.gregorianYear || existing.contractGregorianYear || existing.contractYear);
  const explicitStart = clean(data.contractStartDate || existing.contractStartDate);
  const explicitEnd = clean(data.contractEndDate || existing.contractEndDate);
  let contractStartDate = explicitStart;
  if (!contractStartDate) {
    contractStartDate = targetYear > currentGregorianYear() ? `${targetYear}-01-01` : todayKey();
  }
  const contractEndDate = explicitEnd || `${targetYear}-12-31`;
  return {
    contractGregorianYear: targetYear,
    contractRocYear: rocYear(targetYear),
    contractYearKey: String(rocYear(targetYear)),
    contractStartDate,
    contractEndDate,
    nextRenewalOpenDate: nextYearOpenDate(targetYear),
  };
}

function availableContractYears() {
  const current = currentGregorianYear();
  const years = [{ gregorianYear: current, rocYear: rocYear(current), open: true, label: `${rocYear(current)} 年（${current}-12-31 到期）` }];
  years.push({ gregorianYear: current + 1, rocYear: rocYear(current + 1), open: isDec15OrLater(new Date()), label: `${rocYear(current + 1)} 年（下一年度，12/15 後開放）` });
  return years;
}

function makeToken() {
  return crypto.randomBytes(18).toString('hex');
}

function makeBindCode() {
  return `EXT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function safeFileName(name) {
  return clean(name || 'file').replace(/[\\/:*?"<>|#%{}]/g, '_').slice(0, 120) || 'file';
}

function normalizeBindingMethod(value, hasEmail) {
  const v = lower(value || '');
  if (['line', 'line_only', 'line-only', '只用line', '只用 line'].includes(v)) return 'line';
  if (['email', 'email_only', 'email-only', 'mail', '只用email', '只用 email', '信箱'].includes(v)) return 'email';
  if (['both', 'line_email', 'line+email', 'line + email', 'all', '兩者', '雙軌'].includes(v)) return 'both';
  return hasEmail ? 'both' : 'line';
}

function wantsLine(method) {
  return method === 'line' || method === 'both';
}

function wantsEmail(method) {
  return method === 'email' || method === 'both';
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

function contractAdminUrl() {
  return `${webBaseUrl()}external-teacher-admin.html`;
}

function externalTeacherApprovalUrl(contractId = '') {
  const qs = contractId
    ? `?from=approval&filterStatus=submitted_pending_admin&contractId=${encodeURIComponent(contractId)}`
    : '?from=approval&filterStatus=submitted_pending_admin';
  return `${webBaseUrl()}external-teacher-admin.html${qs}`;
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
  const snap = await db().collection('employees').doc(userId).get();
  return snap.exists && isManagerData(snap.data() || {}, snap.id);
}

async function getSystemSettingValue(keys) {
  const wanted = new Set((keys || []).map(clean).filter(Boolean));
  if (!wanted.size) return '';
  try {
    const snap = await db().collection('systemSettings').limit(300).get();
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


function normalizeTeachingText(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).join('、');
  return clean(value);
}

function mobileDigits(value) {
  return clean(value).replace(/\D/g, '');
}

function hashKey(value) {
  return crypto.createHash('sha1').update(clean(value).toLowerCase()).digest('hex').slice(0, 12).toUpperCase();
}

function fallbackExternalEmployeeId(name, email, mobile) {
  const seed = lower(email) || mobileDigits(mobile) || clean(name) || String(Date.now());
  return `EXTEMP_${hashKey(seed)}`;
}

function isExternalEmployeeRow(row = {}) {
  const raw = lower(row.identityType || row.employeeType || row.identityLabel || row.role || '');
  return row.isExternalTeacher === true || raw.includes('external') || raw.includes('外聘') || raw.includes('externalteacher');
}

function isManagerEmployeeRow(row = {}, id = '') {
  const role = lower(row.role || row.userRole || row.permissionRole || row.identityType || row.employeeType || '');
  const email = lower(row.email || row.Email || row.mail || row.loginEmail || '');
  return id === 'PRIMARY_MANAGER_LINE' || BOOTSTRAP_ADMIN_EMAILS.has(email) || row.isAdmin === true || row.isManager === true || row.showSettingsZone === true || ['admin', 'manager', '主管', '管理者'].some((k) => role.includes(k));
}

async function collectEmployeeCandidate(list, query) {
  try {
    const snap = await query.limit(5).get();
    snap.forEach((doc) => {
      const data = doc.data() || {};
      if (!isManagerEmployeeRow(data, doc.id)) list.push({ id: doc.id, data });
    });
  } catch (err) {
    logger.warn('collectEmployeeCandidate failed', err);
  }
}

function pickEmployeeCandidate(list) {
  if (!list.length) return null;
  const deduped = Array.from(new Map(list.map((x) => [x.id, x])).values());
  deduped.sort((a, b) => {
    const ae = isExternalEmployeeRow(a.data) ? 1 : 0;
    const be = isExternalEmployeeRow(b.data) ? 1 : 0;
    if (ae !== be) return be - ae;
    return clean(b.data.externalTeacherSyncedAt || b.data.updatedAt || '').localeCompare(clean(a.data.externalTeacherSyncedAt || a.data.updatedAt || ''));
  });
  return deduped[0];
}

async function findExternalEmployeeByContact(email, mobile) {
  const candidates = [];
  const em = lower(email || '');
  const mob = clean(mobile || '');
  const digits = mobileDigits(mob);
  if (em) {
    await collectEmployeeCandidate(candidates, db().collection('employees').where('email', '==', em));
    await collectEmployeeCandidate(candidates, db().collection('employees').where('Email', '==', em));
  }
  if (mob) {
    await collectEmployeeCandidate(candidates, db().collection('employees').where('mobilePhone', '==', mob));
    await collectEmployeeCandidate(candidates, db().collection('employees').where('phone', '==', mob));
    await collectEmployeeCandidate(candidates, db().collection('employees').where('mobile', '==', mob));
  }
  if (digits) await collectEmployeeCandidate(candidates, db().collection('employees').where('mobileDigits', '==', digits));
  return pickEmployeeCandidate(candidates);
}

async function resolveExternalEmployeeId(row = {}) {
  let id = clean(row.employeeId || row.externalTeacherEmployeeId || row.linkedEmployeeId || '');
  if (id) return id;
  const existing = await findExternalEmployeeByContact(row.email, row.mobile || row.phone);
  if (existing) return existing.id;
  return fallbackExternalEmployeeId(row.name || row.teacherName || row.displayName, row.email, row.mobile || row.phone);
}

async function syncExternalTeacherEmployee(teacherId, row = {}) {
  const contractId = clean(row.contractId || row.currentContractId || row.id || teacherId || '');
  const employeeId = await resolveExternalEmployeeId(Object.assign({}, row, { employeeId: row.employeeId || row.externalTeacherEmployeeId }));
  if (!employeeId) return '';
  const ref = db().collection('employees').doc(employeeId);
  let old = {};
  try {
    const snap = await ref.get();
    if (snap.exists) old = snap.data() || {};
  } catch (err) {
    old = {};
  }

  const name = clean(row.name || row.teacherName || row.displayName || old.name || old.displayName || '');
  const email = lower(row.email || old.email || '');
  const mobile = clean(row.mobile || row.phone || old.mobilePhone || old.phone || '');
  const lineUserId = clean(row.lineUserId || old.lineUserId || '');
  const teachingItemsText = normalizeTeachingText(row.teachingItems || old.teachingItems || old.teachingItemsText || '');

  const update = {
    employeeId,
    id: employeeId,
    userId: employeeId,
    name,
    displayName: name,
    employeeName: name,
    email,
    mobilePhone: mobile,
    phone: mobile,
    mobileDigits: mobileDigits(mobile),
    identityType: 'external',
    identityLabel: '外聘老師',
    employeeType: 'external',
    role: 'externalTeacher',
    isExternalTeacher: true,
    accountStatus: clean(old.accountStatus || 'active'),
    employmentStatus: clean(old.employmentStatus || 'active'),
    hiddenFromActiveLists: old.hiddenFromActiveLists === true,
    lineUserId,
    lineDisplayName: clean(row.lineDisplayName || old.lineDisplayName || ''),
    lineNotifyEnabled: !!lineUserId,
    lineBindStatus: clean(row.lineBindStatus || (lineUserId ? 'bound' : old.lineBindStatus || 'pending')),
    emailBindStatus: clean(row.emailBindStatus || old.emailBindStatus || ''),
    bindingMethod: clean(row.bindingMethod || old.bindingMethod || ''),
    bindingMethodLabel: clean(row.bindingMethodLabel || old.bindingMethodLabel || ''),
    externalTeacherProfileId: clean(row.externalTeacherProfileId || old.externalTeacherProfileId || contractId),
    externalTeacherContractId: contractId || clean(old.externalTeacherContractId || ''),
    currentExternalContractId: contractId || clean(old.currentExternalContractId || ''),
    externalTeacherStatus: clean(row.status || old.externalTeacherStatus || ''),
    contractStatus: clean(row.contractStatus || row.status || old.contractStatus || ''),
    progressStatus: clean(row.progressStatus || old.progressStatus || ''),
    teachingItems: teachingItemsText,
    teachingItemsText,
    cooperationStartDate: clean(row.contractStartDate || old.cooperationStartDate || ''),
    hireDate: clean(row.contractStartDate || old.hireDate || ''),
    contractYear: clean(row.contractYear || row.contractGregorianYear || old.contractYear || ''),
    contractRocYear: clean(row.contractRocYear || old.contractRocYear || ''),
    contractStartDate: clean(row.contractStartDate || old.contractStartDate || ''),
    contractEndDate: clean(row.contractEndDate || old.contractEndDate || ''),
    idNumber: clean(row.idNumber || old.idNumber || ''),
    birthDate: clean(row.birthDate || old.birthDate || ''),
    householdAddress: clean(row.householdAddress || old.householdAddress || ''),
    mailingAddress: clean(row.mailingAddress || old.mailingAddress || ''),
    address: clean(row.mailingAddress || row.householdAddress || old.address || ''),
    externalTeacherSyncedAt: nowTs(),
    updatedAt: nowTs(),
    source: 'external-teacher-linked-sync'
  };

  const identityUrl = Array.isArray(row.identityUrls) && row.identityUrls.length ? row.identityUrls[0] : '';
  if (identityUrl) update.identityDocumentUrl = identityUrl;
  if (contractId) update.externalTeacherContractIds = admin.firestore.FieldValue.arrayUnion(contractId);

  await ref.set(update, { merge: true });

  if (contractId) {
    const linkPatch = {
      employeeId,
      externalTeacherEmployeeId: employeeId,
      employeeRef: `employees/${employeeId}`,
      updatedAt: nowTs()
    };
    await db().collection('externalTeacherContracts').doc(contractId).set(linkPatch, { merge: true }).catch(() => null);
    await db().collection('externalTeacherProfiles').doc(contractId).set(linkPatch, { merge: true }).catch(() => null);
  }
  return employeeId;
}

function lineUserIdFromRow(data = {}) {
  return clean(data.lineUserId || data['LINE User ID'] || data.targetLineUserId || data.lineId || '');
}

async function getPrimaryManagerLineRecipient() {
  const primary = await db().collection('employees').doc('PRIMARY_MANAGER_LINE').get();
  if (primary.exists) {
    const data = primary.data() || {};
    const lineUserId = lineUserIdFromRow(data);
    const email = lower(data.email || data.Email || data.mail || data.loginEmail || '');
    if (lineUserId) return { employeeId: primary.id, lineUserId, name: clean(data.name || data.displayName || '柚子樂器主要管理者'), email, source: 'PRIMARY_MANAGER_LINE' };
  }

  const snap = await db().collection('employees').limit(300).get();
  const candidates = [];
  snap.forEach((doc) => {
    if (doc.id === 'PRIMARY_MANAGER_LINE') return;
    const data = doc.data() || {};
    const lineUserId = lineUserIdFromRow(data);
    if (!lineUserId || !isManagerData(data, doc.id)) return;
    const email = lower(data.email || data.Email || data.mail || data.loginEmail || '');
    candidates.push({
      employeeId: doc.id,
      lineUserId,
      name: clean(data.name || data.displayName || email || doc.id),
      email,
      source: BOOTSTRAP_ADMIN_EMAILS.has(email) ? 'bootstrap-admin' : 'manager-fallback',
      priority: BOOTSTRAP_ADMIN_EMAILS.has(email) ? 0 : (data.lineNotifyEnabled === false ? 2 : 1)
    });
  });
  candidates.sort((a, b) => a.priority - b.priority || clean(a.employeeId).localeCompare(clean(b.employeeId)));
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

async function pushAdminMessage(text, options = {}) {
  const configured = clean(process.env.ADMIN_LINE_USER_ID || process.env.LINE_ADMIN_USER_ID || '');
  const manager = configured ? null : await getPrimaryManagerLineRecipient().catch(() => null);
  const target = configured || (manager && manager.lineUserId ? manager.lineUserId : '');
  const payload = {
    eventCode: clean(options.eventCode || 'external_teacher_admin_notice'),
    target: 'admin',
    targetRole: 'admin',
    targetEmployeeId: clean((manager && manager.employeeId) || options.targetEmployeeId || 'PRIMARY_MANAGER_LINE'),
    targetName: clean((manager && manager.name) || options.targetName || '柚子樂器主管'),
    channel: 'line',
    title: clean(options.title || '外聘老師通知'),
    body: text,
    text,
    message: text,
    status: '待發送',
    createdAt: nowTs(),
    source: clean(options.source || 'external-teacher-onboarding')
  };
  if (target) payload.targetLineUserId = target;
  if (manager && manager.email) payload.targetEmail = manager.email;
  if (options.contractId) payload.contractId = clean(options.contractId);
  if (options.approvalUrl) payload.approvalUrl = clean(options.approvalUrl);
  await db().collection('notificationQueue').add(payload).catch((err) => logger.warn('queue admin notice failed', err));
}

async function queueTeacherEmail({ teacherId, email, title, body, source }) {
  if (!clean(email)) return null;
  const ref = db().collection('notificationQueue').doc(`external-teacher-email-${teacherId}-${Date.now()}`);
  await ref.set({
    queueId: ref.id,
    teacherId,
    channel: 'email',
    targetEmail: lower(email),
    title,
    subject: title,
    body,
    message: body,
    status: '待發送',
    source: source || 'external-teacher-email',
    createdAt: nowTs(),
    updatedAt: nowTs()
  }, { merge: true });
  return ref.id;
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

function externalProfileRef(teacherId) {
  return db().collection('externalTeacherProfiles').doc(teacherId);
}

async function getExternalTeacherProfile(teacherId) {
  const ref = externalProfileRef(teacherId);
  const snap = await ref.get();
  if (snap.exists) return { ref, snap, profile: { id: snap.id, ...snap.data() } };

  // 向下相容：前端直寫版本會先建立 externalTeacherContracts，再同步 profile。若 profile 尚未建立，先從合約補回。
  const contractSnap = await db().collection('externalTeacherContracts').doc(teacherId).get();
  if (contractSnap.exists) {
    const c = contractSnap.data() || {};
    const profile = {
      teacherId,
      id: teacherId,
      ...c,
      displayName: clean(c.displayName || c.name || c.teacherName || ''),
      profileStatus: clean(c.profileStatus || c.status || 'waiting_bindings'),
      migratedFromContract: true,
      updatedAt: nowTs()
    };
    await ref.set(profile, { merge: true });
    const newSnap = await ref.get();
    return { ref, snap: newSnap, profile: { id: newSnap.id, ...newSnap.data() } };
  }

  // 向下相容：如果早期版本曾把外聘老師資料放 employees，讀取時可轉成獨立 profile。
  const oldSnap = await db().collection('employees').doc(teacherId).get();
  if (oldSnap.exists) {
    const old = oldSnap.data() || {};
    const ext = old.externalTeacher || {};
    const profile = {
      teacherId,
      id: teacherId,
      name: clean(old.name || old.displayName || ext.name || ''),
      displayName: clean(old.displayName || old.name || ext.name || ''),
      mobile: clean(old.mobile || old.phone || ext.mobile || ''),
      phone: clean(old.phone || old.mobile || ext.mobile || ''),
      email: clean(old.email || ext.email || ''),
      role: 'externalTeacher',
      identityType: 'external',
      bindingMethod: normalizeBindingMethod(ext.bindingMethod || '', !!clean(old.email || ext.email)),
      lineUserId: clean(ext.lineUserId || old.lineUserId || ''),
      lineDisplayName: clean(ext.lineDisplayName || old.lineDisplayName || ''),
      onboardingToken: clean(ext.onboardingToken || ''),
      bindCode: clean(ext.bindCode || ''),
      status: clean(ext.status || ext.profileStatus || 'pendingProfile'),
      payrollInfoStatus: clean(ext.payrollInfoStatus || 'pending'),
      contractStatus: clean(ext.contractStatus || 'unsigned'),
      identityFiles: Array.isArray(ext.identityFiles) ? ext.identityFiles : [],
      migratedFromEmployees: true,
      createdAt: nowTs(),
      updatedAt: nowTs()
    };
    await ref.set(profile, { merge: true });
    const newSnap = await ref.get();
    return { ref, snap: newSnap, profile: { id: newSnap.id, ...newSnap.data() } };
  }

  return { ref, snap, profile: null };
}

async function validateTeacherTokenIfNeeded(request, teacherId, token) {
  if (!teacherId) throw new HttpsError('invalid-argument', '缺少 teacherId');
  if (isAdminToken(request)) return;
  if (request.auth && request.auth.uid === teacherId) return;

  const { profile } = await getExternalTeacherProfile(teacherId);
  if (!profile) throw new HttpsError('not-found', '找不到外聘老師資料');
  if (!clean(token) || clean(token) !== clean(profile.onboardingToken)) {
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
  const file = bucket().file(storagePath);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: mimeType,
      cacheControl: 'private, max-age=0',
      metadata: { firebaseStorageDownloadTokens: downloadToken }
    }
  });

  return {
    fileName,
    storagePath,
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket().name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`,
    mimeType,
    size: buffer.length
  };
}

async function recordExternalTeacherFile(row) {
  const ref = db().collection('externalTeacherFiles').doc();
  await ref.set(Object.assign({}, row, { fileId: ref.id, createdAt: nowTs() }));
  return ref.id;
}

const DEFAULT_CLAUSES = [
  [
    "第一條",
    "契約性質",
    "一、甲方委任乙方提供才藝教學、課程協助、活動支援或雙方另行約定之專業服務。\n二、乙方係以外聘才藝教師身分受任提供服務，雙方同意本契約性質為委任關係，非僱傭關係。\n三、乙方得依其專業能力、教學方法與課程特性提供服務；惟課程時間、地點、學生安全、教室規範及甲方對外承諾事項，仍應依雙方確認內容及甲方合理管理規範辦理。\n四、本契約如因實際履行情形涉及勞動、承攬或其他法律關係之認定，仍應依主管機關或法院就個案事實之認定為準。"
  ],
  [
    "第二條",
    "委任期間",
    "一、本契約期間自 {{contractStartDate}} 起至 {{contractEndDate}} 止。\n二、每年度契約原則上以當年度十二月三十一日為屆滿日。\n三、次年度契約得自每年十二月十五日起，由甲方開放乙方簽署下一年度契約；新年度契約期間原則上自次年度一月一日起至次年度十二月三十一日止。\n四、契約期滿後，如雙方未另行完成續約簽署，乙方不得主張契約自動延長。"
  ],
  [
    "第三條",
    "委任工作內容",
    "乙方受任事項如下：\n一、依雙方確認之課程項目提供教學服務。\n二、依學生程度、課程目標及教學需求，進行備課、授課、課程回饋或進度建議。\n三、配合甲方合理通知，參與必要之課程溝通、學生狀況回報、成果活動或教學相關事項。\n四、協助維護教學現場安全、教室秩序及學生學習品質。\n五、其他經雙方書面、LINE、Email 或系統確認之委任事項。"
  ],
  [
    "第四條",
    "授課時間與地點",
    "一、乙方授課時間、地點及課程安排，應由甲乙雙方事前確認。\n二、乙方如因故無法依約授課，應儘早通知甲方，以利甲方安排補課、調課或其他處理方式。\n三、甲方如因學生請假、停課、活動異動、天災或其他不可歸責於甲方之事由需調整課程，應儘早通知乙方。\n四、乙方不得未經甲方同意，私自變更授課老師、授課地點、課程內容或將委任事項轉由第三人代為履行。"
  ],
  [
    "第五條",
    "報酬與給付方式",
    "一、乙方報酬依雙方於後台、書面、LINE、Email 或其他可保存紀錄之方式確認。\n二、報酬計算方式得依鐘點、堂數、課程件數、活動場次或雙方另行約定方式計算。乙方鐘點費如有約定，為每小時新臺幣 {{hourlyRate}} 元整。\n三、甲方得於每月結算乙方已完成之服務內容，並依雙方約定日期給付報酬；約定付款日為每月 {{paymentDay}} 日者，依該約定辦理。\n四、如遇學生請假、課程取消、臨時停課、未達開課人數或其他特殊情形，報酬是否給付及計算方式，依甲乙雙方事前約定或個案協議辦理。\n五、乙方應提供正確之匯款帳戶、身分資料及依法所需文件；如資料錯誤致給付延誤，乙方應自行負責。"
  ],
  [
    "第六條",
    "稅務與保險",
    "一、乙方因本契約所取得之報酬，應依中華民國相關稅法規定辦理所得申報、扣繳或補充保費等事項。\n二、甲方得依法辦理必要之所得扣繳、申報或相關行政作業。\n三、乙方如非甲方正式員工，除法律另有強制規定或雙方另有書面約定外，甲方不負擔乙方勞工保險、就業保險、勞工退休金提繳或其他僱傭關係下之雇主義務。\n四、乙方如需自行投保相關保險，應自行辦理。"
  ],
  [
    "第七條",
    "乙方基本義務",
    "乙方應遵守下列事項：\n一、以善良管理人之注意義務提供教學服務。\n二、不得對學生、家長或甲方人員有不當言語、肢體接觸、歧視、騷擾、恐嚇或其他不適當行為。\n三、不得未經甲方同意，私下向甲方學生或家長收費、招生、轉介、推銷課程或移轉至其他場所授課。\n四、不得擅自使用甲方名義、商標、教室、設備、學生資料或課程資料從事與本契約無關之行為。\n五、不得違反兒少保護、個人資料保護、著作權、性騷擾防治、校園及補教相關安全規範。\n六、如發生學生安全、意外、糾紛、家長申訴或其他異常事件，乙方應立即通知甲方。"
  ],
  [
    "第八條",
    "甲方義務",
    "甲方應遵守下列事項：\n一、提供雙方約定之授課資訊、課程需求及必要聯絡窗口。\n二、依約給付乙方報酬。\n三、提供合理教學環境或必要設備，惟設備項目仍以雙方約定或現場既有條件為準。\n四、對乙方提供之個人資料、身分證明文件及契約資料，依個人資料保護法及相關規定妥善保管。"
  ],
  [
    "第九條",
    "身分資料與個人資料使用",
    "一、乙方同意提供姓名、身分證字號、聯絡方式、通訊地址、匯款帳戶、身分證明文件、簽名影像及其他簽約必要資料。\n二、甲方蒐集乙方資料之目的，限於簽約、身分確認、報酬給付、所得申報、聯絡通知、契約保存及相關管理作業。\n三、乙方上傳之身分證明文件，甲方得加註浮水印，例如「僅供柚子樂器外聘教師簽約使用」及簽署日期，以降低文件遭不當使用之風險。\n四、未經乙方同意，甲方不得將乙方個人資料提供予與本契約目的無關之第三人；但依法令、主管機關要求或辦理必要行政作業者，不在此限。"
  ],
  [
    "第十條",
    "保密義務",
    "一、乙方因履行本契約而知悉之學生資料、家長資料、課程價格、營運資訊、教學安排、內部管理資料、系統帳號或其他非公開資訊，均負保密義務。\n二、乙方不得將前項資訊洩漏、交付、轉傳或提供予第三人，亦不得作為本契約以外之用途。\n三、本條保密義務於契約終止或期滿後仍繼續有效。"
  ],
  [
    "第十一條",
    "教材、著作與肖像使用",
    "一、乙方自行設計之教材、講義、教學方法或作品，如無另行約定，其著作權歸乙方所有。\n二、甲方提供之教材、講義、圖片、影音、課程資料、品牌素材或內部文件，其權利歸甲方或原權利人所有，乙方不得擅自重製、散布或移作他用。\n三、乙方如同意甲方拍攝授課花絮、成果照片或宣傳素材，應另依雙方確認範圍使用。\n四、涉及學生肖像、姓名、作品或個人資料之使用，應依甲方規範及相關法令辦理。"
  ],
  [
    "第十二條",
    "不得私下招攬與利益衝突",
    "一、乙方不得利用甲方提供之學生、家長、課程或營運資訊，私下招攬甲方學生或家長至其他場所、其他單位或個人名義授課。\n二、乙方不得以降低價格、跳過甲方、私下收費或其他方式，破壞甲方與學生或家長之契約關係。\n三、乙方如有其他合作單位或教學安排，應避免與甲方課程安排發生利益衝突；如有疑義，應先與甲方溝通確認。"
  ],
  [
    "第十三條",
    "課程取消、補課與調課",
    "一、學生請假、臨時停課、天災、停班停課或不可抗力事件所生之補課、調課或取消，依甲方對學生之課程規範及雙方協議辦理。\n二、乙方因個人因素需調課或請假，應提早通知甲方，並配合甲方安排補課或替代方案。\n三、如乙方無故缺席、臨時取消或嚴重影響學生權益，甲方得視情節調整委任事項、停止排課或終止契約。"
  ],
  [
    "第十四條",
    "契約終止",
    "一、任一方欲提前終止本契約，應提前通知他方，並完成已排課程、報酬結算及相關交接。但有重大違約或不可繼續履約之情形者，不在此限。\n二、乙方如有下列情形之一，甲方得立即終止契約：\n（一）提供不實資料或冒用他人身分。\n（二）有重大教學疏失、學生安全疑慮或不當行為。\n（三）未經同意私下招攬學生、收費或轉介課程。\n（四）洩漏學生、家長或甲方非公開資料。\n（五）違反法令、主管機關規範或本契約重大條款。\n三、契約終止後，乙方應返還或刪除甲方提供之非公開資料，並不得繼續使用甲方名義對外招攬或授課。"
  ],
  [
    "第十五條",
    "違約責任",
    "一、任一方違反本契約，致他方受有損害者，應負損害賠償責任。\n二、乙方如因故意或重大過失造成學生、家長、甲方或第三人損害，應依法律規定負相關責任。\n三、如因乙方違反保密、個資保護、私下招攬或擅自使用甲方資料等義務，致甲方商譽、營運或法律權益受損，甲方得依法請求損害賠償。"
  ],
  [
    "第十六條",
    "電子文件與線上簽署",
    "一、甲乙雙方同意本契約得以電子文件、線上勾選、電子簽名、LINE、Email 或系統紀錄方式成立及保存。\n二、乙方於系統中完成資料填寫、身分證明文件上傳、契約確認及線上簽名後，視為已詳閱並同意本契約內容。\n三、甲方得將乙方簽署完成之契約以網頁、PDF、Email 或 LINE 方式提供乙方查看或保存。"
  ],
  [
    "第十七條",
    "通知方式",
    "一、甲乙雙方同意以下列方式之一作為通知方式：LINE、Email、電話、簡訊、系統通知或書面通知。\n二、乙方應確保所留聯絡資料正確，如有變更應主動通知甲方。\n三、乙方因聯絡資料錯誤、未讀取訊息或未更新資料而致通知未能送達或延誤者，由乙方自行負責。"
  ],
  [
    "第十八條",
    "契約修改",
    "一、本契約內容如需修改，應經雙方合意。\n二、甲方得因年度營運、課程制度、法令變更或管理需求，調整下一年度契約模板。\n三、乙方已簽署完成之年度契約，除雙方另行合意外，不因甲方後續修改契約模板而當然變更。"
  ],
  [
    "第十九條",
    "準據法與管轄法院",
    "一、本契約以中華民國法律為準據法。\n二、因本契約所生爭議，雙方應先本誠信原則協商解決。\n三、如協商不成，雙方同意以甲方所在地之地方法院為第一審管轄法院，但法律另有強制規定者，從其規定。"
  ],
  [
    "第二十條",
    "其他約定",
    "一、本契約未盡事宜，依民法、個人資料保護法及其他相關法令辦理。\n二、本契約之標題僅為閱讀便利，不影響條文解釋。\n三、本契約經乙方線上簽署並送出，且經甲方系統保存後生效。"
  ]
];

async function ensureActiveTemplate() {
  const templates = db().collection('externalTeacherContractTemplates');
  const active = await templates.where('status', '==', 'active').limit(1).get();
  if (!active.empty) return { id: active.docs[0].id, ...active.docs[0].data() };

  const templateRef = templates.doc('external_teacher_mandate_default');
  await templateRef.set({
    title: '外聘才藝教師委任契約書',
    contractType: 'externalTeacherMandate',
    version: String(currentGregorianYear()),
    status: 'active',
    createdAt: nowTs(),
    updatedAt: nowTs()
  }, { merge: true });

  const batch = db().batch();
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

  return { id: templateRef.id, title: '外聘才藝教師委任契約書', contractType: 'externalTeacherMandate', version: String(currentGregorianYear()), status: 'active' };
}

async function getActiveTemplateWithClauses() {
  const template = await ensureActiveTemplate();
  const snap = await db().collection('externalTeacherContractTemplates').doc(template.id).collection('clauses').get();
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

function profileTeachingItems(profile) {
  const value = profile.teachingItems;
  if (Array.isArray(value)) return value.join('、');
  return clean(value);
}

function renderContractText({ profile, template, clauses, contractStartDate, contractEndDate }) {
  profile = profile || {};
  const values = {
    companyName: process.env.COMPANY_NAME || '柚子樂器',
    companyTaxId: process.env.COMPANY_TAX_ID || '',
    companyRepresentative: process.env.COMPANY_REPRESENTATIVE || '',
    companyAddress: process.env.COMPANY_ADDRESS || '',
    teacherName: clean(profile.name || profile.displayName || ''),
    teacherIdNumber: clean(profile.idNumber || ''),
    teacherBirthDate: clean(profile.birthDate || ''),
    teacherHouseholdAddress: clean(profile.householdAddress || ''),
    teacherMailingAddress: clean(profile.mailingAddress || ''),
    teacherMobile: clean(profile.mobile || profile.phone || ''),
    teacherEmail: clean(profile.email || ''),
    teachingItems: profileTeachingItems(profile),
    hourlyRate: profile.hourlyRate || '',
    paymentDay: profile.paymentDay || '',
    contractStartDate,
    contractEndDate
  };

  let text = `${template.title || '外聘才藝教師委任契約書'}\n\n`;
  text += `甲方：${values.companyName}\n`;
  text += `代表人：${values.companyRepresentative}\n`;
  text += `地址：${values.companyAddress}\n\n`;
  text += `乙方：${values.teacherName}\n`;
  text += `身分證字號：${values.teacherIdNumber}\n`;
  text += `出生年月日：${values.teacherBirthDate}\n`;
  text += `通訊地址：${values.teacherMailingAddress}\n`;
  text += `電話：${values.teacherMobile}\n`;
  text += `Email：${values.teacherEmail}\n\n`;

  clauses.forEach((clause) => {
    text += `${clause.articleNo || ''}　${clause.title || ''}\n`;
    text += `${replaceVars(clause.content, values)}\n\n`;
  });

  text += `立契約書人：\n\n甲方：${values.companyName}\n代表人：${values.companyRepresentative}\n\n乙方：${values.teacherName}\n簽署日期：${todayKey()}\n`;
  return text;
}

function contractHtml(contractText, signatureUrl, identityFiles = [], profile = {}) {
  const htmlEsc = (value) => String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const attrEsc = htmlEsc;
  const text = htmlEsc(contractText || '');
  const teacherName = htmlEsc(profile.name || profile.displayName || profile.teacherName || '外聘老師');
  const idNumber = htmlEsc(profile.idNumber || profile.identityNumber || profile.nationalId || '');
  const mobile = htmlEsc(profile.mobile || profile.mobilePhone || profile.phone || '');
  const identityUrls = (Array.isArray(identityFiles) ? identityFiles : [])
    .map((f) => clean(f.downloadUrl || f.url || f.fileUrl || f.storageUrl || ''))
    .filter(Boolean);
  const signatureHtml = signatureUrl
    ? `<img class="signature-img" src="${attrEsc(signatureUrl)}" alt="乙方簽名">`
    : '<div class="signature-demo">乙方線上簽名</div>';
  const identityHtml = identityUrls.length
    ? `<div class="identity-doc-block"><div class="identity-doc-title">乙方身分證明文件／證件照片：</div>${identityUrls.map((u, i) => `<img class="identity-doc-img" src="${attrEsc(u)}" alt="乙方身分證明文件${i + 1}">`).join('')}</div>`
    : '<div class="identity-doc-note">乙方身分證明文件／證件照片已隨契約資料保存。</div>';
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>外聘才藝教師委任契約書</title><style>
body{margin:0;background:#e9e1d6;color:#111}.print-page{padding:20px 0 32px}.a4{width:210mm;min-height:297mm;background:#fff;margin:0 auto;padding:18mm 16mm;box-sizing:border-box;color:#111;font-family:"Noto Serif TC","標楷體","PMingLiU",serif;font-size:13.2px;line-height:1.72;position:relative}.a4 h2{text-align:center;font-size:24px;margin:0 0 12px;letter-spacing:2px}.party{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0 12px}.party-box{border:1px solid #ddd;padding:10px;border-radius:8px;min-height:80px}.contract-body{white-space:pre-wrap}.sign-row{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:24px;align-items:start}.sign-box{border-top:1px solid #333;padding-top:10px;min-height:105px;position:relative}.identity-row{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:8px;align-items:start}.seal{position:absolute;right:10px;bottom:8px;width:90px;max-width:90px;opacity:.86}.small-seal{position:absolute;right:112px;bottom:15px;width:54px;max-width:54px;opacity:.86}.signature-demo{height:54px;border:1px dashed #aaa;border-radius:8px;margin-top:10px;display:flex;align-items:center;justify-content:center;color:#777;background:#fafafa}.signature-img{max-height:70px;max-width:220px;display:block;margin-top:8px}.identity-doc-block{margin-top:12px;border-top:1px dashed #bbb;padding-top:10px}.identity-doc-title{font-weight:900;margin-bottom:6px}.identity-doc-img{display:block;max-width:100%;max-height:170px;margin-top:8px;border:1px solid #ccc;border-radius:8px;object-fit:contain}.identity-doc-note{margin-top:8px;color:#777;font-size:12px;line-height:1.6}@page{size:A4;margin:0}@media print{body{background:#fff}.print-page{padding:0}.a4{box-shadow:none;margin:0;transform:none!important}}@media(max-width:760px){body{background:#e9e1d6}.print-page{padding:8px;overflow:hidden}.a4{width:210mm;min-width:210mm;min-height:297mm;margin:0;padding:18mm 16mm;font-size:13.2px;line-height:1.72;transform-origin:top left}.party,.sign-row,.identity-row{grid-template-columns:1fr 1fr}.sign-box{min-height:105px}.identity-doc-img{max-height:170px}.signature-img{max-height:70px;max-width:220px}}
</style></head><body><div class="print-page"><div class="a4"><h2>外聘才藝教師委任契約書</h2><div class="party"><div class="party-box"><b>甲方</b><br>臺中市私立凱立音樂短期補習班<br>代表人：黃銘廷<br>地址：依補習班登記資料</div><div class="party-box"><b>乙方</b><br>外聘老師姓名：${teacherName}<br>身分證字號：${idNumber || '＿＿＿＿＿＿'}<br>電話：${mobile || '＿＿＿＿＿＿'}</div></div><div class="contract-body">${text}</div><div class="sign-row"><div class="sign-box">甲方：臺中市私立凱立音樂短期補習班<br>代表人：黃銘廷<img class="seal" src="https://danny700808.github.io/play-card/kaili-school-seal.png" alt="補習班大章"><img class="small-seal" src="https://danny700808.github.io/play-card/personal-seal.png" alt="負責人小章"></div><div class="sign-box">乙方：${teacherName}${signatureHtml}</div></div><div class="identity-row"><div></div><div>${identityHtml}</div></div><div style="margin-top:20px">簽署日期：${htmlEsc(todayKey())}</div></div></div><script>(function(){function fit(){var wrap=document.querySelector('.print-page'),a4=document.querySelector('.a4');if(!wrap||!a4)return;if(window.innerWidth>760){a4.style.transform='';wrap.style.height='';return;}a4.style.transform='scale(1)';var natural=a4.scrollWidth||a4.offsetWidth||794;var scale=Math.min(1,Math.max(.32,(window.innerWidth-16)/natural));a4.style.transformOrigin='top left';a4.style.transform='scale('+scale+')';wrap.style.height=Math.ceil((a4.scrollHeight||1123)*scale+16)+'px';}window.addEventListener('resize',function(){setTimeout(fit,80)});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fit);else fit();setTimeout(fit,250);})();<\/script></body></html>`;
}

async function saveContractHtml({ teacherId, contractRocYear, contractId, contractText, signatureUrl, identityFiles, profile }) {
  const token = crypto.randomUUID();
  const storagePath = `external-teachers/${teacherId}/${contractRocYear}/contracts/${contractId}.html`;
  const file = bucket().file(storagePath);
  await file.save(contractHtml(contractText, signatureUrl, identityFiles, profile), {
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
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket().name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`,
    mimeType: 'text/html; charset=utf-8'
  };
}

function normalizeTeachingItems(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return String(value || '').split(/[、,，]/).map(clean).filter(Boolean);
}

function publicProfile(profile) {
  profile = profile || {};
  return {
    id: profile.teacherId || profile.id || '',
    teacherId: profile.teacherId || profile.id || '',
    name: profile.name || '',
    displayName: profile.displayName || profile.name || '',
    mobile: profile.mobile || profile.phone || '',
    phone: profile.phone || profile.mobile || '',
    email: profile.email || '',
    idNumber: profile.idNumber || '',
    birthDate: profile.birthDate || '',
    householdAddress: profile.householdAddress || '',
    mailingAddress: profile.mailingAddress || '',
    teachingItems: profile.teachingItems || [],
    hourlyRate: profile.hourlyRate || '',
    paymentDay: profile.paymentDay || '',
    bindingMethod: profile.bindingMethod || '',
    lineBindStatus: profile.lineBindStatus || '',
    emailBindStatus: profile.emailBindStatus || '',
    identityFiles: Array.isArray(profile.identityFiles) ? profile.identityFiles : [],
    payrollInfoStatus: profile.payrollInfoStatus || '',
    contractStatus: profile.contractStatus || '',
    status: profile.status || ''
  };
}

const EXTERNAL_TEACHER_BIND_CODE_FIELDS = ['bindingCode', 'employeeBindCode', 'bindCode', 'onboardingToken'];

function externalTeacherIdFromRow(row = {}, fallbackId = '') {
  return clean(
    row.teacherId ||
    row.externalTeacherContractId ||
    row.contractId ||
    row.currentContractId ||
    row.profileId ||
    row.id ||
    fallbackId ||
    ''
  );
}

async function firstExternalTeacherRecordByCode(bindCode) {
  const code = clean(bindCode).toUpperCase();
  if (!code) return null;
  const collectionNames = ['externalTeacherContracts', 'externalTeacherProfiles'];

  for (const collectionName of collectionNames) {
    for (const field of EXTERNAL_TEACHER_BIND_CODE_FIELDS) {
      try {
        const snap = await db().collection(collectionName).where(field, '==', code).limit(1).get();
        if (!snap.empty) {
          const doc = snap.docs[0];
          return { collectionName, id: doc.id, data: doc.data() || {} };
        }
      } catch (err) {
        logger.warn('external teacher bind-code lookup failed', { collectionName, field, code, error: err && err.message });
      }
    }
  }

  // 舊資料有時只留下綁定文字，最後再做一次有限量掃描，避免既有流程卡住。
  for (const collectionName of collectionNames) {
    try {
      const snap = await db().collection(collectionName).limit(800).get();
      let found = null;
      snap.forEach((doc) => {
        if (found) return;
        const row = doc.data() || {};
        const values = [
          row.bindingCode,
          row.employeeBindCode,
          row.bindCode,
          row.onboardingToken,
          row.employeeBindText,
          row.bindText
        ].map((value) => clean(value).toUpperCase());
        if (values.some((value) => value === code || value === `柚子人員綁定 ${code}`)) {
          found = { collectionName, id: doc.id, data: row };
        }
      });
      if (found) return found;
    } catch (err) {
      logger.warn('external teacher bind-code fallback scan failed', { collectionName, code, error: err && err.message });
    }
  }
  return null;
}

async function repairExternalTeacherBindingIndex(bindCode, currentBinding = {}) {
  const code = clean(bindCode).toUpperCase();
  if (!code) return null;

  const bindingRef = db().collection('externalTeacherLineBindings').doc(code);
  const employeeBindingRef = db().collection('employeeLineBindings').doc(code);
  let employeeBinding = {};
  try {
    const snap = await employeeBindingRef.get();
    if (snap.exists) employeeBinding = snap.data() || {};
  } catch (err) {
    logger.warn('employee binding lookup failed during repair', { code, error: err && err.message });
  }

  let teacherId = clean(
    currentBinding.teacherId ||
    currentBinding.externalTeacherContractId ||
    employeeBinding.externalTeacherContractId ||
    employeeBinding.teacherId ||
    employeeBinding.externalTeacherId ||
    ''
  );
  let source = null;

  if (teacherId) {
    for (const collectionName of ['externalTeacherContracts', 'externalTeacherProfiles']) {
      try {
        const snap = await db().collection(collectionName).doc(teacherId).get();
        if (snap.exists) {
          source = { collectionName, id: snap.id, data: snap.data() || {} };
          break;
        }
      } catch (err) {
        logger.warn('external teacher direct record lookup failed', { collectionName, teacherId, error: err && err.message });
      }
    }
  }

  if (!source) source = await firstExternalTeacherRecordByCode(code);
  if (!source && !teacherId) return null;

  const row = (source && source.data) || {};
  teacherId = teacherId || externalTeacherIdFromRow(row, source && source.id);
  if (!teacherId) return null;

  const token = clean(
    currentBinding.onboardingToken ||
    employeeBinding.onboardingToken ||
    row.onboardingToken ||
    row.bindingCode ||
    row.employeeBindCode ||
    row.bindCode ||
    code
  );
  const employeeId = clean(
    currentBinding.employeeId ||
    currentBinding.externalTeacherEmployeeId ||
    employeeBinding.employeeId ||
    employeeBinding.employeeDocId ||
    row.employeeId ||
    row.externalTeacherEmployeeId ||
    ''
  );
  const teacherName = clean(currentBinding.teacherName || employeeBinding.teacherName || row.teacherName || row.name || row.displayName || '外聘老師');
  const mobile = clean(currentBinding.mobile || employeeBinding.mobile || employeeBinding.mobilePhone || row.mobile || row.phone || '');
  const email = lower(currentBinding.email || employeeBinding.email || row.email || '');
  const bindingMethod = clean(currentBinding.bindingMethod || employeeBinding.bindingMethod || row.bindingMethod || 'line');
  const lineUserId = clean(currentBinding.lineUserId || employeeBinding.lineUserId || row.lineUserId || '');
  const lineDisplayName = clean(currentBinding.lineDisplayName || employeeBinding.lineDisplayName || row.lineDisplayName || '');
  const status = lineUserId || lower(row.lineBindStatus) === 'bound' ? 'bound' : clean(currentBinding.status || employeeBinding.status || 'pending');
  const onboardingUrl = clean(currentBinding.onboardingUrl || employeeBinding.onboardingUrl || row.onboardingUrl || externalTeacherContractUrl(teacherId, token, false));
  const bindText = `柚子人員綁定 ${code}`;

  const bindingPatch = {
    bindCode: code,
    bindingCode: code,
    employeeBindCode: code,
    bindText,
    teacherId,
    externalTeacherContractId: teacherId,
    employeeId,
    externalTeacherEmployeeId: employeeId,
    teacherName,
    mobile,
    email,
    bindingMethod,
    onboardingToken: token,
    onboardingUrl,
    status,
    lineUserId,
    lineDisplayName,
    repairedAt: nowTs(),
    updatedAt: nowTs(),
    source: 'external-teacher-binding-self-repair'
  };

  const employeeBindingPatch = {
    bindingCode: code,
    employeeBindCode: code,
    bindText,
    employeeId,
    employeeDocId: employeeId,
    targetCollection: 'externalTeacherContracts',
    externalTeacherContractId: teacherId,
    teacherId,
    status,
    name: teacherName,
    teacherName,
    email,
    mobilePhone: mobile,
    mobile,
    bindingMethod,
    notificationPreference: bindingMethod,
    onboardingToken: token,
    onboardingUrl,
    lineUserId,
    lineDisplayName,
    repairedAt: nowTs(),
    updatedAt: nowTs(),
    source: 'external-teacher-binding-self-repair'
  };

  const recordPatch = {
    bindingCode: code,
    employeeBindCode: code,
    employeeBindText: bindText,
    onboardingToken: token,
    onboardingUrl,
    updatedAt: nowTs()
  };
  if (employeeId) {
    recordPatch.employeeId = employeeId;
    recordPatch.externalTeacherEmployeeId = employeeId;
    recordPatch.employeeRef = `employees/${employeeId}`;
  }

  await Promise.all([
    bindingRef.set(bindingPatch, { merge: true }),
    employeeBindingRef.set(employeeBindingPatch, { merge: true }),
    db().collection('externalTeacherContracts').doc(teacherId).set(recordPatch, { merge: true }),
    db().collection('externalTeacherProfiles').doc(teacherId).set({ teacherId, id: teacherId, ...recordPatch }, { merge: true })
  ]);

  logger.info('external teacher binding index repaired', { code, teacherId, employeeId: employeeId || null });
  return { bindingRef, binding: { ...currentBinding, ...bindingPatch }, teacherId, token };
}

function shouldKeepExternalTeacherStatus(profile = {}) {
  const status = lower(profile.status || profile.contractStatus || profile.profileStatus || '');
  return [
    'submitted_pending_admin',
    'active',
    'confirmed',
    'contract_effective',
    'completed',
    'needs_revision',
    'archived',
    'overdue_unsigned',
    'signed'
  ].some((key) => status === key || status.includes(key)) || /已送出|待主管|已確認|生效|完成|補件|封存|逾期|已簽/.test(status);
}

async function handleExternalTeacherLineEvent(event) {
  const text = event && event.message && event.message.type === 'text' ? clean(event.message.text) : '';
  const legacyMatch = text.match(/^外聘老師綁定\s+([A-Z0-9-]+)$/i);
  const personnelMatch = text.match(/^柚子人員綁定\s+([A-Z0-9-]+)$/i);
  const match = legacyMatch || personnelMatch;
  if (!match) return false;

  const bindCode = match[1].toUpperCase();
  const replyToken = event.replyToken;
  const lineUserId = event.source && event.source.userId;
  if (!lineUserId) {
    await replyLineMessage(replyToken, 'LINE 綁定失敗：系統無法取得您的 LINE 使用者 ID。');
    return true;
  }

  const bindingRef = db().collection('externalTeacherLineBindings').doc(bindCode);
  let bindingSnap = await bindingRef.get();
  let binding = bindingSnap.exists ? (bindingSnap.data() || {}) : {};
  let teacherId = clean(binding.teacherId || binding.externalTeacherContractId || '');
  let token = clean(binding.onboardingToken || '');

  // 既有契約可能還在，但綁定索引曾被刪除或未完整建立；收到訊息時自動補回。
  if (!bindingSnap.exists || !teacherId) {
    const repaired = await repairExternalTeacherBindingIndex(bindCode, binding);
    if (!repaired) {
      if (personnelMatch) return false; // 交由一般員工綁定流程判斷。
      await replyLineMessage(replyToken, '查不到這組外聘老師綁定碼。\n\n請確認文字是否完整，例如：\n柚子人員綁定 EMP-123456');
      return true;
    }
    binding = repaired.binding || {};
    teacherId = repaired.teacherId;
    token = repaired.token;
    bindingSnap = await bindingRef.get();
  }

  if (binding.expiresAt && binding.expiresAt.toMillis && binding.expiresAt.toMillis() < Date.now()) {
    await bindingRef.set({ status: 'expired', updatedAt: nowTs() }, { merge: true });
    await replyLineMessage(replyToken, '這組外聘老師綁定碼已逾期，請重新產生綁定碼。');
    return true;
  }

  const { ref, profile } = await getExternalTeacherProfile(teacherId);
  if (!profile) {
    await replyLineMessage(replyToken, '系統找不到此外聘老師資料，請重新開啟填寫連結或聯絡柚子樂器官方 LINE。');
    return true;
  }

  const lineProfile = await getLineProfile(lineUserId);
  const lineDisplayName = clean(lineProfile.displayName || '');
  const teacherName = clean(profile.name || profile.displayName || binding.teacherName || '老師');
  const linkedEmployeeId = clean(
    binding.employeeId ||
    binding.externalTeacherEmployeeId ||
    profile.employeeId ||
    profile.externalTeacherEmployeeId ||
    ''
  );
  const nextToken = token || clean(profile.onboardingToken || profile.bindingCode || profile.employeeBindCode || bindCode) || bindCode;
  const keepStatus = shouldKeepExternalTeacherStatus(profile);
  const currentStatus = clean(profile.status || profile.contractStatus || profile.profileStatus || '');
  const currentProgress = clean(profile.progressStatus || '');
  const employeeBindingRef = db().collection('employeeLineBindings').doc(bindCode);

  await db().runTransaction(async (tx) => {
    const boundAt = nowTs();
    tx.set(bindingRef, {
      status: 'bound',
      lineUserId,
      lineDisplayName,
      boundAt,
      updatedAt: nowTs()
    }, { merge: true });

    tx.set(employeeBindingRef, {
      bindingCode: bindCode,
      employeeBindCode: bindCode,
      bindText: `柚子人員綁定 ${bindCode}`,
      employeeId: linkedEmployeeId,
      employeeDocId: linkedEmployeeId,
      targetCollection: 'externalTeacherContracts',
      externalTeacherContractId: teacherId,
      teacherId,
      status: 'bound',
      name: teacherName,
      teacherName,
      email: lower(profile.email || binding.email || ''),
      mobilePhone: clean(profile.mobile || profile.phone || binding.mobile || ''),
      mobile: clean(profile.mobile || profile.phone || binding.mobile || ''),
      bindingMethod: clean(profile.bindingMethod || binding.bindingMethod || 'line'),
      notificationPreference: clean(profile.bindingMethod || binding.bindingMethod || 'line'),
      onboardingToken: nextToken,
      onboardingUrl: externalTeacherContractUrl(teacherId, nextToken, false),
      lineUserId,
      lineDisplayName,
      boundAt,
      updatedAt: nowTs(),
      source: 'external-teacher-line-binding'
    }, { merge: true });

    const linePatch = {
      lineUserId,
      lineNotifyEnabled: true,
      lineBindStatus: 'bound',
      lineDisplayName,
      lineBoundAt: boundAt,
      bindingCode: bindCode,
      employeeBindCode: bindCode,
      employeeBindText: `柚子人員綁定 ${bindCode}`,
      bindCode,
      onboardingToken: nextToken,
      onboardingUrl: externalTeacherContractUrl(teacherId, nextToken, false),
      status: keepStatus ? currentStatus : 'waiting_contract',
      progressStatus: keepStatus ? currentProgress : 'LINE 已綁定，等待老師從 LINE 下一步連結進入正式資料填寫',
      verifiedBy: 'line',
      verifiedAt: boundAt,
      updatedAt: nowTs()
    };
    if (linkedEmployeeId) {
      linePatch.employeeId = linkedEmployeeId;
      linePatch.externalTeacherEmployeeId = linkedEmployeeId;
      linePatch.employeeRef = `employees/${linkedEmployeeId}`;
    }

    tx.set(ref, linePatch, { merge: true });
    tx.set(db().collection('externalTeacherContracts').doc(teacherId), linePatch, { merge: true });
  });

  // 既有外聘老師若已經有員工管理資料，只更新現有帳號，不建立新的空白帳號。
  if (linkedEmployeeId) {
    try {
      const employeeRef = db().collection('employees').doc(linkedEmployeeId);
      const employeeSnap = await employeeRef.get();
      if (employeeSnap.exists) {
        await employeeRef.set({
          lineUserId,
          lineDisplayName,
          lineNotifyEnabled: true,
          lineBindStatus: 'bound',
          employeeBindCode: bindCode,
          employeeBindText: `柚子人員綁定 ${bindCode}`,
          updatedAt: nowTs(),
          source: 'external-teacher-line-binding'
        }, { merge: true });
      }
    } catch (err) {
      logger.warn('linked external teacher employee update failed', { linkedEmployeeId, error: err && err.message });
    }
  }

  const nextUrl = externalTeacherContractUrl(teacherId, nextToken, false);
  await replyLineMessage(replyToken, `外聘老師 LINE 綁定完成 ✅\n\n您好 ${teacherName}，系統已完成您的 LINE 綁定。\n\n請點選下方下一步連結，繼續完成正式資料、身分證明文件與契約簽署。\n\n${nextUrl}`);
  await pushAdminMessage(`外聘老師 LINE 綁定完成\n\n姓名：${teacherName}\n狀態：待填資料`, { contractId: teacherId, source: 'external-teacher-line-bound' });
  return true;
}

function buildExternalTeacherEmailBody({ name, url, bindText, bindingMethod, contractRocYear, contractStartDate, contractEndDate }) {
  const lines = [
    `${name || '老師'} 您好：`,
    '',
    '這是柚子樂器外聘老師資料填寫與年度契約簽署連結。',
    `合約年度：民國 ${contractRocYear} 年`,
    `契約期間：${contractStartDate} 至 ${contractEndDate}`,
    '',
    `填寫連結：${url}`,
    ''
  ];
  if (wantsLine(bindingMethod)) {
    lines.push('若您選擇 LINE 綁定，請將下列文字貼到柚子樂器官方 LINE：');
    lines.push(bindText);
    lines.push('');
  }
  lines.push('請依頁面完成基本資料、身分證明文件上傳、契約確認與線上簽名。');
  return lines.join('\n');
}


function taipeiYmd(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function ymdParts(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function ymdToMillisTaipei(ymd) {
  const p = ymdParts(ymd);
  if (!p) return 0;
  return Date.parse(`${ymd}T00:00:00+08:00`);
}

function daysBetweenYmd(startYmd, endYmd) {
  const start = ymdToMillisTaipei(startYmd);
  const end = ymdToMillisTaipei(endYmd);
  if (!start || !end) return 0;
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function renewalTargetYearForYmd(ymd) {
  const p = ymdParts(ymd) || ymdParts(taipeiYmd());
  if (p.month === 12 && p.day >= 15) return p.year + 1;
  return p.year;
}

function renewalOpenDateForTargetYear(targetYear) {
  return `${Number(targetYear) - 1}-12-15`;
}

function safeDocId(value) {
  return clean(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120) || `EXT_${Date.now()}`;
}

function makeEmployeeBindCode() {
  return `EMP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function externalTeacherContractUrl(contractId, code, verifyEmail = false) {
  return `${webBaseUrl()}external-teacher-onboarding.html?id=${encodeURIComponent(contractId || '')}&code=${encodeURIComponent(code || '')}${verifyEmail ? '&verify=email' : ''}`;
}

function renewalContractIdFor(profileId, targetYear) {
  return `EXTRENEW_${safeDocId(profileId)}_${targetYear}`;
}

function inactiveTextMatch(value) {
  const s = lower(value || '');
  if (!s) return false;
  const keys = ['archived', 'archive', 'deleted', 'delete', 'cancelled', 'canceled', 'inactive', 'terminated', 'disabled', 'paused', '封存', '已封存', '刪除', '已刪除', '取消', '已取消', '停用', '已停用', '離職', '已離職', '不續聘', '終止', '停聘', '暫停'];
  return keys.some((key) => s === key || s.includes(key));
}

function isInactiveExternalTeacher(profile = {}, employee = {}) {
  if (profile.hiddenFromActiveLists === true || employee.hiddenFromActiveLists === true) return true;
  if (profile.active === false || profile.enabled === false || employee.active === false || employee.enabled === false) return true;
  if (clean(profile.externalAccessEnabled) === '否' || clean(employee.externalAccessEnabled) === '否') return true;
  if (profile.renewalPaused === true || profile.contractRenewalPaused === true || profile.noRenewal === true || employee.renewalPaused === true || employee.contractRenewalPaused === true || employee.noRenewal === true) return true;
  return [profile.status, profile.profileStatus, profile.contractStatus, profile.accountStatus, profile.employmentStatus, employee.status, employee.accountStatus, employee.employmentStatus, employee.externalTeacherStatus, employee.contractStatus]
    .some(inactiveTextMatch);
}

function contractYearMatches(row = {}, targetYear) {
  const year = normalizeContractGregorianYear(row.contractGregorianYear || row.contractYear || row.gregorianYear || row.renewalTargetYear || '');
  return Number(year) === Number(targetYear);
}

function isSignedExternalContract(row = {}, targetYear) {
  if (!contractYearMatches(row, targetYear)) return false;
  const s = lower(row.status || row.contractStatus || row.profileStatus || '');
  const signedWords = ['signed', 'active', 'submitted_pending_admin', 'confirmed', 'contract_effective', 'completed', '已簽署', '已送出', '已確認', '生效', '完成', '管理端已確認'];
  return signedWords.some((key) => s === key || s.includes(key));
}

async function getLinkedEmployee(profile = {}) {
  const employeeId = clean(profile.employeeId || profile.externalTeacherEmployeeId || profile.linkedEmployeeId || profile.userId || '');
  if (!employeeId) return {};
  try {
    const snap = await db().collection('employees').doc(employeeId).get();
    return snap.exists ? (snap.data() || {}) : {};
  } catch (err) {
    logger.warn('getLinkedEmployee failed', err);
    return {};
  }
}

async function queryExternalContractsBy(field, value) {
  const v = clean(value);
  if (!field || !v) return [];
  try {
    const snap = await db().collection('externalTeacherContracts').where(field, '==', v).limit(50).get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    logger.warn('queryExternalContractsBy failed', { field, err });
    return [];
  }
}

async function hasSignedContractForYear(profileId, profile = {}, targetYear) {
  if (isSignedExternalContract(profile, targetYear)) return true;
  const renewalId = renewalContractIdFor(profileId, targetYear);
  const rows = [];
  try {
    const direct = await db().collection('externalTeacherContracts').doc(renewalId).get();
    if (direct.exists) rows.push({ id: direct.id, ...direct.data() });
  } catch (err) {}
  const ids = Array.from(new Set([
    profileId,
    profile.teacherId,
    profile.id,
    profile.employeeId,
    profile.externalTeacherEmployeeId,
    profile.linkedEmployeeId,
    profile.currentContractId,
    profile.externalTeacherContractId
  ].map(clean).filter(Boolean)));
  for (const id of ids) {
    rows.push(...await queryExternalContractsBy('teacherId', id));
    rows.push(...await queryExternalContractsBy('baseTeacherProfileId', id));
    rows.push(...await queryExternalContractsBy('employeeId', id));
    rows.push(...await queryExternalContractsBy('externalTeacherEmployeeId', id));
  }
  const deduped = Array.from(new Map(rows.map((row) => [row.id, row])).values());
  return deduped.some((row) => isSignedExternalContract(row, targetYear));
}

function shouldSendRenewalReminder(profile = {}, targetYear, todayYmd) {
  const openDate = renewalOpenDateForTargetYear(targetYear);
  if (daysBetweenYmd(openDate, todayYmd) < 0) return false;
  const state = (profile.renewalReminderState && profile.renewalReminderState[String(targetYear)]) || {};
  const count = Number(state.count || 0) || 0;
  const lastDate = clean(state.lastReminderDate || '');
  if (!count) return true;
  if (count === 1) return daysBetweenYmd(lastDate || openDate, todayYmd) >= 5;
  return daysBetweenYmd(lastDate || todayYmd, todayYmd) >= 3;
}

function renewalReminderBody({ name, targetYear, url }) {
  const roc = rocYear(targetYear);
  return [
    `${name || '老師'} 您好：`,
    '',
    `柚子樂器外聘老師民國 ${roc} 年契約已開放簽署。`,
    `契約期間：${targetYear}-01-01 至 ${targetYear}-12-31`,
    '',
    '請點選以下連結完成資料確認與契約簽署：',
    url,
    '',
    '若您已完成簽署，請忽略本通知。'
  ].join('\n');
}

async function ensureRenewalContractDraft(profileId, profile = {}, targetYear) {
  const contractId = renewalContractIdFor(profileId, targetYear);
  const ref = db().collection('externalTeacherContracts').doc(contractId);
  const snap = await ref.get().catch(() => null);
  const old = snap && snap.exists ? (snap.data() || {}) : {};
  const method = normalizeBindingMethod(profile.bindingMethod || profile.notificationPreference || old.bindingMethod || '', !!clean(profile.email || old.email));
  const lineUserId = clean(profile.lineUserId || old.lineUserId || '');
  const lineBound = wantsLine(method) ? (!!lineUserId || clean(profile.lineBindStatus || old.lineBindStatus) === 'bound') : false;
  const code = clean(old.bindingCode || old.onboardingToken || profile.renewalBindCode || '') || makeEmployeeBindCode();
  const url = externalTeacherContractUrl(contractId, code, false);
  const emailUrl = externalTeacherContractUrl(contractId, code, true);
  const name = clean(profile.name || profile.displayName || profile.teacherName || old.name || old.teacherName || '');
  const email = lower(profile.email || old.email || '');
  const mobile = clean(profile.mobile || profile.phone || old.mobile || old.phone || '');
  const employeeId = clean(profile.employeeId || profile.externalTeacherEmployeeId || old.employeeId || old.externalTeacherEmployeeId || profileId);
  const lineBindStatus = wantsLine(method) ? (lineBound ? 'bound' : 'pending') : 'not_required';
  const emailBindStatus = wantsEmail(method) ? 'bound' : 'not_required';
  const status = wantsLine(method) && !lineBound ? 'waiting_bindings' : 'waiting_contract';
  const row = {
    id: contractId,
    teacherId: contractId,
    baseTeacherProfileId: profileId,
    baseTeacherEmployeeId: employeeId,
    isRenewalContractDraft: true,
    renewalTargetYear: Number(targetYear),
    employeeId,
    externalTeacherEmployeeId: employeeId,
    teacherName: name,
    name,
    displayName: name,
    mobile,
    phone: mobile,
    email,
    teachingItems: profile.teachingItems || profile.teachingItemsText || old.teachingItems || '',
    teachingItemsText: profile.teachingItemsText || profile.teachingItems || old.teachingItemsText || '',
    teachingAbilities: Array.isArray(profile.teachingAbilities) ? profile.teachingAbilities : (Array.isArray(old.teachingAbilities) ? old.teachingAbilities : []),
    bindingMethod: method,
    bindingMethodLabel: method === 'both' ? 'LINE + Email' : (method === 'email' ? '只用 Email' : '只用 LINE'),
    bindingCode: code,
    employeeBindCode: code,
    employeeBindText: `柚子人員綁定 ${code}`,
    onboardingToken: code,
    onboardingUrl: url,
    emailVerifyUrl: emailUrl,
    contractYear: Number(targetYear),
    contractGregorianYear: Number(targetYear),
    contractRocYear: rocYear(targetYear),
    contractYearKey: String(rocYear(targetYear)),
    contractStartDate: `${targetYear}-01-01`,
    contractEndDate: `${targetYear}-12-31`,
    nextRenewalOpenDate: renewalOpenDateForTargetYear(Number(targetYear) + 1),
    renewalDueDate: `${targetYear}-01-01`,
    renewalOverdue: false,
    lineUserId,
    lineBindStatus,
    emailBindStatus,
    status,
    progressStatus: status === 'waiting_bindings' ? '等待 LINE 綁定後簽署年度契約' : '等待老師簽署年度契約',
    createdAt: old.createdAt || nowTs(),
    updatedAt: nowTs(),
    source: 'external-teacher-annual-renewal-reminder'
  };
  await ref.set(row, { merge: true });

  if (employeeId) {
    await db().collection('employees').doc(employeeId).set({
      nextExternalContractId: contractId,
      nextExternalContractRocYear: rocYear(targetYear),
      nextExternalContractGregorianYear: Number(targetYear),
      nextExternalContractStatus: status,
      externalContractRenewalStatus: status,
      externalContractRenewalUpdatedAt: nowTs(),
      updatedAt: nowTs()
    }, { merge: true }).catch(() => null);
  }

  if (wantsLine(method) && !lineBound) {
    await db().collection('externalTeacherLineBindings').doc(code).set({
      bindCode: code,
      bindingCode: code,
      employeeBindCode: code,
      bindText: `柚子人員綁定 ${code}`,
      teacherId: contractId,
      employeeId,
      externalTeacherEmployeeId: employeeId,
      teacherName: name,
      mobile,
      email,
      bindingMethod: method,
      onboardingToken: code,
      onboardingUrl: url,
      status: 'pending',
      updatedAt: nowTs(),
      source: 'external-teacher-renewal-binding'
    }, { merge: true });
    await db().collection('employeeLineBindings').doc(code).set({
      bindingCode: code,
      employeeBindCode: code,
      bindText: `柚子人員綁定 ${code}`,
      employeeId,
      employeeDocId: employeeId,
      targetCollection: 'employees',
      externalTeacherContractId: contractId,
      teacherId: contractId,
      status: 'pending',
      name,
      teacherName: name,
      email,
      mobilePhone: mobile,
      mobile,
      bindingMethod: method,
      notificationPreference: method,
      onboardingToken: code,
      onboardingUrl: url,
      updatedAt: nowTs(),
      source: 'external-teacher-renewal-binding'
    }, { merge: true });
  }
  return { contractId, code, url, emailUrl, method, lineUserId, email, name };
}

async function queueExternalTeacherRenewalNotice({ profileId, profile, targetYear, link }) {
  const title = `柚子樂器外聘老師 ${rocYear(targetYear)} 年契約簽署提醒`;
  const body = renewalReminderBody({ name: link.name || profile.name || profile.displayName, targetYear, url: link.emailUrl || link.url });
  const sentChannels = [];
  if (wantsLine(link.method) && link.lineUserId) {
    await db().collection('notificationQueue').add({
      teacherId: profileId,
      contractId: link.contractId,
      channel: 'line',
      targetLineUserId: link.lineUserId,
      targetName: link.name || clean(profile.name || profile.displayName || '外聘老師'),
      title,
      body,
      message: body,
      status: '待發送',
      source: 'external-teacher-annual-renewal-reminder',
      renewalTargetYear: Number(targetYear),
      createdAt: nowTs()
    });
    sentChannels.push('line');
  }
  if (wantsEmail(link.method) && link.email) {
    await queueTeacherEmail({
      teacherId: profileId,
      email: link.email,
      title,
      body,
      source: 'external-teacher-annual-renewal-reminder'
    });
    sentChannels.push('email');
  }
  return sentChannels;
}

function isUnsignedRenewalContract(row = {}) {
  const s = lower(row.status || row.contractStatus || row.profileStatus || '');
  return ['waiting_contract', 'waiting_bindings', 'unsigned', 'overdue_unsigned'].includes(s) || /等待.*簽署|未簽/.test(s);
}

async function markRenewalOverdueIfNeeded({ contractId, profileId, employeeId, targetYear, today }) {
  if (!contractId || !targetYear || daysBetweenYmd(`${targetYear}-01-01`, today) < 0) return false;
  const ref = db().collection('externalTeacherContracts').doc(contractId);
  const snap = await ref.get().catch(() => null);
  if (!snap || !snap.exists) return false;
  const row = snap.data() || {};
  if (!isUnsignedRenewalContract(row)) return false;
  const patch = {
    status: 'overdue_unsigned',
    contractStatus: 'overdue_unsigned',
    progressStatus: '逾期未簽署，請重新通知老師',
    renewalOverdue: true,
    overdueSince: `${targetYear}-01-01`,
    overdueMarkedAt: nowTs(),
    updatedAt: nowTs()
  };
  await ref.set(patch, { merge: true });
  const empId = clean(employeeId || row.employeeId || row.externalTeacherEmployeeId || '');
  if (empId) {
    await db().collection('employees').doc(empId).set({
      nextExternalContractId: contractId,
      nextExternalContractRocYear: rocYear(targetYear),
      nextExternalContractGregorianYear: Number(targetYear),
      nextExternalContractStatus: 'overdue_unsigned',
      externalContractRenewalStatus: 'overdue_unsigned',
      externalContractRenewalUpdatedAt: nowTs(),
      updatedAt: nowTs()
    }, { merge: true }).catch(() => null);
  }
  const baseId = clean(profileId || row.baseTeacherProfileId || '');
  if (baseId) {
    await db().collection('externalTeacherProfiles').doc(baseId).set({
      nextExternalContractId: contractId,
      nextExternalContractRocYear: rocYear(targetYear),
      nextExternalContractStatus: 'overdue_unsigned',
      contractRenewalStatus: 'overdue_unsigned',
      updatedAt: nowTs()
    }, { merge: true }).catch(() => null);
  }
  return true;
}

function registerExternalTeacherOnboarding(exportsObj) {
  exportsObj.externalTeacherCreateBindCode = onCall({ region: REGION }, async (request) => {
    const data = request.data || {};
    const name = clean(data.name || '');
    const mobile = clean(data.mobile || data.phone || '');
    const email = lower(data.email || '');
    const bindingMethod = normalizeBindingMethod(data.bindingMethod || data.notificationPreference, !!email);
    if (!name) throw new HttpsError('invalid-argument', '請輸入姓名');
    if (!mobile) throw new HttpsError('invalid-argument', '請輸入手機');
    if (wantsEmail(bindingMethod) && !email) throw new HttpsError('invalid-argument', '選擇 Email 綁定時，請填寫 Email');

    const dates = contractDatesFromData(data, {});
    const nowYear = currentGregorianYear();
    if (dates.contractGregorianYear > nowYear && !isDec15OrLater(new Date())) {
      throw new HttpsError('failed-precondition', '下一年度契約需於每年 12 月 15 日起開放簽署。');
    }

    let teacherId = clean(data.teacherId || data.userId || (request.auth && request.auth.uid) || '');
    if (!teacherId) teacherId = await resolveExternalEmployeeId({ name, mobile, email });
    const token = makeToken();
    const bindCode = wantsLine(bindingMethod) ? makeBindCode() : '';
    const url = onboardingUrl(teacherId, token);
    const bindText = bindCode ? `外聘老師綁定 ${bindCode}` : '';

    const profileRow = {
      teacherId,
      id: teacherId,
      employeeId: '',
      externalTeacherEmployeeId: '',
      name,
      displayName: name,
      mobile,
      phone: mobile,
      email,
      role: 'externalTeacher',
      identityType: 'external',
      bindingMethod,
      bindCode,
      onboardingToken: token,
      onboardingUrl: url,
      lineBindStatus: wantsLine(bindingMethod) ? 'pending' : 'not_required',
      emailBindStatus: wantsEmail(bindingMethod) ? 'bound' : 'not_required',
      status: wantsLine(bindingMethod) ? 'pendingLine' : 'pendingProfile',
      profileStatus: wantsLine(bindingMethod) ? 'pendingLine' : 'pendingProfile',
      payrollInfoStatus: 'pending',
      paymentMethod: 'pending',
      contractStatus: 'unsigned',
      contractGregorianYear: dates.contractGregorianYear,
      contractRocYear: dates.contractRocYear,
      contractYearKey: dates.contractYearKey,
      contractStartDate: dates.contractStartDate,
      contractEndDate: dates.contractEndDate,
      nextRenewalOpenDate: dates.nextRenewalOpenDate,
      teachingItems: normalizeTeachingItems(data.teachingItems),
      hourlyRate: Number(data.hourlyRate || 0),
      paymentDay: Number(data.paymentDay || 0),
      createdAt: nowTs(),
      updatedAt: nowTs()
    };

    await externalProfileRef(teacherId).set(profileRow, { merge: true });

    if (bindCode) {
      await db().collection('externalTeacherLineBindings').doc(bindCode).set({
        bindCode,
        teacherId,
        employeeId: '',
        externalTeacherEmployeeId: '',
        teacherName: name,
        mobile,
        email,
        bindingMethod,
        onboardingToken: token,
        onboardingUrl: url,
        contractGregorianYear: dates.contractGregorianYear,
        contractRocYear: dates.contractRocYear,
        contractStartDate: dates.contractStartDate,
        contractEndDate: dates.contractEndDate,
        status: 'pending',
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: nowTs(),
        updatedAt: nowTs()
      }, { merge: true });
    }

    let emailQueueId = '';
    if (wantsEmail(bindingMethod) && email) {
      emailQueueId = await queueTeacherEmail({
        teacherId,
        email,
        title: `柚子樂器外聘老師 ${dates.contractRocYear} 年契約簽署`,
        body: buildExternalTeacherEmailBody({ name, url, bindText, bindingMethod, ...dates }),
        source: 'external-teacher-onboarding-link'
      }) || '';
    }

    return {
      ok: true,
      teacherId,
      token,
      bindCode,
      bindText,
      bindingMethod,
      onboardingUrl: url,
      emailQueueId,
      availableContractYears: availableContractYears(),
      ...dates
    };
  });

  exportsObj.externalTeacherGetOnboarding = onCall({ region: REGION }, async (request) => {
    const data = request.data || {};
    const teacherId = clean(data.teacherId || data.userId || (request.auth && request.auth.uid) || '');
    const token = clean(data.token || '');
    await validateTeacherTokenIfNeeded(request, teacherId, token);

    const { profile } = await getExternalTeacherProfile(teacherId);
    if (!profile) throw new HttpsError('not-found', '找不到外聘老師資料');
    const dates = contractDatesFromData(data, profile);
    const { template, clauses } = await getActiveTemplateWithClauses();
    const contractText = renderContractText({ profile, template, clauses, contractStartDate: dates.contractStartDate, contractEndDate: dates.contractEndDate });

    return { ok: true, teacher: publicProfile(profile), profile: publicProfile(profile), template, clauses, contractText, payrollUrl: payrollUrl(teacherId, token || profile.onboardingToken), availableContractYears: availableContractYears(), ...dates };
  });

  exportsObj.externalTeacherSaveProfile = onCall({ region: REGION, timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
    const data = request.data || {};
    const teacherId = clean(data.teacherId || data.userId || (request.auth && request.auth.uid) || '');
    const token = clean(data.token || '');
    await validateTeacherTokenIfNeeded(request, teacherId, token);

    const { profile } = await getExternalTeacherProfile(teacherId);
    if (!profile) throw new HttpsError('not-found', '找不到外聘老師資料');
    const dates = contractDatesFromData(data, profile);

    const identityFiles = [];
    const incomingFiles = Array.isArray(data.identityFilesData) ? data.identityFilesData : [];
    for (let i = 0; i < incomingFiles.length; i++) {
      const f = incomingFiles[i] || {};
      if (!f.dataUrl) continue;
      const fileName = safeFileName(f.fileName || `identity_${i + 1}.jpg`);
      const saved = await saveDataUrlToStorage({
        dataUrl: f.dataUrl,
        fileName,
        storagePath: `external-teachers/${teacherId}/${dates.contractRocYear}/identity/${Date.now()}_${i}_${fileName}`,
        contentType: f.mimeType || ''
      });
      const fileRow = Object.assign({}, saved, { watermarkApplied: f.watermarkApplied === true, watermarkText: clean(f.watermarkText || '') });
      identityFiles.push(fileRow);
      await recordExternalTeacherFile({ teacherId, contractId: '', contractRocYear: dates.contractRocYear, contractYearKey: dates.contractYearKey, fileType: 'identityPhoto', ...fileRow });
    }

    const skipPayroll = data.skipPayroll === true;
    const hasBank = !!(data.bankName && data.bankAccountName && data.bankAccountNumber);
    const payrollInfoStatus = skipPayroll ? 'pending' : (hasBank ? 'completed' : 'pending');
    const paymentMethod = skipPayroll ? 'pending' : (hasBank ? 'bank' : 'pending');

    const update = {
      name: clean(data.name || profile.name || ''),
      displayName: clean(data.name || profile.displayName || profile.name || ''),
      mobile: clean(data.mobile || data.phone || profile.mobile || ''),
      phone: clean(data.mobile || data.phone || profile.phone || ''),
      email: lower(data.email || profile.email || ''),
      idNumber: clean(data.idNumber || ''),
      birthDate: clean(data.birthDate || ''),
      householdAddress: clean(data.householdAddress || ''),
      mailingAddress: clean(data.mailingAddress || ''),
      teachingItems: normalizeTeachingItems(data.teachingItems),
      hourlyRate: Number(data.hourlyRate || 0),
      paymentDay: Number(data.paymentDay || 0),
      identityPhotoStatus: identityFiles.length ? 'uploaded' : ((Array.isArray(profile.identityFiles) && profile.identityFiles.length) ? 'uploaded' : 'pending'),
      payrollInfoStatus,
      paymentMethod,
      bankName: clean(data.bankName || ''),
      bankBranch: clean(data.bankBranch || ''),
      bankAccountName: clean(data.bankAccountName || ''),
      bankAccountNumber: clean(data.bankAccountNumber || ''),
      profileStatus: 'pendingContract',
      status: 'pendingContract',
      contractGregorianYear: dates.contractGregorianYear,
      contractRocYear: dates.contractRocYear,
      contractYearKey: dates.contractYearKey,
      contractStartDate: dates.contractStartDate,
      contractEndDate: dates.contractEndDate,
      nextRenewalOpenDate: dates.nextRenewalOpenDate,
      updatedAt: nowTs()
    };
    if (identityFiles.length) update.identityFiles = admin.firestore.FieldValue.arrayUnion(...identityFiles);

    await externalProfileRef(teacherId).set(update, { merge: true });
    return { ok: true, payrollInfoStatus, paymentMethod, identityFiles, ...dates };
  });

  exportsObj.externalTeacherCompleteContract = onCall({ region: REGION, timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
    const data = request.data || {};
    const teacherId = clean(data.teacherId || data.userId || (request.auth && request.auth.uid) || '');
    const token = clean(data.token || '');
    await validateTeacherTokenIfNeeded(request, teacherId, token);

    if (data.agreeTerms !== true) throw new HttpsError('failed-precondition', '請先勾選同意契約內容');
    if (!data.signatureDataUrl) throw new HttpsError('invalid-argument', '請先完成簽名');

    const { ref, profile } = await getExternalTeacherProfile(teacherId);
    if (!profile) throw new HttpsError('not-found', '找不到外聘老師資料');
    const identityFiles = Array.isArray(profile.identityFiles) ? profile.identityFiles : [];
    if (!identityFiles.length) throw new HttpsError('failed-precondition', '請先上傳身分證明文件。');

    const dates = contractDatesFromData(data, profile);
    const contractId = makeId('EXTC');
    const { template, clauses } = await getActiveTemplateWithClauses();
    const contractText = renderContractText({ profile, template, clauses, contractStartDate: dates.contractStartDate, contractEndDate: dates.contractEndDate });

    const signatureFile = await saveDataUrlToStorage({
      dataUrl: data.signatureDataUrl,
      fileName: `${contractId}_signature.png`,
      storagePath: `external-teachers/${teacherId}/${dates.contractRocYear}/signatures/${contractId}_signature.png`,
      contentType: 'image/png'
    });
    await recordExternalTeacherFile({ teacherId, contractId, contractRocYear: dates.contractRocYear, contractYearKey: dates.contractYearKey, fileType: 'signature', ...signatureFile });

    const contractHtmlFile = await saveContractHtml({ teacherId, contractRocYear: dates.contractRocYear, contractId, contractText, signatureUrl: signatureFile.downloadUrl, identityFiles, profile });
    await recordExternalTeacherFile({ teacherId, contractId, contractRocYear: dates.contractRocYear, contractYearKey: dates.contractYearKey, fileType: 'signedContractHtml', ...contractHtmlFile });

    const contractDoc = {
      contractId,
      teacherId,
      employeeId: '',
      externalTeacherEmployeeId: '',
      teacherName: clean(profile.name || profile.displayName || ''),
      profileRef: `externalTeacherProfiles/${teacherId}`,
      templateId: template.id,
      templateVersion: template.version || '',
      contractTitle: template.title || '外聘才藝教師委任契約書',
      contractGregorianYear: dates.contractGregorianYear,
      contractRocYear: dates.contractRocYear,
      contractYearKey: dates.contractYearKey,
      contractStartDate: dates.contractStartDate,
      contractEndDate: dates.contractEndDate,
      nextRenewalOpenDate: dates.nextRenewalOpenDate,
      teacherSnapshot: publicProfile(profile),
      clauseSnapshots: clauses,
      fullContractTextSnapshot: contractText,
      signatureFile,
      identityFiles,
      contractHtmlFile,
      contractHtmlUrl: contractHtmlFile.downloadUrl,
      bindingMethod: profile.bindingMethod || '',
      lineUserId: clean(profile.lineUserId || ''),
      email: clean(profile.email || ''),
      status: 'submitted_pending_admin',
      progressStatus: '老師已送出，等待管理端確認',
      signedAt: nowTs(),
      signedAtText: todayKey(),
      createdAt: nowTs(),
      updatedAt: nowTs()
    };

    await db().collection('externalTeacherContracts').doc(contractId).set(contractDoc);
    await ref.set({
      contractStatus: 'submitted_pending_admin',
      currentContractId: contractId,
      currentContractRocYear: dates.contractRocYear,
      contractGregorianYear: dates.contractGregorianYear,
      contractRocYear: dates.contractRocYear,
      contractYearKey: dates.contractYearKey,
      contractStartDate: dates.contractStartDate,
      contractEndDate: dates.contractEndDate,
      signedAt: nowTs(),
      signedAtText: todayKey(),
      profileStatus: 'submitted_pending_admin',
      status: 'submitted_pending_admin',
      updatedAt: nowTs()
    }, { merge: true });

    const completeBody = `外聘老師資料與契約簽署已完成 ✅\n\n柚子樂器已收到您的資料與簽名，目前等待管理端確認契約生效。\n\n合約年度：民國 ${dates.contractRocYear} 年\n契約期間：${dates.contractStartDate} 至 ${dates.contractEndDate}`;
    if (wantsLine(profile.bindingMethod) && profile.lineUserId) await pushLineMessage(profile.lineUserId, completeBody);
    if (wantsEmail(profile.bindingMethod) && profile.email) {
      await queueTeacherEmail({ teacherId, email: profile.email, title: `柚子樂器外聘老師 ${dates.contractRocYear} 年契約簽署完成`, body: `${completeBody}\n\n契約檔案：${contractHtmlFile.downloadUrl}`, source: 'external-teacher-contract-completed' });
    }
    if (clean(profile.payrollInfoStatus || 'pending') === 'pending' && profile.lineUserId) {
      await pushLineMessage(profile.lineUserId, `提醒您：您的薪資／匯款資料目前尚未補填。\n\n這不影響本次資料送出；待管理端確認後，為方便後續鐘點費結算，請之後點選連結補填銀行帳戶資料。\n\n${payrollUrl(teacherId, token || profile.onboardingToken)}`);
    }

    await pushAdminMessage(`外聘老師已送出契約，等待確認

姓名：${clean(profile.name || '')}
合約年度：民國 ${dates.contractRocYear} 年
契約期間：${dates.contractStartDate} 至 ${dates.contractEndDate}

請點選下方連結進入外聘老師合約確認，確認後契約才會生效：
${externalTeacherApprovalUrl(contractId)}`, {
      title: '外聘老師合約待確認',
      source: 'external-teacher-contract-submitted',
      contractId,
      approvalUrl: externalTeacherApprovalUrl(contractId)
    });

    return { ok: true, contractId, contractHtmlFile, contractHtmlUrl: contractHtmlFile.downloadUrl, ...dates };
  });

  exportsObj.externalTeacherSavePayroll = onCall({ region: REGION }, async (request) => {
    const data = request.data || {};
    const teacherId = clean(data.teacherId || data.userId || (request.auth && request.auth.uid) || '');
    const token = clean(data.token || '');
    await validateTeacherTokenIfNeeded(request, teacherId, token);
    if (!data.bankName || !data.bankAccountName || !data.bankAccountNumber) throw new HttpsError('invalid-argument', '請至少填寫銀行名稱、戶名與帳號');

    const { ref, profile } = await getExternalTeacherProfile(teacherId);
    if (!profile) throw new HttpsError('not-found', '找不到外聘老師資料');
    await ref.set({
      payrollInfoStatus: 'completed',
      paymentMethod: 'bank',
      bankName: clean(data.bankName || ''),
      bankBranch: clean(data.bankBranch || ''),
      bankAccountName: clean(data.bankAccountName || ''),
      bankAccountNumber: clean(data.bankAccountNumber || ''),
      payrollReminderPaused: true,
      updatedAt: nowTs()
    }, { merge: true });

    if (profile.lineUserId) await pushLineMessage(profile.lineUserId, '薪資／匯款資料已補填完成 ✅\n\n柚子樂器已收到您的銀行帳戶資料。');
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

    const templateId = clean(data.templateId || 'external_teacher_mandate_default');
    const templateRef = db().collection('externalTeacherContractTemplates').doc(templateId);
    await templateRef.set({
      title: clean(data.title || '外聘才藝教師委任契約書'),
      contractType: 'externalTeacherMandate',
      version: clean(data.version || String(currentGregorianYear())),
      status: 'active',
      updatedAt: nowTs(),
      createdAt: nowTs()
    }, { merge: true });

    const existing = await templateRef.collection('clauses').get();
    const batch = db().batch();
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

  exportsObj.externalTeacherListContracts = onCall({ region: REGION, timeoutSeconds: 60 }, async (request) => {
    const data = request.data || {};
    if (!(await isAdminRequest(request, data))) throw new HttpsError('permission-denied', '只有管理者可以查看外聘老師簽約紀錄');
    const targetRocYear = clean(data.rocYear || data.contractRocYear || '');
    let contractQuery = db().collection('externalTeacherContracts').orderBy('createdAt', 'desc').limit(300);
    if (targetRocYear) contractQuery = db().collection('externalTeacherContracts').where('contractYearKey', '==', String(targetRocYear)).limit(300);
    const contractSnap = await contractQuery.get();
    const contracts = contractSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => String(b.signedAtText || b.contractStartDate || '').localeCompare(String(a.signedAtText || a.contractStartDate || '')))
      .map((c) => ({
        id: c.id,
        contractId: c.contractId || c.id,
        teacherId: c.teacherId || '',
        teacherName: c.teacherName || '',
        contractTitle: c.contractTitle || '',
        contractRocYear: c.contractRocYear || '',
        contractYearKey: c.contractYearKey || '',
        contractStartDate: c.contractStartDate || '',
        contractEndDate: c.contractEndDate || '',
        status: c.status || '',
        signedAtText: c.signedAtText || '',
        contractHtmlUrl: c.contractHtmlUrl || (c.contractHtmlFile && c.contractHtmlFile.downloadUrl) || '',
        lineUserId: c.lineUserId || '',
        email: c.email || ''
      }));

    let profileQuery = db().collection('externalTeacherProfiles').limit(300);
    if (targetRocYear) profileQuery = db().collection('externalTeacherProfiles').where('contractYearKey', '==', String(targetRocYear)).limit(300);
    const profileSnap = await profileQuery.get();
    const profiles = profileSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).map((p) => ({
      id: p.id || p.teacherId || '',
      teacherId: p.teacherId || p.id || '',
      name: p.name || p.displayName || '',
      mobile: p.mobile || p.phone || '',
      email: p.email || '',
      bindingMethod: p.bindingMethod || '',
      lineBindStatus: p.lineBindStatus || '',
      emailBindStatus: p.emailBindStatus || '',
      contractRocYear: p.contractRocYear || '',
      contractYearKey: p.contractYearKey || '',
      contractStatus: p.contractStatus || '',
      status: p.status || '',
      currentContractId: p.currentContractId || '',
      onboardingUrl: p.onboardingUrl || onboardingUrl(p.teacherId || p.id, p.onboardingToken || '')
    }));

    return { ok: true, contracts, profiles, availableContractYears: availableContractYears() };
  });

  exportsObj.externalTeacherAnnualRenewalReminderEveryDay = onSchedule({
    region: REGION,
    schedule: '0 10 * * *',
    timeZone: 'Asia/Taipei',
    timeoutSeconds: 300,
    memory: '512MiB'
  }, async () => {
    const today = taipeiYmd();
    const targetYear = renewalTargetYearForYmd(today);
    const openDate = renewalOpenDateForTargetYear(targetYear);
    if (daysBetweenYmd(openDate, today) < 0) {
      logger.info('externalTeacherAnnualRenewalReminderEveryDay not open yet', { today, targetYear, openDate });
      return { sent: 0, skipped: 0, targetYear, today };
    }

    const snap = await db().collection('externalTeacherProfiles').limit(500).get();
    let sent = 0;
    let skipped = 0;
    for (const doc of snap.docs) {
      const profile = { id: doc.id, teacherId: doc.id, ...(doc.data() || {}) };
      try {
        if (profile.isRenewalContractDraft === true || clean(profile.baseTeacherProfileId)) { skipped++; continue; }
        const employee = await getLinkedEmployee(profile);
        if (isInactiveExternalTeacher(profile, employee)) { skipped++; continue; }
        if (await hasSignedContractForYear(doc.id, profile, targetYear)) { skipped++; continue; }
        if (!shouldSendRenewalReminder(profile, targetYear, today)) { skipped++; continue; }
        const link = await ensureRenewalContractDraft(doc.id, profile, targetYear);
        await markRenewalOverdueIfNeeded({ contractId: link.contractId, profileId: doc.id, employeeId: clean(profile.employeeId || profile.externalTeacherEmployeeId || ''), targetYear, today });
        const channels = await queueExternalTeacherRenewalNotice({ profileId: doc.id, profile, targetYear, link });
        if (!channels.length) { skipped++; continue; }
        const state = (profile.renewalReminderState && profile.renewalReminderState[String(targetYear)]) || {};
        const count = Number(state.count || 0) || 0;
        await doc.ref.set({
          renewalReminderState: {
            [String(targetYear)]: {
              count: count + 1,
              lastReminderDate: today,
              lastReminderAt: nowTs(),
              lastReminderChannels: channels,
              renewalContractId: link.contractId,
              updatedAt: nowTs()
            }
          },
          lastRenewalReminderAt: nowTs(),
          lastRenewalReminderDate: today,
          updatedAt: nowTs()
        }, { merge: true });
        sent++;
      } catch (err) {
        skipped++;
        logger.warn('externalTeacherAnnualRenewalReminder profile skipped by error', { teacherId: doc.id, error: err && err.message ? err.message : String(err) });
      }
    }
    logger.info('externalTeacherAnnualRenewalReminderEveryDay completed', { sent, skipped, targetYear, today });
    return { sent, skipped, targetYear, today };
  });

  exportsObj.externalTeacherPayrollReminderEveryDay = onSchedule({
    region: REGION,
    schedule: '0 10 * * *',
    timeZone: 'Asia/Taipei',
    timeoutSeconds: 180,
    memory: '512MiB'
  }, async () => {
    const snap = await db().collection('externalTeacherProfiles')
      .where('status', '==', 'active')
      .where('payrollInfoStatus', '==', 'pending')
      .get();

    const now = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    let sent = 0;
    for (const doc of snap.docs) {
      const profile = doc.data() || {};
      if (profile.payrollReminderPaused === true) continue;
      const lineUserId = clean(profile.lineUserId || '');
      if (!lineUserId) continue;
      const last = profile.lastPayrollReminderAt && profile.lastPayrollReminderAt.toMillis ? profile.lastPayrollReminderAt.toMillis() : 0;
      if (last && now - last < threeDaysMs) continue;
      const msg = `柚子樂器提醒您：\n\n您的外聘教師薪資／匯款資料尚未補填。\n為了方便後續鐘點費結算，請點選下方連結補填銀行帳戶資料。\n\n補填連結：\n${payrollUrl(doc.id, profile.onboardingToken || '')}`;
      await pushLineMessage(lineUserId, msg);
      await doc.ref.set({ lastPayrollReminderAt: nowTs(), payrollReminderCount: Number(profile.payrollReminderCount || 0) + 1, updatedAt: nowTs() }, { merge: true });
      await db().collection('notificationQueue').add({
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
