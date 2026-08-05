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
const READ_PAGE_SIZE = 500;
const MAX_ATOMIC_WRITES = 400;
const ACTION_WRITE_BUDGET_MS = 135000;
const BUSINESS_HISTORY_COLLECTIONS = new Set([
  'externalTeacherProfiles', 'externalTeacherContracts',
  'rentalApplications', 'rentalContracts'
]);
const DEDUPLICATED_BINDING_COLLECTIONS = new Set([
  'coursePortalTeacherBindings', 'coursePortalStudentBindings', 'coursePortalRenterBindings',
  'employeeLineBindings', 'externalTeacherLineBindings'
]);
const ACTIVE_BINDING_STATUSES = new Set([
  'active', 'enabled', 'approved', 'bound', 'verified',
  '使用中', '啟用', '已啟用', '已綁定', '已驗證'
]);
const CANCELLABLE_QUEUE_STATUSES = new Set([
  'pending', '待發送', 'queued', 'queue', '待處理', 'retry', '發送失敗'
]);

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
  const statuses = [
    'status', 'accountStatus', 'employmentStatus', 'lineBindStatus', 'lineLinkStatus',
    'approvalStatus'
  ].map((field) => lower(row[field])).filter(Boolean);
  const englishWords = new Set([
    'inactive', 'disabled', 'revoked', 'deleted', 'cancelled', 'canceled', 'archived',
    'terminated', 'resigned', 'unbound', 'rejected', 'expired', 'ended', 'closed', 'returned'
  ]);
  const chineseExact = new Set([
    '已停用', '停用', '已解除', '解除', '已取消', '取消', '離職',
    '已離職', '已退租', '退租', '封存', '已封存', '已結束', '到期', '已到期'
  ]);
  const chineseFinalPrefixes = [
    '已停用', '已解除', '已取消', '已離職', '已退租', '已封存', '已結束', '已到期'
  ];
  const inactiveStatus = statuses.some((status) => {
    // Generic words such as「解除」or「離職」may occur in a pending request label.
    // Only exact generic states or explicit 已… final-state prefixes are destructive.
    if (chineseExact.has(status) || chineseFinalPrefixes.some((prefix) => status.startsWith(prefix))) return true;
    const tokens = status.split(/[^a-z0-9]+/).filter(Boolean);
    return tokens.some((token) => englishWords.has(token));
  });
  return inactiveStatus ||
    row.active === false || row.enabled === false || row.hiddenFromActiveLists === true;
}

function lineIds(row) {
  const values = LINE_FIELDS.map((field) => clean(row && row[field]));
  if (row && row.line && typeof row.line === 'object') {
    values.push(clean(row.line.userId), clean(row.line.lineUserId));
  }
  return uniq(values);
}

function activeSource(spec, row) {
  if (inactive(row)) return false;
  if (['employees', 'admins'].includes(spec.collection)) {
    return !['0', 'false', 'no', '否', 'disabled', 'inactive'].includes(lower(row.lineNotifyEnabled));
  }
  if (/^coursePortal.+Bindings$/.test(spec.collection)) {
    const status = lower(row.status || 'active');
    const approval = lower(row.approvalStatus || 'approved');
    return ['active', 'enabled', 'approved', '使用中', '啟用'].includes(status) &&
      !['pending', 'rejected', 'revoked', '等待主管確認', '已拒絕', '已解除'].includes(approval);
  }
  if (['employeeLineBindings', 'externalTeacherLineBindings'].includes(spec.collection)) {
    return ACTIVE_BINDING_STATUSES.has(lower(row.status || row.lineBindStatus || 'bound'));
  }
  if (['rentalApplications', 'rentalContracts'].includes(spec.collection)) {
    const link = lower(row.lineLinkStatus || 'linked');
    return ['linked', 'bound', 'verified', 'active', '已綁定', '已驗證'].includes(link);
  }
  return true;
}

