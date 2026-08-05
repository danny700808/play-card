'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const REGION = 'us-central1';
const ADMIN_EMAILS = new Set(['danny700808@gmail.com']);

const LINE_FIELDS = [
  'lineUserId', 'customerLineUserId', 'targetLineUserId', 'toLineUserId',
  'linkedLineUserId', 'lineUid', 'lineUID', 'lineId', 'LINE User ID'
];
const CLEAR_LINE_NAMES = ['lineDisplayName', 'lineName', 'LINE 顯示名稱'];
const SOURCES = [
  ['coursePortalTeacherBindings', 'teacher', '課務入口', '課務老師', ['teacherId', 'targetId'], ['targetName', 'teacherName', 'name']],
  ['coursePortalStudentBindings', 'student', '課務入口', '學生／家長', ['studentId', 'targetId'], ['targetName', 'studentName', 'name']],
  ['coursePortalRenterBindings', 'renter', '課務入口', '教室租用者', ['renterId', 'targetId'], ['targetName', 'renterName', 'name']],
  ['employees', 'employee', '員工系統', '員工／主管', ['employeeId', 'id', 'userId'], ['name', 'employeeName', 'displayName']],
  ['admins', 'manager', '員工系統', '管理者', ['adminId', 'managerId', 'id'], ['name', 'displayName']],
  ['employeeLineBindings', 'employee', '員工綁定', '員工 LINE 綁定', ['employeeId', 'employeeDocId', 'targetEmployeeId'], ['employeeName', 'name', 'displayName']],
  ['externalTeacherLineBindings', 'external', '外聘老師', '外聘老師 LINE 綁定', ['employeeId', 'externalTeacherEmployeeId', 'teacherId', 'externalTeacherContractId'], ['teacherName', 'name', 'displayName']],
  ['externalTeacherProfiles', 'external', '外聘老師', '外聘老師資料', ['employeeId', 'externalTeacherEmployeeId', 'teacherId', 'id'], ['name', 'teacherName', 'displayName']],
  ['externalTeacherContracts', 'external', '外聘老師', '外聘老師契約', ['employeeId', 'externalTeacherEmployeeId', 'teacherId', 'contractId'], ['name', 'teacherName', 'displayName']],
  ['rentalApplications', 'equipment-rental', '設備租賃', '設備租賃申請', ['applicationId', 'applicationNo', 'rentalApplicationNo'], ['customerName', 'partyAName', 'name']],
  ['rentalContracts', 'equipment-rental', '設備租賃', '設備租賃契約', ['contractId', 'contractNo', 'applicationId'], ['customerName', 'partyAName', 'name']]
].map(([collection, kind, system, label, idFields, nameFields]) => ({ collection, kind, system, label, idFields, nameFields }));

const AUTH_COLLECTIONS = [
  'coursePortalSessions', 'coursePortalAccessTokens', 'coursePortalEmailOtps',
  'coursePortalBindCodes', 'coursePortalLineLoginCodes',
  'coursePortalLineOAuthStates', 'coursePortalLineSetupTokens'
];
const QUEUE_COLLECTIONS = [
  'notificationQueue', 'lineNotificationQueue', 'coursePortalNotificationQueue',
  'employeeNotificationQueue', 'externalTeacherNotificationQueue', 'rentalNotificationQueue'
];

const clean = (value) => String(value == null ? '' : value).trim();
const lower = (value) => clean(value).toLowerCase();
const uniq = (values) => [...new Set((values || []).map(clean).filter(Boolean))];
const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const first = (row, fields) => {
  for (const field of fields || []) {
    const value = clean(row && row[field]);
    if (value) return value;
  }
  return '';
};
const mask = (value) => {
  const id = clean(value);
  if (!id) return '';
  return id.length <= 10
    ? `${id.slice(0, 2)}••••${id.slice(-2)}`
    : `${id.slice(0, 5)}••••••••${id.slice(-5)}`;
};

function assertManager(request) {
  const token = request && request.auth && request.auth.token || {};
  const role = lower(token.role || token.userRole || token.permissionRole);
  const ok = token.admin === true || token.manager === true || token.owner === true ||
    ['admin', 'manager', 'owner', '主管', '管理者'].includes(role) ||
    ADMIN_EMAILS.has(lower(token.email));
  if (!ok) throw new HttpsError('permission-denied', '請先使用管理者帳號登入。');
}

