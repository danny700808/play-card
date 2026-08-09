'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  catalogSubjectId,
  feePlanConfigured,
  managerAssignmentPatch,
  mergeFeePlanRows,
  mergeSubjectRows,
  mergeTeacherRows,
  normalizedSubjectName,
  prepareTeachingAbilitySubjects,
  profileAssignmentPatch
} = require('../functions/courseSubjectCatalog');

const FieldValue = {
  serverTimestamp: () => ({ server: 'timestamp' }),
  arrayUnion: (...values) => ({ arrayUnion: values })
};

function doc(id, data) {
  return { id, data: () => data };
}

function fakeDb(mirrorDocs = [], catalogDocs = [], mirrorFeeDocs = [], portalFeeDocs = []) {
  return {
    collection(name) {
      if (name === 'opsEducationMirrorSubjects') {
        return { where: () => ({ get: async () => ({ docs: mirrorDocs }) }) };
      }
      if (name === 'coursePortalSubjectCatalog') {
        return { get: async () => ({ docs: catalogDocs }) };
      }
      if (name === 'opsEducationMirrorFeePlans') {
        return { where: () => ({ get: async () => ({ docs: mirrorFeeDocs }) }) };
      }
      if (name === 'coursePortalFeePlans') {
        return { get: async () => ({ docs: portalFeeDocs }) };
      }
      throw new Error(`unexpected collection: ${name}`);
    }
  };
}

test('subject names share a stable Unicode-normalized identity', () => {
  assert.equal(normalizedSubjectName('  木 吉他 '), '木吉他');
  assert.equal(normalizedSubjectName('ＰＩＡＮＯ'), 'piano');
  assert.equal(catalogSubjectId('木 吉他'), catalogSubjectId('木吉他'));
});

test('shared subjects remain selectable even when pricing has not been configured', () => {
  const merged = mergeSubjectRows([
    { id: 'mirror-piano', name: '鋼琴', active: true }
  ], [
    doc('pending-vocal', { id: 'pending-vocal', name: '歌唱訓練', approvalStatus: 'pending', active: false }),
    doc('approved-flute', { id: 'approved-flute', name: '長笛', approvalStatus: 'approved', active: true })
  ]);
  assert.deepEqual(merged.map((row) => row.name), ['鋼琴', '歌唱訓練', '長笛']);
  assert.equal(merged.find((row) => row.name === '歌唱訓練').active, true);
});

test('an older pending-pricing subject is upgraded to an available shared subject', () => {
  const merged = mergeSubjectRows([], [
    doc('pending-vocal', {
      id: 'pending-vocal', name: '歌唱訓練', approvalStatus: 'pending_pricing', active: false
    })
  ], { includePending: true });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].active, true);
  assert.equal(merged[0].pricingStatus, 'unconfigured');
});

test('a complete fee plan accepts an explicit teacher split of zero', () => {
  const base = { amount: 4000, lessonCount: 4, active: true, listed: true };
  assert.equal(feePlanConfigured(Object.assign({}, base, { splitType: 'ratio', splitValue: 60 })), true);
  assert.equal(feePlanConfigured(Object.assign({}, base, { splitType: 'fixed', splitValue: 800 })), true);
  assert.equal(feePlanConfigured(Object.assign({}, base, { splitType: 'none', splitValue: 0, zeroTeacherPayConfirmed: true })), true);
  assert.equal(feePlanConfigured(Object.assign({}, base, { name: '專職四堂', splitType: 'none', splitValue: 0 })), true);
  assert.equal(feePlanConfigured(Object.assign({}, base, { splitType: 'ratio', splitValue: 0 })), true);
  assert.equal(feePlanConfigured(Object.assign({}, base, { splitType: 'fixed', splitValue: 0 })), true);
  assert.equal(feePlanConfigured(Object.assign({}, base, { splitType: 'none', splitValue: 1 })), false);
  assert.equal(feePlanConfigured(Object.assign({}, base, { name: '一般四堂', splitType: 'none', splitValue: 0 })), true);
  assert.equal(feePlanConfigured(Object.assign({}, base, { amount: 0, splitType: 'none', splitValue: 0 })), false);
});

test('official fee plans override same-id mirror plans without deleting unrelated legacy plans', () => {
  const rows = mergeFeePlanRows([
    { id: 'legacy-piano', subjectId: 'piano', name: '舊方案', amount: 3200, lessonCount: 4, splitType: 'ratio', splitValue: 50 },
    { id: 'legacy-guitar', subjectId: 'guitar', name: '吉他方案', amount: 3600, lessonCount: 4, splitType: 'fixed', splitValue: 700 }
  ], [doc('legacy-piano', {
    id: 'legacy-piano', subjectId: 'piano', name: '正式方案', amount: 4000,
    lessonCount: 4, splitType: 'ratio', splitValue: 60, active: true
  })]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.id === 'legacy-piano').amount, 4000);
  assert.equal(rows.find((row) => row.id === 'legacy-guitar').amount, 3600);
});