function sourceKind(spec, row) {
  if (spec.collection === 'employees') {
    const identityType = lower(row && (row.identityType || row.employeeType));
    if ((row && row.isExternalTeacher === true) || identityType.includes('external') || identityType.includes('外聘')) {
      return 'external';
    }
  }
  if (spec.collection !== 'employeeLineBindings') return spec.kind;
  const targetCollection = lower(row && row.targetCollection);
  const externalMirror = targetCollection.includes('externalteacher') ||
    clean(row && row.externalTeacherContractId) ||
    clean(row && row.externalTeacherEmployeeId);
  return externalMirror ? 'external' : spec.kind;
}

function timestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (typeof value.toDate === 'function') return Number(value.toDate().getTime()) || 0;
  if (typeof value === 'object' && Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1e6);
  }
  if (value instanceof Date) return value.getTime() || 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sourceTimestamp(row) {
  return Math.max(0, ...[
    'updatedAt', 'lineLinkedAt', 'lineBoundAt', 'linkedAt', 'approvedAt', 'createdAt',
    'updatedAtText', 'lineLinkedAtText', 'lineBoundAtText', 'linkedAtText', 'createdAtText'
  ].map((field) => timestampMs(row && row[field])));
}

async function readSource(spec, database = db) {
  const docs = [];
  let cursor = null;
  try {
    while (true) {
      let query = database.collection(spec.collection)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(READ_PAGE_SIZE);
      if (cursor) query = query.startAfter(cursor);
      const snap = await query.get();
      const page = snap.docs || [];
      page.forEach((doc) => docs.push({
        spec,
        ref: doc.ref,
        id: doc.id,
        row: doc.data() || {},
        updateTime: doc.updateTime || null
      }));
      if (page.length < READ_PAGE_SIZE) break;
      cursor = page[page.length - 1];
    }
    return docs;
  } catch (error) {
    console.error('[unified-line read failed]', spec.collection, error && error.message || error);
    // Cleanup must never continue from a silently truncated inventory.
    throw error;
  }
}

function staleReason(source, context) {
  if (!source.identityId) return '缺少身分編號';
  if (inactive(source.row)) return '來源已停用或已結束';
  if (source.collection === 'employeeLineBindings' && source.kind === 'employee') {
    if (!context.employeeIds.has(source.identityId)) return '找不到對應員工';
    if (!context.activeEmployeeIds.has(source.identityId)) return '對應員工已停用或離職';
  }
  if (['employeeLineBindings', 'externalTeacherLineBindings'].includes(source.collection) &&
      source.kind === 'external') {
    const linkedIds = uniq([
      source.identityId, source.canonicalIdentityId,
      source.row && source.row.employeeId,
      source.row && source.row.externalTeacherEmployeeId,
      source.row && source.row.employeeDocId,
      source.row && source.row.teacherId,
      source.row && source.row.externalTeacherId,
      source.row && source.row.externalTeacherContractId,
      source.row && source.row.contractId
    ]);
    const exists = linkedIds.some((id) => context.externalIds.has(id) || context.employeeIds.has(id));
    if (!exists) return '找不到對應外聘老師資料';
  }
  return '';
}

