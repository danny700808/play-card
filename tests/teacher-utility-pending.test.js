'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const backendPath = path.join(root, 'functions', 'coursePortal.js');
const backendSource = fs.readFileSync(backendPath, 'utf8');

function fixtureDb(collections) {
  class FixtureDocumentRef {
    constructor(name, id) {
      this.name = name;
      this.id = String(id);
      this.path = `${name}/${this.id}`;
    }

    async get() {
      const data = (collections[this.name] || []).find((row) =>
        String(row.__id || '') === this.id
      );
      return {
        id: this.id,
        ref: this,
        exists: Boolean(data),
        data: () => data ? Object.assign({}, data) : undefined
      };
    }

    async set() {}

    async delete() {
      const rows = collections[this.name] || [];
      const index = rows.findIndex((row) => String(row.__id || '') === this.id);
      if (index >= 0) rows.splice(index, 1);
    }
  }

  class FixtureQuery {
    constructor(name, filters = [], rowLimit = Infinity) {
      this.name = name;
      this.filters = filters;
      this.rowLimit = rowLimit;
    }

    where(field, operator, expected) {
      return new FixtureQuery(
        this.name,
        this.filters.concat({ field, operator, expected }),
        this.rowLimit
      );
    }

    limit(rowLimit) {
      return new FixtureQuery(this.name, this.filters, rowLimit);
    }

    doc(id) {
      return new FixtureDocumentRef(this.name, id);
    }

    async get() {
      if (collections[this.name] instanceof Error) throw collections[this.name];
      const docs = (collections[this.name] || []).filter((data) => this.filters.every((filter) => {
        const actual = data[filter.field];
        if (filter.operator === '==') return actual === filter.expected;
        if (filter.operator === 'in') return filter.expected.includes(actual);
        if (filter.operator === 'array-contains') {
          return Array.isArray(actual) && actual.includes(filter.expected);
        }
        throw new Error(`unsupported fixture query operator: ${filter.operator}`);
      })).slice(0, this.rowLimit).map((data, index) => ({
        id: String(data.__id || `${this.name}-${index + 1}`),
        ref: new FixtureDocumentRef(this.name, data.__id || `${this.name}-${index + 1}`),
        data: () => Object.assign({}, data)
      }));
      return { docs, size: docs.length, empty: docs.length === 0 };
    }
  }
  return {
    collection(name) {
      return new FixtureQuery(name);
    },
    batch() {
      const operations = [];
      return {
        set(ref, data, options) { operations.push({ type: 'set', ref, data, options }); },
        delete(ref) { operations.push({ type: 'delete', ref }); },
        async commit() {
          for (const operation of operations) {
            if (operation.type === 'delete') {
              await operation.ref.delete();
              continue;
            }
            const rows = collections[operation.ref.name] || (collections[operation.ref.name] = []);
            const index = rows.findIndex((row) => String(row.__id || '') === operation.ref.id);
            const next = Object.assign(
              {},
              operation.options && operation.options.merge && index >= 0 ? rows[index] : {},
              operation.data,
              { __id: operation.ref.id }
            );
            if (index >= 0) rows[index] = next;
            else rows.push(next);
          }
        }
      };
    }
  };
}

