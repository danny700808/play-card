'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');
const {
  SUBJECT_CATALOG_COLLECTION,
  TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION,
  prepareTeachingAbilitySubjects,
  profileAssignmentPatch
} = require('./courseSubjectCatalog');
const { normalizeAbilities } = require('./teacherProfileChanges');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const REGION = 'us-central1';
const ADMIN_EMAILS = new Set(['danny700808@gmail.com']);
const PAGE_SIZE = 400;
const MAX_ACTION_WRITES = 380;
const TEACHER_PROFILE_DRAFTS = 'teacherProfileDrafts';
const TEACHER_PROFILE_CHANGE_DRAFTS = 'teacherProfileChangeDrafts';

const clean = (value) => String(value == null ? '' : value).trim();
const lower = (value) => clean(value).toLowerCase();
const uniq = (values) => [...new Set((values || []).map(clean).filter(Boolean))];
const truthy = (value) => value === true || ['true', '1', 'yes', 'y', '是', '啟用', '使用中'].includes(lower(value));
const falsey = (value) => value === false || ['false', '0', 'no', 'n', '否', '停用', '未啟用'].includes(lower(value));
const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const first = (row, fields) => {
  for (const field of fields || []) {
    const value = clean(row && row[field]);
    if (value) return value;
  }
  return '';
};

const SOURCE_SPECS = [
  ['employees', '人員主檔', ['employeeId', 'id', 'userId', 'personMasterId'], ['coursePortalTeacherId', 'legacyTeacherId'], 'master'],
  ['admins', '管理者身分', ['employeeId', 'adminId', 'managerId', 'personMasterId'], [], 'role'],
  ['registrationApplications', '註冊申請', ['approvedEmployeeId', 'linkedEmployeeId', 'personMasterId'], [], 'application'],
  ['externalTeacherProfiles', '外聘老師個人資料', ['employeeId', 'externalTeacherEmployeeId', 'personMasterId'], ['coursePortalTeacherId', 'legacyTeacherId'], 'profile'],
  ['teacherPrivateProfiles', '外聘老師私密證件', ['employeeId', 'personMasterId'], ['coursePortalTeacherId'], 'private'],
  ['externalTeacherFiles', '外聘老師附件', ['employeeId', 'externalTeacherEmployeeId', 'personMasterId'], ['teacherId', 'coursePortalTeacherId'], 'private'],
  ['externalTeacherContracts', '外聘老師年度契約', ['employeeId', 'externalTeacherEmployeeId', 'personMasterId'], ['coursePortalTeacherId', 'legacyTeacherId'], 'contract'],
  ['teacherContractAssignments', '年度合約指派', ['employeeId', 'externalTeacherEmployeeId', 'personMasterId'], ['teacherId', 'coursePortalTeacherId'], 'contract'],
  ['teacherContractPrivateSnapshots', '年度合約簽署私密快照', ['employeeId', 'externalTeacherEmployeeId', 'personMasterId'], ['teacherId', 'coursePortalTeacherId'], 'private'],
  ['coursePortalTeacherBindings', '老師登入綁定', ['employeeId', 'externalTeacherEmployeeId', 'personMasterId'], ['teacherId', 'targetId', 'legacyTeacherId'], 'binding'],
  ['employeeLineBindings', '員工 LINE 綁定', ['employeeId', 'employeeDocId', 'targetEmployeeId', 'personMasterId'], [], 'binding'],
  ['externalTeacherLineBindings', '外聘老師 LINE 綁定', ['employeeId', 'externalTeacherEmployeeId', 'personMasterId'], ['teacherId'], 'binding'],
  ['employeeSchedules', '固定班表', ['employeeId', 'userId', 'personMasterId'], [], 'schedule'],
  ['singleDaySchedules', '單日班表', ['employeeId', 'userId', 'personMasterId'], [], 'schedule'],
  ['coursePortalScheduleChanges', '課務班表異動', ['employeeId', 'personMasterId'], ['teacherId'], 'schedule'],
  ['coursePortalTeacherSubjectAssignments', '老師授課科目', ['employeeId', 'personMasterId'], ['teacherId'], 'schedule'],
  ['clockRecords', '打卡紀錄', ['employeeId', 'userId', 'personMasterId'], [], 'attendance'],
  ['leaveRequests', '請假紀錄', ['employeeId', 'userId', 'personMasterId'], [], 'attendance'],
  ['leaveRecords', '請假核准歷史', ['employeeId', 'userId', 'personMasterId'], [], 'attendance'],
  ['temporaryAttendanceRequests', '臨時出勤', ['employeeId', 'userId', 'personMasterId'], [], 'attendance'],
  ['clockCorrections', '打卡修正', ['employeeId', 'userId', 'personMasterId'], [], 'attendance'],
  ['coursePortalTeacherAttendancePayroll', '老師出勤薪資', ['employeeId', 'personMasterId'], ['teacherId'], 'payroll'],
  ['coursePortalTeacherAdjustments', '老師薪資調整', ['employeeId', 'personMasterId'], ['teacherId'], 'payroll'],
  ['coursePortalTeacherBonusRequests', '老師獎金申請', ['employeeId', 'personMasterId'], ['teacherId'], 'payroll'],
  ['coursePortalLateAttendance', '老師遲到出勤', ['employeeId', 'personMasterId'], ['teacherId'], 'attendance'],
  ['coursePortalAttendanceRecords', '老師簽到紀錄', ['employeeId', 'personMasterId'], ['teacherId', 'createdByTeacherId'], 'attendance'],
  ['coursePortalAttendanceCancellationRequests', '取消簽到申請', ['employeeId', 'personMasterId'], ['teacherId'], 'attendance'],
  ['coursePortalAttendanceLessonLocks', '簽到課程鎖定', ['employeeId', 'personMasterId'], ['teacherId'], 'attendance'],
  ['attendanceReconciliations', '出勤核對紀錄', ['employeeId', 'userId', 'personMasterId'], [], 'attendance'],
  ['parttimeRecords', '工讀時數薪資', ['employeeId', 'userId', 'personMasterId'], [], 'payroll'],
  ['employeeSalaryConfigs', '薪資設定', ['employeeId', 'userId', 'personMasterId'], [], 'payroll-config'],
  ['employeeSalaryConfigHistory', '薪資設定歷史', ['employeeId', 'userId', 'personMasterId'], [], 'payroll-config'],
  ['profileChangeRequests', '個資修改申請', ['employeeId', 'userId', 'applicantId', 'personMasterId'], [], 'application'],
  ['certificateApplications', '員工證明申請', ['employeeId', 'userId', 'applicantId', 'personMasterId'], [], 'application'],
  ['parttimeHourRequests', '工讀時數申請', ['employeeId', 'userId', 'personMasterId'], [], 'payroll'],
  ['teacherContractLogs', '老師合約歷程', ['employeeId', 'personMasterId'], ['teacherId'], 'contract'],
  ['teacherGoodsInquiry', '老師商品詢問', ['employeeId', 'userId', 'personMasterId'], ['teacherId'], 'activity'],
  ['lineBindingLogs', 'LINE 綁定歷程', ['employeeId', 'targetEmployeeId', 'userId', 'personMasterId'], ['teacherId'], 'log'],
  ['notificationQueue', '人員通知佇列', ['employeeId', 'targetEmployeeId', 'userId', 'personMasterId'], ['teacherId'], 'notification'],
  ['notificationLogs', '人員通知歷程', ['employeeId', 'targetEmployeeId', 'userId', 'personMasterId'], ['teacherId'], 'notification'],
  ['coursePortalReminderLogs', '老師提醒歷程', ['employeeId', 'personMasterId'], ['teacherId'], 'log'],
  ['coursePortalSessions', '登入工作階段', ['employeeId', 'personMasterId'], ['teacherId'], 'auth'],
  ['coursePortalAccessTokens', '登入交換票據', ['employeeId', 'personMasterId'], ['teacherId'], 'auth']
].map(([collection, label, employeeFields, teacherFields, kind]) => ({
  collection, label, employeeFields, teacherFields, kind
}));

