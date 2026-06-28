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

function lineUserIdFromRow(data = {}) {
  return clean(data.lineUserId || data['LINE User ID'] || data.targetLineUserId || data.lineId || '');
}

async function getPrimaryManagerLineRecipient() {
  const primary = await db().collection('employees').doc('PRIMARY_MANAGER_LINE').get();
  if (primary.exists) {
    const data = primary.data() || {};
    const lineUserId = lineUserIdFromRow(data);
    if (lineUserId) return { lineUserId, name: clean(data.name || data.displayName || '柚子樂器主要管理者') };
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

  await db().collection('notificationQueue').add({
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
  ['第一條', '委任職務', '甲方委任乙方擔任 {{teachingItems}} 課程之外聘才藝教師，乙方同意受任並依本契約約定執行相關教學事務。'],
  ['第二條', '委任期間', '本契約委任期間自 {{contractStartDate}} 起至 {{contractEndDate}} 止。委任期間屆滿後，除雙方另以書面、電子文件或系統紀錄續約外，本契約當然終止。甲方得自每年十二月十五日起，開放下一年度契約簽署作業。'],
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

function contractHtml(contractText, signatureUrl) {
  const escaped = String(contractText || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const signature = signatureUrl ? `\n\n乙方簽名：\n<img src="${signatureUrl}" style="max-width:320px;border:1px solid #ccc;padding:8px;background:#fff">` : '';
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>外聘才藝教師委任契約書</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Noto Sans TC','Microsoft JhengHei',sans-serif;line-height:1.85;padding:32px;white-space:pre-wrap;color:#111">${escaped}${signature}</body></html>`;
}

async function saveContractHtml({ teacherId, contractRocYear, contractId, contractText, signatureUrl }) {
  const token = crypto.randomUUID();
  const storagePath = `external-teachers/${teacherId}/${contractRocYear}/contracts/${contractId}.html`;
  const file = bucket().file(storagePath);
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
    downloadUrl: `https://firebasestorage.googleapis.com/v0/b/${bucket().name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`,
    mimeType: 'text/html'
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

  const bindingRef = db().collection('externalTeacherLineBindings').doc(bindCode);
  const bindingSnap = await bindingRef.get();
  if (!bindingSnap.exists) {
    await replyLineMessage(replyToken, '查不到這組外聘老師綁定碼。\n\n請確認文字是否完整，例如：\n外聘老師綁定 EXT-123456');
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

  await db().runTransaction(async (tx) => {
    tx.set(bindingRef, { status: 'bound', lineUserId, lineDisplayName, boundAt: nowTs(), updatedAt: nowTs() }, { merge: true });
    tx.set(ref, {
      lineUserId,
      lineNotifyEnabled: true,
      lineBindStatus: 'bound',
      lineDisplayName,
      lineBoundAt: nowTs(),
      bindCode,
      onboardingToken: token || profile.onboardingToken || '',
      status: profile.status === 'pendingLine' ? 'pendingProfile' : (profile.status || 'pendingProfile'),
      updatedAt: nowTs()
    }, { merge: true });
  });

  await replyLineMessage(replyToken, `外聘老師 LINE 綁定完成 ✅\n\n您好 ${teacherName}，系統已完成您的 LINE 綁定。\n\n請回到外聘老師資料填寫頁，繼續完成基本資料、身分證明文件與契約簽署。\n\n${onboardingUrl(teacherId, token || profile.onboardingToken)}`);
  await pushAdminMessage(`外聘老師 LINE 綁定完成\n\n姓名：${teacherName}\n狀態：待填資料`);
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

    const teacherId = clean(data.teacherId || data.userId || (request.auth && request.auth.uid) || db().collection('externalTeacherProfiles').doc().id);
    const token = makeToken();
    const bindCode = wantsLine(bindingMethod) ? makeBindCode() : '';
    const url = onboardingUrl(teacherId, token);
    const bindText = bindCode ? `外聘老師綁定 ${bindCode}` : '';

    const profileRow = {
      teacherId,
      id: teacherId,
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

    const contractHtmlFile = await saveContractHtml({ teacherId, contractRocYear: dates.contractRocYear, contractId, contractText, signatureUrl: signatureFile.downloadUrl });
    await recordExternalTeacherFile({ teacherId, contractId, contractRocYear: dates.contractRocYear, contractYearKey: dates.contractYearKey, fileType: 'signedContractHtml', ...contractHtmlFile });

    const contractDoc = {
      contractId,
      teacherId,
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
      status: 'active',
      signedAt: nowTs(),
      signedAtText: todayKey(),
      createdAt: nowTs(),
      updatedAt: nowTs()
    };

    await db().collection('externalTeacherContracts').doc(contractId).set(contractDoc);
    await ref.set({
      contractStatus: 'signed',
      currentContractId: contractId,
      currentContractRocYear: dates.contractRocYear,
      contractGregorianYear: dates.contractGregorianYear,
      contractRocYear: dates.contractRocYear,
      contractYearKey: dates.contractYearKey,
      contractStartDate: dates.contractStartDate,
      contractEndDate: dates.contractEndDate,
      signedAt: nowTs(),
      signedAtText: todayKey(),
      profileStatus: 'active',
      status: 'active',
      updatedAt: nowTs()
    }, { merge: true });

    const completeBody = `外聘老師資料與契約簽署已完成 ✅\n\n柚子樂器已收到您的資料與簽名。\n\n合約年度：民國 ${dates.contractRocYear} 年\n契約期間：${dates.contractStartDate} 至 ${dates.contractEndDate}`;
    if (wantsLine(profile.bindingMethod) && profile.lineUserId) await pushLineMessage(profile.lineUserId, completeBody);
    if (wantsEmail(profile.bindingMethod) && profile.email) {
      await queueTeacherEmail({ teacherId, email: profile.email, title: `柚子樂器外聘老師 ${dates.contractRocYear} 年契約簽署完成`, body: `${completeBody}\n\n契約檔案：${contractHtmlFile.downloadUrl}`, source: 'external-teacher-contract-completed' });
    }
    if (clean(profile.payrollInfoStatus || 'pending') === 'pending' && profile.lineUserId) {
      await pushLineMessage(profile.lineUserId, `提醒您：您的薪資／匯款資料目前尚未補填。\n\n這不影響本次契約簽署完成，但為方便後續鐘點費結算，請之後點選連結補填銀行帳戶資料。\n\n${payrollUrl(teacherId, token || profile.onboardingToken)}`);
    }

    await pushAdminMessage(`外聘老師簽約完成\n\n姓名：${clean(profile.name || '')}\n合約年度：民國 ${dates.contractRocYear} 年\n契約期間：${dates.contractStartDate} 至 ${dates.contractEndDate}\n\n管理端：${contractAdminUrl()}`);

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