function buildIdentityContext(docs) {
  const context = {
    employeeIds: new Set(),
    activeEmployeeIds: new Set(),
    externalIds: new Set(),
    externalAliasToEmployee: new Map(),
    rentalAliasToApplication: new Map()
  };

  docs.forEach(({ spec, id, row }) => {
    const identityId = first(row, spec.idFields) || id;
    if (spec.collection === 'employees') {
      context.employeeIds.add(identityId);
      if (!inactive(row)) context.activeEmployeeIds.add(identityId);
    }

    if (spec.kind === 'external' || sourceKind(spec, row) === 'external') {
      const employeeId = first(row, [
        'employeeId', 'externalTeacherEmployeeId', 'linkedEmployeeId',
        'employeeDocId', 'targetEmployeeId'
      ]);
      const aliases = uniq([
        id, identityId, employeeId,
        first(row, ['teacherId']),
        first(row, ['externalTeacherId']),
        first(row, ['externalTeacherContractId']),
        first(row, ['contractId']),
        first(row, ['id'])
      ]);
      if (['externalTeacherProfiles', 'externalTeacherContracts'].includes(spec.collection)) {
        aliases.forEach((alias) => context.externalIds.add(alias));
      }
      if (employeeId) {
        if (['externalTeacherProfiles', 'externalTeacherContracts'].includes(spec.collection)) {
          context.externalIds.add(employeeId);
        }
        aliases.forEach((alias) => context.externalAliasToEmployee.set(alias, employeeId));
      }
    }

    if (spec.collection === 'rentalApplications') {
      const applicationId = first(row, ['applicationId', 'applicationNo', 'rentalApplicationNo']) || id;
      const applicationAliases = uniq([
        id, applicationId, row.applicationId, row.applicationNo, row.rentalApplicationNo
      ]);
      applicationAliases.forEach((alias) => context.rentalAliasToApplication.set(alias, applicationId));
      uniq([row.linkedContractId, row.contractId]).forEach((contractId) => {
        context.rentalAliasToApplication.set(contractId, applicationId);
      });
    }
  });

  // A mirror may only know a teacher/contract id. Resolve it after every authoritative
  // employee link has been collected so input/read order cannot change the result.
  docs.forEach(({ spec, id, row }) => {
    if (spec.kind !== 'external' && sourceKind(spec, row) !== 'external') return;
    const employeeId = first(row, [
      'employeeId', 'externalTeacherEmployeeId', 'linkedEmployeeId',
      'employeeDocId', 'targetEmployeeId'
    ]) || uniq([
      id, first(row, spec.idFields), row.teacherId, row.externalTeacherId,
      row.externalTeacherContractId, row.contractId
    ]).map((alias) => context.externalAliasToEmployee.get(alias)).find(Boolean) || '';
    if (!employeeId) return;
    uniq([
      id, employeeId, first(row, spec.idFields), row.teacherId, row.externalTeacherId,
      row.externalTeacherContractId, row.contractId
    ]).forEach((alias) => {
      context.externalAliasToEmployee.set(alias, employeeId);
    });
  });

  return context;
}

function canonicalIdentityId(spec, id, row, kind, context) {
  const identityId = first(row, spec.idFields) || id;
  if (kind === 'equipment-rental') {
    if (spec.collection === 'rentalApplications') {
      const aliases = uniq([id, row.applicationId, row.applicationNo, row.rentalApplicationNo, identityId]);
      return aliases.map((alias) => context.rentalAliasToApplication.get(alias)).find(Boolean) || identityId;
    }
    const applicationAlias = first(row, ['applicationId', 'applicationNo', 'rentalApplicationNo']);
    if (applicationAlias) return context.rentalAliasToApplication.get(applicationAlias) || applicationAlias;
    const contractAliases = uniq([id, row.contractId, row.contractNo, identityId]);
    return contractAliases.map((alias) => context.rentalAliasToApplication.get(alias)).find(Boolean) || identityId;
  }
  if (kind === 'external') {
    const employeeId = first(row, [
      'employeeId', 'externalTeacherEmployeeId', 'linkedEmployeeId',
      'employeeDocId', 'targetEmployeeId'
    ]);
    if (employeeId) return employeeId;
    const aliases = uniq([
      id, identityId, row.teacherId, row.externalTeacherId,
      row.externalTeacherContractId, row.contractId
    ]);
    return aliases.map((alias) => context.externalAliasToEmployee.get(alias)).find(Boolean) || identityId;
  }
  return identityId;
}

function compareSourcePreference(a, b) {
  const validDiff = Number(!b.staleReason) - Number(!a.staleReason);
  if (validDiff) return validDiff;
  const activeDiff = Number(b.active) - Number(a.active);
  if (activeDiff) return activeDiff;
  const timeDiff = b.updatedAtMs - a.updatedAtMs;
  if (timeDiff) return timeDiff;
  return a.path.localeCompare(b.path, 'en');
}