const SPEC_BY_COLLECTION = new Map(SOURCE_SPECS.map((spec) => [spec.collection, spec]));
const FORMAL_KINDS = new Set(['attendance', 'payroll']);
const CASCADE_KINDS = new Set([
  'master', 'role', 'application', 'profile', 'private', 'contract', 'binding', 'schedule',
  'auth', 'payroll-config', 'activity', 'log', 'notification'
]);

function assertManager(request) {
  const token = request && request.auth && request.auth.token || {};
  const role = lower(token.role || token.userRole || token.permissionRole);
  const allowed = token.admin === true || token.manager === true || token.owner === true ||
    ['admin', 'manager', 'owner', '主管', '管理者'].includes(role) ||
    ADMIN_EMAILS.has(lower(token.email));
  if (!allowed) throw new HttpsError('permission-denied', '請先使用管理者帳號登入。');
}

function actorOf(request) {
  const token = request && request.auth && request.auth.token || {};
  return clean(token.name || token.email || request && request.auth && request.auth.uid) || '管理者';
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime() || 0;
  if (value && Number.isFinite(Number(value.seconds))) return Number(value.seconds) * 1000;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowTime(row) {
  return Math.max(...[
    row.updatedAt, row.submittedAt, row.signedAt, row.confirmedAt, row.approvedAt, row.createdAt,
    row.updatedAtText, row.submittedAtText, row.createdAtText
  ].map(timestampMs), 0);
}

function rowStatus(row) {
  return first(row, [
    'personLifecycleStatus', 'accountStatus', 'employmentStatus', 'profileStatus', 'contractStatus',
    'approvalStatus', 'status', 'progressStatus'
  ]);
}

function rowName(row) {
  return first(row, [
    'name', 'displayName', 'employeeName', 'teacherName', 'targetName', 'applicantName',
    '姓名', '員工姓名', '老師姓名', '申請人'
  ]);
}

function rowEmail(row) {
  return lower(first(row, [
    'email', 'Email', 'loginEmail', 'loginAccount', 'contactEmail', 'teacherEmail',
    '電子信箱', '登入帳號'
  ]));
}

function rowPhone(row) {
  return first(row, [
    'mobilePhone', 'mobile', 'phone', 'telephone', 'contactPhone',
    '行動電話', '手機', '電話'
  ]).replace(/[^0-9+]/g, '');
}

function lineIds(row) {
  const values = ['lineUserId', 'lineUid', 'lineId', 'LINE User ID'].map((field) => clean(row && row[field]));
  return uniq(values);
}

function identityKeys(spec, row, docId) {
  const keys = [];
  if (spec.collection === 'employees') keys.push(`employee:${clean(docId)}`);
  uniq((spec.employeeFields || []).concat([
    'employeeId', 'userId', 'personMasterId', 'canonicalEmployeeId', 'targetEmployeeId',
    'approvedEmployeeId', 'linkedEmployeeId', 'externalTeacherEmployeeId', 'employeeDocId',
    'applicantId', '員工ID', '使用者ID', '申請人ID'
  ])).forEach((field) => {
    const value = clean(row && row[field]);
    if (value) keys.push(`employee:${value.replace(/^employees\//, '')}`);
  });
  uniq((spec.teacherFields || []).concat([
    'teacherId', 'coursePortalTeacherId', 'legacyTeacherId', '老師ID', '教師ID'
  ])).forEach((field) => {
    const value = clean(row && row[field]);
    if (value) keys.push(`teacher:${value}`);
  });
  ['externalTeacherProfileId', 'profileId'].forEach((field) => {
    const value = clean(row && row[field]);
    if (value) keys.push(`profile:${value}`);
  });
  if (['externalTeacherProfiles', 'teacherPrivateProfiles'].includes(spec.collection)) {
    keys.push(`profile:${docId}`);
  }
  if (['binding', 'profile', 'private', 'master'].includes(spec.kind)) {
    lineIds(row).forEach((value) => keys.push(`employee-line:${value}`));
  }
  return uniq(keys);
}

function contractIsFormal(row) {
  const status = lower(rowStatus(row));
  return Boolean(
    first(row, ['signatureUrl', 'signatureDataUrl', 'signedAt', 'confirmedAt', 'approvedAt', 'contractHtmlUrl']) ||
    /active|confirmed|approved|contract_effective|signed|生效|已確認|已核准|已簽/.test(status)
  );
}

function rowIsFormal(spec, row) {
  if (FORMAL_KINDS.has(spec.kind)) return true;
  if (spec.collection === 'leaveRequests') {
    return /approved|核准|同意/.test(lower(rowStatus(row)));
  }
  if (spec.kind === 'contract') return contractIsFormal(row);
  return false;
}

function activeEmployee(row) {
  const account = lower(row.accountStatus || row.status || 'active');
  const employment = lower(row.employmentStatus || 'active');
  const blocked = new Set([
    'profile_draft', 'pending_review', 'pending', 'inactive', 'disabled', 'archived', 'rejected',
    'resigned', 'suspended', 'contractorended', 'contract_ended', 'deleted'
  ]);
  return !falsey(row.active) && !truthy(row.hiddenFromActiveLists) &&
    !blocked.has(account) && !blocked.has(employment);
}

function recordBelongsToPersonnel(spec, row) {
  const source = row || {};
  const explicitEmployee = (spec.employeeFields || []).some((field) => clean(source[field]));
  const explicitTeacher = (spec.teacherFields || []).some((field) => clean(source[field]));
  if (['coursePortalSessions', 'coursePortalAccessTokens'].includes(spec.collection)) {
    const role = lower(source.role || source.type || source.accountType || source.portalRole);
    return explicitEmployee || explicitTeacher || role === 'teacher' || role === 'external';
  }
  if (['notificationQueue', 'notificationLogs'].includes(spec.collection)) {
    return explicitEmployee || explicitTeacher;
  }
  return true;
}

async function readAll(spec) {
  const rows = [];
  let cursor = null;
  for (;;) {
    let query = db.collection(spec.collection).orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    snapshot.docs.forEach((doc) => {
      const row = doc.data() || {};
      if (!recordBelongsToPersonnel(spec, row)) return;
      rows.push({ spec, docId: doc.id, ref: doc.ref, row });
    });
    if (snapshot.size < PAGE_SIZE) break;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
  return rows;
}

function makeUnion(size) {
  const parent = Array.from({ length: size }, (_, index) => index);
  function find(index) {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  }
  function union(left, right) {
    const a = find(left); const b = find(right);
    if (a !== b) parent[b] = a;
  }
  return { find, union };
}

function buildGroups(records) {
  const union = makeUnion(records.length);
  const ownerByKey = new Map();
  records.forEach((record, index) => {
    const keys = identityKeys(record.spec, record.row, record.docId);
    record.keys = keys;
    keys.forEach((key) => {
      if (ownerByKey.has(key)) union.union(index, ownerByKey.get(key));
      else ownerByKey.set(key, index);
    });
  });
  const grouped = new Map();
  records.forEach((record, index) => {
    const root = union.find(index);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(record);
  });
  return [...grouped.values()].map((rows) => {
    rows.sort((a, b) => rowTime(b.row) - rowTime(a.row));
    const employeeRows = rows.filter((item) => item.spec.collection === 'employees');
    const effectiveEmployeeRows = employeeRows.filter((item) => !clean(item.row.mergedIntoEmployeeId));
    const personMasterIds = uniq(rows.map((item) => clean(item.row.personMasterId || item.row.canonicalEmployeeId)));
    const employeeIds = uniq(rows.flatMap((item) => item.keys)
      .filter((key) => key.startsWith('employee:')).map((key) => key.slice(9)));
    const teacherIds = uniq(rows.flatMap((item) => item.keys)
      .filter((key) => key.startsWith('teacher:')).map((key) => key.slice(8)));
    const names = uniq(rows.map((item) => rowName(item.row)));
    const emails = uniq(rows.map((item) => rowEmail(item.row)));
    const phones = uniq(rows.map((item) => rowPhone(item.row)));
    const sourceCounts = {};
    rows.forEach((item) => { sourceCounts[item.spec.collection] = (sourceCounts[item.spec.collection] || 0) + 1; });
    const formalRows = rows.filter((item) => rowIsFormal(item.spec, item.row));
    const activeMasters = effectiveEmployeeRows.filter((item) => activeEmployee(item.row));
    const draftMasters = effectiveEmployeeRows.filter((item) => /profile_draft|pending/.test(lower(rowStatus(item.row))));
    const groupId = `PERSON_${hash(rows.map((item) => `${item.spec.collection}/${item.docId}`).sort().join('|')).slice(0, 24)}`;
    const safelyDeletable = formalRows.length === 0 && activeMasters.length === 0 && rows.length <= MAX_ACTION_WRITES - 2;
    return {
      groupId,
      rows,
      employeeIds,
      canonicalEmployeeIds: personMasterIds.length === 1
        ? personMasterIds
        : uniq(effectiveEmployeeRows.map((item) => first(item.row, ['employeeId', 'id']) || item.docId)),
      teacherIds,
      names,
      emails,
      phones,
      sourceCounts,
      sourceCount: rows.length,
      formalCount: formalRows.length,
      masterCount: effectiveEmployeeRows.length,
      historicalMasterCount: employeeRows.length - effectiveEmployeeRows.length,
      activeMasterCount: activeMasters.length,
      draftMasterCount: draftMasters.length,
      safelyDeletable,
      needsReview: personMasterIds.length > 1 || effectiveEmployeeRows.length !== 1 ||
        (!personMasterIds.length && employeeIds.length > 1),
      latestAt: Math.max(...rows.map((item) => rowTime(item.row)), 0)
    };
  }).sort((a, b) => b.latestAt - a.latestAt || a.groupId.localeCompare(b.groupId));
}

async function inventoryState() {
  const results = await Promise.allSettled(SOURCE_SPECS.map(readAll));
  const unavailable = [];
  const records = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') records.push(...result.value);
    else unavailable.push(SOURCE_SPECS[index].collection);
  });
  if (unavailable.length) {
    throw new HttpsError('unavailable', `以下資料目前無法完整讀取：${unavailable.join('、')}。為避免誤整理，本次不提供部分結果。`);
  }
  return { records, groups: buildGroups(records) };
}

