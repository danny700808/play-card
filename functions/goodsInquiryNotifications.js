'use strict';
const crypto = require('crypto');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { recipientFields } = require('./portalNotificationPolicy');
const { deletedPersonMatches } = require('./notificationDeliveryGuard');
const clean = v => String(v == null ? '' : v).trim();
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
const replyKeys = ['replyItemName','replyTeacherPrice','replyPrice','replyMarketPrice','replyStock','replyArrivalDate','replyPickupDate','replyNote','replySummary'];
function replySignature(row = {}) { return JSON.stringify(replyKeys.map(k => clean(row[k]))); }
function inquiryEvent(before, after) {
  if (!after || after.deleted || /取消|結案|cancel|deleted/i.test(clean(after.status))) return '';
  if (!before) return 'submitted';
  if (replyKeys.some(k => clean(after[k])) && replySignature(before) !== replySignature(after)) return 'replied';
  return '';
}
function inquiryMessage(kind, row) {
  if (kind === 'submitted') return [
    `${clean(row.teacherName) || '老師'}送出商品詢價：${clean(row.itemName) || '商品詢價'}`,
    row.quantity ? `數量：${clean(row.quantity)}` : '',
    '請至管理端「拿貨／詢價」查看及回覆。',
    'https://danny700808.github.io/play-card/teacher-goods-admin.html'
  ].filter(Boolean).join('\n');
  return [`您詢問的「${clean(row.itemName) || '商品'}」已有回覆。`,
    '請至老師入口「其他 → 拿貨／詢價 → 我的紀錄」查看。',
    'https://danny700808.github.io/play-card/teacher-course-portal.html'].join('\n');
}
async function teacherRecipient(db, row) {
  const ids = [...new Set([row.userId, row.teacherId].map(clean).filter(Boolean))];
  const employeeDocs = await Promise.all(ids.filter(id => !id.includes('/')).map(id => db.collection('employees').doc(id).get()));
  const employee = employeeDocs.find(d => d.exists);
  const data = employee ? employee.data() : {};
  if (/deleted|archived|inactive|停用|離職/i.test(clean(data.accountStatus || data.status))) return null;
  const bindings = await db.collection('coursePortalTeacherBindings').where('status','==','active').get();
  const matches = bindings.docs.map(d => d.data()).filter(b => {
    const tid = clean(b.teacherId);
    return [b.personMasterId,b.canonicalEmployeeId,b.employeeId,tid,tid ? `EXT_${hash(`course-teacher:${tid}`).slice(0,16)}` : ''].some(id => id && ids.includes(id));
  });
  // Use only this teacher's active binding; never infer a recipient from a name.
  const binding = matches.find(b => clean(b.lineUserId)) || matches[0] || {};
  const recipient = {targetEmployeeId: employee ? employee.id : ids[0] || '', targetName:clean(row.teacherName),
    lineUserId:clean(binding.lineUserId || data.lineUserId || data['LINE User ID']),
    email:clean(binding.email || binding.emailNormalized || data.email || data.Email)};
  return recipient.lineUserId || recipient.email ? recipient : null;
}
function registerGoodsInquiryNotifications(exports, {db, admin, managerRecipient}) {
  exports.teacherGoodsInquiryNotification = onDocumentWritten({document:'teacherGoodsInquiry/{inquiryId}',region:'us-central1',retry:true}, async event => {
    const before = event.data.before.exists ? event.data.before.data() : null;
    const after = event.data.after.exists ? event.data.after.data() : null;
    const kind = inquiryEvent(before, after);
    if (!kind) return;
    const deleted = await db.collection('personDeletionTombstones').get();
    const person = {teacherId:after.teacherId, employeeId:after.userId};
    if (deleted.docs.some(d => deletedPersonMatches(person, d.data()))) return;
    const recipient = kind === 'submitted' ? await managerRecipient() : await teacherRecipient(db, after);
    if (!recipient || !(recipient.lineUserId || recipient.email)) throw new Error('商品詢價通知缺少已驗證收件資料');
    const key = `goods-${event.params.inquiryId}-${kind}-${kind === 'submitted' ? 'new' : hash(replySignature(after)).slice(0,24)}`;
    const queue = db.collection('notificationQueue').doc(key);
    await db.runTransaction(async tx => {
      const [existing, current] = await Promise.all([tx.get(queue), tx.get(event.data.after.ref)]);
      if (existing.exists || !current.exists || current.data().deleted) return;
      if (kind === 'replied' && replySignature(current.data()) !== replySignature(after)) return;
      tx.create(queue, {queueId:key, ...recipientFields(recipient),
        targetEmployeeId:clean(recipient.targetEmployeeId || recipient.employeeId),
        targetName:clean(recipient.targetName || recipient.name), targetRole:kind === 'submitted' ? 'manager' : 'employee',
        inquiryTeacherId:clean(after.teacherId), inquiryId:event.params.inquiryId,
        title:kind === 'submitted' ? '【老師商品詢價】' : '【商品詢價已回覆】',
        body:inquiryMessage(kind, after), status:'待發送',source:`teacher-goods-${kind}`,
        createdAt:admin.firestore.FieldValue.serverTimestamp()});
    });
  });
}
module.exports = {registerGoodsInquiryNotifications, inquiryEvent, inquiryMessage, replySignature, teacherRecipient};
