'use strict';

const clean = (value) => String(value == null ? '' : value).trim();

const PROFILE_TEXT_FIELDS = Object.freeze([
  ['name', '姓名'],
  ['mobilePhone', '手機號碼'],
  ['email', 'Email'],
  ['birthDate', '出生年月日'],
  ['householdAddress', '戶籍地址'],
  ['mailingAddress', '通訊地址'],
  ['emergencyContact', '緊急聯絡人'],
  ['emergencyPhone', '緊急聯絡人電話']
]);

function normalizeAbility(value) {
  const row = typeof value === 'string' ? { item: value } : value || {};
  const item = clean(row.item || row.name || row.subject);
  if (!item) return null;
  return {
    subjectId: clean(row.subjectId || row.id),
    item,
    level: clean(row.level || row.degree || row.proficiency) || '普通'
  };
}

function normalizeAbilities(values) {
  return (Array.isArray(values) ? values : []).map(normalizeAbility).filter(Boolean)
    .sort((left, right) => {
      const leftKey = clean(left.subjectId) || left.item.normalize('NFKC').toLocaleLowerCase('zh-TW');
      const rightKey = clean(right.subjectId) || right.item.normalize('NFKC').toLocaleLowerCase('zh-TW');
      return leftKey.localeCompare(rightKey, 'zh-TW') || left.level.localeCompare(right.level, 'zh-TW');
    });
}

function identityFileCount(source) {
  const row = source || {};
  const files = Array.isArray(row.identityFiles) ? row.identityFiles : [];
  const urls = Array.isArray(row.identityUrls) ? row.identityUrls : [];
  const explicit = Number(row.identityFileCount || 0);
  return Math.max(Number.isFinite(explicit) ? explicit : 0, files.length, urls.length);
}

function profileDraftSnapshot(profile, privateProfile) {
  const source = profile || {};
  const privateRow = privateProfile || {};
  const out = {};
  PROFILE_TEXT_FIELDS.forEach(([key]) => { out[key] = clean(source[key]); });
  out.teachingAbilities = normalizeAbilities(source.teachingAbilities);
  out.idNumberMasked = clean(source.idNumberMasked || privateRow.idNumberMasked);
  out.identityFileCount = identityFileCount(Object.assign({}, source, privateRow));
  return out;
}

function abilityText(values) {
  return normalizeAbilities(values).map((row) => `${row.item}（${row.level}）`).join('、');
}

function profileChangeRows(beforeValue, afterValue) {
  const before = beforeValue || {};
  const after = afterValue || {};
  const rows = [];
  PROFILE_TEXT_FIELDS.forEach(([key, label]) => {
    const oldText = clean(before[key]);
    const newText = clean(after[key]);
    if (oldText !== newText) rows.push({ key, label, before: oldText || '未填寫', after: newText || '已刪除' });
  });
  const oldAbilities = abilityText(before.teachingAbilities);
  const newAbilities = abilityText(after.teachingAbilities);
  if (oldAbilities !== newAbilities) {
    rows.push({
      key: 'teachingAbilities',
      label: '可教授科目與程度',
      before: oldAbilities || '未設定',
      after: newAbilities || '已全部移除',
      immediate: true
    });
  }
  const oldId = clean(before.idNumberMasked);
  const newId = clean(after.idNumberMasked);
  if (oldId !== newId) {
    rows.push({ key: 'idNumber', label: '身分證字號', before: oldId || '未留存', after: newId || '已刪除' });
  }
  const oldFiles = Math.max(0, Number(before.identityFileCount || 0));
  const newFiles = Math.max(0, Number(after.identityFileCount || 0));
  if (oldFiles !== newFiles) {
    rows.push({
      key: 'identityFiles',
      label: '身分證明照片',
      before: oldFiles ? `已留存 ${oldFiles} 份` : '未留存',
      after: newFiles ? `已留存 ${newFiles} 份` : '已刪除'
    });
  }
  return rows;
}

module.exports = {
  PROFILE_TEXT_FIELDS,
  abilityText,
  normalizeAbilities,
  profileChangeRows,
  profileDraftSnapshot
};
