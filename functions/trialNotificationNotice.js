'use strict';

const START = Date.parse('2026-09-11T00:00:00+08:00');
const END = Date.parse('2026-09-15T00:00:00+08:00');
const NOTICE = '【新系統試用期間提醒】\n即日起至 9/14（一）為新系統試用期間，正式課務紀錄仍以舊系統為準。本則為試用通知，您可先忽略，無須依此補登或處理。\n\n9/15（二）起全面使用新系統，屆時收到的通知請正常查看，並依內容辦理。';

function active(now = Date.now()) {
  const time = Number(now);
  return time >= START && time < END;
}
function trialNotificationText(text, now = Date.now()) {
  const original = String(text || '');
  if (!active(now) || original.startsWith(NOTICE)) return original;
  return NOTICE + '\n\n──────────\n\n' + original;
}
function trialNotificationHtml(html, now = Date.now()) {
  const original = String(html || '');
  if (!active(now) || original.includes('data-yuzu-trial-notice="20260914"')) return original;
  return '<div data-yuzu-trial-notice="20260914" style="padding:14px;border:1px solid #cfddd4;margin-bottom:18px;line-height:1.8">' + NOTICE.replace(/\n/g, '<br>') + '</div>' + original;
}
module.exports = { START, END, NOTICE, active, trialNotificationText, trialNotificationHtml };
