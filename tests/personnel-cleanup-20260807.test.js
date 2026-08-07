'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const personData = require('../functions/personDataAdmin').__test;
const cleanup = require('../functions/personnelCleanup20260807');

const spec = (collection) => personData.SOURCE_SPECS.find((item) => item.collection === collection);
const record = (collection, docId, row) => ({
  spec: spec(collection), docId, row: row || {}, ref: { path: `${collection}/${docId}` }
});

function baseKeepers() {
  return [
    record('employees', 'PT-KEEP', {
      employeeId: 'PT-KEEP', name: '廖浤鈞', identityType: 'parttime',
      isPartTime: true, active: true, accountStatus: 'active', employmentStatus: 'active'
    }),
    record('admins', 'ADMIN-KEEP', {
      adminId: 'ADMIN-KEEP', name: '黃銘廷', role: 'admin', accountStatus: 'active'
    })
  ];
}

test('keeps every explicitly linked record for active part-time worker and deletes another employee', () => {
  const rows = baseKeepers().concat([
    record('employeeSchedules', 'S-KEEP', { employeeId: 'PT-KEEP' }),
    record('parttimeRecords', 'P-KEEP', { employeeId: 'PT-KEEP' }),
    record('employees', 'TEST-1', { employeeId: 'TEST-1', name: '測試人員', active: true }),
    record('clockRecords', 'C-TEST', { employeeId: 'TEST-1' })
  ]);
  const plan = cleanup.buildCleanupPlan(rows);
  assert.equal(plan.keepPaths.has('employeeSchedules/S-KEEP'), true);
  assert.equal(plan.keepPaths.has('parttimeRecords/P-KEEP'), true);
  assert.deepEqual(plan.targetRecords.map((item) => item.ref.path).sort(), [
    'clockRecords/C-TEST', 'employees/TEST-1'
  ]);
});

test('manager keeps only manager account and employee LINE binding, not teacher or attendance history', () => {
  const rows = baseKeepers().concat([
    record('employeeLineBindings', 'LB-KEEP', {
      employeeId: 'ADMIN-KEEP', name: '黃銘廷', status: 'active', lineUserId: 'U_MANAGER'
    }),
    record('externalTeacherProfiles', 'PROFILE-OLD', { employeeId: 'ADMIN-KEEP', name: '黃銘廷' }),
    record('employeeSchedules', 'S-OLD', { employeeId: 'ADMIN-KEEP' }),
    record('clockRecords', 'C-OLD', { employeeId: 'ADMIN-KEEP' })
  ]);
  const plan = cleanup.buildCleanupPlan(rows);
  assert.equal(plan.keepPaths.has('admins/ADMIN-KEEP'), true);
  assert.equal(plan.keepPaths.has('employeeLineBindings/LB-KEEP'), true);
  assert.deepEqual(plan.targetRecords.map((item) => item.ref.path).sort(), [
    'clockRecords/C-OLD', 'employeeSchedules/S-OLD', 'externalTeacherProfiles/PROFILE-OLD'
  ]);
});

test('student and renter portal sessions are outside personnel cleanup', () => {
  const rows = baseKeepers().concat([
    record('coursePortalSessions', 'STUDENT', { role: 'student', studentId: 'S1' }),
    record('coursePortalSessions', 'RENTER', { role: 'renter', renterId: 'R1' })
  ]);
  const plan = cleanup.buildCleanupPlan(rows);
  assert.equal(plan.targetRecords.some((item) => item.docId === 'STUDENT'), false);
  assert.equal(plan.targetRecords.some((item) => item.docId === 'RENTER'), false);
});

test('primary manager LINE infrastructure is preserved even when it has a system display name', () => {
  const rows = baseKeepers().concat([
    record('employees', 'PRIMARY_MANAGER_LINE', {
      employeeId: 'PRIMARY_MANAGER_LINE', name: '柚子樂器主要管理者',
      role: 'manager', isPrimaryManagerLineRecipient: true
    })
  ]);
  const plan = cleanup.buildCleanupPlan(rows);
  assert.equal(plan.keepPaths.has('employees/PRIMARY_MANAGER_LINE'), true);
});