function loadHelpers(collections) {
  const database = fixtureDb(collections);
  const fakeFirestore = () => database;
  fakeFirestore.FieldValue = {
    serverTimestamp: () => 'fixture-server-time',
    arrayUnion: (...values) => values,
    increment: (value) => value,
    delete: () => 'fixture-delete'
  };
  fakeFirestore.Timestamp = { fromMillis: (value) => value, fromDate: (value) => value };
  const firebaseAdmin = {
    apps: [{}],
    initializeApp() {},
    firestore: fakeFirestore,
    storage: () => ({ bucket: () => ({}) })
  };
  const originalLoad = Module._load;
  Module._load = function fixtureLoad(request, parent, isMain) {
    if (request === 'firebase-admin') return firebaseAdmin;
    if (request === 'firebase-functions/v2/https') {
      return {
        HttpsError: class HttpsError extends Error {},
        onCall: (options, handler) => handler || options,
        onRequest: (options, handler) => handler || options
      };
    }
    if (request === 'firebase-functions/v2/scheduler') {
      return { onSchedule: (options, handler) => handler || options };
    }
    if (request === 'firebase-functions/params') {
      return { defineSecret: () => ({ value: () => '' }) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const fixtureModule = new Module(backendPath, module);
    fixtureModule.filename = backendPath;
    fixtureModule.paths = Module._nodeModulePaths(path.dirname(backendPath));
    fixtureModule._compile(
      `${backendSource}\n` +
      'module.exports.__pendingSummary = teacherUtilityPendingSummary;\n' +
      'module.exports.__missingFields = externalTeacherProfileMissingFields;\n' +
      'module.exports.__profileBundle = teacherUtilityProfileBundle;\n' +
      'module.exports.__portalProfileId = teacherPortalProfileId;\n' +
      'module.exports.__contractMatchesProfile = teacherUtilityContractMatchesProfile;\n' +
      'module.exports.__resolveEmployee = resolveTeacherUtilityEmployee;\n',
      backendPath
    );
    return fixtureModule.exports;
  } finally {
    Module._load = originalLoad;
  }
}

function completeProfile(overrides = {}) {
  return Object.assign({
    name: '林老師',
    mobilePhone: '0912345678',
    email: 'teacher@example.com',
    birthDate: '1990-01-01',
    idNumber: 'A123456789',
    householdAddress: '台中市豐原區戶籍地址',
    mailingAddress: '台中市豐原區通訊地址',
    emergencyContact: '林家人',
    emergencyPhone: '0987654321',
    teachingAbilities: [{ item: '鋼琴' }],
    identityUrls: ['https://example.com/id.jpg']
  }, overrides);
}

test('profile contact is complete with LINE or Email, and only missing when both are absent', () => {
  const helpers = loadHelpers({});
  assert.equal(
    helpers.__missingFields(completeProfile({ email: '', lineUserId: 'U-LINE' }))
      .some((row) => row.key === 'contactMethod'),
    false
  );
  assert.equal(
    helpers.__missingFields(completeProfile({ email: 'teacher@example.com', lineUserId: '' }))
      .some((row) => row.key === 'contactMethod'),
    false
  );
  assert.equal(
    helpers.__missingFields(completeProfile({ email: '', lineUserId: '' }))
      .some((row) => row.key === 'contactMethod'),
    true
  );
});

test('profile completion stays focused on the short teacher onboarding fields', () => {
  const helpers = loadHelpers({});
  assert.equal(helpers.__missingFields(completeProfile()).length, 0);
  const missing = helpers.__missingFields(completeProfile({
    birthDate: '', householdAddress: '', mailingAddress: '', emergencyContact: '', emergencyPhone: ''
  })).map((row) => row.key);
  assert.deepEqual(missing, []);
  assert.deepEqual(
    helpers.__missingFields(completeProfile({ idNumber: '', identityUrls: [], identityFiles: [] }))
      .map((row) => row.key),
    ['idNumber', 'identityDocument']
  );
});

test('fresh portal resolver never scans or guesses legacy people by name, email, or phone', () => {
  const resolverStart = backendSource.indexOf('async function resolveTeacherUtilityEmployee(session)');
  const resolverEnd = backendSource.indexOf('function teacherUtilityBoolean', resolverStart);
  const resolverSource = backendSource.slice(resolverStart, resolverEnd);
  assert.ok(resolverStart >= 0 && resolverEnd > resolverStart);
  assert.match(resolverSource, /teacherPortalProfileId\(teacherId\)/);
  assert.doesNotMatch(resolverSource, /teacherUtilityResolveRows\(/);
  assert.doesNotMatch(resolverSource, /mirrorRows\('teachers'\)/);
  assert.doesNotMatch(resolverSource, /collection\('employees'\)\.limit\(/);
  assert.doesNotMatch(resolverSource, /verifiedName|verifiedEmail|verifiedPhone|replacedRows/);
});

test('new teacher receives a dedicated blank profile and ignores every old matching record', async () => {
  const collections = {
    coursePortalTeacherBindings: [{
      __id: 'binding-t1',
      status: 'active',
      authAccountId: 'ACCOUNT-T1',
      teacherId: 'T1',
      email: 'shared@example.com'
    }],
    opsEducationMirrorTeachers: [{
      __id: 'mirror-t1',
      sourceActive: true,
      source: {
        id: 'T1',
        name: '甲老師',
        email: 'shared@example.com'
      }
    }],
    externalTeacherProfiles: [{
      __id: 'poison-t2-e2',
      teacherId: 'T2',
      linkedEmployeeId: 'E2',
      email: 'shared@example.com',
      name: '乙老師'
    }],
    externalTeacherContracts: [],
    employees: [{
      __id: 'E2',
      employeeId: 'E2',
      identityType: 'external',
      name: '乙老師',
      email: 'shared@example.com'
    }]
  };
  const helpers = loadHelpers(collections);

  const resolved = await helpers.__resolveEmployee({
    role: 'teacher',
    teacherId: 'T1',
    authAccountId: 'ACCOUNT-T1'
  });
  assert.match(resolved.employeeId, /^EXT_[a-f0-9]{16}$/);
  assert.notEqual(resolved.employeeId, 'E2', 'T1 不得因同 Email 資料而選中屬於 T2 的 E2');
  assert.equal(resolved.profile && resolved.profile.name, '');
  assert.match(resolved.profile && resolved.profile.externalTeacherProfileId, /^EXTP_[a-f0-9]{24}$/);
  assert.equal(resolved.user.employeeRecordCreated, false);
  assert.equal(resolved.user.portalProfileVersion, 2);
  assert.match(resolved.profile.onboardingUrl, /teacher-profile\.html$/);
  const ownProfile = collections.externalTeacherProfiles.find((row) =>
    row.__id === resolved.user.portalProfileId
  );
  const ownContract = collections.externalTeacherContracts.find((row) => row.__id === resolved.user.portalProfileId);
  assert.ok(ownProfile);
  assert.equal(ownContract, undefined, '開啟個人資料不得順便建立契約空殼');
  assert.equal(ownProfile.name, undefined, '新資料不得寫入課務鏡像姓名');
  assert.equal(collections.externalTeacherProfiles.find((row) => row.__id === 'poison-t2-e2').name, '乙老師');
  assert.ok(collections.employees.some((row) => row.__id === 'E2'), '不相關的舊人不可被誤刪');
});

test('unapproved employee shell created by the old resolver is deleted exactly, not reused', async () => {
  const teacherId = 'T-NEW';
  const profileId = loadHelpers({}).__portalProfileId(teacherId);
  const canonicalEmployeeId = `EXT_${crypto.createHash('sha256').update(`course-teacher:${teacherId}`).digest('hex').slice(0, 16)}`;
  const collections = {
    coursePortalTeacherBindings: [{
      __id: 'binding-new', status: 'active', authAccountId: 'ACCOUNT-NEW', teacherId
    }],
    employees: [{
      __id: canonicalEmployeeId,
      employeeId: canonicalEmployeeId,
      identityType: 'external',
      name: '黃銘廷',
      source: 'course-portal-canonical-external-teacher',
      coursePortalTeacherCanonical: true
    }],
    externalTeacherProfiles: [],
    externalTeacherContracts: [{
      __id: profileId,
      id: profileId,
      teacherId: profileId,
      coursePortalTeacherId: teacherId,
      portalProfileVersion: 2,
      portalProfileSource: 'course-portal-fresh-external-teacher-v2',
      status: 'waiting_profile'
    }]
  };
  const resolved = await loadHelpers(collections).__resolveEmployee({
    role: 'teacher', teacherId, authAccountId: 'ACCOUNT-NEW', authMethod: 'email'
  });
  assert.equal(resolved.employeeId, canonicalEmployeeId);
  assert.equal(resolved.profile.name, '');
  assert.equal(resolved.user.employeeRecordCreated, false);
  assert.equal(collections.employees.some((row) => row.__id === canonicalEmployeeId), false);
  assert.equal(collections.externalTeacherContracts.some((row) => row.__id === profileId), false,
    '舊版自動產生的未簽契約空殼應安全移除');
});

test('manager-confirmed fresh profile keeps its formal employee and returns only its own data', async () => {
  const teacherId = 'T-CONFIRMED';
  const helpersForId = loadHelpers({});
  const profileId = helpersForId.__portalProfileId(teacherId);
  const canonicalEmployeeId = `EXT_${crypto.createHash('sha256').update(`course-teacher:${teacherId}`).digest('hex').slice(0, 16)}`;
  const base = {
    __id: profileId,
    id: profileId,
    teacherId: profileId,
    coursePortalTeacherId: teacherId,
    portalProfileVersion: 2,
    portalProfileSource: 'course-portal-fresh-external-teacher-v2',
    bindingCode: 'SAFE-TOKEN',
    onboardingToken: 'SAFE-TOKEN',
    status: 'active'
  };
  const collections = {
    coursePortalTeacherBindings: [{
      __id: 'binding-confirmed', status: 'active', authAccountId: 'ACCOUNT-CONFIRMED', teacherId
    }],
    externalTeacherProfiles: [Object.assign({}, base, completeProfile({ name: '新老師' }))],
    externalTeacherContracts: [Object.assign({}, base, { contractStatus: 'active' })],
    employees: [{
      __id: canonicalEmployeeId,
      employeeId: canonicalEmployeeId,
      identityType: 'external',
      name: '新老師',
      source: 'external-teacher-admin-confirmed'
    }]
  };
  const resolved = await loadHelpers(collections).__resolveEmployee({
    role: 'teacher', teacherId, authAccountId: 'ACCOUNT-CONFIRMED'
  });
  assert.equal(resolved.profile.name, '新老師');
  assert.equal(resolved.user.employeeRecordCreated, true);
  assert.ok(collections.employees.some((row) => row.__id === canonicalEmployeeId));
});

test('teacher utility profile is whitelisted, masks ID, and only keeps safe own URLs', () => {
  const helpers = loadHelpers({});
  const result = helpers.__profileBundle({
    employeeId: 'E-1',
    employee: {
      employeeId: 'E-1',
      name: '員工舊姓名',
      idNumber: 'Z999999999',
      onboardingUrl: 'https://evil.example/employee-link',
      identityDocumentUrl: 'https://files.example/employee.jpg'
    },
    externalProfile: {
      __id: 'profile-current',
      name: '林老師',
      email: 'teacher@example.com',
      mobilePhone: '0912345678',
      birthDate: '1990-01-01',
      idNumber: 'A123456789',
      householdAddress: '戶籍地址',
      mailingAddress: '通訊地址',
      emergencyContact: '林家人',
      emergencyPhone: '0987654321',
      teachingAbilities: [{ item: '鋼琴' }],
      identityUrls: [
        'http://files.example/insecure.jpg',
        'https://files.example/front.jpg',
        'https://files.example/front.jpg',
        'https://files.example/back.jpg',
        'https://files.example/extra-1.jpg',
        'https://files.example/extra-2.jpg',
        'https://files.example/over-limit.jpg'
      ],
      onboardingUrl: 'https://portal.example/current',
      lineUserId: 'U-LINE',
      status: 'active'
    },
    externalContract: { __id: 'contract-current', status: 'signed' }
  });
  const profile = result.profile;
  assert.equal(profile.idNumberMasked, 'A*****6789');
  assert.equal(Object.hasOwn(profile, 'idNumber'), false);
  assert.equal(JSON.stringify(profile).includes('A123456789'), false);
  assert.equal(JSON.stringify(profile).includes('Z999999999'), false);
  assert.deepEqual(profile.identityUrls, [
    'https://files.example/front.jpg',
    'https://files.example/back.jpg',
    'https://files.example/extra-1.jpg',
    'https://files.example/extra-2.jpg'
  ]);
  assert.match(profile.onboardingUrl, /teacher-profile\.html$/);
  assert.equal(Object.hasOwn(profile, 'contractStatus'), false);
  assert.equal(Object.hasOwn(profile, 'externalTeacherContractId'), false);
  assert.equal(profile.lineUserId, 'U-LINE');
  assert.equal(profile.householdAddress, '戶籍地址');
  assert.equal(profile.mailingAddress, '通訊地址');
});

test('fresh teacher contract view accepts only assignments issued for the same profile lifecycle', () => {
  const helpers = loadHelpers({});
  const resolved = {
    user: {
      portalProfileId: 'EXTP-CURRENT',
      externalTeacherProfileId: 'EXTP-CURRENT',
      portalProfileVersion: 2
    }
  };
  assert.equal(helpers.__contractMatchesProfile({
    portalProfileId: 'EXTP-CURRENT', portalProfileVersion: 2
  }, resolved), true);
  assert.equal(helpers.__contractMatchesProfile({
    portalProfileId: 'EXTP-OLD', portalProfileVersion: 2
  }, resolved), false);
  assert.equal(helpers.__contractMatchesProfile({
    employeeId: 'SAME-EMPLOYEE', status: 'pending'
  }, resolved), false, '只用同員工編號的舊測試合約不得出現');
});

test('teacher utility summary matches the linked teacher and excludes completed or inactive rows', async () => {
  const collections = {
    teacherContractAssignments: [
      { __id: 'contract-1', employeeId: 'E-1', status: 'pending' },
      { __id: 'contract-2', teacherId: 'T-1', status: '待簽署' },
      { __id: 'contract-signed', employeeId: 'E-1', status: 'signed' },
      { __id: 'contract-other', employeeId: 'E-2', status: 'pending' }
    ],
    announcements: [
      { __id: 'announcement-all', published: true, audience: ['all'], title: '全部公告', updatedAtText: '2026-08-06 09:00' },
      { __id: 'announcement-external', published: true, audience: ['external'], title: '外聘公告', updatedAtText: '2026-08-06 10:00' },
      { __id: 'announcement-target', published: true, audience: ['external'], targetTeacherIds: ['T-1'], title: '指定公告' },
      { __id: 'announcement-staff', published: true, audience: ['staff'], title: '員工公告' },
      { __id: 'announcement-draft', published: false, audience: ['external'], title: '草稿' },
      { __id: 'announcement-other', published: true, audience: ['external'], targetEmployeeIds: ['E-2'], title: '其他人' }
    ],
    tasks: [
      { __id: 'task-1', assigneeId: 'E-1', status: '待處理' },
      { __id: 'task-email', assigneeEmail: 'teacher@example.com', status: '退回重做' },
      { __id: 'task-done', assigneeId: 'E-1', status: '已完成' },
      { __id: 'task-other', assigneeId: 'E-2', status: '待處理' }
    ],
    teacherGoods: [
      { __id: 'goods-1', enabled: true, name: '琴弦', updatedAtText: '2026-08-06 09:00' },
      { __id: 'goods-2', name: '譜架' },
      { __id: 'goods-off', enabled: false, name: '已下架' },
      { __id: 'goods-deleted', enabled: true, deleted: true, name: '已刪除' }
    ],
    teacherGoodsInquiry: [
      { __id: 'inquiry-wait', teacherId: 'E-1', status: '待處理' },
      { __id: 'inquiry-replied', teacherId: 'E-1', status: '已回覆', replyNote: '已有現貨' },
      { __id: 'inquiry-email', email: 'teacher@example.com', status: '可取貨', replyStock: '現貨' },
      { __id: 'inquiry-done', teacherId: 'E-1', status: '已完成' },
      { __id: 'inquiry-other', teacherId: 'E-2', status: '已回覆' }
    ]
  };
  const helpers = loadHelpers(collections);
  const resolved = {
    employeeId: 'E-1',
    profileComplete: false,
    user: {
      id: 'E-1',
      employeeId: 'E-1',
      legacyTeacherId: 'T-1',
      email: 'teacher@example.com'
    }
  };
  const first = await helpers.__pendingSummary(resolved, { teacherId: 'T-1' });
  const second = await helpers.__pendingSummary(resolved, { teacherId: 'T-1' });
  assert.deepEqual({
    profileCount: first.profileCount,
    contractCount: first.contractCount,
    announcementCount: first.announcementCount,
    taskCount: first.taskCount,
    goodsCount: first.goodsCount,
    goodsAttentionCount: first.goodsAttentionCount
  }, {
    profileCount: 1,
    contractCount: 2,
    announcementCount: 3,
    taskCount: 2,
    goodsCount: 2,
    goodsAttentionCount: 2
  });
  assert.match(first.announcementRevision, /^[a-f0-9]{24}$/);
  assert.match(first.goodsRevision, /^[a-f0-9]{24}$/);
  assert.match(first.goodsAttentionRevision, /^[a-f0-9]{24}$/);
  assert.equal(first.announcementRevision, second.announcementRevision);
  assert.equal(first.goodsRevision, second.goodsRevision);
  assert.equal(first.goodsAttentionRevision, second.goodsAttentionRevision);

  collections.announcements[0].title = '全部公告（更新）';
  const changedHelpers = loadHelpers(collections);
  const changed = await changedHelpers.__pendingSummary(resolved, { teacherId: 'T-1' });
  assert.notEqual(first.announcementRevision, changed.announcementRevision);

  collections.teacherGoodsInquiry[1].replyNote = '回覆內容已更新';
  const inquiryChanged = await loadHelpers(collections).__pendingSummary(resolved, { teacherId: 'T-1' });
  assert.equal(first.goodsRevision, inquiryChanged.goodsRevision);
  assert.notEqual(first.goodsAttentionRevision, inquiryChanged.goodsAttentionRevision);

  collections.teacherGoods[0].name = '琴弦（更新）';
  const goodsChanged = await loadHelpers(collections).__pendingSummary(resolved, { teacherId: 'T-1' });
  assert.notEqual(inquiryChanged.goodsRevision, goodsChanged.goodsRevision);
  assert.equal(inquiryChanged.goodsAttentionRevision, goodsChanged.goodsAttentionRevision);
});

test('one unavailable pending collection does not fail the teacher utility login summary', async () => {
  const helpers = loadHelpers({
    teacherContractAssignments: [],
    announcements: new Error('temporary Firestore error'),
    tasks: [{ __id: 'task-1', assigneeId: 'E-1', status: '待處理' }],
    teacherGoods: [],
    teacherGoodsInquiry: []
  });
  const summary = await helpers.__pendingSummary({
    employeeId: 'E-1',
    profileComplete: true,
    user: { id: 'E-1', employeeId: 'E-1', email: 'teacher@example.com' }
  }, { teacherId: 'T-1' });
  assert.equal(summary.available, false);
  assert.deepEqual(summary.unavailableSections, ['announcements']);
  assert.equal(summary.announcementCount, 0);
  assert.equal(summary.taskCount, 1);
});