function publicGroup(group) {
  return {
    groupId: group.groupId,
    employeeIds: group.employeeIds,
    canonicalEmployeeIds: group.canonicalEmployeeIds,
    teacherIds: group.teacherIds,
    names: group.names,
    emails: group.emails,
    phones: group.phones.map((phone) => phone.length > 6 ? `${phone.slice(0, 4)}•••${phone.slice(-3)}` : phone),
    sourceCounts: group.sourceCounts,
    sourceCount: group.sourceCount,
    formalCount: group.formalCount,
    masterCount: group.masterCount,
    historicalMasterCount: group.historicalMasterCount,
    activeMasterCount: group.activeMasterCount,
    draftMasterCount: group.draftMasterCount,
    safelyDeletable: group.safelyDeletable,
    needsReview: group.needsReview,
    latestAt: group.latestAt
  };
}

async function personDataInventory(data, request) {
  assertManager(request);
  const state = await inventoryState();
  const keyword = lower(data && data.keyword);
  const employeeId = clean(data && data.employeeId);
  let groups = state.groups;
  if (employeeId) groups = groups.filter((group) => group.employeeIds.includes(employeeId));
  if (keyword) groups = groups.filter((group) => lower([
    ...group.names, ...group.emails, ...group.employeeIds, ...group.teacherIds
  ].join(' ')).includes(keyword));
  const summary = {
    people: state.groups.length,
    review: state.groups.filter((group) => group.needsReview).length,
    deletable: state.groups.filter((group) => group.safelyDeletable).length,
    formal: state.groups.filter((group) => group.formalCount > 0).length,
    sources: state.records.length
  };
  return { ok: true, summary, groups: groups.map(publicGroup), scannedAt: Date.now() };
}

async function signedIdentityFiles(group) {
  const results = [];
  const rows = group.rows.filter((item) => item.spec.kind === 'private');
  for (const item of rows) {
    const files = (Array.isArray(item.row.identityFiles) ? item.row.identityFiles : []).concat([item.row]);
    for (const file of files.slice(0, 4)) {
      const path = clean(file && file.storagePath);
      if (!path) continue;
      try {
        const [url] = await admin.storage().bucket().file(path).getSignedUrl({
          action: 'read', expires: Date.now() + 15 * 60 * 1000
        });
        results.push({ name: clean(file.fileName) || '身分證明文件', url, expiresInMinutes: 15 });
      } catch (error) {
        console.warn('[person data signed identity file]', path, error && error.message);
      }
    }
  }
  return results;
}

async function personDataDetail(data, request) {
  assertManager(request);
  const state = await inventoryState();
  const group = state.groups.find((item) => item.groupId === clean(data && data.groupId));
  if (!group) throw new HttpsError('not-found', '找不到這組人員資料，請重新掃描。');
  const privateRows = group.rows.filter((item) => item.spec.collection === 'teacherPrivateProfiles');
  const rawId = first(privateRows.map((item) => item.row).find((row) => first(row, ['idNumber', 'identityNumber'])) || {}, ['idNumber', 'identityNumber']);
  const identityFiles = await signedIdentityFiles(group);
  const sources = group.rows.map((item) => ({
    collection: item.spec.collection,
    label: item.spec.label,
    kind: item.spec.kind,
    docId: item.docId,
    status: rowStatus(item.row),
    name: rowName(item.row),
    employeeIds: uniq(item.keys.filter((key) => key.startsWith('employee:')).map((key) => key.slice(9))),
    teacherIds: uniq(item.keys.filter((key) => key.startsWith('teacher:')).map((key) => key.slice(8))),
    formal: rowIsFormal(item.spec, item.row),
    updatedAt: rowTime(item.row)
  }));
  return {
    ok: true,
    group: publicGroup(group),
    sources,
    privateProfile: {
      idNumber: rawId,
      identityFiles
    }
  };
}

function groupById(state, groupId) {
  const group = state.groups.find((item) => item.groupId === clean(groupId));
  if (!group) throw new HttpsError('not-found', '找不到這組人員資料，請重新掃描。');
  return group;
}

function auditRef() {
  return db.collection('personDataAdminAudits').doc();
}

function currentProfileItem(group) {
  const candidates = group.rows.filter((item) => item.spec.collection === 'externalTeacherProfiles');
  const current = candidates.filter((item) => Number(item.row.portalProfileVersion || 0) === 2 ||
    clean(item.row.portalProfileSource).includes('course-portal-fresh'));
  return (current.length ? current : candidates).slice().sort((a, b) => rowTime(b.row) - rowTime(a.row))[0] || null;
}

function currentEmployeeItems(group) {
  return group.rows.filter((item) => item.spec.collection === 'employees' && !clean(item.row.mergedIntoEmployeeId));
}