function markDeterministicDuplicates(sources) {
  const duplicateGroups = new Map();
  sources.forEach((source) => {
    // Profiles, contracts and rental records are business history mirrors. Multiple
    // documents there are expected and must never be auto-labelled as duplicate
    // bindings. Only dedicated binding/index collections are safe to deduplicate.
    if (!DEDUPLICATED_BINDING_COLLECTIONS.has(source.collection)) return;
    const key = `${source.lineUserId}|${source.collection}|${source.kind}|${source.canonicalIdentityId}`;
    if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
    duplicateGroups.get(key).push(source);
  });
  duplicateGroups.forEach((group) => {
    const ordered = [...group].sort(compareSourcePreference);
    ordered.slice(1).forEach((source) => {
      source.duplicate = true;
      if (!source.staleReason) source.staleReason = '同一身分有重複綁定資料';
    });
  });
}

function sourceAutoCleanable(source) {
  return Boolean(source && source.staleReason && source.autoCleanupEligible && !source.destructiveBlocked);
}

function effectiveIdentityKey(source) {
  // Rental applications/contracts are business events under one LINE customer, not
  // separate people. Keep their per-application canonical ids for display, but count
  // the LINE account as one effective equipment-rental identity.
  if (source.kind === 'equipment-rental') return 'equipment-rental|line-account';
  return `${source.kind}|${source.canonicalIdentityId}`;
}

function buildInventory(docs) {
  const context = buildIdentityContext(docs);

  const sources = [];
  docs.forEach(({ spec, ref, id, row, updateTime }) => {
    const documentLineIds = lineIds(row);
    const hasDifferentLineIds = documentLineIds.length > 1;
    documentLineIds.forEach((lineUserId) => {
      const kind = sourceKind(spec, row);
      const identityId = first(row, spec.idFields) || id;
      const sourceRef = ref || { path: `${spec.collection}/${id}` };
      const source = {
        ref: sourceRef, row, lineUserId, updateTime: updateTime || null,
        path: sourceRef.path || `${spec.collection}/${id}`,
        collection: spec.collection,
        sourceId: id,
        kind,
        system: spec.system,
        label: spec.label,
        identityId,
        canonicalIdentityId: canonicalIdentityId(spec, id, row, kind, context),
        identityName: first(row, spec.nameFields),
        lineDisplayName: first(row, ['lineDisplayName', 'lineName', 'displayName']),
        active: activeSource(spec, row),
        staleReason: '',
        duplicate: false,
        updatedAtMs: sourceTimestamp(row),
        autoCleanupEligible: !BUSINESS_HISTORY_COLLECTIONS.has(spec.collection),
        destructiveBlocked: hasDifferentLineIds,
        conflictReason: hasDifferentLineIds ? '同一筆資料含有不同 LINE 帳號，禁止自動整理' : '',
        documentLineIds
      };
      source.staleReason = staleReason(source, context);
      sources.push(source);
    });
  });

  markDeterministicDuplicates(sources);

  const grouped = new Map();
  sources.forEach((source) => {
    if (!grouped.has(source.lineUserId)) grouped.set(source.lineUserId, []);
    grouped.get(source.lineUserId).push(source);
  });

  const rows = [...grouped.entries()].map(([lineUserId, list]) => {
    const ordered = [...list].sort(compareSourcePreference);
    const canonicalKeyOf = (source) => `${source.kind}|${source.canonicalIdentityId}`;
    const identityKeys = uniq(ordered.map(canonicalKeyOf)).sort();
    const systems = uniq(ordered.map((source) => source.system)).sort();
    const kinds = uniq(ordered.map((source) => source.kind)).sort();
    const stale = list.filter(sourceAutoCleanable);
    const manualReview = list.filter((source) => source.destructiveBlocked ||
      (source.staleReason && !sourceAutoCleanable(source)));
    const active = list.filter((source) => source.active && !source.staleReason);
    const activeIdentityKeys = uniq(active.map(effectiveIdentityKey)).sort();
    const activeByKind = new Map();
    active.forEach((source) => {
      if (!activeByKind.has(source.kind)) activeByKind.set(source.kind, new Set());
      activeByKind.get(source.kind).add(effectiveIdentityKey(source));
    });
    // A parent LINE account may legitimately own several student identities. Other
    // role kinds must remain one-to-one so distinct active ids are a real conflict.
    // Equipment-rental events already collapse to one effective LINE identity above.
    const multiIdentity = [...activeByKind.entries()].some(([kind, identityIds]) =>
      kind !== 'student' && identityIds.size > 1
    );
    const lineIdConflict = list.some((source) => source.destructiveBlocked);
    return {
      lineUserId,
      lineUserIdMasked: mask(lineUserId),
      lineDisplayName: ordered.map((source) => source.lineDisplayName).find(Boolean) ||
        ordered.map((source) => source.identityName).find(Boolean) || '未取得 LINE 名稱',
      identities: identityKeys,
      activeIdentities: activeIdentityKeys,
      systems,
      kinds,
      sourceCount: list.length,
      // This count represents effective role identities, not mirrored business rows.
      activeSourceCount: activeIdentityKeys.length,
      activeRecordCount: active.length,
      staleSourceCount: stale.length,
      manualReviewSourceCount: manualReview.length,
      lineIdConflict,
      multiIdentity,
      mixedSystems: systems.length > 1,
      needsAttention: stale.length > 0 || manualReview.length > 0 || multiIdentity,
      sources: ordered.map((source) => ({
        path: source.path,
        collection: source.collection,
        sourceId: source.sourceId,
        kind: source.kind,
        system: source.system,
        label: source.label,
        identityId: source.identityId,
        canonicalIdentityId: source.canonicalIdentityId,
        identityName: source.identityName,
        active: source.active && !source.staleReason,
        stale: sourceAutoCleanable(source),
        staleReason: source.staleReason,
        manualReview: source.destructiveBlocked || Boolean(source.staleReason && !sourceAutoCleanable(source)),
        conflictReason: source.conflictReason,
        destructiveBlocked: source.destructiveBlocked,
        duplicate: source.duplicate,
        status: source.conflictReason
          ? `需人工確認：${source.conflictReason}`
          : source.staleReason
            ? (sourceAutoCleanable(source) ? `需整理：${source.staleReason}` : `保留歷史：${source.staleReason}`)
            : (statusOf(source.row) || (source.active ? '使用中' : '未啟用'))
      }))
    };
  }).sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) ||
    Number(b.multiIdentity) - Number(a.multiIdentity) ||
    a.lineDisplayName.localeCompare(b.lineDisplayName, 'zh-Hant'));

  return { rows, sources };
}

