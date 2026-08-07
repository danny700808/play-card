'use strict';

const personData = require('./personDataAdmin').__test;

const KEEP_PARTTIME_NAME = '廖浤鈞';
const KEEP_MANAGER_NAME = '黃銘廷';
const PRIMARY_MANAGER_ID = 'PRIMARY_MANAGER_LINE';
const BOOTSTRAP_MANAGER_ID = 'ADMIN_DANNY';
const BOOTSTRAP_MANAGER_EMAIL = 'danny700808@gmail.com';

const clean = (value) => String(value == null ? '' : value).trim();
const lower = (value) => clean(value).toLowerCase();
const uniq = (values) => [...new Set((values || []).map(clean).filter(Boolean))];
const truthy = (value) => value === true || ['true', '1', 'yes', 'y', '是', '啟用', '使用中'].includes(lower(value));

function rowName(row) {
  const source = row || {};
  return clean(source.name || source.displayName || source.employeeName || source.teacherName ||
    source.targetName || source.applicantName || source['姓名']);
}

function rowEmail(row) {
  const source = row || {};
  return lower(source.email || source.Email || source.loginEmail || source.loginAccount ||
    source.contactEmail || source.teacherEmail || source.targetEmail || source['登入帳號']);
}

function managerAccount(record) {
  const row = record && record.row || {};
  const role = lower(row.role || row.userRole || row['角色']);
  return record && (record.spec.collection === 'admins' ||
    ['admin', 'manager', '主管', '管理者'].includes(role) ||
    truthy(row.showSettingsZone) || truthy(row.isAdmin) || truthy(row.isManager) ||
    truthy(row.canViewSettings) || truthy(row['是否顯示設定區']) ||
    truthy(row['可看設定區']) || truthy(row['管理權限']));
}

function canonicalManagerAccount(record) {
  if (!record) return false;
  if (!['admins', 'employees'].includes(record.spec.collection)) return false;
  const canonicalIdentity = rowName(record.row) === KEEP_MANAGER_NAME ||
    record.docId === BOOTSTRAP_MANAGER_ID || rowEmail(record.row) === BOOTSTRAP_MANAGER_EMAIL ||
    truthy(record.row && record.row.adminBootstrap);
  return canonicalIdentity && (managerAccount(record) || record.docId === BOOTSTRAP_MANAGER_ID ||
    rowEmail(record.row) === BOOTSTRAP_MANAGER_EMAIL);
}

function activeManagerLineBinding(record) {
  if (!record || record.spec.collection !== 'employeeLineBindings') return false;
  const row = record.row || {};
  const status = lower(row.status || row.lineBindStatus || row.approvalStatus);
  const blocked = /pending|revoked|rejected|expired|cancelled|unbound|待|撤銷|駁回|過期|取消|解除/.test(status);
  const lineId = clean(row.lineUserId || row.targetLineUserId || row.lineUid || row.lineId || row['LINE User ID']);
  return Boolean(lineId && !blocked && row.active !== false);
}

function activeParttimeEmployee(record) {
  if (!record || record.spec.collection !== 'employees') return false;
  const row = record.row || {};
  const identity = lower(row.identityType || row.employeeType || row['身分類型']);
  const parttime = identity === 'parttime' || identity.includes('工讀') ||
    truthy(row.isPartTime) || truthy(row['是否工讀生']);
  return parttime && personData.activeEmployee(row);
}

function primaryManagerInfrastructure(record) {
  const row = record && record.row || {};
  return Boolean(record && record.spec.collection === 'employees' &&
    (record.docId === PRIMARY_MANAGER_ID || clean(row.employeeId) === PRIMARY_MANAGER_ID ||
      truthy(row.isPrimaryManagerLineRecipient)));
}

function managerKeepRecord(record) {
  if (!record) return false;
  if (canonicalManagerAccount(record)) return true;
  return activeManagerLineBinding(record);
}

function countByCollection(records) {
  const result = {};
  (records || []).forEach((record) => {
    const name = record.spec.collection;
    result[name] = (result[name] || 0) + 1;
  });
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function embeddedSalaryTargetKeys(map, targetIds, keepIds) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  const targets = new Set((targetIds || []).map(clean).filter(Boolean));
  const keep = new Set((keepIds || []).map(clean).filter(Boolean));
  return Object.keys(map).filter((key) => {
    const row = map[key] && typeof map[key] === 'object' ? map[key] : {};
    const employeeId = clean(row.employeeId || row.userId || row.id || row['員工ID'] || key);
    return !keep.has(employeeId) && (targets.has(clean(key)) || targets.has(employeeId));
  });
}

