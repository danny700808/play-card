'use strict';
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { recipientFields, notificationRecipientKey } = require('./portalNotificationPolicy');
const clean = value => String(value == null ? '' : value).trim();
const BASE = 'https://danny700808.github.io/play-card';
function registerPortalContractNotices(exports) {
  exports.portalAnnualContractAssignments = onSchedule({ schedule: '0 9 * * *', timeZone: 'Asia/Taipei', region: 'us-central1', timeoutSeconds: 300 }, async () => {
    const db = admin.firestore();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const targetYear = Number(today.slice(0, 4)) + (today.slice(5) >= '12-15' ? 1 : 0);
    const [templates, assignments, people] = await Promise.all([
      db.collection('teacherContractTemplates').get(), db.collection('teacherContractAssignments').get(),
      db.collection('employees').get()
    ]);
    const rows = templates.docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(row => row.status === 'published');
    const yearOf = row => Number(row.year) < 1911 ? Number(row.year) + 1911 : Number(row.year);
    const target = rows.find(row => yearOf(row) === targetYear);
    const latest = rows.filter(row => yearOf(row) <= targetYear).sort((a,b) => yearOf(b) - yearOf(a))[0];
    if (!latest) return;
    const templateId = target ? target.id : `TCY_${targetYear}_auto`;
    const template = target || { ...latest, id: templateId, contractId: templateId, year: String(targetYear),
      contractName: `${targetYear} 年度老師合作契約`, title: `${targetYear} 年度老師合作契約`,
      contractStartDate: `${targetYear}-01-01`, contractEndDate: `${targetYear}-12-31`,
      startDate: `${targetYear}-01-01`, endDate: `${targetYear}-12-31`, sourceTemplateId: latest.id };
    const now = admin.firestore.FieldValue.serverTimestamp();
    if (!target) {
      try { await db.collection('teacherContractTemplates').doc(templateId).create({ ...template, publishedAt: now, source: 'annual-contract-rollover' }); }
      catch (error) { if (String(error.code) !== '6') throw error; }
    }
    for (const doc of people.docs) {
      const person = doc.data();
      if (!(person.isExternalTeacher || person.externalTeacher || person.coursePortalTeacherId || person.role === 'externalTeacher')) continue;
      if (person.active === false || person.hiddenFromActiveLists || /inactive|disabled|archived|resigned|停用|離職|封存/i.test(`${person.accountStatus || ''}|${person.employmentStatus || ''}`)) continue;
      if (assignments.docs.some(item => yearOf(item.data()) === targetYear && [item.data().employeeId, item.data().teacherId].includes(doc.id))) continue;
      const id = `${templateId}_${doc.id}`;
      try { await db.collection('teacherContractAssignments').doc(id).create({
        assignmentId: id, contractId: templateId, templateId, year: String(targetYear), version: clean(template.version),
        contractName: clean(template.contractName || template.title) || '老師年度契約', teacherId: doc.id, employeeId: doc.id,
        teacherName: clean(person.name || person.displayName), email: clean(person.email),
        portalProfileId: clean(person.portalProfileId || person.externalTeacherProfileId),
        portalProfileVersion: Number(person.portalProfileVersion || 0), assignmentProfilePolicy: 'canonical-profile-or-protected-person-v1',
        status: 'pending', statusLabel: '待簽署', contractSnapshot: template,
        contractStartDate: `${targetYear}-01-01`, contractEndDate: `${targetYear}-12-31`,
        publishedAt: now, publishedAtText: today, source: 'annual-contract-rollover'
      }); } catch (error) { if (String(error.code) !== '6') throw error; }
    }
  });
  async function notice(event, legacy) {
    const before = event.data.before.exists ? event.data.before.data() : {};
    if (!event.data.after.exists) return;
    const row = event.data.after.data();
    const status = clean(row.status || row.contractStatus);
    if (status === clean(before.status || before.contractStatus)) return;
    const approved = ['active', 'confirmed', 'contract_effective'].includes(status);
    const submitted = ['signed', 'submitted_pending_admin'].includes(status);
    if (!approved && !submitted) return;
    // Legacy submission already queues the manager notification in its callable.
    if (legacy && submitted) return;
    const db = admin.firestore();
    const id = event.params.id;
    let person = row;
    const employeeId = clean(row.employeeId || row.externalTeacherEmployeeId);
    if (employeeId) {
      const doc = await db.collection('employees').doc(employeeId).get();
      person = { ...(doc.exists ? doc.data() : {}), ...row };
    }
    const rawYear = Number(row.contractRocYear || row.year);
    const year = rawYear ? `民國 ${rawYear > 1911 ? rawYear - 1911 : rawYear} 年` : '依契約內容';
    const period = `${clean(row.contractStartDate || row.startDate || (row.contractSnapshot || {}).startDate)} 至 ${clean(row.contractEndDate || row.endDate || (row.contractSnapshot || {}).endDate)}`;
    const name = clean(person.name || person.teacherName || person.displayName) || '老師';
    const recipients = [];
    if (approved) {
      if (notificationRecipientKey(person)) recipients.push(recipientFields(person));
      else {
        const teacherId = clean(row.coursePortalTeacherId || person.coursePortalTeacherId || row.teacherId);
        if (teacherId) {
          const bindings = await db.collection('coursePortalTeacherBindings').where('teacherId', '==', teacherId).where('status', '==', 'active').get();
          const seen = new Set();
          for (const doc of bindings.docs) { const key = notificationRecipientKey(doc.data()); if (key && !seen.has(key)) { seen.add(key); recipients.push(recipientFields(doc.data())); } }
        }
      }
    } else recipients.push({ channel: 'line', target: 'admin', targetRole: 'admin', targetEmployeeId: 'PRIMARY_MANAGER_LINE', emailFallbackEnabled: true });
    for (let n = 0; n < recipients.length; n++) {
      const ref = db.collection('notificationQueue').doc(`contract-${legacy ? 'legacy' : 'assignment'}-${id}-${status}-${n}`);
      const body = approved
        ? `${name}老師您好，您的契約已由柚子樂器確認生效。\n合約年度：${year}\n契約期間：${period}\n您可以至老師入口的「其他 → 合約」查看契約內容。\n${BASE}/teacher-course-portal.html`
        : `${name}老師已送出契約，等待管理者確認。\n合約年度：${year}\n契約期間：${period}\n${BASE}/external-teacher-admin.html`;
      try { await ref.create({ ...recipients[n], title: approved ? '契約確認通知' : '老師合約待確認', body,
        status: '待發送', source: 'portal-contract-confirmation', createdAt: admin.firestore.FieldValue.serverTimestamp() }); }
      catch (error) { if (String(error.code) !== '6' && !/already.exists/i.test(String(error.code))) throw error; }
    }
  }
  exports.portalContractAssignmentNotice = onDocumentWritten({ document: 'teacherContractAssignments/{id}', region: 'us-central1' }, event => notice(event, false));
  exports.portalLegacyContractNotice = onDocumentWritten({ document: 'externalTeacherContracts/{id}', region: 'us-central1' }, event => notice(event, true));
}
module.exports = { registerPortalContractNotices };
