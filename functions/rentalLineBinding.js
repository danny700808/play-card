'use strict';
const clean = value => String(value == null ? '' : value).trim();
const LINE_FIELDS = ['customerLineUserId', 'lineUserId', 'lineDisplayName', 'lineLinkStatus', 'lineLinkedAt', 'lineLinkedAtText', 'lineConfirmText', 'lineNotifyEnabled', 'globalLineRevokedAt'];
const validId = value => /^U[A-Za-z0-9_-]{20,}$/.test(clean(value));
const lineId = row => [row.customerLineUserId, row.lineUserId].map(clean).find(validId) || '';
function revoked(row) {
  return !!row.globalLineRevokedAt || row.lineNotifyEnabled === false || /^(unlinked|unbound|revoked)$/.test(clean(row.lineLinkStatus));
}
// An editor snapshot is never authoritative for an application's LINE binding.
function bindingPatch(current = {}, application = null, incoming = {}) {
  if (revoked(current) || (application && revoked(application))) {
    return {customerLineUserId: '', lineUserId: '', lineDisplayName: '', lineLinkStatus: 'unlinked', lineNotifyEnabled: false};
  }
  const existing = lineId(current), linked = application && lineId(application);
  if (existing && linked && existing !== linked) throw new Error('申請與契約的 LINE 綁定不一致，請先由管理者確認，系統未更換收件人。');
  const source = linked ? application : existing ? current : application ? {} : incoming;
  const id = lineId(source);
  if (!id) return {};
  const patch = {customerLineUserId:id, lineUserId:id, lineLinkStatus:'linked'};
  for (const key of ['lineDisplayName','lineLinkedAt','lineLinkedAtText','lineConfirmText']) {
    if (source[key] != null) patch[key] = source[key];
  }
  return patch;
}
function withoutBinding(row) {
  const result = {...row};
  for (const key of LINE_FIELDS) delete result[key];
  return result;
}
function createRentalLineBinding(db) {
  async function applicationFor(tx, current, incoming = {}) {
    const oldId = clean(current.applicationId), newId = clean(incoming.applicationId);
    if (oldId && newId && oldId !== newId) throw new Error('不可將既有契約改連到另一筆租賃申請。');
    const id = oldId || newId;
    if (!id) return {id:'', row:null};
    const snap = await tx.get(db.collection('rentalApplications').doc(id));
    if (!snap.exists) throw new Error('找不到原租賃申請，無法安全確認 LINE 收件人。');
    return {id, row:snap.data()};
  }
  async function repair(contractId) {
    const ref = db.collection('rentalContracts').doc(contractId);
    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('找不到租賃契約。');
      const current = snap.data(), app = await applicationFor(tx,current);
      const patch = bindingPatch(current,app.row);
      if (Object.keys(patch).length) tx.set(ref,patch,{merge:true});
      return {...current,...patch,__id:snap.id,contractId:snap.id};
    });
  }
  async function syncApplication(applicationId) {
    const snap = await db.collection('rentalContracts').where('applicationId','==',applicationId).get();
    // repair re-reads both records in a transaction: late or duplicated webhook
    // deliveries cannot overwrite a subsequent revocation or a newer binding.
    for (const doc of snap.docs) await repair(doc.id);
  }
  return {applicationFor,repair,syncApplication};
}
module.exports = {bindingPatch,withoutBinding,createRentalLineBinding};