function profileReadiness(group, profileItem) {
  if (!profileItem) return { ready: false, missing: ['個人資料'] };
  const privateItem = group.rows.find((item) => item.spec.collection === 'teacherPrivateProfiles' &&
    (item.docId === profileItem.docId || clean(item.row.profileId) === profileItem.docId));
  const profile = profileItem.row || {};
  const privateRow = privateItem && privateItem.row || {};
  const teaching = Array.isArray(profile.teachingAbilities) && profile.teachingAbilities.some((item) => first(item, ['item', 'name', 'subject']));
  const files = Array.isArray(privateRow.identityFiles) && privateRow.identityFiles.some((file) => clean(file && file.storagePath));
  const checks = [
    ['姓名', rowName(profile)],
    ['行動電話', rowPhone(profile)],
    ['LINE 或 Email', lineIds(profile)[0] || rowEmail(profile)],
    ['出生年月日', clean(profile.birthDate)],
    ['戶籍地址', clean(profile.householdAddress)],
    ['通訊地址', clean(profile.mailingAddress || profile.contactAddress)],
    ['緊急聯絡人', clean(profile.emergencyContact)],
    ['緊急聯絡人電話', clean(profile.emergencyPhone || profile.emergencyContactPhone)],
    ['身分證字號', clean(privateRow.idNumber || privateRow.identityNumber)],
    ['身分證明照片', files],
    ['授課項目', teaching]
  ];
  const missing = checks.filter((entry) => !entry[1]).map((entry) => entry[0]);
  return { ready: missing.length === 0, missing };
}

function batchAudit(batch, action, group, request, extra) {
  const ref = auditRef();
  batch.set(ref, Object.assign({
    auditId: ref.id,
    action,
    groupId: group.groupId,
    employeeIds: group.employeeIds,
    teacherIds: group.teacherIds,
    actor: actorOf(request),
    createdAt: FV.serverTimestamp()
  }, extra || {}));
}

function revokePatch(kind, reason) {
  const common = { updatedAt: FV.serverTimestamp(), personArchiveReason: reason };
  if (kind === 'binding') return Object.assign(common, {
    status: 'revoked', approvalStatus: 'revoked', active: false, revokedAt: FV.serverTimestamp()
  });
  if (kind === 'auth') return Object.assign(common, {
    status: 'revoked', active: false, revokedAt: FV.serverTimestamp(), revokedReason: reason
  });
  if (kind === 'schedule') return Object.assign(common, {
    active: false, enabled: false, status: 'archived', archivedAt: FV.serverTimestamp()
  });
  return common;
}

async function approveProfile(group, request) {
  const employees = currentEmployeeItems(group);
  const profile = currentProfileItem(group);
  if (employees.length !== 1 || !profile) {
    throw new HttpsError('failed-precondition', '這組資料沒有唯一人員主檔與個人資料，請先整理歸屬。');
  }
  const readiness = profileReadiness(group, profile);
  if (!readiness.ready) {
    throw new HttpsError('failed-precondition', `個人資料尚缺：${readiness.missing.join('、')}。請先退回老師補齊。`);
  }
  const profileRow = profile.row || {};
  const employeeRow = employees[0].row || {};
  const teacherId = first(Object.assign({}, employeeRow, profileRow), ['coursePortalTeacherId', 'legacyTeacherId', 'teacherId']) ||
    clean(group.teacherIds && group.teacherIds[0]);
  const teachingPlan = await prepareTeachingAbilitySubjects({
    db,
    FieldValue: FV,
    abilities: Array.isArray(profileRow.teachingAbilities) ? profileRow.teachingAbilities : [],
    approveNew: true,
    profileId: profile.docId,
    teacherId,
    employeeId: employees[0].docId,
    actor: actorOf(request),
    source: 'approved-teacher-profile-subject',
    nowText: new Date().toISOString()
  });
  const teachingAbilities = teachingPlan.abilities;
  const assignmentRef = teacherId
    ? db.collection(TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION).doc(teacherId)
    : null;
  const assignmentSnapshot = assignmentRef ? await assignmentRef.get() : null;
  const assignmentPatch = assignmentRef ? profileAssignmentPatch(
    assignmentSnapshot && assignmentSnapshot.exists ? assignmentSnapshot.data() || {} : {},
    teachingPlan.allSubjectIds,
    {
      teacherId,
      employeeId: employees[0].docId,
      profileId: profile.docId,
      activeProfileSubjectIds: teachingPlan.subjectIds,
      nowText: new Date().toISOString()
    },
    FV
  ) : null;
  const batch = db.batch();
  batch.set(employees[0].ref, {
    name: rowName(profileRow),
    displayName: rowName(profileRow),
    mobile: rowPhone(profileRow),
    mobilePhone: rowPhone(profileRow),
    email: rowEmail(profileRow),
    teachingAbilities,
    teachingItems: teachingAbilities.map((row) => row.item).join('、'),
    subjectIds: assignmentPatch ? assignmentPatch.effectiveSubjectIds : teachingPlan.subjectIds,
    active: true,
    accountStatus: 'active',
    employmentStatus: 'active',
    personLifecycleStatus: 'active',
    profileReviewStatus: 'approved',
    profileRevisionReason: FV.delete(),
    hiddenFromActiveLists: false,
    profileApprovedAt: FV.serverTimestamp(),
    profileApprovedBy: actorOf(request),
    updatedAt: FV.serverTimestamp()
  }, { merge: true });
  batch.set(profile.ref, {
    status: 'approved',
    profileStatus: 'approved',
    progressStatus: '已建立為外聘老師',
    approvedAt: FV.serverTimestamp(),
    approvedBy: actorOf(request),
    teachingAbilities,
    teachingItems: teachingAbilities.map((row) => row.item).join('、'),
    active: true,
    updatedAt: FV.serverTimestamp()
  }, { merge: true });
  teachingPlan.catalogWrites.forEach((write) => {
    batch.set(db.collection(SUBJECT_CATALOG_COLLECTION).doc(write.id), write.patch, { merge: true });
  });
  if (assignmentRef && assignmentPatch) batch.set(assignmentRef, assignmentPatch, { merge: true });
  batchAudit(batch, 'approve-profile', group, request);
  await batch.commit();
  return { ok: true, message: '已確認個人資料並啟用此外聘老師。' };
}

async function returnProfile(group, request, reason) {
  if (!reason) throw new HttpsError('invalid-argument', '請填寫退回補件原因。');
  const employees = currentEmployeeItems(group);
  const profile = currentProfileItem(group);
  if (employees.length !== 1 || !profile) {
    throw new HttpsError('failed-precondition', '這組資料沒有唯一人員主檔與個人資料，請先整理歸屬。');
  }
  const batch = db.batch();
  const existingEmployee = employees[0].row || {};
  const establishedTeacher = activeEmployee(existingEmployee);
  batch.set(employees[0].ref, {
    active: establishedTeacher ? true : false,
    accountStatus: establishedTeacher ? clean(existingEmployee.accountStatus || 'active') : 'profile_draft',
    employmentStatus: establishedTeacher ? clean(existingEmployee.employmentStatus || 'active') : 'profile_draft',
    personLifecycleStatus: establishedTeacher ? 'active' : 'needs_revision',
    profileReviewStatus: 'needs_revision',
    profileRevisionReason: reason,
    updatedAt: FV.serverTimestamp()
  }, { merge: true });
  batch.set(profile.ref, {
    status: 'needs_revision',
    profileStatus: 'needs_revision',
    progressStatus: '管理者退回補件',
    revisionReason: reason,
    returnedAt: FV.serverTimestamp(),
    returnedBy: actorOf(request),
    updatedAt: FV.serverTimestamp()
  }, { merge: true });
  batchAudit(batch, 'return-profile', group, request, { reason });
  await batch.commit();
  return { ok: true, message: '已退回老師補件。' };
}

