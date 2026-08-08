'use strict';

const crypto = require('crypto');
const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const REGION = 'us-central1';
const VERSION = 'external-teacher-work-v2';
const SOURCE = 'firestore-canonical-external-teacher-work';
const ALL_EXTERNAL = '__ALL_EXTERNAL__';
const COLLECTIONS = Object.freeze({
  announcements: 'externalTeacherAnnouncementsV2',
  announcementViews: 'externalTeacherAnnouncementViewsV2',
  tasks: 'externalTeacherTasksV2',
  taskResponses: 'externalTeacherTaskResponsesV2'
});
const MANAGER_ROLES = new Set(['admin', 'manager', 'owner', '主管', '管理者']);
const BOOTSTRAP_MANAGER_EMAILS = new Set(['danny700808@gmail.com']);
const ARCHIVED = new Set(['archived', 'deleted', 'inactive', 'disabled', 'cancelled', 'canceled', '已封存', '已刪除', '停用', '已停用', '作廢']);
const PROFILE_IN_PROGRESS = new Set(['profile_draft', 'pending_profile', 'waiting_profile', 'pending_review', 'needs_revision', 'pending', '資料填寫中', '待管理者確認']);
const ACTIVE_BINDING = new Set(['active', 'enabled', 'approved', 'bound', 'linked', '啟用', '已綁定', '使用中']);

const clean = (value) => String(value == null ? '' : value).trim();
const lower = (value) => clean(value).toLowerCase();
const unique = (values) => [...new Set((values || []).map(clean).filter(Boolean))];
const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');

function bool(value) {
  return value === true || ['true', '1', 'yes', '是', 'enabled', 'active', 'published', '已發布'].includes(lower(value));
}

function managerAllowed(request) {
  const token = request && request.auth && request.auth.token || {};
  const role = lower(token.role || token.userRole || token.permissionRole);
  return token.admin === true || token.manager === true || token.owner === true || MANAGER_ROLES.has(role) ||
    BOOTSTRAP_MANAGER_EMAILS.has(lower(token.email));
}

function assertManager(request) {
  if (!managerAllowed(request)) throw new HttpsError('permission-denied', '請先使用管理者帳號登入。');
}

function actor(request) {
  const auth = request && request.auth || {};
  const token = auth.token || {};
  return {
    employeeId: clean(token.employeeId || auth.uid),
    name: clean(token.name || token.email || '管理者'),
    email: lower(token.email)
  };
}

function asMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value) {
  const millis = asMillis(value);
  return millis ? new Date(millis).toISOString() : clean(value);
}

