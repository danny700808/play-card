'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const admin = require('firebase-admin');
const personData = require('../personDataAdmin').__test;
const cleanup = require('../personnelCleanup20260807');
const clean = (value) => String(value == null ? '' : value).trim();
const lower = (value) => clean(value).toLowerCase();
const uniq = (values) => [...new Set((values || []).map(clean).filter(Boolean))];
const sha256 = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');

function serviceAccountProjectId() {
  const credentialPath = clean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  if (!credentialPath) return clean(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT);
  try {
    const source = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
    return clean(source.project_id || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT);
  } catch (_) {
    return clean(process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT);
  }
}

if (!admin.apps.length) {
  const projectId = serviceAccountProjectId();
  admin.initializeApp(Object.assign({}, projectId ? {
    projectId,
    storageBucket: clean(process.env.FIREBASE_STORAGE_BUCKET) || `${projectId}.appspot.com`
  } : {}));
}
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const PAGE_SIZE = 400;
const BATCH_SIZE = 350;
const CONFIRMATION = '保留廖浤鈞工讀生與黃銘廷管理者，刪除其餘測試人員';
const EXTRA_COLLECTIONS = [
  ['employeeAuthRateLimits', ['employeeId', 'userId'], [], ['emailHash']],
  ['coursePortalEmailOtps', ['employeeId', 'personMasterId'], ['teacherId'], []],
  ['coursePortalBindCodes', ['employeeId', 'personMasterId'], ['teacherId'], []],
  ['coursePortalLineLoginCodes', ['employeeId', 'personMasterId'], ['teacherId'], []],
  ['coursePortalLineOAuthStates', ['employeeId', 'personMasterId'], ['teacherId'], []],
  ['coursePortalLineSetupTokens', ['employeeId', 'personMasterId'], ['teacherId'], []]
];
const oneTimeSpec = (collection, label, employeeFields, teacherFields, kind, unwrapSource) => ({
  collection, label, employeeFields: employeeFields || [], teacherFields: teacherFields || [],
  kind, unwrapSource: unwrapSource === true
});
const ONE_TIME_PERSONNEL_SPECS = [
  oneTimeSpec('clockFailures', '打卡失敗紀錄', ['employeeId', 'userId', '員工ID'], [], 'attendance'),
  oneTimeSpec('opsEducationMirrorTeachers', '課務老師鏡像', [], ['id', 'teacherId', 'sourceId'], 'role', true),
  oneTimeSpec('opsEducationMirrorTeacherPayroll', '課務老師薪資鏡像', [], ['teacherId'], 'payroll', true),
  oneTimeSpec('opsEducationMirrorTeacherAdjustments', '課務老師調整鏡像', [], ['teacherId'], 'payroll', true),
  oneTimeSpec('opsEducationMirrorAttendance', '課務簽到鏡像', [], ['teacherId'], 'attendance', true),
  oneTimeSpec('opsInjiaoyunTestTeachers', '舊課務老師來源', [], ['id', 'teacherId', 'sourceId'], 'role'),
  oneTimeSpec('opsInjiaoyunTestTeacherDetails', '舊課務老師資料', [], ['id', 'teacherId', 'sourceId'], 'profile'),
  oneTimeSpec('opsInjiaoyunTestTeacherAnalysis', '舊課務老師分析', [], ['id', 'teacherId', 'sourceId'], 'profile'),
  oneTimeSpec('opsInjiaoyunTestTeacherFixedCourses', '舊課務固定課程', [], ['teacherId'], 'schedule'),
  oneTimeSpec('opsInjiaoyunTestTeacherTemporaryCourses', '舊課務臨時課程', [], ['teacherId'], 'schedule'),
  oneTimeSpec('opsInjiaoyunTestTeacherNoCourses', '舊課務無課紀錄', [], ['teacherId'], 'schedule'),
  oneTimeSpec('opsInjiaoyunTestTeacherDeductions', '舊課務老師扣款', [], ['teacherId'], 'payroll'),
  oneTimeSpec('opsInjiaoyunTestTeacherRewards', '舊課務老師獎勵', [], ['teacherId'], 'payroll'),
  oneTimeSpec('opsInjiaoyunTestHistoryPayrollCheckins', '舊薪資簽到', [], ['teacherId'], 'payroll'),
  oneTimeSpec('opsInjiaoyunTestHistoryPayrollReducePaychecks', '舊薪資扣款', [], ['teacherId'], 'payroll'),
  oneTimeSpec('opsInjiaoyunTestHistoryPayrollRewards', '舊薪資獎勵', [], ['teacherId'], 'payroll'),
  oneTimeSpec('opsInjiaoyunTestCheckinLeaves', '舊課務簽到請假', [], ['teacherId'], 'attendance'),
  oneTimeSpec('opsInjiaoyunTestLeaves', '舊課務請假', [], ['teacherId'], 'attendance')
];
const PERSONNEL_COLLECTION_HINT = /(employee|teacher|staff|admin|manager|attendance|clock|leave|payroll|salary|person|notification|binding|session|token|contract|profile)/i;
const KNOWN_NON_PERSONNEL_COLLECTIONS = new Set([
  'coursePortalStudentBindings', 'coursePortalRenterBindings', 'coursePortalStudentProfiles',
  'coursePortalStudentSuspensions', 'coursePortalRoomBookings', 'coursePortalAttendanceLessonLocks',
  'rentalApplications', 'rentalContracts', 'rentalRenewalRequests', 'rentalReturnRequests',
  'externalTeacherContractTemplates', 'lineBindingAdminAudit', 'personDataAdminAudits',
  'personDeletionTombstones', 'notificationFeatureSettings', 'notificationManagerRecipients',
  'notificationSettings', 'notificationSettingsV2', 'notificationTimeRules', 'notificationUniversal',
  'notificationV2Settings', 'opsEducationMirrorLeaveReasons', 'opsInjiaoyunTestLeaveReasons',
  'opsInjiaoyunTestPermissionManagerLogs', 'salarySetup', 'salarySettings',
  'teacherContractSettings', 'teacherContractTemplates'
]);