async function inventory() {
  const docs = (await Promise.all(SOURCES.map((spec) => readSource(spec)))).flat();
  return buildInventory(docs);
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
      manualReviewSources: rows.reduce((sum, row) => sum + row.manualReviewSourceCount, 0),
      lineIdConflictAccounts: rows.filter((row) => row.lineIdConflict).length,
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
  // Destructive operations use batch.update(), so dotted field paths can remove only
  // the nested user ids while preserving unrelated LINE metadata on the same map.
  if (source.row && source.row.line && typeof source.row.line === 'object') {
    patch['line.userId'] = FV.delete();
    patch['line.lineUserId'] = FV.delete();
  }
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

async function queryEq(collection, field, value, database = db) {
  const docs = [];
  let cursor = null;
  try {
    while (true) {
      let query = database.collection(collection)
        .where(field, '==', value)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(READ_PAGE_SIZE);
      if (cursor) query = query.startAfter(cursor);
      const snap = await query.get();
      const page = snap.docs || [];
      docs.push(...page);
      if (page.length < READ_PAGE_SIZE) break;
      cursor = page[page.length - 1];
    }
    return docs;
  } catch (error) {
    console.error('[unified-line query failed]', collection, field, error && error.message || error);
    // A partial token/queue scan must not be reported as a complete revocation.
    throw error;
  }
}

function queueCanBeCancelled(row) {
  const status = lower(row && (row.status || row['狀態']) || '待發送');
  return CANCELLABLE_QUEUE_STATUSES.has(status) || /^fail/i.test(status) ||
    status.includes('error') || status.includes('失敗');
}

function queueCancelPatch(row, lineUserId, actor, reason) {
  const patch = {
    status: 'cancelled',
    cancelledAt: FV.serverTimestamp(),
    cancelledBy: actor,
    cancelReason: reason,
    cancelledLineUserIdHash: hash(lineUserId),
    updatedAt: FV.serverTimestamp()
  };
  LINE_FIELDS.forEach((name) => { patch[name] = FV.delete(); });
  if (row && row.line && typeof row.line === 'object') {
    patch['line.userId'] = FV.delete();
    patch['line.lineUserId'] = FV.delete();
  }
  if (row && row.target && typeof row.target === 'object') {
    patch['target.lineUserId'] = FV.delete();
  }
  return patch;
}

async function authAndQueueOps(lineUserId, actor, reason) {
  const ops = [];
  const authQueries = [];
  for (const collection of AUTH_COLLECTIONS) {
    for (const field of ['lineUserId', 'customerLineUserId', 'targetLineUserId', 'toLineUserId', 'linkedLineUserId']) {
      authQueries.push(queryEq(collection, field, lineUserId));
    }
  }
  (await Promise.all(authQueries)).flat().forEach((doc) => {
    ops.push({ action: 'delete', ref: doc.ref, updateTime: doc.updateTime || null });
  });

  const queueQueries = [];
  for (const collection of QUEUE_COLLECTIONS) {
    for (const field of ['lineUserId', 'customerLineUserId', 'targetLineUserId', 'toLineUserId', 'linkedLineUserId', 'target.lineUserId']) {
      queueQueries.push(queryEq(collection, field, lineUserId));
    }
  }
  (await Promise.all(queueQueries)).flat().forEach((doc) => {
    const row = typeof doc.data === 'function' ? (doc.data() || {}) : {};
    // Sent/delivered/skipped records are notification history. Only queue states that
    // the sender itself considers pending/retryable may be cancelled.
    if (queueCanBeCancelled(row)) {
      const patch = queueCancelPatch(row, lineUserId, actor, reason);
      ops.push({ action: 'update', ref: doc.ref, data: patch, updateTime: doc.updateTime || null });
    }
  });
  return ops;
}

function dedupeOperations(operations) {
  return [...new Map((operations || []).map((op) => [op.ref.path, op])).values()];
}

async function commitAtomic(operations, database = db) {
  const deduped = dedupeOperations(operations);
  if (deduped.length > MAX_ATOMIC_WRITES) {
    throw new HttpsError(
      'resource-exhausted',
      `本次需要修改 ${deduped.length} 筆資料，超過單次安全上限 ${MAX_ATOMIC_WRITES} 筆；系統未執行任何修改。`
    );
  }
  if (!deduped.length) return 0;
  const batch = database.batch();
  deduped.forEach((op) => {
    const precondition = op.updateTime ? { lastUpdateTime: op.updateTime } : null;
    if (op.action === 'delete') {
      if (precondition) batch.delete(op.ref, precondition);
      else batch.delete(op.ref);
    } else if (op.action === 'update') {
      if (precondition) batch.update(op.ref, op.data || {}, precondition);
      else batch.update(op.ref, op.data || {});
    } else {
      batch.set(op.ref, op.data || {}, { merge: true });
    }
  });
  await batch.commit();
  return deduped.length;
}

function auditRecord(action, lineUserId, actor, details) {
  return {
    action,
    lineUserIdHash: lineUserId ? hash(lineUserId) : '',
    lineUserIdMasked: lineUserId ? mask(lineUserId) : '',
    actor,
    details: details || {},
    createdAt: FV.serverTimestamp(),
    createdAtText: new Date().toISOString()
  };
}

async function audit(action, lineUserId, actor, details) {
  await db.collection('lineBindingAdminAudit').add(auditRecord(action, lineUserId, actor, details));
}

function auditWriteOperation(action, lineUserId, actor, details) {
  return {
    action: 'set',
    ref: db.collection('lineBindingAdminAudit').doc(),
    data: auditRecord(action, lineUserId, actor, details)
  };
}

async function auditSafely(action, lineUserId, actor, details) {
  try {
    await audit(action, lineUserId, actor, details);
    return true;
  } catch (error) {
    console.error('[unified-line audit failed]', action, error && error.message || error);
    return false;
  }
}

function sourceClearOperation(source, actor, reason) {
  return {
    action: 'update',
    ref: source.ref,
    data: clearPatch(source, actor, reason),
    updateTime: source.updateTime || null
  };
}

function unsafeSharedLineSources(sources) {
  return (sources || []).filter((source) => source.destructiveBlocked);
}

async function revokeAll(lineUserId, request, reason) {
  const actor = actorOf(request);
  const data = await inventory();
  const matched = data.sources.filter((source) => source.lineUserId === lineUserId);
  const shared = unsafeSharedLineSources(matched);
  if (shared.length) {
    throw new HttpsError(
      'failed-precondition',
      `有 ${new Set(shared.map((source) => source.path)).size} 筆資料同時含有不同 LINE 帳號。為避免解除到另一位使用者，系統未執行修改，請先人工確認這些資料。`
    );
  }
  const ops = matched.map((source) => sourceClearOperation(source, actor, reason));
  ops.push(...await authAndQueueOps(lineUserId, actor, reason));
  const changed = dedupeOperations(ops).length;
  ops.push(auditWriteOperation('revoke_all', lineUserId, actor, {
    sourceCount: matched.length,
    changedRecordCount: changed,
    reason
  }));
  await commitAtomic(ops);
  return {
    ok: true,
    action: 'revoke_all',
    sourceCount: matched.length,
    changedRecordCount: changed,
    auditLogged: true,
    message: '已從課務、員工、外聘老師與租賃系統解除這個 LINE，並取消尚未送出的相關通知。'
  };
}

async function cleanupLine(lineUserId, request) {
  const actor = actorOf(request);
  const data = await inventory();
  const matched = data.sources.filter((source) => source.lineUserId === lineUserId);
  const stale = matched.filter(sourceAutoCleanable);
  const protectedSources = matched.filter((source) => source.destructiveBlocked ||
    (source.staleReason && !sourceAutoCleanable(source)));
  if (!stale.length) {
    return {
      ok: true,
      changedRecordCount: 0,
      protectedSourceCount: protectedSources.length,
      message: protectedSources.length
        ? `有 ${protectedSources.length} 筆資料屬於業務歷史或 LINE 欄位衝突，系統已保留並交由人工確認。`
        : '目前沒有散落或失效資料需要整理。'
    };
  }
  // Only a group made exclusively of safe stale binding/index rows may trigger full
  // token/queue revocation. Historical business rows and conflicts are never used as
  // proof that a person has no valid identity.
  if (matched.length && matched.every(sourceAutoCleanable)) {
    return revokeAll(lineUserId, request, '管理者整理無有效身分的 LINE 殘留資料');
  }
  const ops = stale.map((source) =>
    sourceClearOperation(source, actor, '管理者整理散落或重複 LINE 資料')
  );
  const changed = dedupeOperations(ops).length;
  ops.push(auditWriteOperation('cleanup_line', lineUserId, actor, {
    staleSourceCount: stale.length,
    protectedSourceCount: protectedSources.length,
    changedRecordCount: changed
  }));
  await commitAtomic(ops);
  return {
    ok: true,
    changedRecordCount: changed,
    protectedSourceCount: protectedSources.length,
    auditLogged: true,
    message: `已整理 ${stale.length} 筆散落、重複或失效資料；有效綁定與業務歷史仍保留。` +
      (protectedSources.length ? `另有 ${protectedSources.length} 筆需人工確認，未自動修改。` : '')
  };
}

async function cleanupAll(request) {
  const actor = actorOf(request);
  const startedAt = Date.now();
  const data = await inventory();
  let groups = 0;
  let successfulGroups = 0;
  let fullyDisconnected = 0;
  let changed = 0;
  let protectedGroups = 0;
  let deferredGroups = 0;
  const failures = [];
  const sourcesByLine = new Map();
  data.sources.forEach((source) => {
    if (!sourcesByLine.has(source.lineUserId)) sourcesByLine.set(source.lineUserId, []);
    sourcesByLine.get(source.lineUserId).push(source);
  });
  for (let rowIndex = 0; rowIndex < data.rows.length; rowIndex += 1) {
    const row = data.rows[rowIndex];
    const matched = sourcesByLine.get(row.lineUserId) || [];
    const stale = matched.filter(sourceAutoCleanable);
    const protectedSources = matched.filter((source) => source.destructiveBlocked ||
      (source.staleReason && !sourceAutoCleanable(source)));
    if (protectedSources.length) protectedGroups += 1;
    if (!stale.length) continue;
    if (Date.now() - startedAt >= ACTION_WRITE_BUDGET_MS) {
      deferredGroups = data.rows.slice(rowIndex).filter((remainingRow) =>
        (sourcesByLine.get(remainingRow.lineUserId) || []).some(sourceAutoCleanable)
      ).length;
      groups += deferredGroups;
      break;
    }
    groups += 1;
    const disconnect = matched.length > 0 && matched.every(sourceAutoCleanable);
    try {
      const groupOps = stale.map((source) =>
        sourceClearOperation(source, actor, '管理者執行全系統 LINE 殘留整理')
      );
      if (disconnect) {
        groupOps.push(...await authAndQueueOps(row.lineUserId, actor, '管理者整理無有效身分的 LINE 殘留資料'));
      }
      const groupChanged = dedupeOperations(groupOps).length;
      groupOps.push(auditWriteOperation('cleanup_all_group', row.lineUserId, actor, {
        staleSourceCount: stale.length,
        protectedSourceCount: protectedSources.length,
        changedRecordCount: groupChanged,
        fullyDisconnected: disconnect
      }));
      await commitAtomic(groupOps);
      changed += groupChanged;
      successfulGroups += 1;
      if (disconnect) fullyDisconnected += 1;
    } catch (error) {
      failures.push({
        lineUserIdHash: hash(row.lineUserId),
        lineUserIdMasked: mask(row.lineUserId),
        message: clean(error && error.message || error).slice(0, 300)
      });
    }
  }
  const auditLogged = await auditSafely('cleanup_all', '', actor, {
    groupCount: groups,
    successfulGroupCount: successfulGroups,
    failedGroupCount: failures.length,
    deferredGroupCount: deferredGroups,
    fullyDisconnectedGroupCount: fullyDisconnected,
    protectedGroupCount: protectedGroups,
    changedRecordCount: changed,
    partial: (failures.length > 0 || deferredGroups > 0) && successfulGroups > 0,
    failures: failures.slice(0, 100)
  });
  const partial = (failures.length > 0 || deferredGroups > 0) && successfulGroups > 0;
  const ok = failures.length === 0 && deferredGroups === 0;
  let message = groups
    ? `已安全整理 ${successfulGroups}/${groups} 個 LINE 帳號，共修改 ${changed} 筆資料；其中 ${fullyDisconnected} 個沒有有效身分的帳號已停止通知。`
    : '目前沒有可自動整理的 LINE 殘留資料。';
  if (protectedGroups) message += `另有 ${protectedGroups} 個帳號含業務歷史或 LINE 欄位衝突，未自動修改。`;
  if (failures.length) message += `有 ${failures.length} 個帳號未完成；每一組皆採單一原子批次，因此失敗組沒有套用部分修改。`;
  if (deferredGroups) message += `為避免函式逾時，另有 ${deferredGroups} 個帳號延後處理；可重新執行以繼續。`;
  if (!auditLogged) message += '本次稽核記錄寫入失敗，系統已在伺服器記錄錯誤。';
  return {
    ok,
    partial,
    groupCount: groups,
    successfulGroupCount: successfulGroups,
    failedGroupCount: failures.length,
    deferredGroupCount: deferredGroups,
    fullyDisconnectedGroupCount: fullyDisconnected,
    protectedGroupCount: protectedGroups,
    changedRecordCount: changed,
    auditLogged,
    message
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
  _test: {
    clean, inactive, lineIds, mask, activeSource, first, sourceKind,
    sourceTimestamp, canonicalIdentityId, compareSourcePreference,
    buildIdentityContext, buildInventory, readSource, queryEq, SOURCES,
    sourceAutoCleanable, effectiveIdentityKey, queueCanBeCancelled, queueCancelPatch,
    clearPatch, dedupeOperations, commitAtomic, MAX_ATOMIC_WRITES
  }
};
