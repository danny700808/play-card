'use strict';

const crypto = require('crypto');

const SUBJECT_CATALOG_COLLECTION = 'coursePortalSubjectCatalog';
const TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION = 'coursePortalTeacherSubjectAssignments';
const FEE_PLAN_COLLECTION = 'coursePortalFeePlans';

const clean = (value) => String(value == null ? '' : value).trim();
const uniq = (values) => [...new Set((values || []).map(clean).filter(Boolean))];

function normalizedSubjectName(value) {
  return clean(value).normalize('NFKC').toLocaleLowerCase('zh-TW').replace(/\s+/gu, '');
}

function catalogSubjectId(value) {
  const key = normalizedSubjectName(value);
  if (!key) return '';
  return `portal-subject-${crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 24)}`;
}

function rowId(row, fallback = '') {
  return clean(row && (row.id || row.subjectId || row.sourceId || row.__id)) || clean(fallback);
}

function catalogRow(value) {
  if (!value) return null;
  if (typeof value.data === 'function') {
    return Object.assign({ __id: value.id }, value.data() || {});
  }
  return value;
}

function catalogApproved(row) {
  const status = clean(row && (row.approvalStatus || row.status)).toLowerCase();
  return ['approved', 'active', 'confirmed'].includes(status);
}

function catalogPendingPricing(row) {
  const status = clean(row && (row.approvalStatus || row.status)).toLowerCase();
  return ['pending', 'pending_pricing', 'needs_pricing'].includes(status);
}

function catalogMapped(row) {
  const status = clean(row && (row.approvalStatus || row.status)).toLowerCase();
  return status === 'mapped' || Boolean(clean(row && row.mappedToSubjectId));
}

function subjectActive(row) {
  return row && row.active !== false && row.off !== true && row.end !== true;
}

function catalogSubjectAvailable(row) {
  if (!row || catalogMapped(row)) return false;
  // Earlier drafts used active:false to mean "fee not configured". Pricing is now
  // independent from the shared subject catalog, so those rows remain selectable.
  return subjectActive(row) || catalogPendingPricing(row);
}