async function readCollection(collection, spec) {
  const rows = [];
  let cursor = null;
  for (;;) {
    let query = db.collection(collection).orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    snapshot.docs.forEach((doc) => {
      const stored = doc.data() || {};
      const row = spec && spec.unwrapSource && stored.source && typeof stored.source === 'object'
        ? Object.assign({}, stored, stored.source)
        : stored;
      if (spec && !personData.recordBelongsToPersonnel(spec, row)) return;
      rows.push({ spec, docId: doc.id, ref: doc.ref, row });
    });
    if (snapshot.size < PAGE_SIZE) break;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
  return rows;
}

async function readPersonnelRecords() {
  const specs = personData.SOURCE_SPECS.concat(ONE_TIME_PERSONNEL_SPECS);
  const chunks = await Promise.all(specs.map((spec) => readCollection(spec.collection, spec)));
  return chunks.flat();
}

async function uncoveredPersonnelCollections() {
  const covered = new Set(personData.SOURCE_SPECS.concat(ONE_TIME_PERSONNEL_SPECS).map((spec) => spec.collection)
    .concat(EXTRA_COLLECTIONS.map((item) => item[0])));
  const collections = await db.listCollections();
  return collections.map((collection) => collection.id).filter((name) =>
    PERSONNEL_COLLECTION_HINT.test(name) && !covered.has(name) && !KNOWN_NON_PERSONNEL_COLLECTIONS.has(name)
  ).sort();
}

function valueMatches(row, fields, values) {
  const set = values instanceof Set ? values : new Set(values || []);
  return (fields || []).some((field) => set.has(clean(row && row[field])));
}

async function readExtraTargets(plan) {
  const employeeIds = new Set(plan.targetEmployeeIds);
  const teacherIds = new Set(plan.targetTeacherIds.concat(plan.targetProfileIds));
  const emailHashes = new Set(plan.deleteEmails.map(sha256));
  const results = [];
  for (const [collection, employeeFields, teacherFields, hashFields] of EXTRA_COLLECTIONS) {
    const rows = await readCollection(collection, null);
    rows.forEach((record) => {
      if (valueMatches(record.row, employeeFields, employeeIds) ||
          valueMatches(record.row, teacherFields, teacherIds) ||
          valueMatches(record.row, hashFields, emailHashes)) results.push(record);
    });
  }
  return results;
}

function storagePaths(records) {
  const values = [];
  (records || []).forEach((record) => {
    const row = record.row || {};
    ['storagePath', 'identityStoragePath', 'signatureStoragePath', 'contractStoragePath', 'path'].forEach((field) => {
      if (clean(row[field])) values.push(clean(row[field]));
    });
    ['identityFiles', 'files', 'attachments'].forEach((field) => {
      if (!Array.isArray(row[field])) return;
      row[field].forEach((file) => {
        if (clean(file && (file.storagePath || file.path))) values.push(clean(file.storagePath || file.path));
      });
    });
  });
  return uniq(values).filter((value) =>
    value.startsWith('external-teachers/') || value.startsWith('teacher-private-profiles/'));
}

async function commitDeletes(records) {
  const unique = [...new Map(records.map((record) => [record.ref.path, record])).values()];
  let deleted = 0;
  for (let offset = 0; offset < unique.length; offset += BATCH_SIZE) {
    const batch = db.batch();
    const slice = unique.slice(offset, offset + BATCH_SIZE);
    slice.forEach((record) => batch.delete(record.ref));
    await batch.commit();
    deleted += slice.length;
  }
  return deleted;
}

async function normalizeKeepers(plan) {
  const operations = [];
  plan.keepParttimeRecords.forEach((record) => {
    if (record.spec.collection !== 'employees' || cleanup.rowName(record.row) !== cleanup.KEEP_PARTTIME_NAME) return;
    operations.push([record.ref, {
      identityType: 'parttime', isPartTime: true, active: true,
      accountStatus: 'active', employmentStatus: 'active', hiddenFromActiveLists: false,
      personnelCleanupProtected: true, updatedAt: FV.serverTimestamp()
    }]);
  });
  plan.keepManagerRecords.forEach((record) => {
    if (!cleanup.canonicalManagerAccount(record) && !cleanup.primaryManagerInfrastructure(record)) return;
    const patch = {
      name: cleanup.KEEP_MANAGER_NAME, displayName: cleanup.KEEP_MANAGER_NAME,
      role: 'admin', active: true, accountStatus: 'active', showSettingsZone: true,
      isManager: true, personnelCleanupProtected: true, updatedAt: FV.serverTimestamp()
    };
    if (record.spec.collection === 'employees') Object.assign(patch, {
      identityType: 'admin', isPartTime: false, isExternalTeacher: false, hiddenFromActiveLists: true
    });
    operations.push([record.ref, patch]);
  });
  for (let offset = 0; offset < operations.length; offset += BATCH_SIZE) {
    const batch = db.batch();
    operations.slice(offset, offset + BATCH_SIZE).forEach(([ref, patch]) =>
      batch.set(ref, patch, { merge: true }));
    await batch.commit();
  }
  return operations.length;
}

async function deleteAuthUsers(plan) {
  const employeeIds = new Set(plan.targetEmployeeIds.concat(plan.targetTeacherIds));
  const emails = new Set(plan.deleteEmails.map(lower));
  const keepEmails = new Set(plan.keepEmails.map(lower));
  const keepPersonIds = new Set(plan.keepPersonIds || []);
  let pageToken;
  const targets = [];
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    page.users.forEach((user) => {
      const claims = user.customClaims || {};
      const claimedId = clean(claims.employeeId || claims.teacherId || claims.personMasterId);
      const personnelClaim = claims.employee === true || claims.manager === true ||
        ['employee', 'teacher', 'external', 'staff', 'parttime', 'admin', 'manager'].includes(lower(claims.role || claims.identityType));
      const email = lower(user.email);
      if (keepEmails.has(email) || (claimedId && keepPersonIds.has(claimedId))) return;
      if (personnelClaim && ((claimedId && employeeIds.has(claimedId)) || (email && emails.has(email)))) targets.push(user.uid);
    });
    pageToken = page.pageToken;
  } while (pageToken);
  let deleted = 0;
  for (let offset = 0; offset < targets.length; offset += 1000) {
    const result = await admin.auth().deleteUsers(targets.slice(offset, offset + 1000));
    deleted += Number(result.successCount || 0);
    if (result.failureCount) {
      const codes = (result.errors || []).map((item) => clean(item && item.error && item.error.code)).filter(Boolean);
      throw new Error(`Firebase Auth 刪除失敗 ${result.failureCount} 筆：${uniq(codes).join(', ') || '未知錯誤'}`);
    }
  }
  return deleted;
}

