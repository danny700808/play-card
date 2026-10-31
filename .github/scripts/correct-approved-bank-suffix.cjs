'use strict';

function planCorrection(request, official, target) {
  const fail = message => { throw new Error(message); };
  for (const key of ['profileId', 'employeeId', 'teacherId']) {
    if (!target[key] || request[key] !== target[key]) fail('Request identity differs from the requested person');
  }
  if (official.profileId !== target.profileId || official.employeeId !== target.employeeId || official.coursePortalTeacherId !== target.teacherId) fail('Official profile identity differs');
  if (request.approvalStatus !== 'approved' || !['approved', '已核准'].includes(request.status)) fail('Request has not been approved');
  const changes = (request.changes || []).filter(row => row.key === 'bankAccountNumber');
  if (changes.length !== 1) fail('Expected exactly one bank account change');
  const {before, after} = changes[0];
  if (typeof before !== 'string' || typeof after !== 'string' || !/^\d{14}$/.test(before) || !/^\d{18}$/.test(after) || after.slice(0, 14) !== before) fail('Expected original 14 digits followed by exactly four additional digits');
  if (![before, after].includes(official.bankAccountNumber)) fail('Official account changed since approval');
  return {before: after, after: before, alreadyCorrect: official.bankAccountNumber === before};
}

async function correctAccount(db, timestamp, target, apply) {
  const requestRef = db.collection('profileChangeRequests').doc(target.requestId);
  const officialRef = db.collection('teacherPrivateProfiles').doc(target.profileId);
  const publicRef = db.collection('externalTeacherProfiles').doc(target.profileId);
  const draftRef = db.collection('teacherProfileDrafts').doc(target.profileId);
  const operationId = 'bank-suffix-correction-' + target.requestId;
  const correctionRef = db.collection('profileChangeRequests').doc(operationId);
  const auditRef = db.collection('personDataAdminAudits').doc(operationId);
  const result = await db.runTransaction(async tx => {
    const [requestSnap, officialSnap, publicSnap, draftSnap, correctionSnap, auditSnap] = await Promise.all(
      [requestRef, officialRef, publicRef, draftRef, correctionRef, auditRef].map(ref => tx.get(ref))
    );
    if (!requestSnap.exists || !officialSnap.exists || !publicSnap.exists) throw new Error('Required records are missing');
    if (draftSnap.exists) throw new Error('A newer editable draft exists; correction stopped');
    const request = requestSnap.data(), official = officialSnap.data(), publicProfile = publicSnap.data();
    const plan = planCorrection(request, official, target);
    if (publicProfile.employeeId !== target.employeeId) throw new Error('Public profile identity differs');
    const summary = {originalLength: 18, correctedLength: 14, removedDigits: 4, matchesOriginalAccount: true};
    if (correctionSnap.exists || auditSnap.exists) {
      if (!plan.alreadyCorrect || !correctionSnap.exists || !auditSnap.exists || correctionSnap.data().changes?.[0]?.after !== plan.after) throw new Error('Existing correction does not match current state');
      return {...summary, status: 'already-corrected'};
    }
    if (plan.alreadyCorrect) return {...summary, status: 'already-correct-no-write'};
    if (!apply) return {...summary, status: 'ready-no-writes'};
    const at = timestamp();
    tx.update(officialRef, {bankAccountNumber: plan.after, updatedAt: at});
    // Preserve the approved request as history; append the explicitly authorized correction.
    tx.create(correctionRef, {
      requestId: operationId, profileId: target.profileId, employeeId: target.employeeId, teacherId: target.teacherId,
      name: publicProfile.name || request.name || '', status: '已核准', approvalStatus: 'approved',
      changes: [{key: 'bankAccountNumber', label: '台新國際商業銀行帳號（移除尾端誤填4碼）', before: plan.before, after: plan.after}],
      changeCount: 1, source: 'owner-authorized-bank-suffix-correction', originalRequestId: target.requestId,
      reviewedBy: '管理者授權更正（Codex 執行）', createdAt: at, reviewedAt: at, updatedAt: at
    });
    tx.create(auditRef, {
      auditId: operationId, action: 'correct-bank-account-suffix', source: 'owner-explicit-request',
      employeeId: target.employeeId, profileId: target.profileId, teacherId: target.teacherId,
      originalRequestId: target.requestId, field: 'bankAccountNumber', before: plan.before, after: plan.after,
      reason: '管理者明確指示刪除核准帳號尾端多填的4碼，恢復原14碼',
      executedBy: process.env.GITHUB_ACTOR || 'Codex', runId: process.env.GITHUB_RUN_ID || '', createdAt: at
    });
    return {...summary, status: 'corrected'};
  });
  if (apply && ['corrected', 'already-corrected'].includes(result.status)) {
    const [request, official] = await Promise.all([requestRef.get(), officialRef.get()]);
    if (!planCorrection(request.data(), official.data(), target).alreadyCorrect) throw new Error('Read-back verification failed');
    result.readBackVerified = true;
  }
  return result;
}

module.exports = {planCorrection, correctAccount};

if (require.main === module) {
  (async () => {
    const env = process.env;
    if (!['inspect', 'apply'].includes(env.CORRECTION_MODE)) throw new Error('Unknown correction mode');
    const target = {requestId: env.REQUEST_ID, profileId: env.PROFILE_ID, employeeId: env.EMPLOYEE_ID, teacherId: env.TEACHER_ID};
    if (Object.values(target).some(value => !value || !/^[A-Za-z0-9_-]{1,100}$/.test(value))) throw new Error('Invalid record identifier');
    const credentials = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '{}');
    if (credentials.project_id !== 'youzi-c1b74') throw new Error('Unexpected project');
    const admin = require('../../functions/node_modules/firebase-admin');
    admin.initializeApp({credential: admin.credential.cert(credentials), projectId: 'youzi-c1b74'});
    try {
      console.log(JSON.stringify(await correctAccount(admin.firestore(), () => admin.firestore.FieldValue.serverTimestamp(), target, env.CORRECTION_MODE === 'apply')));
    } finally { await admin.app().delete(); }
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
