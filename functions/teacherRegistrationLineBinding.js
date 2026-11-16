'use strict';

const {isRegistrationOnly} = require('./teacherRegistrationPolicy');
const clean = value => String(value == null ? '' : value).trim();
const allowedStates = new Set(['waiting_bindings', 'waiting_email_link', 'waiting_contract', 'needs_revision', 'submitted_pending_admin', 'active']);
const stopped = row => row.active === false || row.revoked === true || row.deleted === true || row.deletedAt || row.revokedAt ||
  ['revoked', 'cancelled', 'canceled', 'disabled', 'deleted', 'expired', 'inactive'].includes(clean(row.status).toLowerCase());
const registration = row => isRegistrationOnly(row) && !row.signatureUrl && !row.signedAt && !row.contractHtmlUrl;
const teacherIdOf = row => clean(row.externalTeacherContractId || row.teacherId);
const employeeIdOf = row => clean(row.employeeId || row.externalTeacherEmployeeId);
const validId = id => /^[A-Za-z0-9_-]{1,150}$/.test(id);

// This handler only accepts current, unsigned registrations. Historical teacher
// binding handlers remain disabled, and a notification binding grants no login role.
function createTeacherRegistrationLineBinding({db, FieldValue, replyLineMessage, getLineProfile, getPrimaryManagerLineRecipient, baseUrl}) {
  return async function handle(event) {
    if (event.type !== 'message' || event.message?.type !== 'text') return false;
    const match = clean(event.message.text).match(/^柚子人員綁定\s+(EMP-[A-F0-9]{36})$/i);
    if (!match) return false;
    const code = match[1].toUpperCase();
    const indexRefs = ['employeeLineBindings', 'externalTeacherLineBindings'].map(name => db.collection(name).doc(code));
    const initial = await indexRefs[0].get();
    if (!initial.exists || initial.data().targetCollection !== 'externalTeacherContracts') return false;
    const teacherId = teacherIdOf(initial.data());
    if (!validId(teacherId)) return false;
    const contractRef = db.collection('externalTeacherContracts').doc(teacherId);
    const candidate = await contractRef.get();
    if (!candidate.exists || !registration(candidate.data())) return false;
    const reply = message => replyLineMessage(event.replyToken, message);
    const lineUserId = clean(event.source?.userId);
    if (event.source?.type !== 'user' || !/^U[a-f0-9]{32}$/i.test(lineUserId)) {
      await reply('請使用老師本人的 LINE，私訊柚子樂器官方帳號完成綁定。');
      return true;
    }
    const manager = await getPrimaryManagerLineRecipient();
    if (manager?.lineUserId === lineUserId) {
      await reply('這支 LINE 是主管通知帳號，不能綁定老師資料。請使用老師本人的 LINE。');
      return true;
    }
    const lineProfile = await getLineProfile(lineUserId);
    const lockRef = db.collection('coursePortalRuntime').doc('teacherRegistrationLineBinding');
    const result = await db.runTransaction(async tx => {
      const [contract, ...indexes] = await Promise.all([tx.get(contractRef), ...indexRefs.map(ref => tx.get(ref))]);
      const row = contract.data() || {};
      const invalid = () => ({error: '這組老師註冊碼已失效或資料不一致，請聯絡管理者確認。'});
      if (!contract.exists || !registration(row) || stopped(row) || !allowedStates.has(clean(row.status))) return invalid();
      if (![row.bindingCode, row.onboardingToken].map(clean).includes(code)) return invalid();
      if (row.bindingMethod === 'email') return invalid();
      for (const index of indexes) {
        if (!index.exists) return invalid();
        const binding = index.data();
        if (stopped(binding) || binding.targetCollection !== 'externalTeacherContracts' || teacherIdOf(binding) !== teacherId) return invalid();
        if (['bindingCode', 'bindCode', 'employeeBindCode'].some(key => clean(binding[key]) && clean(binding[key]) !== code)) return invalid();
        if (clean(binding.lineUserId) && binding.lineUserId !== lineUserId) return {error: '這組老師資料已綁定其他 LINE，請由管理者確認後再處理。'};
      }
      const profileId = clean(row.externalTeacherProfileId || row.portalProfileId || teacherId);
      const employeeId = employeeIdOf(row);
      if (!validId(profileId) || (employeeId && !validId(employeeId))) return invalid();
      const profileRef = db.collection('externalTeacherProfiles').doc(profileId);
      const employeeRef = employeeId ? db.collection('employees').doc(employeeId) : null;
      const queries = ['employees', 'externalTeacherContracts', 'externalTeacherProfiles', 'coursePortalTeacherBindings']
        .map(name => db.collection(name).where('lineUserId', '==', lineUserId));
      const [profile, employee, lock, ...owners] = await Promise.all([
        tx.get(profileRef), employeeRef ? tx.get(employeeRef) : null, tx.get(lockRef), ...queries.map(query => tx.get(query))
      ]);
      if (!profile.exists || stopped(profile.data()) || !registration(profile.data()) ||
          ![profile.data().bindingCode, profile.data().onboardingToken].map(clean).includes(code)) return invalid();
      if (employeeRef && (!employee.exists || stopped(employee.data()) ||
          !['external', 'externalTeacher'].includes(clean(employee.data().identityType || employee.data().employeeType || employee.data().role)))) return invalid();
      const linkedRows = [row, profile.data(), ...(employee?.exists ? [employee.data()] : [])];
      if (linkedRows.some(item => clean(item.lineUserId) && item.lineUserId !== lineUserId)) {
        return {error: '這組老師資料已綁定其他 LINE，請由管理者確認後再處理。'};
      }
      const otherOwner = owners.some((snapshot, i) => snapshot.docs.some(doc => {
        const item = doc.data();
        if (i === 0) return doc.id !== employeeId;
        if (i === 1) return doc.id !== teacherId && !(employeeId && employeeIdOf(item) === employeeId);
        if (i === 2) return doc.id !== profileId && !(employeeId && employeeIdOf(item) === employeeId);
        return item.active !== false && !stopped(item) && clean(item.teacherId) !== clean(row.coursePortalTeacherId);
      }));
      if (otherOwner) return {error: '這支 LINE 已綁定其他人員，請先由管理者確認原本的綁定。'};
      const alreadyBound = linkedRows.every(item => item.lineUserId === lineUserId && item.lineBindStatus === 'bound') &&
        indexes.every(doc => doc.data().lineUserId === lineUserId && doc.data().status === 'bound');
      if (!alreadyBound) {
        const now = FieldValue.serverTimestamp();
        const patch = {lineUserId, lineDisplayName: clean(lineProfile?.displayName), lineBindStatus: 'bound',
          lineBoundAt: row.lineBoundAt || now, updatedAt: now};
        tx.set(contractRef, patch, {merge: true});
        tx.set(profileRef, patch, {merge: true});
        if (employeeRef) tx.set(employeeRef, patch, {merge: true});
        for (const ref of indexRefs) tx.set(ref, {...patch, status: 'bound', boundAt: row.lineBoundAt || now}, {merge: true});
        // Serializes two different codes attempting to claim the same LINE, also
        // across regions. Contract reads likewise serialize manager approval.
        tx.set(lockRef, {version: Number(lock.data()?.version || 0) + 1, updatedAt: now}, {merge: true});
      }
      return {name: clean(row.name || row.teacherName), status: row.status};
    });
    if (result.error) await reply(result.error);
    else {
      let message = 'LINE 綁定完成 ✅\n' + result.name + '老師，';
      if (result.status === 'submitted_pending_admin') message += '您的資料已送出，目前等待管理者確認，不需要重新填寫。';
      else if (result.status === 'active') message += '您的老師資料已核准，LINE 聯絡資料已更新。';
      else {
        const url = new URL('external-teacher-onboarding.html', baseUrl);
        url.search = new URLSearchParams({id: teacherId, code}).toString();
        message += '請回到註冊頁繼續完成第三步的老師資料：\n' + url.href;
      }
      await reply(message);
    }
    return true;
  };
}

module.exports = {createTeacherRegistrationLineBinding};