function buildCleanupPlan(records) {
  const personnelRecords = (records || []).filter((record) =>
    personData.recordBelongsToPersonnel(record.spec, record.row || {}));
  const groups = personData.buildGroups(personnelRecords);
  const parttimeGroups = groups.filter((group) => group.names.includes(KEEP_PARTTIME_NAME));
  const managerGroups = groups.filter((group) => group.rows.some(canonicalManagerAccount));
  const managerLineGroups = groups.filter((group) =>
    group.names.includes(KEEP_MANAGER_NAME) &&
    group.rows.some((record) => record.spec.collection === 'employeeLineBindings'));
  const infrastructureGroups = groups.filter((group) => group.rows.some(primaryManagerInfrastructure));

  if (!parttimeGroups.length || !parttimeGroups.some((group) => group.rows.some(activeParttimeEmployee))) {
    throw new Error(`找不到啟用中的工讀生「${KEEP_PARTTIME_NAME}」，已停止清理。`);
  }
  if (!managerGroups.length) {
    throw new Error(`找不到管理者「${KEEP_MANAGER_NAME}」，已停止清理。`);
  }

  const keepPaths = new Set();
  const keepParttimeRecords = [];
  const keepManagerRecords = [];
  parttimeGroups.forEach((group) => group.rows.forEach((record) => {
    keepPaths.add(record.ref.path);
    keepParttimeRecords.push(record);
  }));
  managerGroups.forEach((group) => group.rows.forEach((record) => {
    if (!managerKeepRecord(record)) return;
    keepPaths.add(record.ref.path);
    keepManagerRecords.push(record);
  }));
  managerLineGroups.forEach((group) => group.rows.forEach((record) => {
    if (!activeManagerLineBinding(record)) return;
    keepPaths.add(record.ref.path);
    keepManagerRecords.push(record);
  }));
  infrastructureGroups.forEach((group) => group.rows.forEach((record) => {
    keepPaths.add(record.ref.path);
    keepManagerRecords.push(record);
  }));

  const targetRecords = personnelRecords.filter((record) => !keepPaths.has(record.ref.path));
  const keepEmails = uniq(keepParttimeRecords.concat(keepManagerRecords).map((record) => rowEmail(record.row)));
  const deleteEmails = uniq(targetRecords.map((record) => rowEmail(record.row))).filter((email) => !keepEmails.includes(email));
  const targetEmployeeIds = uniq(targetRecords.flatMap((record) => (record.keys || [])
    .filter((key) => key.startsWith('employee:')).map((key) => key.slice(9))));
  const targetTeacherIds = uniq(targetRecords.flatMap((record) => (record.keys || [])
    .filter((key) => key.startsWith('teacher:')).map((key) => key.slice(8))));
  const targetProfileIds = uniq(targetRecords.flatMap((record) => (record.keys || [])
    .filter((key) => key.startsWith('profile:')).map((key) => key.slice(8))));
  const deleteNames = uniq(targetRecords.map((record) => rowName(record.row)))
    .filter((name) => ![KEEP_PARTTIME_NAME, KEEP_MANAGER_NAME].includes(name));
  const keepPersonIds = uniq(keepParttimeRecords.concat(keepManagerRecords).flatMap((record) =>
    (record.keys || []).filter((key) => key.startsWith('employee:') || key.startsWith('teacher:'))
      .map((key) => key.slice(key.indexOf(':') + 1))));
  const keepParttimeIds = uniq(keepParttimeRecords.flatMap((record) =>
    (record.keys || []).filter((key) => key.startsWith('employee:') || key.startsWith('teacher:'))
      .map((key) => key.slice(key.indexOf(':') + 1))));

  return {
    groups,
    keepPaths,
    keepParttimeRecords,
    keepManagerRecords,
    targetRecords,
    keepEmails,
    deleteEmails,
    targetEmployeeIds,
    targetTeacherIds,
    targetProfileIds,
    keepPersonIds,
    keepParttimeIds,
    deleteNames,
    summary: {
      scannedPeople: groups.length,
      scannedRecords: personnelRecords.length,
      keepParttimeGroups: parttimeGroups.length,
      keepManagerGroups: managerGroups.length,
      keepManagerLineGroups: managerLineGroups.length,
      keepInfrastructureGroups: infrastructureGroups.length,
      deleteRecords: targetRecords.length,
      deleteGroups: groups.filter((group) => group.rows.some((record) => !keepPaths.has(record.ref.path))).length,
      deleteByCollection: countByCollection(targetRecords)
    }
  };
}

module.exports = {
  KEEP_PARTTIME_NAME,
  KEEP_MANAGER_NAME,
  PRIMARY_MANAGER_ID,
  BOOTSTRAP_MANAGER_ID,
  BOOTSTRAP_MANAGER_EMAIL,
  rowName,
  rowEmail,
  managerAccount,
  canonicalManagerAccount,
  activeManagerLineBinding,
  activeParttimeEmployee,
  primaryManagerInfrastructure,
  managerKeepRecord,
  buildCleanupPlan,
  countByCollection,
  embeddedSalaryTargetKeys
};
