'use strict';

const clean = value => String(value == null ? '' : value).trim();
function recipientFields(row = {}) {
  const line = clean(row.targetLineUserId || row.lineUserId);
  const email = clean(row.targetEmail || row.email || row.emailNormalized);
  return { channel: line ? 'line' : 'email', targetLineUserId: line,
    targetEmail: email, emailFallbackEnabled: Boolean(line && email) };
}
function notificationRecipientKey(row = {}) {
  const fields = recipientFields(row);
  return fields.targetLineUserId || fields.targetEmail.toLowerCase();
}
function fallbackEmail(row, error) {
  // A network timeout is an uncertain result: do not duplicate it by email.
  if (!row.emailFallbackEnabled || !clean(row.targetEmail) || !error || !error.lineRejected) return null;
  const body = clean(row.body || row.message || row.text);
  const image = clean(row.lineImageUrl);
  return { ...row, channel: 'email', emailFallbackEnabled: false,
    body: ['本次 LINE 通知未能成功送達，因此改以 Email 通知您。此變更僅適用於本次通知，後續仍會優先使用 LINE。', body, image ? `收據：${image}` : ''].filter(Boolean).join('\n\n'),
    text: '', message: '', lineText: '', lineMessage: '', lineBody: '', htmlBody: '', html: '', status: '待發送' };
}
module.exports = { recipientFields, notificationRecipientKey, fallbackEmail };