function actorOf(request) {
  const token = request && request.auth && request.auth.token || {};
  return clean(token.name || token.email || request && request.auth && request.auth.uid) || '管理者';
}

function statusOf(row) {
  return first(row || {}, [
    'status', 'accountStatus', 'employmentStatus', 'lineBindStatus', 'lineLinkStatus',
    'approvalStatus', 'contractStatus', 'externalTeacherStatus', 'progressStatus'
  ]);
}

function inactive(row) {
  row = row || {};
  const status = lower(statusOf(row));
  const words = [
    'inactive', 'disabled', 'revoked', 'deleted', 'cancelled', 'canceled', 'archived',
    'terminated', 'resigned', 'unbound', 'rejected', 'expired', 'ended', 'closed',
    'returned', '已停用', '停用', '已解除', '解除', '已取消', '取消', '離職',
    '已離職', '已退租', '退租', '封存', '已封存', '已結束', '到期', '已到期'
  ];
  return words.some((word) => status.includes(word)) ||
    row.active === false || row.enabled === false || row.hiddenFromActiveLists === true;
}

function lineIds(row) {
  const values = LINE_FIELDS.map((field) => clean(row && row[field]));
  if (row && row.line && typeof row.line === 'object') values.push(clean(row.line.userId || row.line.lineUserId));
  return uniq(values);
}

function activeSource(spec, row) {
  if (inactive(row)) return false;
  if (['employees', 'admins'].includes(spec.collection)) return row.lineNotifyEnabled !== false;
  if (/^coursePortal.+Bindings$/.test(spec.collection)) {
    const status = lower(row.status || 'active');
    const approval = lower(row.approvalStatus || 'approved');
    return ['active', 'enabled', 'approved', '使用中', '啟用'].includes(status) &&
      !['pending', 'rejected', 'revoked', '等待主管確認', '已拒絕', '已解除'].includes(approval);
  }
  if (['employeeLineBindings', 'externalTeacherLineBindings'].includes(spec.collection)) {
    return !['revoked', 'disabled', 'inactive', 'expired', '已解除', '已停用'].includes(lower(row.status || row.lineBindStatus || 'bound'));
  }
  if (['rentalApplications', 'rentalContracts'].includes(spec.collection)) {
    const status = lower(row.status);
    const link = lower(row.lineLinkStatus || 'linked');
    return !['unlinked', 'revoked', '已解除'].includes(link) &&
      !['已取消', '取消', '已退租', '退租', '封存', 'closed', 'cancelled', 'returned'].some((word) => status.includes(word));
  }
  return true;
}

async function readSource(spec) {
  try {
    const snap = await db.collection(spec.collection).limit(2500).get();
    return snap.docs.map((doc) => ({ spec, ref: doc.ref, id: doc.id, row: doc.data() || {} }));
  } catch (error) {
    console.warn('[unified-line read skipped]', spec.collection, error && error.message || error);
    return [];
  }
}

function staleReason(source, context) {
  if (!source.identityId) return '缺少身分編號';
  if (inactive(source.row)) return '來源已停用或已結束';
  if (source.collection === 'employeeLineBindings') {
    if (!context.employeeIds.has(source.identityId)) return '找不到對應員工';
    if (!context.activeEmployeeIds.has(source.identityId)) return '對應員工已停用或離職';
  }
  if (source.collection === 'externalTeacherLineBindings' &&
      !context.externalIds.has(source.identityId) &&
      !context.employeeIds.has(source.identityId)) {
    return '找不到對應外聘老師資料';
  }
  return '';
}

