'use strict';
const clean = v => String(v == null ? '' : v).trim();
function millis(v) {
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  if (v && v._seconds) return v._seconds * 1000;
  return typeof v === 'number' ? v : Date.parse(v || '');
}
function queueBlockReason(row, now = Date.now()) {
  const status = clean(row.status);
  if (/^(已發送|sent|已轉寄Email|已取消|cancelled|canceled|已略過|skipped|deleted)$/i.test(status)) return '此通知已結束，不重新發送。';
  const created = millis(row.createdAt);
  const scheduled = millis(row.sendAfterAt || row.scheduledAt) || Number(row.sendAfterMs) || 0;
  // Future-dated reminders retain their scheduled delivery window.
  const effective = Math.max(created || 0, scheduled);
  if (effective && now - effective > 7 * 86400000) return '通知已超過七日，停止補送舊資料。';
  return '';
}
function deletedPersonMatches(row, tombstone) {
  const ids = [...(tombstone.employeeIds || []), ...(tombstone.teacherIds || [])].map(clean).filter(Boolean);
  const exact = [row.targetEmployeeId, row.employeeId, row.teacherId, row.contractId, row.inquiryTeacherId].map(clean);
  const urls = [row.approvalUrl, row.body, row.message, row.text].map(clean).join('\n');
  return ids.some(id => exact.includes(id) || (id.length >= 8 && urls.includes(id)));
}
module.exports = { queueBlockReason, deletedPersonMatches };
