'use strict';

const fs = require('fs');

function replaceRequired(source, pattern, replacement, minimum, label) {
  const matches = source.match(pattern) || [];
  if (matches.length < minimum) {
    throw new Error(`${label}: expected at least ${minimum} match(es), found ${matches.length}`);
  }
  return source.replace(pattern, replacement);
}

const firebasePath = 'firebase-client.js';
let firebaseSource = fs.readFileSync(firebasePath, 'utf8');

// A scheduled employee who is merely late must still use the normal clock-in flow.
// Supplemental clock-in/out becomes available only after the scheduled shift has ended,
// plus the existing five-minute completion grace period.
firebaseSource = replaceRequired(
  firebaseSource,
  /const\s+clockInDue\s*=\s*isPastDay\s*\|\|\s*nowMinute\s*>=\s*startMinute\s*\+\s*5\s*;/g,
  'const clockInDue = isPastDay || nowMinute >= endMinute + 5;',
  2,
  'active-shift clock-in due rule'
);

if (/clockInDue\s*=\s*isPastDay\s*\|\|\s*nowMinute\s*>=\s*startMinute\s*\+\s*5/.test(firebaseSource)) {
  throw new Error('A legacy active-shift supplemental clock-in rule still remains.');
}

fs.writeFileSync(firebasePath, firebaseSource);

const clockPath = 'clock.html';
let clockSource = fs.readFileSync(clockPath, 'utf8');

const oldNote = '系統會檢查今日與昨日班表。如果有班但缺上班卡或下班卡，會在這裡提醒；你可以提出補打卡，或改申請事後補假。';
const newNote = '系統會檢查今日與昨日班表。班段進行中若遲到，請直接使用標準打卡，系統會記錄實際到班時間；補打卡只在班段結束後、確定漏打時開放，並送主管審核。';
if (clockSource.includes(oldNote)) {
  clockSource = clockSource.replace(oldNote, newNote);
} else if (!clockSource.includes(newNote)) {
  throw new Error('Unable to find the missing-clock explanatory copy.');
}

const oldHelp = '如果已經有打卡紀錄但時間錯誤，請到「近期打卡記錄」點「修正這筆」；如果有班但忘記打卡，請看「待處理事項」。';
const newHelp = '<strong>遲到仍要正常打卡：</strong>系統會照實記錄到班時間與遲到分鐘；有異議再提出修正。只有班段結束後確定漏打，才可從「待處理事項」提出補打卡。';
if (clockSource.includes(oldHelp)) {
  clockSource = clockSource.replace(oldHelp, newHelp);
} else if (!clockSource.includes('只有班段結束後確定漏打')) {
  throw new Error('Unable to find the clock help item.');
}

const guardTag = '  <script src="clock-active-shift-guard-v1.js?v=20260804-active-shift-v1"></script>\n';
if (!clockSource.includes('clock-active-shift-guard-v1.js')) {
  const marker = '  <script src="global-nav.js?v=20260603unified1"></script>';
  if (!clockSource.includes(marker)) throw new Error('Unable to find the clock script insertion marker.');
  clockSource = clockSource.replace(marker, guardTag + marker);
}

fs.writeFileSync(clockPath, clockSource);