async function inventory() {
  const docs = (await Promise.all(SOURCES.map(readSource))).flat();
  const context = { employeeIds: new Set(), activeEmployeeIds: new Set(), externalIds: new Set() };
  docs.forEach(({ spec, id, row }) => {
    const identityId = first(row, spec.idFields) || id;
    if (spec.collection === 'employees') {
      context.employeeIds.add(identityId);
      if (!inactive(row)) context.activeEmployeeIds.add(identityId);
    }
    if (['externalTeacherProfiles', 'externalTeacherContracts'].includes(spec.collection)) {
      context.externalIds.add(identityId);
      const employeeId = first(row, ['employeeId', 'externalTeacherEmployeeId']);
      if (employeeId) context.externalIds.add(employeeId);
    }
  });

  const sources = [];
  docs.forEach(({ spec, ref, id, row }) => {
    lineIds(row).forEach((lineUserId) => {
      const source = {
        ref, row, lineUserId,
        path: ref.path,
        collection: spec.collection,
        sourceId: id,
        kind: spec.kind,
        system: spec.system,
        label: spec.label,
        identityId: first(row, spec.idFields) || id,
        identityName: first(row, spec.nameFields),
        lineDisplayName: first(row, ['lineDisplayName', 'lineName', 'displayName']),
        active: activeSource(spec, row),
        staleReason: '',
        duplicate: false
      };
      source.staleReason = staleReason(source, context);
      sources.push(source);
    });
  });

  const duplicateGroups = new Map();
  sources.forEach((source) => {
    const key = `${source.lineUserId}|${source.collection}|${source.kind}|${source.identityId}`;
    if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
    duplicateGroups.get(key).push(source);
  });
  duplicateGroups.forEach((rows) => {
    rows.slice(1).forEach((source) => {
      source.duplicate = true;
      if (!source.staleReason) source.staleReason = '同一身分有重複綁定資料';
    });
  });

  const grouped = new Map();
  sources.forEach((source) => {
    if (!grouped.has(source.lineUserId)) grouped.set(source.lineUserId, []);
    grouped.get(source.lineUserId).push(source);
  });

  const rows = [...grouped.entries()].map(([lineUserId, list]) => {
    const identityKeys = uniq(list.map((source) => `${source.kind}|${source.identityId}`));
    const systems = uniq(list.map((source) => source.system));
    const kinds = uniq(list.map((source) => source.kind));
    const stale = list.filter((source) => source.staleReason);
    const active = list.filter((source) => source.active && !source.staleReason);
    return {
      lineUserId,
      lineUserIdMasked: mask(lineUserId),
      lineDisplayName: first({ value: uniq(list.map((source) => source.lineDisplayName))[0] }, ['value']) ||
        uniq(list.map((source) => source.identityName))[0] || '未取得 LINE 名稱',
      identities: identityKeys,
      systems,
      kinds,
      sourceCount: list.length,
      activeSourceCount: active.length,
      staleSourceCount: stale.length,
      multiIdentity: identityKeys.length > 1,
      mixedSystems: systems.length > 1,
      needsAttention: stale.length > 0,
      sources: list.map((source) => ({
        path: source.path,
        collection: source.collection,
        sourceId: source.sourceId,
        kind: source.kind,
        system: source.system,
        label: source.label,
        identityId: source.identityId,
        identityName: source.identityName,
        active: source.active && !source.staleReason,
        stale: Boolean(source.staleReason),
        staleReason: source.staleReason,
        duplicate: source.duplicate,
        status: source.staleReason ? `需整理：${source.staleReason}` : (statusOf(source.row) || (source.active ? '使用中' : '未啟用'))
      }))
    };
  }).sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) ||
    Number(b.multiIdentity) - Number(a.multiIdentity) ||
    a.lineDisplayName.localeCompare(b.lineDisplayName, 'zh-Hant'));

  return { rows, sources };
}

function overview(data) {
  const rows = data.rows;
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: {
      lineAccounts: rows.length,
      sourceRecords: rows.reduce((sum, row) => sum + row.sourceCount, 0),
      activeSources: rows.reduce((sum, row) => sum + row.activeSourceCount, 0),
      staleSources: rows.reduce((sum, row) => sum + row.staleSourceCount, 0),
      multiIdentityAccounts: rows.filter((row) => row.multiIdentity).length,
      attentionAccounts: rows.filter((row) => row.needsAttention).length
    },
    rows
  };
}

