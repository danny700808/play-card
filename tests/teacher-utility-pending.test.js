'use strict';

const assert = require('node:assert/strict');
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
      return {
        set() {},
        async commit() {}
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
      'module.exports.__selectExternalRow = teacherUtilitySelectExternalRow;\n' +
      'module.exports.__profileBundle = teacherUtilityProfileBundle;\n' +
      'module.exports.__employeeFallbackScore = teacherUtilityEmployeeFallbackScore;\n' +
      'module.exports.__externalRowBelongs = teacherUtilityExternalRowBelongs;\n' +
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

test('profile requires household and mailing addresses independently', () => {
  const helpers = loadHelpers({});
  assert.equal(helpers.__missingFields(completeProfile()).length, 0);
  assert.deepEqual(
    helpers.__missingFields(completeProfile({ householdAddress: '', address: '不能代替戶籍地址' }))
      .map((row) => row.key),
    ['householdAddress']
  );
  assert.deepEqual(
    helpers.__missingFields(completeProfile({ mailingAddress: '', address: '不能代替通訊地址' }))
      .map((row) => row.key),
    ['mailingAddress']
  );
});

test('multi-year external records use explicit employee links, then current active latest record', () => {
  const helpers = loadHelpers({});
  const rows = [
    { __id: 'contract-2025', contractGregorianYear: 2025, status: 'active', updatedAt: '2026-08-06T12:00:00Z' },
    { __id: 'contract-2026-inactive', contractGregorianYear: 2026, status: 'cancelled', updatedAt: '2026-08-06T13:00:00Z' },
    { __id: 'contract-2026-old', contractGregorianYear: 2026, status: 'active', updatedAt: '2026-07-01T12:00:00Z' },
    { __id: 'contract-2026-latest', contractYearKey: '115', status: 'active', updatedAt: '2026-08-01T12:00:00Z' }
  ];
  assert.equal(helpers.__selectExternalRow(rows, [], 2026).__id, 'contract-2026-latest');
  assert.equal(
    helpers.__selectExternalRow(rows, ['contract-2025'], 2026).__id,
    'contract-2025',
    'employee.currentExternalContractId must win over an arbitrary annual row'
  );
});

test('email-only external rows cannot poison employee resolution before owner identity is established', () => {
  const helpers = loadHelpers({});
  const names = new Set(['甲']);
  const emails = new Set(['shared@example.com']);
  const phones = new Set(['0911111111']);
  const linkedToAnotherTeacher = {
    employeeId: 'E2',
    teacherId: 'T2',
    name: '乙老師',
    email: 'shared@example.com',
    mobilePhone: '0922222222'
  };

  assert.equal(
    helpers.__employeeFallbackScore(linkedToAnotherTeacher, names, emails, phones),
    0,
    'T1 僅以 Email 命中屬於 T2／E2 的資料時，E2 不得成為候選員工'
  );
  assert.equal(
    helpers.__employeeFallbackScore(
      Object.assign({}, linkedToAnotherTeacher, { mobilePhone: '0911111111' }),
      names,
      emails,
      phones
    ),
    11,
    'Email 與電話都一致才能進入 fallback 候選'
  );
  assert.equal(
    helpers.__employeeFallbackScore(
      Object.assign({}, linkedToAnotherTeacher, { name: '甲老師', mobilePhone: '0911111111' }),
      names,
      emails,
      phones
    ),
    13,
    '姓名再一致時只能增加已有雙因子的分數'
  );

  const resolverStart = backendSource.indexOf('async function resolveTeacherUtilityEmployee(session)');
  const resolverEnd = backendSource.indexOf('function teacherUtilityBoolean', resolverStart);
  const resolverSource = backendSource.slice(resolverStart, resolverEnd);
  const employeeSelectedAt = resolverSource.indexOf('const canonicalEmployeeId =');
  const externalProfileReadAt = resolverSource.indexOf("teacherUtilityResolveRows('externalTeacherProfiles'");
  assert.ok(resolverStart >= 0 && resolverEnd > resolverStart);
  assert.ok(employeeSelectedAt >= 0 && externalProfileReadAt > employeeSelectedAt,
    'external profile/contract 必須在員工身分安全選定之後才可讀取，不得反向污染 employee resolver');
});

test('external rows without an explicit owner require both trusted email and phone', () => {
  const helpers = loadHelpers({});
  const emails = ['teacher@example.com'];
  const phones = ['0911111111'];

  assert.equal(helpers.__externalRowBelongs({
    __id: 'foreign-linked-row',
    linkedEmployeeId: 'E2',
    teacherId: 'T2',
    email: 'teacher@example.com',
    mobilePhone: '0911111111'
  }, 'E1', 'T1', [], emails, phones), false);
  assert.equal(helpers.__externalRowBelongs({
    __id: 'email-only-row',
    email: 'teacher@example.com'
  }, 'E1', 'T1', [], emails, phones), false,
  '無明確 owner 的 external row 不得只靠 Email 歸屬');
  assert.equal(helpers.__externalRowBelongs({
    __id: 'wrong-phone-row',
    email: 'teacher@example.com',
    mobilePhone: '0922222222'
  }, 'E1', 'T1', [], emails, phones), false);
  assert.equal(helpers.__externalRowBelongs({
    __id: 'two-factor-row',
    email: 'teacher@example.com',
    mobilePhone: '0911111111'
  }, 'E1', 'T1', [], emails, phones), true,
  'Email 與電話都完全符合時，才允許無明確 link 的舊資料歸屬');
});

test('T1 email hit on an external row owned by T2 and E2 cannot replace the canonical T1 identity', async () => {
  const helpers = loadHelpers({
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
  });

  const resolved = await helpers.__resolveEmployee({
    role: 'teacher',
    teacherId: 'T1',
    authAccountId: 'ACCOUNT-T1'
  });
  assert.match(resolved.employeeId, /^EXT_[a-f0-9]{16}$/);
  assert.notEqual(resolved.employeeId, 'E2', 'T1 不得因同 Email 資料而選中屬於 T2 的 E2');
  assert.notEqual(resolved.profile && resolved.profile.name, '乙老師');
  assert.equal(resolved.profile && resolved.profile.externalTeacherProfileId, '');
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
  assert.equal(profile.onboardingUrl, 'https://portal.example/current');
  assert.equal(profile.lineUserId, 'U-LINE');
  assert.equal(profile.householdAddress, '戶籍地址');
  assert.equal(profile.mailingAddress, '通訊地址');
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