test('accepts legacy Chinese boolean and identity fields for the retained part-time worker', () => {
  const rows = [
    record('employees', 'PT-LEGACY', {
      '員工ID': 'PT-LEGACY', '姓名': '廖浤鈞', identityType: '工讀生',
      '是否工讀生': '是', active: '是', hiddenFromActiveLists: '否'
    }),
    record('parttimeRecords', 'PT-HOURS', { '員工ID': 'PT-LEGACY', '姓名': '廖浤鈞' }),
    record('admins', 'ADMIN-KEEP', {
      adminId: 'ADMIN-KEEP', '姓名': '黃銘廷', role: 'admin', '可看設定區': '是'
    })
  ];
  const plan = cleanup.buildCleanupPlan(rows);
  assert.equal(plan.keepPaths.has('parttimeRecords/PT-HOURS'), true);
  assert.equal(plan.keepPersonIds.includes('PT-LEGACY'), true);
  assert.equal(plan.targetRecords.length, 0);
});

test('preserves a separately keyed manager LINE binding carrying the exact manager name', () => {
  const rows = baseKeepers().concat([
    record('employeeLineBindings', 'UNLINKED-MANAGER-LINE', {
      employeeId: 'LEGACY-MANAGER-LINE-ID', name: '黃銘廷', status: 'active',
      lineUserId: 'U_MANAGER'
    })
  ]);
  const plan = cleanup.buildCleanupPlan(rows);
  assert.equal(plan.keepPaths.has('employeeLineBindings/UNLINKED-MANAGER-LINE'), true);
});

test('deletes obsolete pending manager bind codes instead of treating them as manager accounts', () => {
  const rows = baseKeepers().concat([
    record('employeeLineBindings', 'OLD-PENDING-CODE', {
      employeeId: 'OLD-MANAGER-ID', name: '黃銘廷', role: 'admin', status: 'pending'
    })
  ]);
  const plan = cleanup.buildCleanupPlan(rows);
  assert.equal(plan.keepPaths.has('employeeLineBindings/OLD-PENDING-CODE'), false);
  assert.equal(plan.targetRecords.some((item) => item.ref.path === 'employeeLineBindings/OLD-PENDING-CODE'), true);
});

test('recognizes the production bootstrap manager even when its old display name is not canonical', () => {
  const rows = baseKeepers().slice(0, 1).concat([
    record('employees', 'ADMIN_DANNY', {
      employeeId: 'ADMIN_DANNY', name: 'Danny', email: 'danny700808@gmail.com',
      role: 'admin', identityType: 'admin', adminBootstrap: true
    }),
    record('employeeSchedules', 'OLD-MANAGER-SHIFT', { employeeId: 'ADMIN_DANNY' })
  ]);
  const plan = cleanup.buildCleanupPlan(rows);
  assert.equal(plan.keepPaths.has('employees/ADMIN_DANNY'), true);
  assert.equal(plan.keepPaths.has('employeeSchedules/OLD-MANAGER-SHIFT'), false);
});

test('fails closed when either exact retained identity is missing', () => {
  assert.throws(() => cleanup.buildCleanupPlan(baseKeepers().slice(1)), /廖浤鈞/);
  assert.throws(() => cleanup.buildCleanupPlan(baseKeepers().slice(0, 1)), /黃銘廷/);
});

test('removes only targeted embedded salary entries and always protects the retained part-time worker', () => {
  const map = {
    'PT-KEEP': { employeeId: 'PT-KEEP', hourlyRate: 196 },
    'OLD-EMPLOYEE': { employeeId: 'OLD-EMPLOYEE', hourlyRate: 200 },
    alias: { '員工ID': 'OLD-CHINESE-ID', hourlyRate: 210 },
    unrelated: { employeeId: 'UNRELATED', hourlyRate: 220 }
  };
  assert.deepEqual(cleanup.embeddedSalaryTargetKeys(
    map,
    ['PT-KEEP', 'OLD-EMPLOYEE', 'OLD-CHINESE-ID'],
    ['PT-KEEP']
  ).sort(), ['OLD-EMPLOYEE', 'alias']);
});