function mergeSubjectRows(baseRows, catalogDocuments, options = {}) {
  const rows = (Array.isArray(baseRows) ? baseRows : []).map((row, index) => Object.assign({}, row, {
    id: rowId(row, `subject_${index + 1}`)
  }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const byName = new Map(rows.map((row) => [normalizedSubjectName(row.name), row]).filter(([key]) => key));
  (Array.isArray(catalogDocuments) ? catalogDocuments : []).map(catalogRow).filter(Boolean).forEach((entry) => {
    const available = catalogSubjectAvailable(entry);
    if (catalogMapped(entry) || (!available && options.includePending !== true)) return;
    const id = rowId(entry);
    const name = clean(entry.name);
    if (!id || !name) return;
    let target = byId.get(id);
    if (!target) target = byName.get(normalizedSubjectName(name));
    if (target) {
      if (target.id === id) {
        target.name = name;
        if (Number.isFinite(Number(entry.sort))) target.sort = Number(entry.sort);
        target.active = available;
        target.approvalStatus = clean(entry.approvalStatus || entry.status) || (available ? 'active' : 'inactive');
        target.pricingStatus = clean(entry.pricingStatus) || 'unconfigured';
        target.suggestedByTeacherIds = uniq(entry.suggestedByTeacherIds);
        target.suggestedByProfileIds = uniq(entry.suggestedByProfileIds);
        target.catalogManaged = true;
      }
      return;
    }
    const added = {
      id,
      name,
      sort: Number.isFinite(Number(entry.sort)) ? Number(entry.sort) : rows.length + 1,
      active: available,
      approvalStatus: clean(entry.approvalStatus || entry.status) || (available ? 'active' : 'inactive'),
      pricingStatus: clean(entry.pricingStatus) || 'unconfigured',
      suggestedByTeacherIds: uniq(entry.suggestedByTeacherIds),
      suggestedByProfileIds: uniq(entry.suggestedByProfileIds),
      source: clean(entry.source) || 'course-portal-subject-catalog',
      catalogManaged: true
    };
    rows.push(added);
    byId.set(id, added);
    byName.set(normalizedSubjectName(name), added);
  });
  return rows;
}

function feePlanConfigured(row) {
  const source = row || {};
  const splitType = clean(source.splitType).toLowerCase();
  const splitValue = Number(source.splitValue);
  const amount = Number(source.amount);
  const lessonCount = Number(source.lessonCount);
  if (source.active === false || source.listed === false) return false;
  if (!Number.isFinite(amount) || amount <= 0) return false;
  if (!Number.isInteger(lessonCount) || lessonCount <= 0) return false;
  if (splitType === 'none') return Number.isFinite(splitValue) && splitValue === 0;
  if (splitType === 'fixed') return Number.isFinite(splitValue) && splitValue >= 0;
  if (splitType === 'ratio') return Number.isFinite(splitValue) && splitValue >= 0 && splitValue <= 100;
  return false;
}

function feePlanId(subjectId, name) {
  const key = `${clean(subjectId)}|${normalizedSubjectName(name)}`;
  if (!clean(subjectId) || !normalizedSubjectName(name)) return '';
  return `portal-fee-${crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 24)}`;
}

function mergeFeePlanRows(baseRows, feePlanDocuments, options = {}) {
  const rows = (Array.isArray(baseRows) ? baseRows : []).map((row, index) => Object.assign({}, row, {
    id: rowId(row, `fee_${index + 1}`)
  }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  (Array.isArray(feePlanDocuments) ? feePlanDocuments : []).map(catalogRow).filter(Boolean).forEach((entry) => {
    const id = rowId(entry);
    if (!id || (entry.active === false && options.includeInactive !== true)) return;
    const normalized = Object.assign({}, entry, {
      id,
      subjectId: clean(entry.subjectId),
      name: clean(entry.name),
      amount: Number(entry.amount || 0),
      lessonCount: Number(entry.lessonCount || 0),
      splitType: clean(entry.splitType),
      splitValue: Number(entry.splitValue || 0),
      active: entry.active !== false,
      listed: entry.listed !== false,
      portalManaged: true
    });
    const current = byId.get(id);
    if (current) Object.assign(current, normalized);
    else {
      rows.push(normalized);
      byId.set(id, normalized);
    }
  });
  return rows;
}

function effectiveTeacherSubjectIds(row) {
  const source = row || {};
  if (Array.isArray(source.effectiveSubjectIds)) return uniq(source.effectiveSubjectIds);
  const profile = uniq(source.profileSubjectIds);
  const added = uniq(source.managerAddedSubjectIds);
  const excluded = new Set(uniq(source.managerExcludedSubjectIds));
  return uniq(profile.concat(added)).filter((id) => !excluded.has(id));
}

function mergeTeacherRows(baseRows, assignmentDocuments) {
  const assignments = new Map();
  (Array.isArray(assignmentDocuments) ? assignmentDocuments : []).forEach((value) => {
    const row = catalogRow(value);
    const teacherId = clean(row && (row.teacherId || row.__id));
    if (teacherId) assignments.set(teacherId, row);
  });
  return (Array.isArray(baseRows) ? baseRows : []).map((teacher, index) => {
    const id = rowId(teacher, `teacher_${index + 1}`);
    const assignment = assignments.get(id);
    if (!assignment) return Object.assign({}, teacher, { id });
    return Object.assign({}, teacher, {
      id,
      subjectIds: effectiveTeacherSubjectIds(assignment),
      subjectAssignmentSource: clean(assignment.source) || 'course-portal-subject-assignment'
    });
  });
}

function normalizeTeachingAbility(value) {
  const row = typeof value === 'string' ? { item: value } : value || {};
  const item = clean(row.item || row.name || row.subject);
  if (!item) return null;
  return {
    subjectId: clean(row.subjectId || row.id),
    item,
    level: clean(row.level || row.degree || row.proficiency)
  };
}

async function prepareTeachingAbilitySubjects(options) {
  const source = options || {};
  const db = source.db;
  const FieldValue = source.FieldValue;
  if (!db || !FieldValue) throw new Error('Subject catalog dependencies are missing.');
  const abilities = (Array.isArray(source.abilities) ? source.abilities : [])
    .map(normalizeTeachingAbility).filter(Boolean).slice(0, 20);
  const [mirrorSnapshot, catalogSnapshot] = await Promise.all([
    db.collection('opsEducationMirrorSubjects').where('sourceActive', '==', true).get(),
    db.collection(SUBJECT_CATALOG_COLLECTION).get()
  ]);
  const mirrorRows = mirrorSnapshot.docs.map((doc) => Object.assign(
    { __id: doc.id },
    (doc.data() || {}).source || {}
  ));
  const catalogRows = catalogSnapshot.docs.map(catalogRow).filter(Boolean);
  const candidates = [];
  mirrorRows.forEach((row, index) => candidates.push({
    kind: 'mirror',
    id: rowId(row, `subject_${index + 1}`),
    name: clean(row.name),
    active: subjectActive(row),
    row
  }));
  const mappedById = new Map();
  const mappedByName = new Map();
  catalogRows.forEach((row) => {
    if (catalogMapped(row)) {
      const alias = {
        sourceId: rowId(row),
        targetId: clean(row.mappedToSubjectId),
        name: clean(row.name)
      };
      if (alias.sourceId && alias.targetId) mappedById.set(alias.sourceId, alias);
      if (normalizedSubjectName(alias.name) && alias.targetId) {
        mappedByName.set(normalizedSubjectName(alias.name), alias);
      }
      return;
    }
    candidates.push({
      kind: 'catalog',
      id: rowId(row),
      name: clean(row.name),
      active: catalogSubjectAvailable(row),
      approved: catalogApproved(row),
      row
    });
  });
  const byId = new Map(candidates.filter((row) => row.id).map((row) => [row.id, row]));
  const byName = new Map();
  candidates.forEach((row) => {
    const key = normalizedSubjectName(row.name);
    if (!key) return;
    const prior = byName.get(key);
    if (!prior || (row.kind === 'mirror' && prior.kind !== 'mirror') || (row.approved && !prior.approved)) {
      byName.set(key, row);
    }
  });
  const resolved = [];
  const subjectIds = [];
  const writes = new Map();
  abilities.forEach((ability, index) => {
    const key = normalizedSubjectName(ability.item);
    const mappedAlias = mappedById.get(ability.subjectId) || mappedByName.get(key);
    let matched = mappedAlias ? byId.get(mappedAlias.targetId) : byId.get(ability.subjectId);
    if (!mappedAlias && matched && normalizedSubjectName(matched.name) !== key) matched = null;
    const nameMatched = byName.get(key);
    // A previously suggested catalog item may later become an official mirror
    // subject. Prefer that official ID so assignments never point at a duplicate
    // hidden alias with the same display name.
    if (nameMatched && nameMatched.kind === 'mirror') matched = nameMatched;
    if (!matched) matched = nameMatched;
    if (!matched) {
      const id = catalogSubjectId(ability.item);
      matched = {
        kind: 'catalog',
        id,
        name: ability.item,
        active: true,
        approved: true,
        row: null
      };
      candidates.push(matched);
      byId.set(id, matched);
      byName.set(key, matched);
    }
    const displayName = clean(matched.name) || ability.item;
    resolved.push({ subjectId: matched.id, item: displayName, level: ability.level });
    if (matched.kind === 'mirror') {
      if (matched.active) subjectIds.push(matched.id);
      return;
    }
    const existing = matched.row || {};
    const alreadyAvailable = catalogSubjectAvailable(existing);
    const profileApproved = source.approveNew === true;
    const approvalStatus = 'active';
    const active = true;
    if (active) subjectIds.push(matched.id);
    const patch = {
      id: matched.id,
      subjectId: matched.id,
      name: displayName,
      normalizedName: normalizedSubjectName(displayName),
      sort: Number(existing.sort || 0) || 1000 + index,
      approvalStatus,
      status: approvalStatus,
      active,
      pricingStatus: clean(existing.pricingStatus) || 'unconfigured',
      source: clean(existing.source) || clean(source.source) || 'teacher-profile-subject',
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtText: source.nowText || new Date().toISOString()
    };
    if (!matched.row) patch.createdAt = FieldValue.serverTimestamp();
    if (source.profileId) patch.suggestedByProfileIds = FieldValue.arrayUnion(clean(source.profileId));
    if (source.teacherId) patch.suggestedByTeacherIds = FieldValue.arrayUnion(clean(source.teacherId));
    if (source.employeeId) patch.suggestedByEmployeeIds = FieldValue.arrayUnion(clean(source.employeeId));
    if (profileApproved && !alreadyAvailable) {
      patch.profileApprovedAt = FieldValue.serverTimestamp();
      patch.profileApprovedBy = clean(source.actor) || 'manager-profile-approval';
    }
    writes.set(matched.id, patch);
  });
  return {
    abilities: resolved,
    allSubjectIds: uniq(resolved.map((row) => row.subjectId)),
    subjectIds: uniq(subjectIds),
    catalogWrites: [...writes.entries()].map(([id, patch]) => ({ id, patch }))
  };
}

function profileAssignmentPatch(existing, profileSubjectIds, meta, FieldValue) {
  const row = existing || {};
  const profileIds = uniq(profileSubjectIds);
  const activeProfileIds = uniq(meta && meta.activeProfileSubjectIds);
  const added = uniq(row.managerAddedSubjectIds);
  const excluded = new Set(uniq(row.managerExcludedSubjectIds));
  const effective = uniq(activeProfileIds.concat(added)).filter((id) => !excluded.has(id));
  return {
    teacherId: clean(meta && meta.teacherId),
    employeeId: clean(meta && meta.employeeId),
    profileId: clean(meta && meta.profileId),
    profileSubjectIds: profileIds,
    managerAddedSubjectIds: added,
    managerExcludedSubjectIds: [...excluded],
    effectiveSubjectIds: effective,
    source: 'approved-teacher-profile',
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtText: clean(meta && meta.nowText) || new Date().toISOString()
  };
}

function managerAssignmentPatch(existing, selectedSubjectIds, meta, FieldValue) {
  const row = existing || {};
  const selected = uniq(selectedSubjectIds);
  const profile = uniq(row.profileSubjectIds);
  const profileSet = new Set(profile);
  const selectedSet = new Set(selected);
  return {
    teacherId: clean(meta && meta.teacherId),
    employeeId: clean(row.employeeId || meta && meta.employeeId),
    profileId: clean(row.profileId || meta && meta.profileId),
    profileSubjectIds: profile,
    managerAddedSubjectIds: selected.filter((id) => !profileSet.has(id)),
    managerExcludedSubjectIds: profile.filter((id) => !selectedSet.has(id)),
    effectiveSubjectIds: selected,
    source: 'course-scheduler-manager',
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtText: clean(meta && meta.nowText) || new Date().toISOString()
  };
}

module.exports = {
  FEE_PLAN_COLLECTION,
  SUBJECT_CATALOG_COLLECTION,
  TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION,
  catalogSubjectId,
  feePlanConfigured,
  feePlanId,
  effectiveTeacherSubjectIds,
  managerAssignmentPatch,
  mergeSubjectRows,
  mergeFeePlanRows,
  mergeTeacherRows,
  normalizedSubjectName,
  prepareTeachingAbilitySubjects,
  profileAssignmentPatch,
  __test: {
    catalogApproved,
    catalogMapped,
    catalogPendingPricing,
    catalogSubjectAvailable,
    normalizeTeachingAbility,
    subjectActive
  }
};