test('teacher assignment merges the approved profile with explicit manager choices', () => {
  const teachers = mergeTeacherRows([
    { id: 'teacher-1', name: '老師', subjectIds: ['legacy'] }
  ], [
    doc('teacher-1', {
      teacherId: 'teacher-1',
      profileSubjectIds: ['piano', 'guitar'],
      managerAddedSubjectIds: ['flute'],
      managerExcludedSubjectIds: ['guitar']
    })
  ]);
  assert.deepEqual(teachers[0].subjectIds, ['piano', 'flute']);
});

test('a teacher-created item joins the shared subject list without requiring a fee plan', async () => {
  const db = fakeDb([
    doc('mirror-piano', { source: { id: 'mirror-piano', name: '鋼琴', active: true } })
  ], [], [
    doc('piano-plan', { source: { id: 'piano-plan', subjectId: 'mirror-piano', name: '鋼琴四堂', amount: 4000, lessonCount: 4, splitType: 'ratio', splitValue: 60, active: true } })
  ]);
  const draft = await prepareTeachingAbilitySubjects({
    db,
    FieldValue,
    abilities: [{ item: '鋼琴', level: '專業' }, { item: '拇指琴', level: '普通' }],
    approveNew: false,
    profileId: 'profile-1',
    teacherId: 'teacher-1'
  });
  assert.equal(draft.abilities[0].subjectId, 'mirror-piano');
  assert.deepEqual(draft.subjectIds, ['mirror-piano', draft.catalogWrites[0].id]);
  assert.equal(draft.catalogWrites.length, 1);
  assert.equal(draft.catalogWrites[0].patch.approvalStatus, 'active');
  assert.equal(draft.catalogWrites[0].patch.active, true);
  assert.equal(draft.catalogWrites[0].patch.pricingStatus, 'unconfigured');
  assert.deepEqual(draft.allSubjectIds, ['mirror-piano', draft.catalogWrites[0].id]);

  const approved = await prepareTeachingAbilitySubjects({
    db: fakeDb([], [doc(draft.catalogWrites[0].id, draft.catalogWrites[0].patch)]),
    FieldValue,
    abilities: draft.abilities.slice(1),
    approveNew: true,
    profileId: 'profile-1',
    teacherId: 'teacher-1',
    actor: 'manager'
  });
  assert.deepEqual(approved.subjectIds, [draft.catalogWrites[0].id]);
  assert.deepEqual(approved.allSubjectIds, [draft.catalogWrites[0].id]);
  assert.equal(approved.catalogWrites[0].patch.approvalStatus, 'active');
  assert.equal(approved.catalogWrites[0].patch.active, true);
  assert.equal(approved.catalogWrites[0].patch.profileApprovedAt, undefined);
});

test('a mapped teacher suggestion resolves to the official priced subject', async () => {
  const suggestionId = catalogSubjectId('爵士鼓入門');
  const result = await prepareTeachingAbilitySubjects({
    db: fakeDb([
      doc('drums', { source: { id: 'drums', name: '爵士鼓', active: true } })
    ], [
      doc(suggestionId, {
        id: suggestionId,
        name: '爵士鼓入門',
        approvalStatus: 'mapped',
        mappedToSubjectId: 'drums',
        active: false
      })
    ], [
      doc('drums-plan', { source: { id: 'drums-plan', subjectId: 'drums', name: '爵士鼓四堂', amount: 4000, lessonCount: 4, splitType: 'fixed', splitValue: 800, active: true } })
    ]),
    FieldValue,
    abilities: [{ subjectId: suggestionId, item: '爵士鼓入門', level: '專業' }],
    teacherId: 'teacher-1'
  });
  assert.deepEqual(result.subjectIds, ['drums']);
  assert.deepEqual(result.allSubjectIds, ['drums']);
  assert.deepEqual(result.abilities, [{ subjectId: 'drums', item: '爵士鼓', level: '專業' }]);
  assert.equal(result.catalogWrites.length, 0);
});

test('profile reapproval keeps deliberate manager additions and exclusions', () => {
  const existing = {
    profileSubjectIds: ['piano', 'guitar'],
    managerAddedSubjectIds: ['flute'],
    managerExcludedSubjectIds: ['guitar']
  };
  const profilePatch = profileAssignmentPatch(existing, ['piano', 'guitar', 'vocal'], {
    teacherId: 'teacher-1', profileId: 'profile-1', activeProfileSubjectIds: ['piano', 'guitar', 'vocal']
  }, FieldValue);
  assert.deepEqual(profilePatch.effectiveSubjectIds, ['piano', 'vocal', 'flute']);

  const managerPatch = managerAssignmentPatch(profilePatch, ['guitar', 'vocal'], {
    teacherId: 'teacher-1'
  }, FieldValue);
  assert.deepEqual(managerPatch.managerAddedSubjectIds, []);
  assert.deepEqual(managerPatch.managerExcludedSubjectIds, ['piano']);
  assert.deepEqual(managerPatch.effectiveSubjectIds, ['guitar', 'vocal']);
});