function clearPatch(source, actor, reason) {
  const patch = {
    lineNotifyEnabled: false,
    lineFriendFlag: false,
    lineBindStatus: 'unbound',
    lineLinkStatus: 'unlinked',
    globalLineRevokedAt: FV.serverTimestamp(),
    globalLineRevokedBy: actor,
    globalLineRevokedReason: reason,
    updatedAt: FV.serverTimestamp()
  };
  LINE_FIELDS.forEach((field) => { patch[field] = FV.delete(); });
  CLEAR_LINE_NAMES.forEach((field) => { patch[field] = FV.delete(); });
  if (/^coursePortal.+Bindings$/.test(source.collection)) {
    patch.status = 'revoked';
    patch.approvalStatus = 'revoked';
    patch.revokedAt = FV.serverTimestamp();
  }
  if (['employeeLineBindings', 'externalTeacherLineBindings'].includes(source.collection)) {
    patch.status = 'revoked';
    patch.active = false;
    patch.revokedAt = FV.serverTimestamp();
  }
  if (['employees', 'admins'].includes(source.collection)) {
    ['employeeBindCode', 'employeeBindText', 'lineBindingEmail', 'lineBindingRole'].forEach((field) => { patch[field] = FV.delete(); });
  }
  if (['rentalApplications', 'rentalContracts'].includes(source.collection)) {
    ['lineLinkedAt', 'lineLinkedAtText', 'lineConfirmText'].forEach((field) => { patch[field] = FV.delete(); });
  }
  return patch;
}

async function queryEq(collection, field, value) {
  try {
    const snap = await db.collection(collection).where(field, '==', value).limit(600).get();
    return snap.docs;
  } catch (error) {
    console.warn('[unified-line query skipped]', collection, field, error && error.message || error);
    return [];
  }
}

async function authAndQueueOps(lineUserId, actor, reason) {
  const ops = [];
  for (const collection of AUTH_COLLECTIONS) {
    for (const field of ['lineUserId', 'customerLineUserId', 'targetLineUserId', 'toLineUserId', 'linkedLineUserId']) {
      (await queryEq(collection, field, lineUserId)).forEach((doc) => ops.push({ action: 'delete', ref: doc.ref }));
    }
  }
  for (const collection of QUEUE_COLLECTIONS) {
    for (const field of ['lineUserId', 'customerLineUserId', 'targetLineUserId', 'toLineUserId', 'linkedLineUserId', 'target.lineUserId']) {
      (await queryEq(collection, field, lineUserId)).forEach((doc) => {
        const patch = {
          status: 'cancelled',
          cancelledAt: FV.serverTimestamp(),
          cancelledBy: actor,
          cancelReason: reason,
          cancelledLineUserIdHash: hash(lineUserId),
          updatedAt: FV.serverTimestamp()
        };
        LINE_FIELDS.forEach((name) => { patch[name] = FV.delete(); });
        ops.push({ action: 'set', ref: doc.ref, data: patch });
      });
    }
  }
  return ops;
}

async function commit(operations) {
  const deduped = [...new Map((operations || []).map((op) => [`${op.action}|${op.ref.path}`, op])).values()];
  for (let offset = 0; offset < deduped.length; offset += 400) {
    const batch = db.batch();
    deduped.slice(offset, offset + 400).forEach((op) => {
      if (op.action === 'delete') batch.delete(op.ref);
      else batch.set(op.ref, op.data || {}, { merge: true });
    });
    await batch.commit();
  }
  return deduped.length;
}

async function audit(action, lineUserId, actor, details) {
  await db.collection('lineBindingAdminAudit').add({
    action,
    lineUserIdHash: lineUserId ? hash(lineUserId) : '',
    lineUserIdMasked: lineUserId ? mask(lineUserId) : '',
    actor,
    details: details || {},
    createdAt: FV.serverTimestamp(),
    createdAtText: new Date().toISOString()
  });
}