async function archiveGroup(group, request, reason) {
  const batch = db.batch();
  let writes = 1;
  group.rows.forEach((item) => {
    if (item.spec.collection === 'employees') {
      batch.set(item.ref, {
        active: false, accountStatus: 'archived', employmentStatus: 'archived',
        personLifecycleStatus: 'archived', hiddenFromActiveLists: true,
        archivedAt: FV.serverTimestamp(), archivedBy: actorOf(request), archiveReason: reason,
        updatedAt: FV.serverTimestamp()
      }, { merge: true });
      writes += 1;
    } else if (['binding', 'auth', 'schedule'].includes(item.spec.kind)) {
      batch.set(item.ref, revokePatch(item.spec.kind, reason), { merge: true });
      writes += 1;
    }
  });
  if (writes > MAX_ACTION_WRITES) throw new HttpsError('resource-exhausted', '這組資料過多，請聯絡系統管理者分批封存。');
  batchAudit(batch, 'archive', group, request, { reason });
  await batch.commit();
  return { ok: true, message: '已封存人員並停止登入、班表與 LINE 綁定；正式歷史仍保留。' };
}

async function unlinkLine(group, request) {
  const batch = db.batch();
  let writes = 1;
  const clearLine = {
    lineUserId: FV.delete(),
    lineUid: FV.delete(),
    lineId: FV.delete(),
    'LINE User ID': FV.delete(),
    lineDisplayName: FV.delete(),
    lineNotifyEnabled: false,
    lineBindStatus: 'unbound',
    lineUnboundAt: FV.serverTimestamp(),
    lineUnboundBy: actorOf(request),
    updatedAt: FV.serverTimestamp()
  };
  group.rows.forEach((item) => {
    if (item.spec.kind === 'auth') {
      batch.set(item.ref, revokePatch('auth', 'manager-unlink-line'), { merge: true });
      writes += 1;
    } else if (item.spec.kind === 'binding') {
      batch.set(item.ref, Object.assign({}, clearLine, revokePatch('binding', 'manager-unlink-line')), { merge: true });
      writes += 1;
    } else if (['employees', 'externalTeacherProfiles', 'admins'].includes(item.spec.collection)) {
      batch.set(item.ref, clearLine, { merge: true });
      writes += 1;
    }
  });
  if (writes > MAX_ACTION_WRITES) throw new HttpsError('resource-exhausted', '這組資料過多，無法在單次安全交易中解除 LINE。');
  batchAudit(batch, 'unlink-line', group, request);
  await batch.commit();
  return { ok: true, message: '已解除這個人的 LINE 登入與通知，個人資料、合約及正式歷史都保留。' };
}

async function deleteTestGroup(group, request, confirmation) {
  if (confirmation !== '永久刪除測試資料') {
    throw new HttpsError('invalid-argument', '請輸入「永久刪除測試資料」確認。');
  }
  if (!group.safelyDeletable) {
    throw new HttpsError('failed-precondition', group.formalCount
      ? '這個人已有合約、薪資或出勤歷史，只能封存，不能永久刪除。'
      : '這個人仍是啟用狀態或資料量過大，不能直接永久刪除。');
  }
  const deletions = group.rows.filter((item) => CASCADE_KINDS.has(item.spec.kind));
  if (deletions.length + 2 > MAX_ACTION_WRITES) {
    throw new HttpsError('resource-exhausted', '這組資料過多，無法在單次安全交易中刪除。');
  }
  const storagePaths = group.rows
    .filter((item) => item.spec.kind === 'private')
    .flatMap((item) => {
      const rows = Array.isArray(item.row.identityFiles) ? item.row.identityFiles : [];
      return rows.concat([item.row]);
    })
    .map((file) => clean(file && (file.storagePath || file.path))).filter(Boolean);
  const batch = db.batch();
  deletions.forEach((item) => batch.delete(item.ref));
  const tombstone = db.collection('personDeletionTombstones').doc();
  batch.set(tombstone, {
    tombstoneId: tombstone.id,
    groupId: group.groupId,
    employeeIds: group.employeeIds,
    teacherIds: group.teacherIds,
    sourcePaths: deletions.map((item) => `${item.spec.collection}/${item.docId}`),
    deletedAsTestData: true,
    deletedBy: actorOf(request),
    deletedAt: FV.serverTimestamp()
  });
  batchAudit(batch, 'delete-test', group, request, { deletedCount: deletions.length });
  await batch.commit();
  await Promise.allSettled(storagePaths.map((path) => admin.storage().bucket().file(path).delete({ ignoreNotFound: true })));
  return { ok: true, message: `已永久刪除 ${deletions.length} 筆測試資料；正式歷史檢查為 0 筆。` };
}

async function linkGroup(group, request, targetEmployeeId) {
  const targetId = clean(targetEmployeeId);
  if (!targetId) throw new HttpsError('invalid-argument', '請選擇要歸入的人員主檔。');
  const target = await db.collection('employees').doc(targetId).get();
  if (!target.exists) throw new HttpsError('not-found', '找不到指定的人員主檔。');
  const batch = db.batch();
  let writes = 1;
  group.rows.forEach((item) => {
    if (item.spec.collection === 'employees' && item.docId !== targetId) {
      batch.set(item.ref, {
        mergedIntoEmployeeId: targetId,
        personMasterId: targetId,
        active: false,
        accountStatus: 'archived',
        employmentStatus: 'archived',
        hiddenFromActiveLists: true,
        mergedAt: FV.serverTimestamp(),
        mergedBy: actorOf(request),
        updatedAt: FV.serverTimestamp()
      }, { merge: true });
      writes += 1;
      return;
    }
    if (item.docId === targetId && item.spec.collection === 'employees') return;
    batch.set(item.ref, {
      personMasterId: targetId,
      canonicalEmployeeId: targetId,
      linkedByManagerAt: FV.serverTimestamp(),
      linkedByManager: actorOf(request),
      updatedAt: FV.serverTimestamp()
    }, { merge: true });
    writes += 1;
  });
  if (writes > MAX_ACTION_WRITES) throw new HttpsError('resource-exhausted', '這組資料過多，無法在單次安全交易中歸檔。');
  batchAudit(batch, 'link', group, request, { targetEmployeeId: targetId });
  await batch.commit();
  return { ok: true, message: `已把這組歷史來源歸到 ${targetId}；原始契約與紀錄內容未被改寫。` };
}

async function personDataAction(data, request) {
  assertManager(request);
  const state = await inventoryState();
  const group = groupById(state, data && data.groupId);
  const action = clean(data && data.action);
  if (action === 'approve-profile') return approveProfile(group, request);
  if (action === 'return-profile') return returnProfile(group, request, clean(data && data.reason));
  if (action === 'archive') return archiveGroup(group, request, clean(data && data.reason) || '管理者封存');
  if (action === 'unlink-line') return unlinkLine(group, request);
  if (action === 'delete-test') return deleteTestGroup(group, request, clean(data && data.confirmation));
  if (action === 'link') return linkGroup(group, request, clean(data && data.targetEmployeeId));
  throw new HttpsError('invalid-argument', '不支援的人員資料操作。');
}

function contractAssignmentReviewStatus(row) {
  return lower(row && (row.status || row.assignmentStatus || row.contractStatus));
}