function dateKey(value) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function safeId(value) {
  return clean(value).replace(/[\/#?\[\]]/g, '_').slice(0, 180);
}

function generatedId(prefix) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date()).replace(/-/g, '');
  return `${prefix}_${day}_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function canonicalWorkRow(row) {
  const source = row || {};
  return clean(source.systemVersion) === VERSION || clean(source.source) === SOURCE;
}

function archived(row) {
  const source = row || {};
  const status = lower(source.status || source.publishStatus || source.taskStatus);
  return source.archived === true || source.deleted === true || source.active === false || ARCHIVED.has(status);
}

function array(value) {
  if (Array.isArray(value)) return unique(value);
  return unique(clean(value).split(/[,\s、，]+/u));
}

function sanitizeAssets(value) {
  return (Array.isArray(value) ? value : []).slice(0, 30).map((item) => {
    const row = item || {};
    const url = clean(row.url || row.secure_url);
    if (!/^https:\/\//i.test(url)) return null;
    return {
      url,
      name: clean(row.name || row.originalFilename || row.original_filename || '查看附件').slice(0, 180),
      publicId: clean(row.publicId || row.public_id).slice(0, 300),
      resourceType: clean(row.resourceType || row.resource_type).slice(0, 40),
      format: clean(row.format).slice(0, 30),
      bytes: Math.max(0, Number(row.bytes || 0) || 0),
      storageProvider: 'cloudinary-new'
    };
  }).filter(Boolean);
}

function announcementAudience(value) {
  const allowed = new Set(['all', 'staff', 'parttime', 'external']);
  const values = array(value).map(lower).filter((entry) => allowed.has(entry));
  return values.length ? unique(values) : ['external'];
}

function audienceLabel(values) {
  const labels = { all: '全部對象', staff: '專職員工', parttime: '工讀生', external: '外聘老師' };
  return array(values).map((value) => labels[lower(value)] || value).join('、');
}

function externalEmployee(row) {
  const source = row || {};
  const identity = lower(source.identityType || source.employeeType || source.identityLabel || source.roleLabel || source.role);
  return source.isExternalTeacher === true || identity.includes('external') || identity.includes('外聘');
}

function inactiveEmployee(row) {
  const source = row || {};
  if (source.hiddenFromActiveLists === true || clean(source.mergedIntoEmployeeId) || source.coursePortalTeacherCanonicalReplaced === true) return true;
  const statuses = [source.accountStatus, source.employmentStatus, source.personLifecycleStatus, source.status]
    .map(lower).filter(Boolean);
  // Course Portal drafts are canonical people even though active is still false.
  if (statuses.some((status) => PROFILE_IN_PROGRESS.has(status))) return false;
  if (source.active === false) return true;
  return statuses.some((status) => ARCHIVED.has(status) || /archived|inactive|disabled|resigned|terminated|合作結束|離職|封存|停用/.test(status));
}

function employeeIdOf(row, fallback) {
  return clean(row && (row.employeeId || row.id || row.userId) || fallback);
}

function employeeStatusLabel(row) {
  const status = lower(row && (row.personLifecycleStatus || row.profileReviewStatus || row.accountStatus || row.employmentStatus || row.status));
  if (status === 'profile_draft' || status === 'needs_revision') return '資料填寫中';
  if (status === 'pending_review' || status === 'pending') return '待管理者確認';
  if (!clean(row && (row.name || row.displayName || row.employeeName))) return '資料未齊全';
  return '合作中';
}

function employeeScore(row, docId) {
  let score = 0;
  if (employeeIdOf(row, docId) === clean(docId)) score += 5;
  if (row && row.coursePortalTeacherCanonical === true) score += 4;
  if (clean(row && row.coursePortalTeacherId)) score += 3;
  if (clean(row && (row.name || row.displayName))) score += 2;
  if (clean(row && row.email)) score += 1;
  return score;
}

async function eligibleExternalEmployees() {
  const snapshot = await db.collection('employees').limit(1200).get();
  const selected = new Map();
  snapshot.docs.forEach((doc) => {
    const row = Object.assign({ __id: doc.id }, doc.data() || {});
    const employeeId = employeeIdOf(row, doc.id);
    if (!employeeId || !externalEmployee(row) || inactiveEmployee(row)) return;
    const previous = selected.get(employeeId);
    if (!previous || employeeScore(row, doc.id) > employeeScore(previous, previous.__id)) selected.set(employeeId, row);
  });
  return [...selected.entries()].map(([employeeId, row]) => ({
    id: employeeId,
    employeeId,
    name: clean(row.name || row.displayName || row.employeeName || '資料未齊全'),
    email: lower(row.email || row.Email || row.loginEmail),
    coursePortalTeacherId: clean(row.coursePortalTeacherId || row.legacyTeacherId),
    status: clean(row.personLifecycleStatus || row.accountStatus || row.employmentStatus || 'active'),
    statusLabel: employeeStatusLabel(row),
    raw: row
  })).sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'));
}

function canonicalEmployeeBinding(row) {
  const source = row || {};
  const targetCollection = lower(source.targetCollection);
  const legacyExternal = targetCollection.includes('externalteacher') ||
    clean(source.externalTeacherContractId || source.externalTeacherId || source.externalTeacherEmployeeId) ||
    /^external-teacher/i.test(clean(source.source));
  return !legacyExternal && (!targetCollection || targetCollection === 'employees') &&
    ACTIVE_BINDING.has(lower(source.status || source.lineBindStatus || 'bound'));
}

async function activeTeacherLineBindings() {
  const [portalSnapshot, employeeSnapshot] = await Promise.all([
    db.collection('coursePortalTeacherBindings').where('status', '==', 'active').limit(1200).get(),
    db.collection('employeeLineBindings').limit(1200).get()
  ]);
  const byIdentity = new Map();
  employeeSnapshot.docs.forEach((doc) => {
    const row = doc.data() || {};
    if (!canonicalEmployeeBinding(row)) return;
    const employeeId = clean(row.employeeId || row.employeeDocId || row.targetEmployeeId);
    const lineUserId = clean(row.lineUserId);
    if (employeeId && lineUserId && !byIdentity.has(employeeId)) {
      byIdentity.set(employeeId, { lineUserId, source: 'employeeLineBindings:employees' });
    }
  });
  // The current Course Portal login binding wins over any older personnel bind.
  portalSnapshot.docs.forEach((doc) => {
    const row = doc.data() || {};
    const teacherId = clean(row.teacherId || row.targetId);
    const lineUserId = clean(row.lineUserId);
    const employeeId = clean(row.employeeId || row.personMasterId || row.canonicalEmployeeId);
    if (teacherId && lineUserId) byIdentity.set(teacherId, { lineUserId, source: 'coursePortalTeacherBindings' });
    if (employeeId && lineUserId) byIdentity.set(employeeId, { lineUserId, source: 'coursePortalTeacherBindings' });
  });
  return byIdentity;
}

async function notificationRecipients(employeeIds) {
  const wanted = new Set((employeeIds || []).map(clean).filter(Boolean));
  const [employees, bindings] = await Promise.all([eligibleExternalEmployees(), activeTeacherLineBindings()]);
  return employees.filter((row) => !wanted.size || wanted.has(row.employeeId)).map((row) => {
    const binding = bindings.get(row.coursePortalTeacherId) || bindings.get(row.employeeId) || {};
    return {
      employeeId: row.employeeId,
      name: row.name,
      email: row.email,
      lineUserId: clean(binding.lineUserId),
      lineBindingSource: clean(binding.source)
    };
  });
}

function publicBaseUrl() {
  return clean(process.env.PUBLIC_WEB_BASE_URL || 'https://danny700808.github.io/play-card/').replace(/\/?$/, '/');
}

async function writeBatches(rows) {
  for (let offset = 0; offset < rows.length; offset += 400) {
    const batch = db.batch();
    rows.slice(offset, offset + 400).forEach(({ ref, data }) => batch.set(ref, data, { merge: true }));
    await batch.commit();
  }
}

async function queuePublishedNotice(kind, row, employeeIds) {
  const recipients = await notificationRecipients(employeeIds);
  const title = kind === 'announcement' ? '外聘老師新公告' : '外聘老師協助事項';
  const body = [clean(row.title), clean(row.summary || row.content).slice(0, 260), '', `前往老師課務：${publicBaseUrl()}teacher-course-portal.html`]
    .filter((value, index) => value || index === 2).join('\n');
  const writes = [];
  recipients.forEach((recipient) => {
    if (row.sendLine === true && recipient.lineUserId) {
      const id = `ext-work-${hash(`${kind}|${row.id}|${row.revision}|${recipient.employeeId}|line`).slice(0, 40)}`;
      writes.push({
        ref: db.collection('notificationQueue').doc(id),
        data: {
          queueId: id, channel: 'line', eventCode: `${kind}.published`, targetRole: 'externalTeacher',
          targetEmployeeId: recipient.employeeId, targetName: recipient.name, targetLineUserId: recipient.lineUserId,
          title, body, message: body, status: '待發送', source: VERSION,
          sourceCollection: kind === 'announcement' ? COLLECTIONS.announcements : COLLECTIONS.tasks,
          sourceId: row.id, lineBindingSource: recipient.lineBindingSource, createdAt: FieldValue.serverTimestamp()
        }
      });
    }
    if (row.sendEmail === true && recipient.email) {
      const id = `ext-work-${hash(`${kind}|${row.id}|${row.revision}|${recipient.employeeId}|email`).slice(0, 40)}`;
      writes.push({
        ref: db.collection('notificationQueue').doc(id),
        data: {
          queueId: id, channel: 'email', eventCode: `${kind}.published`, targetRole: 'externalTeacher',
          targetEmployeeId: recipient.employeeId, targetName: recipient.name, targetEmail: recipient.email,
          title, subject: title, body, message: body, status: '待發送', source: VERSION,
          sourceCollection: kind === 'announcement' ? COLLECTIONS.announcements : COLLECTIONS.tasks, sourceId: row.id,
          createdAt: FieldValue.serverTimestamp()
        }
      });
    }
  });
  await writeBatches(writes);
  return { recipients: recipients.length, queued: writes.length };
}

function announcementJson(id, row, view, replyCount) {
  const source = row || {};
  const response = view || {};
  return {
    id,
    announcementId: id,
    title: clean(source.title),
    category: ['重要公告', '一般公告'].includes(clean(source.category)) ? clean(source.category) : '一般公告',
    summary: clean(source.summary),
    content: clean(source.content),
    publishDate: dateKey(source.publishDate),
    audience: announcementAudience(source.audience),
    audienceLabel: audienceLabel(source.audience),
    pinned: source.pinned === true,
    published: source.published === true && !archived(source),
    sendEmail: source.sendEmail === true,
    sendLine: source.sendLine === true,
    requireReply: source.requireReply === true,
    replyDeadline: dateKey(source.replyDeadline),
    imageAssets: sanitizeAssets(source.imageAssets),
    videoAssets: sanitizeAssets(source.videoAssets),
    audioAssets: sanitizeAssets(source.audioAssets),
    fileAssets: sanitizeAssets(source.fileAssets),
    revision: Number(source.revision || 1),
    isRead: Boolean(response.readAt || response.read === true),
    myReply: clean(response.replyText) ? { replyText: clean(response.replyText), createdAt: iso(response.repliedAt) } : null,
    replyCount: Number(replyCount || 0),
    createdAt: iso(source.createdAt),
    updatedAt: iso(source.updatedAt),
    systemVersion: VERSION
  };
}

async function managerAnnouncementList() {
  const snapshot = await db.collection(COLLECTIONS.announcements).limit(500).get();
  const docs = snapshot.docs.filter((doc) => canonicalWorkRow(doc.data()) && !archived(doc.data()));
  const repliesByAnnouncement = new Map();
  for (let offset = 0; offset < docs.length; offset += 10) {
    const ids = docs.slice(offset, offset + 10).map((doc) => doc.id);
    if (!ids.length) continue;
    const replies = await db.collection(COLLECTIONS.announcementViews).where('announcementId', 'in', ids).get();
    replies.docs.forEach((doc) => {
      const row = doc.data() || {};
      if (!clean(row.replyText)) return;
      const announcementId = clean(row.announcementId);
      if (!repliesByAnnouncement.has(announcementId)) repliesByAnnouncement.set(announcementId, []);
      repliesByAnnouncement.get(announcementId).push({
        id: doc.id,
        employeeId: clean(row.employeeId),
        teacherId: clean(row.teacherId),
        name: clean(row.name || '外聘老師'),
        roleLabel: '外聘老師',
        replyText: clean(row.replyText),
        createdAt: iso(row.repliedAt || row.updatedAt)
      });
    });
  }
  return docs.map((doc) => {
    const replies = (repliesByAnnouncement.get(doc.id) || [])
      .sort((left, right) => asMillis(right.createdAt) - asMillis(left.createdAt));
    return Object.assign(announcementJson(doc.id, doc.data(), null, replies.length), { replies });
  })
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || asMillis(right.updatedAt || right.createdAt) - asMillis(left.updatedAt || left.createdAt));
}

async function saveAnnouncement(data, request) {
  assertManager(request);
  const title = clean(data.title).slice(0, 160);
  const content = clean(data.content).slice(0, 20000);
  const summary = clean(data.summary).slice(0, 1000);
  if (!title) throw new HttpsError('invalid-argument', '請輸入公告標題。');
  if (!content && !summary) throw new HttpsError('invalid-argument', '請輸入公告摘要或內文。');
  const id = safeId(data.announcementId || data.id) || generatedId('ANN');
  const ref = db.collection(COLLECTIONS.announcements).doc(id);
  const actorRow = actor(request);
  let saved;
  let shouldNotify = false;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.exists ? snapshot.data() || {} : {};
    if (snapshot.exists && !canonicalWorkRow(previous)) throw new HttpsError('failed-precondition', '這是封存的舊版公告，不能直接覆蓋；請建立新版公告。');
    if (snapshot.exists && archived(previous)) throw new HttpsError('failed-precondition', '這則公告已封存，不能用原編號重新覆蓋；請建立新公告。');
    const revision = Number(previous.revision || 0) + 1;
    saved = {
      id, announcementId: id, systemVersion: VERSION, source: SOURCE, legacyImport: false,
      title, category: clean(data.category) === '重要公告' ? '重要公告' : '一般公告', summary, content,
      // This callable is dedicated to the external-teacher centre. Never trust a
      // client-side checkbox to keep a notice inside that audience boundary.
      publishDate: dateKey(data.publishDate), audience: ['external'],
      pinned: data.pinned === true, published: data.published !== false,
      status: data.published === false ? 'unpublished' : 'published',
      sendEmail: data.sendEmail === true, sendLine: data.sendLine === true,
      requireReply: data.requireReply === true, replyDeadline: data.requireReply === true ? dateKey(data.replyDeadline) : '',
      imageAssets: sanitizeAssets(data.imageAssets), videoAssets: sanitizeAssets(data.videoAssets),
      audioAssets: sanitizeAssets(data.audioAssets), fileAssets: sanitizeAssets(data.fileAssets),
      revision, updatedAt: FieldValue.serverTimestamp(), updatedByEmployeeId: actorRow.employeeId,
      updatedByName: actorRow.name, updatedByEmail: actorRow.email,
      createdAt: previous.createdAt || FieldValue.serverTimestamp(), createdByEmployeeId: clean(previous.createdByEmployeeId || actorRow.employeeId)
    };
    shouldNotify = saved.published && (!snapshot.exists || previous.published !== true || data.notifyNow === true);
    transaction.set(ref, saved, { merge: false });
  });
  let notification = { recipients: 0, queued: 0 };
  if (shouldNotify) notification = await queuePublishedNotice('announcement', saved, []).catch((error) => ({ recipients: 0, queued: 0, warning: clean(error.message) }));
  return { ok: true, id, announcementId: id, message: '公告已儲存。', notification };
}

async function toggleAnnouncement(data, request) {
  assertManager(request);
  const id = safeId(data.announcementId || data.id);
  if (!id) throw new HttpsError('invalid-argument', '缺少公告編號。');
  const ref = db.collection(COLLECTIONS.announcements).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists || !canonicalWorkRow(snapshot.data()) || archived(snapshot.data())) throw new HttpsError('not-found', '找不到這則可操作的新版公告。');
  const previous = snapshot.data() || {};
  const published = data.published === true;
  const revision = Number(previous.revision || 0) + 1;
  const next = Object.assign({}, previous, { id, announcementId: id, published, status: published ? 'published' : 'unpublished', revision });
  await ref.set({ published, status: next.status, revision, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  let notification = { recipients: 0, queued: 0 };
  if (published && previous.published !== true) {
    notification = await queuePublishedNotice('announcement', next, []).catch((error) => ({ recipients: 0, queued: 0, warning: clean(error.message) }));
  }
  return { ok: true, id, message: published ? '公告已重新發布。' : '公告已下架。', notification };
}

async function archiveAnnouncement(data, request) {
  assertManager(request);
  const id = safeId(data.announcementId || data.id);
  if (!id) throw new HttpsError('invalid-argument', '缺少公告編號。');
  const ref = db.collection(COLLECTIONS.announcements).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists || !canonicalWorkRow(snapshot.data())) throw new HttpsError('not-found', '找不到這則新版公告。');
  await ref.set({ archived: true, published: false, status: 'archived', archivedAt: FieldValue.serverTimestamp(), archivedBy: actor(request), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, id, message: '公告已封存；附件與歷史仍保留。' };
}

function identityFromResolved(resolved, session) {
  const user = resolved && resolved.user || {};
  return {
    employeeId: clean(resolved && resolved.employeeId || user.employeeId || user.id),
    teacherId: clean(session && session.teacherId || user.coursePortalTeacherId || user.legacyTeacherId),
    email: lower(user.email),
    external: true,
    name: clean(user.name || '外聘老師')
  };
}

async function callerIdentity(data, request, helpers) {
  if (managerAllowed(request)) return Object.assign({ manager: true, external: false }, actor(request));
  const token = request && request.auth && request.auth.token || {};
  if (request && request.auth && token.employee === true && clean(token.employeeId)) {
    return { manager: false, employeeId: clean(token.employeeId), teacherId: '', email: lower(token.email), external: lower(token.identityType) === 'external', name: clean(token.name) };
  }
  if (clean(data && data.sessionToken) && typeof helpers.requireTeacherSession === 'function' && typeof helpers.resolveTeacherEmployee === 'function') {
    const session = await helpers.requireTeacherSession(data, ['teacher']);
    const resolved = await helpers.resolveTeacherEmployee(session);
    return Object.assign({ manager: false }, identityFromResolved(resolved, session));
  }
  throw new HttpsError('unauthenticated', '登入狀態已失效，請重新登入。');
}

function announcementMatchesIdentity(row, identity) {
  const audience = announcementAudience(row && row.audience);
  if (audience.includes('all')) return true;
  if (identity.external && audience.includes('external')) return true;
  const targetIds = array(row && (row.targetEmployeeIds || row.employeeIds));
  return targetIds.includes(clean(identity.employeeId)) || targetIds.includes(clean(identity.teacherId));
}

async function teacherAnnouncementList(data, identity) {
  const snapshot = await db.collection(COLLECTIONS.announcements).limit(500).get();
  const docs = snapshot.docs.filter((doc) => {
    const row = doc.data() || {};
    return canonicalWorkRow(row) && !archived(row) && row.published === true && announcementMatchesIdentity(row, identity);
  });
  const viewMap = new Map();
  if (identity.employeeId) {
    const views = await db.collection(COLLECTIONS.announcementViews).where('employeeId', '==', identity.employeeId).limit(500).get();
    views.docs.forEach((doc) => {
      const row = doc.data() || {};
      viewMap.set(clean(row.announcementId), row);
    });
  }
  let rows = docs.map((doc) => announcementJson(doc.id, doc.data(), viewMap.get(doc.id), 0));
  const history = bool(data.historyMode) || clean(data.historyMode) === '是';
  rows = rows.filter((row) => history
    ? row.isRead && (!row.requireReply || Boolean(row.myReply))
    : !row.isRead || (row.requireReply && !row.myReply));
  const start = dateKey(data.startDate || data.historyStart);
  const end = dateKey(data.endDate || data.historyEnd);
  if (history && start) rows = rows.filter((row) => row.publishDate >= start);
  if (history && end) rows = rows.filter((row) => row.publishDate <= end);
  rows.sort((left, right) => Number(right.pinned) - Number(left.pinned) || clean(right.publishDate).localeCompare(clean(left.publishDate)) || asMillis(right.updatedAt) - asMillis(left.updatedAt));

  if (!history && identity.employeeId && rows.length) {
    const writes = rows.map((row) => ({
      ref: db.collection(COLLECTIONS.announcementViews).doc(safeId(`${row.id}__${identity.employeeId}`)),
      data: { announcementId: row.id, employeeId: identity.employeeId, teacherId: identity.teacherId, read: true, readAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), source: VERSION }
    }));
    await writeBatches(writes);
  }
  return rows;
}

async function submitAnnouncementReply(data, identity) {
  const announcementId = safeId(data.announcementId || data.id);
  const replyText = clean(data.replyText).slice(0, 5000);
  if (!announcementId || !identity.employeeId || !replyText) throw new HttpsError('invalid-argument', '回覆資料不完整。');
  const snapshot = await db.collection(COLLECTIONS.announcements).doc(announcementId).get();
  const row = snapshot.exists ? snapshot.data() || {} : null;
  if (!row || !canonicalWorkRow(row) || archived(row) || row.published !== true || !announcementMatchesIdentity(row, identity)) throw new HttpsError('permission-denied', '這則公告目前無法回覆。');
  if (row.requireReply !== true) throw new HttpsError('failed-precondition', '這則公告不需要回覆。');
  const id = safeId(`${announcementId}__${identity.employeeId}`);
  await db.collection(COLLECTIONS.announcementViews).doc(id).set({
    announcementId, employeeId: identity.employeeId, teacherId: identity.teacherId, name: identity.name,
    read: true, readAt: FieldValue.serverTimestamp(), replyText, repliedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), source: VERSION
  }, { merge: true });
  return { ok: true, message: '已送出回覆。' };
}

function normalizeTaskStatus(value) {
  const status = lower(value);
  if (['completed', 'complete', 'done', '已完成', '完成'].includes(status)) return '已完成';
  if (['redo', 'returned', '退回重做', '退回'].includes(status)) return '退回重做';
  if (['archived', 'deleted', '已封存', '已刪除'].includes(status)) return '已封存';
  return '待處理';
}

function taskMatchesIdentity(row, identity) {
  const source = row || {};
  if (clean(source.assigneeMode) === 'all_external') {
    if (identity.external !== true) return false;
    // New all-external tasks take an immutable recipient snapshot when they are
    // created. This prevents a teacher added later from receiving old work and
    // keeps target/completion counts consistent.
    const snapshotIds = array(source.assigneeIds);
    if (!snapshotIds.length) return true;
    return snapshotIds.includes(clean(identity.employeeId)) || snapshotIds.includes(clean(identity.teacherId));
  }
  const ids = unique([source.assigneeId, source.employeeId, source.teacherId, ...(Array.isArray(source.assigneeIds) ? source.assigneeIds : [])]);
  return ids.includes(clean(identity.employeeId)) || ids.includes(clean(identity.teacherId));
}

function attachmentBundle(source, prefix) {
  const row = source || {};
  if (prefix === 'reply') {
    return {
      images: sanitizeAssets(row.photoAssets || row.replyImageAssets), videos: sanitizeAssets(row.videoAssets || row.replyVideoAssets),
      audios: sanitizeAssets(row.audioAssets || row.replyAudioAssets), files: sanitizeAssets(row.fileAssets || row.replyFileAssets)
    };
  }
  return {
    images: sanitizeAssets(row.taskImageAssets || row.imageAssets), videos: sanitizeAssets(row.taskVideoAssets || row.videoAssets),
    audios: sanitizeAssets(row.taskAudioAssets || row.audioAssets), files: sanitizeAssets(row.taskFileAssets || row.fileAssets)
  };
}

function taskJson(id, row, response, aggregate) {
  const source = row || {};
  const reply = response || {};
  const summary = aggregate || {};
  const targetCount = Number(summary.targetCount || source.targetCount || (clean(source.assigneeMode) === 'all_external' ? array(source.assigneeIds).length : 1)) || 0;
  const completedCount = Number(summary.completedCount || 0);
  const responses = (Array.isArray(summary.responses) ? summary.responses : []).map((item) => ({
    id: clean(item.id),
    employeeId: clean(item.employeeId),
    teacherId: clean(item.teacherId),
    name: clean(item.name || '外聘老師'),
    status: normalizeTaskStatus(item.status),
    replyText: clean(item.replyText || item.note),
    redoReason: clean(item.redoReason),
    currentTarget: item.currentTarget !== false,
    replyAttachments: attachmentBundle(item, 'reply'),
    completedAt: iso(item.completedAt),
    updatedAt: iso(item.updatedAt)
  }));
  const lastUpdatedAt = Math.max(
    asMillis(source.updatedAt || source.createdAt),
    asMillis(reply.updatedAt || reply.completedAt),
    ...responses.map((item) => asMillis(item.updatedAt || item.completedAt))
  );
  const ownStatus = response ? normalizeTaskStatus(reply.status) : '';
  const overallStatus = archived(source) ? '已封存' : (targetCount > 0 && completedCount >= targetCount ? '已完成' : normalizeTaskStatus(source.status));
  return {
    id, taskId: id, title: clean(source.title), content: clean(source.content), category: clean(source.category || '一般交辦'),
    priority: clean(source.priority || '一般'), assigneeId: clean(source.assigneeId), assigneeIds: array(source.assigneeIds),
    assigneeMode: clean(source.assigneeMode || 'individual'), assigneeName: clean(source.assigneeName || '未指定'),
    dueType: clean(source.dueType || (dateKey(source.dueDate) ? 'date' : 'none')), dueDays: clean(source.dueDays),
    dueDate: dateKey(source.dueDate), dueTime: clean(source.dueTime).slice(0, 5),
    needReport: source.needReport === true, allowComment: source.allowComment === true, allowRedo: source.allowRedo === true, needDoneFile: source.needDoneFile === true,
    managerAttachments: attachmentBundle(source, 'manager'), replyAttachments: attachmentBundle(reply, 'reply'),
    replyText: clean(reply.replyText || reply.note), redoReason: clean(reply.redoReason),
    status: ownStatus || overallStatus, targetCount, completedCount, pendingCount: Math.max(0, targetCount - completedCount), responses,
    sourceType: 'single', createdAt: iso(source.createdAt), updatedAt: iso(lastUpdatedAt || source.updatedAt), systemVersion: VERSION
  };
}

async function taskAggregates(taskDocs) {
  const map = new Map();
  const tasksById = new Map((taskDocs || []).map((doc) => [doc.id, doc.data() || {}]));
  const taskIds = [...tasksById.keys()];
  for (let offset = 0; offset < taskIds.length; offset += 10) {
    const ids = taskIds.slice(offset, offset + 10);
    if (!ids.length) continue;
    const responses = await db.collection(COLLECTIONS.taskResponses).where('taskId', 'in', ids).get();
    responses.docs.forEach((doc) => {
      const row = doc.data() || {};
      const taskId = clean(row.taskId);
      if (!map.has(taskId)) map.set(taskId, { completedCount: 0, responses: [] });
      const item = map.get(taskId);
      const task = tasksById.get(taskId) || {};
      const currentIds = unique([
        task.assigneeId,
        ...(Array.isArray(task.assigneeIds) ? task.assigneeIds : [])
      ]);
      const currentTarget = !currentIds.length || currentIds.includes(clean(row.employeeId)) || currentIds.includes(clean(row.teacherId));
      item.responses.push(Object.assign({ id: doc.id, currentTarget }, row));
      if (currentTarget && normalizeTaskStatus(row.status) === '已完成') item.completedCount += 1;
    });
  }
  return map;
}

async function managerTaskList(data) {
  const snapshot = await db.collection(COLLECTIONS.tasks).limit(500).get();
  const docs = snapshot.docs.filter((doc) => canonicalWorkRow(doc.data()) && !archived(doc.data()));
  const aggregates = await taskAggregates(docs);
  let rows = docs.map((doc) => taskJson(doc.id, doc.data(), null, Object.assign({ targetCount: Number(doc.data().targetCount || 0) }, aggregates.get(doc.id) || {})));
  const history = bool(data.historyMode) || clean(data.historyMode) === '是';
  rows = rows.filter((row) => history ? row.status === '已完成' : row.status !== '已完成');
  const start = dateKey(data.startDate || data.historyStart);
  const end = dateKey(data.endDate || data.historyEnd);
  if (history && start) rows = rows.filter((row) => dateKey(row.updatedAt || row.createdAt) >= start);
  if (history && end) rows = rows.filter((row) => dateKey(row.updatedAt || row.createdAt) <= end);
  return rows.sort((left, right) => asMillis(right.updatedAt || right.createdAt) - asMillis(left.updatedAt || left.createdAt));
}

async function saveTask(data, request) {
  assertManager(request);
  const title = clean(data.title).slice(0, 160);
  const content = clean(data.content).slice(0, 20000);
  if (!title) throw new HttpsError('invalid-argument', '請輸入事項標題。');
  if (!content) throw new HttpsError('invalid-argument', '請輸入事項內容。');
  const id = safeId(data.taskId || data.id) || generatedId('TASK');
  const allExternal = clean(data.assigneeId) === ALL_EXTERNAL || clean(data.assigneeMode) === 'all_external';
  const employees = await eligibleExternalEmployees();
  const assigneeId = allExternal ? '' : clean(data.assigneeId);
  if (!allExternal && !assigneeId) throw new HttpsError('invalid-argument', '請選擇負責人。');
  if (!employees.length) throw new HttpsError('failed-precondition', '目前沒有可發布的外聘老師主檔，請先確認老師資料。');
  const selectedEmployee = allExternal ? null : employees.find((row) => row.employeeId === assigneeId);
  if (!allExternal && !selectedEmployee) throw new HttpsError('failed-precondition', '選擇的負責人不在新版外聘老師主檔中，請重新選擇。');
  const dueType = ['today', 'tomorrow', 'days', 'date', 'none'].includes(clean(data.dueType)) ? clean(data.dueType) : 'none';
  const dueDays = dueType === 'days' ? Math.max(1, Math.min(3650, Number(data.dueDays || 1) || 1)) : '';
  const dueDate = dueType === 'none' ? '' : dateKey(data.dueDate);
  const dueTime = dueType === 'none' ? '' : clean(data.dueTime).slice(0, 5);
  const ref = db.collection(COLLECTIONS.tasks).doc(id);
  const actorRow = actor(request);
  let saved;
  let shouldNotify = false;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const previous = snapshot.exists ? snapshot.data() || {} : {};
    if (snapshot.exists && !canonicalWorkRow(previous)) throw new HttpsError('failed-precondition', '這是封存的舊版事項，不能直接覆蓋；請建立新版事項。');
    if (snapshot.exists && archived(previous)) throw new HttpsError('failed-precondition', '這項事項已封存，不能用原編號重新覆蓋；請建立新事項。');
    const revision = Number(previous.revision || 0) + 1;
    const previousSnapshotIds = clean(previous.assigneeMode) === 'all_external' ? array(previous.assigneeIds) : [];
    const assigneeIds = allExternal
      ? (snapshot.exists && previousSnapshotIds.length ? previousSnapshotIds : employees.map((row) => row.employeeId))
      : [selectedEmployee.employeeId];
    saved = {
      id, taskId: id, systemVersion: VERSION, source: SOURCE, legacyImport: false, title, content,
      category: clean(data.category || '一般交辦').slice(0, 60), priority: clean(data.priority || '一般').slice(0, 30),
      assigneeMode: allExternal ? 'all_external' : 'individual', assigneeId,
      assigneeIds, assigneeName: allExternal ? '全體外聘老師' : selectedEmployee.name, targetCount: assigneeIds.length,
      audience: ['external'], dueType, dueDays, dueDate, dueTime,
      needReport: data.needReport === true, allowComment: data.allowComment === true, allowRedo: data.allowRedo === true, needDoneFile: data.needDoneFile === true,
      taskImageAssets: sanitizeAssets(data.taskImageAssets), taskVideoAssets: sanitizeAssets(data.taskVideoAssets),
      taskAudioAssets: sanitizeAssets(data.taskAudioAssets), taskFileAssets: sanitizeAssets(data.taskFileAssets),
      status: 'pending', revision, sendLine: data.sendLine !== false, sendEmail: data.sendEmail !== false,
      updatedAt: FieldValue.serverTimestamp(), updatedByEmployeeId: actorRow.employeeId, updatedByName: actorRow.name,
      createdAt: previous.createdAt || FieldValue.serverTimestamp(), createdByEmployeeId: clean(previous.createdByEmployeeId || actorRow.employeeId)
    };
    const previousRecipients = unique([previous.assigneeId, ...(Array.isArray(previous.assigneeIds) ? previous.assigneeIds : [])]).sort();
    const nextRecipients = unique(assigneeIds).sort();
    shouldNotify = !snapshot.exists || JSON.stringify(previousRecipients) !== JSON.stringify(nextRecipients) || data.notifyNow === true;
    transaction.set(ref, saved, { merge: false });
  });
  let notification = { recipients: 0, queued: 0 };
  if (shouldNotify) notification = await queuePublishedNotice('task', saved, saved.assigneeIds).catch((error) => ({ recipients: 0, queued: 0, warning: clean(error.message) }));
  return { ok: true, id, taskId: id, message: '協助事項已儲存。', notification };
}

async function teacherTaskList(data, identity) {
  const snapshot = await db.collection(COLLECTIONS.tasks).limit(500).get();
  const docs = snapshot.docs.filter((doc) => {
    const row = doc.data() || {};
    return canonicalWorkRow(row) && !archived(row) && taskMatchesIdentity(row, identity);
  });
  const responses = new Map();
  if (identity.employeeId) {
    const responseSnapshot = await db.collection(COLLECTIONS.taskResponses).where('employeeId', '==', identity.employeeId).limit(500).get();
    responseSnapshot.docs.forEach((doc) => {
      const row = doc.data() || {};
      responses.set(clean(row.taskId), row);
    });
  }
  let rows = docs.map((doc) => taskJson(doc.id, doc.data(), responses.get(doc.id), null));
  const history = bool(data.historyMode) || clean(data.historyMode) === '是';
  rows = rows.filter((row) => history ? row.status === '已完成' : row.status !== '已完成');
  const start = dateKey(data.startDate || data.historyStart);
  const end = dateKey(data.endDate || data.historyEnd);
  if (history && start) rows = rows.filter((row) => dateKey(row.updatedAt || row.createdAt) >= start);
  if (history && end) rows = rows.filter((row) => dateKey(row.updatedAt || row.createdAt) <= end);
  return rows.sort((left, right) => asMillis(right.updatedAt || right.createdAt) - asMillis(left.updatedAt || left.createdAt));
}

async function completeTask(data, identity) {
  const taskId = safeId(data.taskId || data.id);
  if (!taskId || !identity.employeeId) throw new HttpsError('invalid-argument', '完成資料不完整。');
  const snapshot = await db.collection(COLLECTIONS.tasks).doc(taskId).get();
  const row = snapshot.exists ? snapshot.data() || {} : null;
  if (!row || !canonicalWorkRow(row) || archived(row) || !taskMatchesIdentity(row, identity)) throw new HttpsError('permission-denied', '這項協助事項目前無法回覆。');
  const replyText = clean(data.note || data.replyText).slice(0, 5000);
  const response = {
    id: safeId(`${taskId}__${identity.employeeId}`), taskId, employeeId: identity.employeeId, teacherId: identity.teacherId,
    name: identity.name, status: 'completed', replyText, redoReason: '',
    photoAssets: sanitizeAssets(data.photoAssets), videoAssets: sanitizeAssets(data.videoAssets),
    audioAssets: sanitizeAssets(data.audioAssets), fileAssets: sanitizeAssets(data.fileAssets),
    completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), source: VERSION
  };
  const attachments = [...response.photoAssets, ...response.videoAssets, ...response.audioAssets, ...response.fileAssets];
  if (row.needReport === true && !replyText) throw new HttpsError('invalid-argument', '這項事項需要填寫完成回報。');
  if (row.needDoneFile === true && !attachments.length) throw new HttpsError('invalid-argument', '這項事項需要附上完成附件。');
  await db.collection(COLLECTIONS.taskResponses).doc(response.id).set(response, { merge: true });
  return { ok: true, message: '已送出完成回覆。' };
}

async function redoTask(data, request) {
  assertManager(request);
  const taskId = safeId(data.taskId || data.id);
  if (!taskId) throw new HttpsError('invalid-argument', '缺少事項編號。');
  const snapshot = await db.collection(COLLECTIONS.tasks).doc(taskId).get();
  if (!snapshot.exists || !canonicalWorkRow(snapshot.data()) || archived(snapshot.data())) throw new HttpsError('not-found', '找不到這項可操作的新版協助事項。');
  const task = snapshot.data() || {};
  if (task.allowRedo !== true) throw new HttpsError('failed-precondition', '這項事項沒有開啟退回重做規則。');
  const currentIds = unique([task.assigneeId, ...(Array.isArray(task.assigneeIds) ? task.assigneeIds : [])]);
  const targetEmployeeId = clean(data.employeeId || data.assigneeId);
  let responseDocs = [];
  if (targetEmployeeId) {
    if (currentIds.length && !currentIds.includes(targetEmployeeId)) throw new HttpsError('failed-precondition', '這位老師已不是目前負責人。');
    const ref = db.collection(COLLECTIONS.taskResponses).doc(safeId(`${taskId}__${targetEmployeeId}`));
    const response = await ref.get();
    if (response.exists && normalizeTaskStatus(response.data() && response.data().status) === '已完成') responseDocs = [response];
  } else {
    responseDocs = (await db.collection(COLLECTIONS.taskResponses).where('taskId', '==', taskId).limit(500).get()).docs
      .filter((doc) => {
        const row = doc.data() || {};
        return normalizeTaskStatus(row.status) === '已完成' &&
          (!currentIds.length || currentIds.includes(clean(row.employeeId)) || currentIds.includes(clean(row.teacherId)));
      });
  }
  if (!responseDocs.length) throw new HttpsError('failed-precondition', '目前沒有已完成的回覆可以退回。');
  await writeBatches(responseDocs.map((doc) => ({
    ref: doc.ref,
    data: { status: 'redo', redoReason: clean(data.reason).slice(0, 2000), redoneAt: FieldValue.serverTimestamp(), redoneBy: actor(request), updatedAt: FieldValue.serverTimestamp() }
  })));
  return { ok: true, message: '已退回重做。' };
}

async function archiveTask(data, request) {
  assertManager(request);
  const id = safeId(data.taskId || data.id);
  if (!id) throw new HttpsError('invalid-argument', '缺少事項編號。');
  const ref = db.collection(COLLECTIONS.tasks).doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists || !canonicalWorkRow(snapshot.data())) throw new HttpsError('not-found', '找不到這項新版協助事項。');
  await ref.set({ archived: true, status: 'archived', archivedAt: FieldValue.serverTimestamp(), archivedBy: actor(request), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, id, message: '協助事項已封存；回覆與附件仍保留。' };
}

async function pendingCountsForIdentity(identity) {
  const [announcementSnapshot, taskSnapshot, viewSnapshot, responseSnapshot] = await Promise.all([
    db.collection(COLLECTIONS.announcements).limit(500).get(),
    db.collection(COLLECTIONS.tasks).limit(500).get(),
    identity.employeeId ? db.collection(COLLECTIONS.announcementViews).where('employeeId', '==', identity.employeeId).limit(500).get() : Promise.resolve({ docs: [] }),
    identity.employeeId ? db.collection(COLLECTIONS.taskResponses).where('employeeId', '==', identity.employeeId).limit(500).get() : Promise.resolve({ docs: [] })
  ]);
  const viewed = new Map(viewSnapshot.docs.map((doc) => [clean((doc.data() || {}).announcementId), doc.data() || {}]));
  const responses = new Map(responseSnapshot.docs.map((doc) => [clean((doc.data() || {}).taskId), doc.data() || {}]));
  const announcements = announcementSnapshot.docs.filter((doc) => {
    const row = doc.data() || {};
    const view = viewed.get(doc.id) || {};
    return canonicalWorkRow(row) && !archived(row) && row.published === true && announcementMatchesIdentity(row, identity) &&
      (!view.readAt || (row.requireReply === true && !clean(view.replyText)));
  });
  const tasks = taskSnapshot.docs.filter((doc) => {
    const row = doc.data() || {};
    const response = responses.get(doc.id) || {};
    return canonicalWorkRow(row) && !archived(row) && taskMatchesIdentity(row, identity) && normalizeTaskStatus(response.status) !== '已完成';
  });
  return { announcementCount: announcements.length, taskCount: tasks.length };
}

async function dispatch(data, request, helpers) {
  const action = clean(data.action);
  if (action === 'getExternalTeacherWorkAssignees') {
    assertManager(request);
    const employees = await eligibleExternalEmployees();
    return { ok: true, rows: employees.map(({ raw, ...row }) => row), employees: employees.map(({ raw, ...row }) => row) };
  }
  if (action === 'getAnnouncementAdminList') {
    assertManager(request);
    return { ok: true, rows: await managerAnnouncementList() };
  }
  if (action === 'saveAnnouncement') return saveAnnouncement(data, request);
  if (action === 'toggleAnnouncement') return toggleAnnouncement(data, request);
  if (action === 'deleteAnnouncement') return archiveAnnouncement(data, request);
  if (action === 'createTask') return saveTask(data, request);
  if (action === 'deleteTask') return archiveTask(data, request);
  if (action === 'markUnifiedWorkItemRedo' || action === 'markTaskRedo') return redoTask(data, request);

  const identity = await callerIdentity(data, request, helpers);
  if (action === 'getAnnouncements') return { ok: true, rows: await teacherAnnouncementList(data, identity) };
  if (action === 'submitAnnouncementReply') return submitAnnouncementReply(data, identity);
  if (action === 'getTasks' || action === 'getUnifiedWorkItems') {
    if (identity.manager) return { ok: true, rows: await managerTaskList(data) };
    return { ok: true, rows: await teacherTaskList(data, identity) };
  }
  if (action === 'completeUnifiedWorkItem' || action === 'completeTask') return completeTask(data, identity);
  throw new HttpsError('invalid-argument', '不支援的外聘老師工作動作。');
}

function registerExternalTeacherWork(exportsObject, helpers = {}) {
  exportsObject.externalTeacherWork = onCall({
    region: REGION,
    timeoutSeconds: 120,
    memory: '512MiB'
  }, async (request) => dispatch(request && request.data || {}, request, helpers));
}

module.exports = {
  VERSION,
  SOURCE,
  ALL_EXTERNAL,
  COLLECTIONS,
  registerExternalTeacherWork,
  pendingCountsForIdentity,
  canonicalWorkRow,
  canonicalEmployeeBinding,
  externalEmployee,
  inactiveEmployee,
  employeeStatusLabel,
  normalizeTaskStatus,
  taskMatchesIdentity,
  announcementMatchesIdentity
};