async function revokeAll(lineUserId, request, reason) {
  const actor = actorOf(request);
  const data = await inventory();
  const matched = data.sources.filter((source) => source.lineUserId === lineUserId);
  const ops = matched.map((source) => ({ action: 'set', ref: source.ref, data: clearPatch(source, actor, reason) }));
  ops.push(...await authAndQueueOps(lineUserId, actor, reason));
  const changed = await commit(ops);
  await audit('revoke_all', lineUserId, actor, { sourceCount: matched.length, changedRecordCount: changed, reason });
  return {
    ok: true,
    action: 'revoke_all',
    sourceCount: matched.length,
    changedRecordCount: changed,
    message: '已從課務、員工、外聘老師與租賃系統解除這個 LINE，並取消尚未送出的相關通知。'
  };
}

async function cleanupLine(lineUserId, request) {
  const actor = actorOf(request);
  const data = await inventory();
  const matched = data.sources.filter((source) => source.lineUserId === lineUserId);
  const stale = matched.filter((source) => source.staleReason);
  const valid = matched.filter((source) => !source.staleReason);
  if (!stale.length) return { ok: true, changedRecordCount: 0, message: '目前沒有散落或失效資料需要整理。' };
  if (!valid.length) return revokeAll(lineUserId, request, '管理者整理無有效身分的 LINE 殘留資料');
  const changed = await commit(stale.map((source) => ({
    action: 'set', ref: source.ref, data: clearPatch(source, actor, '管理者整理散落或重複 LINE 資料')
  })));
  await audit('cleanup_line', lineUserId, actor, { staleSourceCount: stale.length, changedRecordCount: changed });
  return { ok: true, changedRecordCount: changed, message: `已整理 ${stale.length} 筆散落、重複或失效資料；有效綁定仍保留。` };
}

async function cleanupAll(request) {
  const actor = actorOf(request);
  const data = await inventory();
  const ops = [];
  let groups = 0;
  let fullyDisconnected = 0;
  for (const row of data.rows.slice(0, 300)) {
    const matched = data.sources.filter((source) => source.lineUserId === row.lineUserId);
    const stale = matched.filter((source) => source.staleReason);
    if (!stale.length) continue;
    groups += 1;
    stale.forEach((source) => ops.push({ action: 'set', ref: source.ref, data: clearPatch(source, actor, '管理者執行全系統 LINE 殘留整理') }));
    if (!matched.some((source) => !source.staleReason)) {
      fullyDisconnected += 1;
      ops.push(...await authAndQueueOps(row.lineUserId, actor, '管理者整理無有效身分的 LINE 殘留資料'));
    }
  }
  const changed = await commit(ops);
  await audit('cleanup_all', '', actor, { groupCount: groups, fullyDisconnectedGroupCount: fullyDisconnected, changedRecordCount: changed });
  return {
    ok: true,
    groupCount: groups,
    fullyDisconnectedGroupCount: fullyDisconnected,
    changedRecordCount: changed,
    message: groups
      ? `已整理 ${groups} 個 LINE 帳號的散落、重複或失效資料；其中 ${fullyDisconnected} 個沒有有效身分的帳號已停止通知。`
      : '目前沒有需要整理的 LINE 殘留資料。'
  };
}

function registerUnifiedLineBindingAdmin(exportsObject) {
  exportsObject.coursePortalAdminUnifiedLineData = onCall({ region: REGION, timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
    assertManager(request);
    return overview(await inventory());
  });

  exportsObject.coursePortalAdminUnifiedLineAction = onCall({ region: REGION, timeoutSeconds: 180, memory: '512MiB' }, async (request) => {
    assertManager(request);
    const data = request && request.data || {};
    const action = clean(data.action);
    if (action === 'cleanup_all') return cleanupAll(request);
    const lineUserId = clean(data.lineUserId);
    if (!lineUserId) throw new HttpsError('invalid-argument', '缺少 LINE User ID。');
    if (action === 'cleanup_line') return cleanupLine(lineUserId, request);
    if (action === 'revoke_all') {
      if (clean(data.confirmText) !== '解除') throw new HttpsError('failed-precondition', '請輸入「解除」確認完全斷開 LINE。');
      return revokeAll(lineUserId, request, '管理者於統一入口完全解除 LINE');
    }
    throw new HttpsError('invalid-argument', '不支援的 LINE 綁定管理操作。');
  });
}

module.exports = {
  registerUnifiedLineBindingAdmin,
  _test: { clean, inactive, lineIds, mask, activeSource, first }
};