function publicContractAssignment(item) {
  const row = item && item.row || {};
  const rawYear = Number(clean(row.year || row.contractYear));
  const rocYear = Number.isFinite(rawYear) && rawYear > 1911 ? String(rawYear - 1911) : clean(row.contractRocYear || row.rocYear || row.year);
  return {
    id: clean(row.assignmentId || item.docId),
    __id: clean(row.assignmentId || item.docId),
    assignmentId: clean(row.assignmentId || item.docId),
    contractId: clean(row.contractId || row.templateId),
    contractName: clean(row.contractName || row.title || '外聘老師年度契約'),
    year: clean(row.year || row.contractYear),
    contractRocYear: rocYear,
    employeeId: clean(row.employeeId || row.externalTeacherEmployeeId),
    externalTeacherEmployeeId: clean(row.externalTeacherEmployeeId || row.employeeId),
    teacherId: clean(row.teacherId),
    portalProfileId: clean(row.portalProfileId || row.externalTeacherProfileId),
    externalTeacherProfileId: clean(row.externalTeacherProfileId || row.portalProfileId),
    portalProfileVersion: Number(row.portalProfileVersion || 0),
    teacherName: rowName(row),
    name: rowName(row),
    email: rowEmail(row),
    mobile: rowPhone(row),
    bindingMethod: clean(row.bindingMethod),
    lineBindStatus: clean(row.lineBindStatus),
    emailBindStatus: clean(row.emailBindStatus),
    status: contractAssignmentReviewStatus(row),
    statusLabel: clean(row.statusLabel),
    progressStatus: clean(row.progressStatus),
    revisionReason: clean(row.revisionReason),
    publishedAtText: clean(row.publishedAtText),
    submittedAtText: clean(row.submittedAtText || row.signedAtText),
    confirmedAtText: clean(row.confirmedAtText),
    signatureRecorded: row.signatureRecorded === true || Boolean(clean(row.signatureDataUrl || row.signatureUrl || row.signedAt)),
    _sourceCollection: 'teacherContractAssignments',
    _contractWorkflow: 'assignment'
  };
}

async function personDataContractInventory(data, request) {
  assertManager(request);
  const spec = SPEC_BY_COLLECTION.get('teacherContractAssignments');
  const records = await readAll(spec);
  const focusId = clean(data && data.assignmentId);
  let rows = records.map(publicContractAssignment);
  if (focusId) rows = rows.filter((row) => row.assignmentId === focusId);
  rows.sort((left, right) => String(right.year).localeCompare(String(left.year)) ||
    left.teacherName.localeCompare(right.teacherName, 'zh-Hant'));
  return { ok: true, rows };
}

async function personDataContractDetail(data, request) {
  assertManager(request);
  const assignmentId = clean(data && data.assignmentId);
  if (!assignmentId) throw new HttpsError('invalid-argument', '缺少合約指派編號。');
  const [assignmentSnapshot, privateSnapshot] = await Promise.all([
    db.collection('teacherContractAssignments').doc(assignmentId).get(),
    db.collection('teacherContractPrivateSnapshots').doc(assignmentId).get()
  ]);
  if (!assignmentSnapshot.exists) throw new HttpsError('not-found', '找不到這筆合約。');
  const row = assignmentSnapshot.data() || {};
  const privateRow = privateSnapshot.exists ? privateSnapshot.data() || {} : {};
  const profile = privateRow.profileSnapshot && typeof privateRow.profileSnapshot === 'object'
    ? privateRow.profileSnapshot
    : {
      name: rowName(row),
      email: rowEmail(row),
      mobilePhone: rowPhone(row),
      idNumber: clean(row.idNumber || row.teacherIdNumber),
      contractAddress: clean(row.address || row.teacherAddress),
      teachingItemsText: clean(row.teachingItemsText || row.course || row.teacherCourse)
    };
  return {
    ok: true,
    assignment: publicContractAssignment({ docId: assignmentSnapshot.id, row }),
    profile: {
      name: clean(profile.name),
      email: normalizeEmailForAdmin(profile.email),
      mobilePhone: clean(profile.mobilePhone),
      idNumber: clean(profile.idNumber),
      idNumberMasked: clean(profile.idNumberMasked),
      householdAddress: clean(profile.householdAddress),
      mailingAddress: clean(profile.mailingAddress),
      contractAddress: clean(profile.contractAddress || profile.householdAddress || profile.mailingAddress),
      teachingItemsText: clean(profile.teachingItemsText)
    },
    contractSnapshot: privateRow.contractSnapshot || row.contractSnapshot || row.signedSnapshot || {},
    signatureDataUrl: clean(privateRow.signatureDataUrl || row.signatureDataUrl || row.signatureUrl),
    signDate: clean(privateRow.signDate || row.signDate)
  };
}

function normalizeEmailForAdmin(value) {
  return lower(value);
}

async function personDataContractAction(data, request) {
  assertManager(request);
  const assignmentId = clean(data && data.assignmentId);
  const action = clean(data && data.action);
  const reason = clean(data && data.reason);
  if (!assignmentId) throw new HttpsError('invalid-argument', '缺少合約指派編號。');
  if (!['approve', 'return'].includes(action)) throw new HttpsError('invalid-argument', '不支援的合約操作。');
  if (action === 'return' && !reason) throw new HttpsError('invalid-argument', '請填寫退回原因。');
  const assignmentRef = db.collection('teacherContractAssignments').doc(assignmentId);
  const privateRef = db.collection('teacherContractPrivateSnapshots').doc(assignmentId);
  const logRef = db.collection('teacherContractLogs').doc(assignmentId);
  await db.runTransaction(async (transaction) => {
    const assignmentSnapshot = await transaction.get(assignmentRef);
    if (!assignmentSnapshot.exists) throw new HttpsError('not-found', '找不到這筆合約，請重新整理。');
    const row = assignmentSnapshot.data() || {};
    const status = contractAssignmentReviewStatus(row);
    if (!['submitted_pending_admin', 'signed'].includes(status)) {
      throw new HttpsError('failed-precondition', '這筆合約目前不是等待主管確認的狀態。');
    }
    const privateSnapshot = await transaction.get(privateRef);
    const privateRow = privateSnapshot.exists ? privateSnapshot.data() || {} : {};
    const hasSignature = row.signatureRecorded === true || Boolean(clean(
      privateRow.signatureDataUrl || row.signatureDataUrl || row.signatureUrl || row.signedAt
    ));
    if (!hasSignature) throw new HttpsError('failed-precondition', '這筆合約沒有老師簽名，不能核准。');
    const actor = actorOf(request);
    if (action === 'approve') {
      const patch = {
        status: 'active',
        statusLabel: '契約生效',
        progressStatus: '主管已確認，契約生效',
        confirmedAt: FV.serverTimestamp(),
        confirmedAtText: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
        confirmedBy: actor,
        revisionReason: FV.delete(),
        updatedAt: FV.serverTimestamp()
      };
      transaction.set(assignmentRef, patch, { merge: true });
      if (privateSnapshot.exists) transaction.set(privateRef, patch, { merge: true });
      transaction.set(logRef, Object.assign({
        assignmentId,
        employeeId: clean(row.employeeId || row.externalTeacherEmployeeId),
        teacherId: clean(row.teacherId),
        contractId: clean(row.contractId || row.templateId),
        contractName: clean(row.contractName || row.title),
        year: clean(row.year),
        source: 'person-data-admin-contract-review'
      }, patch), { merge: true });
      const employeeId = clean(row.employeeId || row.externalTeacherEmployeeId);
      if (employeeId) {
        transaction.set(db.collection('employees').doc(employeeId), {
          currentExternalContractId: assignmentId,
          externalTeacherContractId: assignmentId,
          latestExternalContractId: assignmentId,
          latestExternalContractYear: clean(row.year),
          latestExternalContractStatus: 'active',
          latestExternalContractProgress: '主管已確認，契約生效',
          contractReviewStatus: 'active',
          updatedAt: FV.serverTimestamp()
        }, { merge: true });
      }
      return;
    }
    const patch = {
      status: 'needs_revision',
      statusLabel: '退回修改',
      progressStatus: '主管退回，等待老師重新簽署',
      revisionReason: reason,
      returnedAt: FV.serverTimestamp(),
      returnedBy: actor,
      updatedAt: FV.serverTimestamp()
    };
    transaction.set(assignmentRef, patch, { merge: true });
    if (privateSnapshot.exists) transaction.set(privateRef, patch, { merge: true });
    transaction.set(logRef, Object.assign({
      assignmentId,
      employeeId: clean(row.employeeId || row.externalTeacherEmployeeId),
      teacherId: clean(row.teacherId),
      contractId: clean(row.contractId || row.templateId),
      contractName: clean(row.contractName || row.title),
      year: clean(row.year),
      source: 'person-data-admin-contract-review'
    }, patch), { merge: true });
  });
  return {
    ok: true,
    status: action === 'approve' ? 'active' : 'needs_revision',
    message: action === 'approve' ? '已確認合約生效。' : '已退回老師重新簽署。'
  };
}