async function deleteStorage(paths) {
  let deleted = 0;
  for (const storagePath of paths) {
    try {
      await admin.storage().bucket().file(storagePath).delete({ ignoreNotFound: true });
      deleted += 1;
    } catch (error) {
      console.error('[personnel cleanup storage]', sha256(storagePath).slice(0, 16), error && error.message || error);
    }
  }
  return deleted;
}

function publicSummary(plan, extraCount) {
  return Object.assign({}, plan.summary, {
    extraRelatedRecords: Number(extraCount || 0),
    keepParttimeByCollection: cleanup.countByCollection(plan.keepParttimeRecords),
    keepManagerByCollection: cleanup.countByCollection(plan.keepManagerRecords),
    keepManagerReferenceHashes: uniq(plan.keepManagerRecords.map((record) =>
      sha256(record.ref.path).slice(0, 12))).sort(),
    keepParttimeValidated: true,
    keepManagerValidated: true
  });
}

async function run() {
  const modePath = path.join(__dirname, 'personnel-cleanup-20260807.mode');
  const mode = lower(fs.readFileSync(modePath, 'utf8'));
  if (!['audit', 'execute'].includes(mode)) throw new Error(`不支援的清理模式：${mode}`);
  const records = await readPersonnelRecords();
  const plan = cleanup.buildCleanupPlan(records);
  const extras = await readExtraTargets(plan);
  const uncovered = await uncoveredPersonnelCollections();
  const summary = Object.assign(publicSummary(plan, extras.length), {
    uncoveredPersonnelCollections: uncovered
  });
  console.log('PERSONNEL_CLEANUP_AUDIT=' + JSON.stringify(summary));
  if (mode === 'audit') return;
  if (uncovered.length) {
    throw new Error(`尚有未分類的人員相關集合：${uncovered.join(', ')}。未執行刪除。`);
  }
  if (clean(process.env.PERSONNEL_CLEANUP_CONFIRM) !== CONFIRMATION) {
    throw new Error('缺少一次性清理確認文字，未執行刪除。');
  }

  const operationRef = db.collection('personDataAdminAudits').doc();
  await operationRef.set({
    auditId: operationRef.id,
    action: 'one-time-personnel-test-cleanup-20260807',
    status: 'running',
    keepPolicy: {
      parttimeName: cleanup.KEEP_PARTTIME_NAME,
      managerName: cleanup.KEEP_MANAGER_NAME,
      managerOnly: true
    },
    summary,
    startedAt: FV.serverTimestamp(),
    sourceCommit: clean(process.env.GITHUB_SHA)
  });

  const deleteRecords = [...new Map(plan.targetRecords.concat(extras)
    .filter((record) => !plan.keepPaths.has(record.ref.path))
    .map((record) => [record.ref.path, record])).values()];
  const paths = storagePaths(deleteRecords);
  const keeperWrites = await normalizeKeepers(plan);
  // 先移除待刪人員的身分驗證；如 Auth 批次失敗，尚未刪除 Firestore 主資料，可安全重試。
  const deletedAuthUsers = await deleteAuthUsers(plan);
  const deletedRecords = await commitDeletes(deleteRecords);
  const deletedFiles = await deleteStorage(paths);

  const remainingRecords = await readPersonnelRecords();
  const verification = cleanup.buildCleanupPlan(remainingRecords);
  if (verification.targetRecords.length) {
    await operationRef.set({
      status: 'incomplete', remainingRecords: verification.targetRecords.length,
      updatedAt: FV.serverTimestamp()
    }, { merge: true });
    throw new Error(`清理後仍有 ${verification.targetRecords.length} 筆非保留人員資料。`);
  }
  await operationRef.set({
    status: 'completed', deletedRecords, deletedAuthUsers, deletedFiles, keeperWrites,
    verifiedRemainingRecords: remainingRecords.length,
    completedAt: FV.serverTimestamp()
  }, { merge: true });
  console.log('PERSONNEL_CLEANUP_RESULT=' + JSON.stringify({
    status: 'completed', deletedRecords, deletedAuthUsers, deletedFiles, keeperWrites,
    verifiedNoOtherPersonnel: true
  }));
}

run().catch((error) => {
  console.error('PERSONNEL_CLEANUP_FAILED=' + (error && error.message || error));
  process.exitCode = 1;
});
