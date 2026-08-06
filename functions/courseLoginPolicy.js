'use strict';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function asMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return Number(value.toMillis()) || 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime() || 0;
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function bindingIdentity(type, row) {
  if (type === 'teacher') return clean(row && (row.teacherId || row.targetId));
  if (type === 'student') return clean(row && (row.studentId || row.targetId));
  if (type === 'renter') return clean(row && (row.renterId || row.targetId));
  return '';
}

function bindingIdentityPatch(type, row) {
  const role = lower(type);
  const field = role === 'teacher' ? 'teacherId' : (role === 'student' ? 'studentId' : (role === 'renter' ? 'renterId' : ''));
  const identityId = bindingIdentity(role, row);
  if (!field || !identityId || clean(row && row[field])) return {};
  return { [field]: identityId };
}

function isPendingBinding(row) {
  const status = lower(row && row.status);
  const approval = lower(row && row.approvalStatus);
  return status === 'pending' || ['pending', 'waiting', '待審核', '等待主管確認'].includes(approval);
}


// A unified LINE unlink removes the messaging/login association, but it is not
// a permanent account suspension. Legacy unlink rows used revoked/revoked;
// current rows use unbound/unbound. Explicit administrator rejection remains blocked.
function isRecoverableUnboundBinding(row) {
  if (!row) return false;
  const status = lower(row.status);
  const approval = lower(row.approvalStatus);
  if (status === 'rejected' || approval === 'rejected') return false;
  if (['unbound', 'unlinked'].includes(status) || ['unbound', 'unlinked'].includes(approval)) return true;
  const globallyUnlinked = Boolean(
    row.globalLineRevokedAt ||
    clean(row.globalLineRevokedReason) ||
    clean(row.globalLineRevokedBy)
  );
  if (!globallyUnlinked) return false;
  return status === 'revoked' ||
    approval === 'revoked' ||
    lower(row.lineBindStatus) === 'unbound' ||
    lower(row.lineLinkStatus) === 'unlinked';
}

function isBlockedBinding(row) {
  if (isRecoverableUnboundBinding(row)) return false;
  const status = lower(row && row.status);
  const approval = lower(row && row.approvalStatus);
  return ['revoked', 'rejected', 'disabled', 'inactive', '已拒絕', '已解除', '已停用'].includes(status) ||
    ['rejected', 'revoked', 'disabled', '已拒絕', '已解除', '已停用'].includes(approval);
}

function isApprovedActiveBinding(row) {
  if (!row || isPendingBinding(row) || isBlockedBinding(row)) return false;
  const status = lower(row.status || 'active');
  return ['active', 'approved', 'enabled', '使用中', '啟用'].includes(status);
}

function recency(row) {
  return Math.max(
    asMillis(row && row.lastLoginAt),
    asMillis(row && row.updatedAt),
    asMillis(row && row.approvedAt),
    asMillis(row && row.createdAt)
  );
}

function compareBindings(a, b) {
  const primaryA = a && (a.primary === true || a.isPrimary === true) ? 1 : 0;
  const primaryB = b && (b.primary === true || b.isPrimary === true) ? 1 : 0;
  if (primaryA !== primaryB) return primaryB - primaryA;
  const recent = recency(b) - recency(a);
  if (recent) return recent;
  return clean(a && a.__id).localeCompare(clean(b && b.__id), 'zh-Hant');
}

/**
 * Decide what a role-specific LINE callback is allowed to do.
 *
 * A LINE account may legitimately own multiple student bindings (one parent,
 * multiple children), but teacher/renter logins must resolve to one active
 * identity. Pending rows are never promoted by login itself.
 */
function decideLineLoginBinding(type, bindings) {
  const role = lower(type);
  const rows = Array.isArray(bindings) ? bindings.slice() : [];
  const active = rows.filter(isApprovedActiveBinding).sort(compareBindings);
  const pending = rows.filter(isPendingBinding);
  const blocked = rows.filter(isBlockedBinding);

  if (!active.length) {
    if (pending.length) return { action: 'pending', active: [], pending, blocked };
    if (blocked.length) return { action: 'blocked', active: [], pending, blocked };
    return { action: 'setup', active: [], pending, blocked };
  }

  const activeIdentities = active.map((row) => bindingIdentity(role, row));
  const identities = [...new Set(activeIdentities.filter(Boolean))];
  if (activeIdentities.some((identity) => !identity) || (role !== 'student' && identities.length > 1)) {
    return { action: 'conflict', active, pending, blocked, identities };
  }

  return {
    action: 'login',
    binding: active[0],
    active,
    pending,
    blocked,
    identities
  };
}

module.exports = {
  bindingIdentity,
  bindingIdentityPatch,
  compareBindings,
  decideLineLoginBinding,
  isApprovedActiveBinding,
  isBlockedBinding,
  isPendingBinding,
  isRecoverableUnboundBinding
};