function profileChangeStatus(row) {
  const source = row || {};
  const approval = lower(source.approvalStatus);
  if (approval === 'approved') return '已核准';
  if (approval === 'rejected') return '已駁回';
  return clean(source.status || source['狀態'] || '待審核');
}

function pendingProfileChange(row) {
  const status = lower(profileChangeStatus(row));
  return ['', 'pending', 'pending_review', '待審核', '未處理'].includes(status);
}

function publicProfileChanges(row) {
  const source = row || {};
  if (Array.isArray(source.changes)) {
    return source.changes.slice(0, 40).map((change) => ({
      key: clean(change && change.key),
      label: clean(change && change.label) || '資料欄位',
      before: clean(change && change.before) || '未填寫',
      after: clean(change && change.after) || '已刪除',
      immediate: change && change.immediate === true
    }));
  }
  const legacyFields = [
    ['mobilePhone', '行動電話'],
    ['email', 'Email'],
    ['address', '聯絡地址'],
    ['emergencyContact', '緊急聯絡人'],
    ['emergencyPhone', '緊急聯絡人電話']
  ];
  return legacyFields.map(([key, label]) => ({
    key,
    label,
    before: '原正式資料',
    after: clean(source[key] || source[label])
  })).filter((change) => change.after);
}

function profileChangeDateText(row, field, fallbackField) {
  const source = row || {};
  const direct = clean(source[fallbackField]);
  if (direct) return direct;
  const millis = timestampMs(source[field]);
  return millis ? new Date(millis).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '';
}

function publicProfileChangeRequest(doc) {
  const row = doc.data() || {};
  const status = profileChangeStatus(row);
  return {
    requestId: clean(row.requestId || doc.id),
    profileId: clean(row.profileId || row.externalTeacherProfileId),
    employeeId: clean(row.employeeId || row.userId || row.applicantId),
    teacherId: clean(row.teacherId),
    name: clean(row.name || row.teacherName || row.employeeName) || '未命名人員',
    status,
    approvalStatus: clean(row.approvalStatus) || (pendingProfileChange(row) ? 'pending' : ''),
    changes: publicProfileChanges(row),
    changeCount: Number(row.changeCount || 0) || publicProfileChanges(row).length,
    subjectChangesAlreadyEffective: row.subjectChangesAlreadyEffective === true,
    rejectReason: clean(row.rejectReason || row.revisionReason || row['駁回原因']),
    reviewedBy: clean(row.reviewedBy),
    createdAt: profileChangeDateText(row, 'createdAt', 'createdAtText'),
    createdAtMs: timestampMs(row.createdAt),
    reviewedAt: profileChangeDateText(row, 'reviewedAt', 'reviewedAtText'),
    source: clean(row.source),
    pending: pendingProfileChange(row)
  };
}

async function personDataProfileChangeInventory(data, request) {
  assertManager(request);
  const snapshot = await db.collection('profileChangeRequests').limit(1000).get();
  let rows = snapshot.docs.map(publicProfileChangeRequest);
  const focusId = clean(data && data.requestId);
  if (focusId) rows = rows.filter((row) => row.requestId === focusId);
  rows.sort((left, right) =>
    Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0) || right.requestId.localeCompare(left.requestId)
  );
  return { ok: true, rows };
}

function reviewedRequestPatch(action, request, reason) {
  const approved = action === 'approve';
  return {
    status: approved ? '已核准' : '已駁回',
    '狀態': approved ? '已核准' : '已駁回',
    approvalStatus: approved ? 'approved' : 'rejected',
    reviewedAt: FV.serverTimestamp(),
    reviewedAtText: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
    reviewedBy: actorOf(request),
    rejectReason: approved ? FV.delete() : reason,
    updatedAt: FV.serverTimestamp()
  };
}

function submittedProfilePublicPatch(source) {
  const row = source || {};
  const teachingAbilities = normalizeAbilities(row.teachingAbilities);
  const mobilePhone = rowPhone(row);
  return {
    name: clean(row.name),
    mobilePhone,
    mobile: mobilePhone,
    phone: mobilePhone,
    email: lower(row.email),
    birthDate: clean(row.birthDate),
    householdAddress: clean(row.householdAddress),
    mailingAddress: clean(row.mailingAddress),
    emergencyContact: clean(row.emergencyContact),
    emergencyPhone: rowPhone({ mobilePhone: row.emergencyPhone }),
    teachingAbilities,
    teachingItems: teachingAbilities.map((ability) => ability.item).join('、'),
    teachingItemsText: teachingAbilities.map((ability) => ability.item).join('、'),
    idNumberMasked: clean(row.idNumberMasked),
    identityFileCount: Math.max(0, Number(row.identityFileCount || 0)),
    identityPhotoStatus: Number(row.identityFileCount || 0) > 0 ? 'uploaded' : 'missing',
    idNumber: FV.delete(),
    identityNumber: FV.delete(),
    identityFiles: FV.delete(),
    identityUrls: FV.delete(),
    profileChangeStatus: 'approved',
    pendingProfileChangeRequestId: FV.delete(),
    profileRevisionReason: FV.delete(),
    updatedAt: FV.serverTimestamp()
  };
}

function submittedProfilePrivatePatch(source, profileId, employeeId, teacherId) {
  const row = source || {};
  return {
    profileId,
    employeeId,
    coursePortalTeacherId: teacherId,
    idNumber: clean(row.idNumber || row.identityNumber),
    identityFiles: Array.isArray(row.identityFiles) ? row.identityFiles : [],
    updatedAt: FV.serverTimestamp()
  };
}

function submittedEmployeePatch(publicProfile) {
  const row = publicProfile || {};
  const mobilePhone = rowPhone(row);
  const teachingAbilities = normalizeAbilities(row.teachingAbilities);
  return {
    name: clean(row.name),
    displayName: clean(row.name),
    mobilePhone,
    mobile: mobilePhone,
    phone: mobilePhone,
    email: lower(row.email),
    householdAddress: clean(row.householdAddress),
    mailingAddress: clean(row.mailingAddress),
    emergencyContact: clean(row.emergencyContact),
    emergencyPhone: rowPhone({ mobilePhone: row.emergencyPhone }),
    teachingAbilities,
    teachingItems: teachingAbilities.map((ability) => ability.item).join('、'),
    profileChangeStatus: 'approved',
    pendingProfileChangeRequestId: FV.delete(),
    profileChangeSubmittedAt: FV.delete(),
    profileRevisionReason: FV.delete(),
    updatedAt: FV.serverTimestamp()
  };
}

