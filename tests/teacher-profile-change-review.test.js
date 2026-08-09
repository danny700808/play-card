'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {
  profileChangeRows,
  profileDraftSnapshot
} = require('../functions/teacherProfileChanges');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('subject order alone is not a change, but a level change is immediate', () => {
  const before = profileDraftSnapshot({
    name: '王老師',
    teachingAbilities: [
      { subjectId: 'piano', item: '鋼琴', level: '專業' },
      { subjectId: 'violin', item: '小提琴', level: '良好' }
    ],
    idNumberMasked: 'A1••••••89'
  }, { identityFiles: [{ storagePath: 'private/front.jpg' }] });
  const reordered = profileDraftSnapshot({
    name: '王老師',
    teachingAbilities: [
      { subjectId: 'violin', item: '小提琴', level: '良好' },
      { subjectId: 'piano', item: '鋼琴', level: '專業' }
    ],
    idNumberMasked: 'A1••••••89'
  }, { identityFiles: [{ storagePath: 'private/front.jpg' }] });
  assert.deepEqual(profileChangeRows(before, reordered), []);

  const changed = profileDraftSnapshot({
    name: '王老師',
    teachingAbilities: [
      { subjectId: 'piano', item: '鋼琴', level: '專精' },
      { subjectId: 'violin', item: '小提琴', level: '良好' }
    ],
    idNumberMasked: 'A1••••••89'
  }, { identityFiles: [{ storagePath: 'private/front.jpg' }] });
  const rows = profileChangeRows(before, changed);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, 'teachingAbilities');
  assert.equal(rows[0].immediate, true);
  assert.match(rows[0].before, /鋼琴（專業）/);
  assert.match(rows[0].after, /鋼琴（專精）/);
});

test('review rows expose only masked identity information and file counts', () => {
  const before = profileDraftSnapshot({ idNumberMasked: 'A1••••••89' }, {
    idNumber: 'A123456789',
    identityFiles: [{ storagePath: 'private/front.jpg' }]
  });
  const after = profileDraftSnapshot({ idNumberMasked: 'B2••••••10' }, {
    idNumber: 'B223456710',
    identityFiles: [{ storagePath: 'private/front.jpg' }, { storagePath: 'private/back.jpg' }]
  });
  const serialized = JSON.stringify(profileChangeRows(before, after));
  assert.match(serialized, /A1••••••89/);
  assert.match(serialized, /B2••••••10/);
  assert.match(serialized, /已留存 2 份/);
  assert.doesNotMatch(serialized, /A123456789|B223456710|private\//);
});

test('teacher profile changes use locked drafts and secure manager callables', () => {
  const backend = read('functions/coursePortal.js');
  const adminBackend = read('functions/personDataAdmin.js');
  const managerPage = read('profile-change-admin.html');
  const rules = read('firestore.rules');
  const workflow = read('.github/workflows/deploy-course-portal-auth.yml');

  assert.match(backend, /teacherProfileDrafts/);
  assert.match(backend, /teacherProfileChangeDrafts/);
  assert.match(backend, /teacher-self-declared-profile/);
  assert.match(backend, /subjectChangesAlreadyEffective/);
  assert.match(adminBackend, /personDataAdminProfileChangeInventory/);
  assert.match(adminBackend, /personDataAdminProfileChangeAction/);
  assert.match(adminBackend, /授課科目屬老師自填資料，維持目前設定/);
  assert.match(managerPage, /personDataAdminProfileChangeInventory/);
  assert.match(managerPage, /personDataAdminProfileChangeAction/);
  assert.match(managerPage, /已立即同步/);
  assert.doesNotMatch(managerPage, /api\('approveProfileChangeRequest'|api\('rejectProfileChangeRequest'/);
  assert.match(rules, /match \/teacherProfileDrafts\/\{document=\*\*\} \{ allow read, write: if false; \}/);
  assert.match(rules, /match \/teacherProfileChangeDrafts\/\{document=\*\*\} \{ allow read, write: if false; \}/);
  assert.match(workflow, /functions:personDataAdminProfileChangeInventory/);
  assert.match(workflow, /functions:personDataAdminProfileChangeAction/);

  const scripts = [...managerPage.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]).filter((source) => source.trim());
  scripts.forEach((source, index) => new vm.Script(source, {
    filename: `profile-change-admin.inline.${index}.js`
  }));
});