async function personDataProfileChangeAction(data, request) {
  assertManager(request);
  const requestId = clean(data && data.requestId);
  const action = clean(data && data.action);
  const reason = clean(data && (data.reason || data.rejectReason));
  if (!requestId) throw new HttpsError('invalid-argument', '缺少個資修改申請編號。');
  if (!['approve', 'reject'].includes(action)) throw new HttpsError('invalid-argument', '不支援的個資簽核操作。');
  if (action === 'reject' && !reason) throw new HttpsError('invalid-argument', '請填寫退回原因。');
  const requestRef = db.collection('profileChangeRequests').doc(requestId);
  const submittedDraftRef = db.collection(TEACHER_PROFILE_CHANGE_DRAFTS).doc(requestId);
  await db.runTransaction(async (transaction) => {
    const requestSnapshot = await transaction.get(requestRef);
    if (!requestSnapshot.exists) throw new HttpsError('not-found', '找不到這筆個資修改申請。');
    const requestRow = requestSnapshot.data() || {};
    const submittedDraftSnapshot = await transaction.get(submittedDraftRef);
    const portalRequest = submittedDraftSnapshot.exists;
    if (!portalRequest) {
      if (!pendingProfileChange(requestRow)) throw new HttpsError('failed-precondition', '這筆申請已經處理過。');
      const employeeId = clean(requestRow.employeeId || requestRow.userId || requestRow.applicantId);
      if (action === 'approve' && employeeId) {
        const employeeRef = db.collection('employees').doc(employeeId);
        const employeeSnapshot = await transaction.get(employeeRef);
        if (!employeeSnapshot.exists) throw new HttpsError('not-found', '找不到這筆申請對應的人員主檔。');
        const patch = { updatedAt: FV.serverTimestamp(), source: 'profile-change-approved' };
        [
          ['mobilePhone', 'mobilePhone'], ['address', 'address'], ['email', 'email'],
          ['emergencyContact', 'emergencyContact'], ['emergencyPhone', 'emergencyPhone']
        ].forEach(([sourceKey, targetKey]) => {
          const value = clean(requestRow[sourceKey]);
          if (value) patch[targetKey] = sourceKey === 'email' ? lower(value) : value;
        });
        transaction.set(employeeRef, patch, { merge: true });
      }
      transaction.set(requestRef, reviewedRequestPatch(action, request, reason), { merge: true });
      return;
    }

    const submitted = submittedDraftSnapshot.data() || {};
    if (clean(submitted.status) !== 'pending_review') {
      throw new HttpsError('failed-precondition', '這筆申請已經處理過，請重新整理。');
    }
    const profileId = clean(submitted.profileId);
    const employeeId = clean(submitted.employeeId);
    const teacherId = clean(submitted.teacherId);
    if (!profileId || !employeeId || !teacherId || clean(submitted.requestId) !== requestId) {
      throw new HttpsError('failed-precondition', '這筆申請的老師歸屬不完整，已停止處理。');
    }
    if ((clean(requestRow.profileId) && clean(requestRow.profileId) !== profileId) ||
        (clean(requestRow.employeeId) && clean(requestRow.employeeId) !== employeeId) ||
        (clean(requestRow.teacherId) && clean(requestRow.teacherId) !== teacherId)) {
      throw new HttpsError('failed-precondition', '申請清單與安全快照的老師歸屬不一致，已停止處理。');
    }
    const profileRef = db.collection('externalTeacherProfiles').doc(profileId);
    const privateRef = db.collection('teacherPrivateProfiles').doc(profileId);
    const employeeRef = db.collection('employees').doc(employeeId);
    const editableDraftRef = db.collection(TEACHER_PROFILE_DRAFTS).doc(profileId);
    const [profileSnapshot, privateSnapshot, employeeSnapshot, editableDraftSnapshot] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(privateRef),
      transaction.get(employeeRef),
      transaction.get(editableDraftRef)
    ]);
    if (!profileSnapshot.exists || !employeeSnapshot.exists) {
      throw new HttpsError('not-found', '找不到老師的正式個人資料或人員主檔。');
    }
    const editableDraft = editableDraftSnapshot.exists ? editableDraftSnapshot.data() || {} : {};
    if (editableDraftSnapshot.exists && clean(editableDraft.requestId) && clean(editableDraft.requestId) !== requestId) {
      throw new HttpsError('failed-precondition', '老師已有較新的修改草稿，請重新整理後再處理。');
    }
    const publicProfile = submitted.publicProfile && typeof submitted.publicProfile === 'object'
      ? submitted.publicProfile
      : {};
    const privateProfile = submitted.privateProfile && typeof submitted.privateProfile === 'object'
      ? submitted.privateProfile
      : {};
    const reviewedPatch = reviewedRequestPatch(action, request, reason);
    if (action === 'approve') {
      transaction.set(profileRef, submittedProfilePublicPatch(publicProfile), { merge: true });
      transaction.set(privateRef, submittedProfilePrivatePatch(privateProfile, profileId, employeeId, teacherId), { merge: true });
      transaction.set(employeeRef, submittedEmployeePatch(publicProfile), { merge: true });
      transaction.set(requestRef, reviewedPatch, { merge: true });
      transaction.delete(submittedDraftRef);
      if (editableDraftSnapshot.exists) transaction.delete(editableDraftRef);
      return;
    }
    transaction.set(profileRef, {
      profileChangeStatus: 'needs_revision',
      pendingProfileChangeRequestId: FV.delete(),
      profileRevisionReason: reason,
      updatedAt: FV.serverTimestamp()
    }, { merge: true });
    transaction.set(employeeRef, {
      profileChangeStatus: 'needs_revision',
      pendingProfileChangeRequestId: FV.delete(),
      profileChangeSubmittedAt: FV.delete(),
      profileRevisionReason: reason,
      updatedAt: FV.serverTimestamp()
    }, { merge: true });
    transaction.set(requestRef, reviewedPatch, { merge: true });
    transaction.set(submittedDraftRef, {
      status: 'rejected',
      revisionReason: reason,
      reviewedAt: FV.serverTimestamp(),
      reviewedBy: actorOf(request)
    }, { merge: true });
    transaction.set(editableDraftRef, {
      requestId: FV.delete(),
      status: 'needs_revision',
      revisionReason: reason,
      submittedAt: FV.delete(),
      submittedAtText: FV.delete(),
      updatedAt: FV.serverTimestamp()
    }, { merge: true });
  });
  return {
    ok: true,
    status: action === 'approve' ? 'approved' : 'rejected',
    message: action === 'approve'
      ? '已核准並更新老師正式資料；老師自填的授課科目仍維持即時生效。'
      : '已退回老師修改；授課科目屬老師自填資料，維持目前設定。'
  };
}

function registerPersonDataAdmin(exportsObject) {
  exportsObject.personDataAdminInventory = onCall({ region: REGION, timeoutSeconds: 300, memory: '1GiB' }, (request) =>
    personDataInventory(request && request.data || {}, request));
  exportsObject.personDataAdminDetail = onCall({ region: REGION, timeoutSeconds: 300, memory: '1GiB' }, (request) =>
    personDataDetail(request && request.data || {}, request));
  exportsObject.personDataAdminAction = onCall({ region: REGION, timeoutSeconds: 300, memory: '1GiB' }, (request) =>
    personDataAction(request && request.data || {}, request));
  exportsObject.personDataAdminContractInventory = onCall({ region: REGION, timeoutSeconds: 120, memory: '512MiB' }, (request) =>
    personDataContractInventory(request && request.data || {}, request));
  exportsObject.personDataAdminContractDetail = onCall({ region: REGION, timeoutSeconds: 120, memory: '512MiB' }, (request) =>
    personDataContractDetail(request && request.data || {}, request));
  exportsObject.personDataAdminContractAction = onCall({ region: REGION, timeoutSeconds: 120, memory: '512MiB' }, (request) =>
    personDataContractAction(request && request.data || {}, request));
  exportsObject.personDataAdminProfileChangeInventory = onCall({ region: REGION, timeoutSeconds: 120, memory: '512MiB' }, (request) =>
    personDataProfileChangeInventory(request && request.data || {}, request));
  exportsObject.personDataAdminProfileChangeAction = onCall({ region: REGION, timeoutSeconds: 120, memory: '512MiB' }, (request) =>
    personDataProfileChangeAction(request && request.data || {}, request));
}

module.exports = {
  registerPersonDataAdmin,
  __test: {
    identityKeys,
    buildGroups,
    contractIsFormal,
    rowIsFormal,
    activeEmployee,
    recordBelongsToPersonnel,
    profileReadiness,
    pendingProfileChange,
    publicProfileChanges,
    publicProfileChangeRequest,
    contractAssignmentReviewStatus,
    publicContractAssignment,
    SOURCE_SPECS
  }
};
