'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { cents, validateTransaction } = require('../functions/courseTuitionLedger');
const source = fs.readFileSync(path.join(__dirname, '../functions/coursePortal.js'), 'utf8');
function extract(name) {
  const start = source.search(new RegExp('^(?:async )?function '+name+'\\(', 'm'));
  assert(start >= 0, name);
  const end = source.indexOf('\n}', start) + 2;
  return source.slice(start, end);
}
function fixture() {
  let records = new Map();
  let queue = Promise.resolve();
  let failCreate = false;
  const readField = (row, field) => field.split('.').reduce((v, key) => v && v[key], row);
  const snapshot = (key, data) => ({ id: key.split('/').at(-1), exists: data !== undefined, data: () => structuredClone(data) });
  const collection = name => ({
    doc: id => ({ key: name+'/'+id }),
    where: (field, op, value) => ({ name, field, op, value })
  });
  const db = {
    collection,
    runTransaction(work) {
      const run = queue.then(async () => {
        const staged = structuredClone(records);
        let writesStarted = false;
        const tx = {
          async get(ref) {
            assert.equal(writesStarted, false, 'Firestore requires every read before the first write');
            if (ref.key) return snapshot(ref.key, staged.get(ref.key));
            const docs = [...staged].filter(([key, row]) => key.startsWith(ref.name+'/') && (ref.op === 'in' ? ref.value.includes(readField(row, ref.field)) : readField(row, ref.field) === ref.value)).map(([key, row]) => snapshot(key, row));
            return { docs };
          },
          set(ref, row, options) { writesStarted = true; staged.set(ref.key, options && options.merge ? { ...staged.get(ref.key), ...structuredClone(row) } : structuredClone(row)); },
          create(ref, row) { writesStarted = true; if (failCreate || staged.has(ref.key)) throw Error('create failed'); staged.set(ref.key, structuredClone(row)); }
        };
        const result = await work(tx);
        records = staged;
        return result;
      });
      queue = run.catch(() => {});
      return run;
    }
  };
  const context = {
    timeOperationStage:(_name,work)=>work(), db, cents, validateTransaction, Map, Set, Date, Object, Array, Number, Math, readCourseGroups: async () => [],
    clean: value => String(value ?? '').trim(), dateKey: value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '',
    sourceId: row => row && (row.id || row.__id) || '', jsonValue: value => value,
    HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } },
    MIRROR: { tuitionPeriods: 'mirror', attendance:'mirrorAttendance' }, ATTENDANCE_RECORDS:'attendance', TUITION_PERIODS: 'periods', TUITION_TRANSACTIONS: 'transactions',
    normalizeScheduleStatus: value=>value,
    attendanceLessonUnits: row=>Number(row.lessonUnits)||1,
    attendanceRowsMatch: (a,b)=>a.id===b.id,
    FieldValue: { serverTimestamp: () => 'server-time' },
    scheduleVersionRef: () => collection('runtime').doc('version'),
    assertScheduleWritable: value => { if (value.exists && value.data().writesBlocked) throw Error('blocked'); },
    mirrorRows: async () => [{ id: 'student1' }]
  };
  vm.createContext(context);
  for (const name of ['tuitionLessonCount','attendanceAllocations','applyPortalAttendanceToPeriods','mergePortalAttendanceRows','firstFiniteNumber','transactionAmount','tuitionBasePaidAmount','mergePortalTuitionRows','adminSaveTuitionPeriods','adminRecordTuitionTransaction']) vm.runInContext(extract(name), context);
  return { context, put: (key, value) => records.set(key, value), get: key => records.get(key), rows: prefix => [...records].filter(([key]) => key.startsWith(prefix+'/')), fail: () => { failCreate = true; } };
}
function request() {
  return { operationId: 'op1', periods: [{ id: 'p1', studentId: 'student1', teacherId: 'teacher1', subjectId: 'guitar', planId: 'group3600', periodNo: 1, startDate: '2026-09-07', lessonCount: 4, expectedAmount: 3600, discount: 0, planSnapshot: { name: '雙人班', splitType: 'ratio', splitValue: 0.6 }, transactions: [] }] };
}
test('new tuition is persisted unpaid with four lessons and the group split', async () => {
  const f = fixture(); await f.context.adminSaveTuitionPeriods(request());
  assert.equal(f.get('periods/p1').lessonCount, 4);
  assert.equal(f.get('periods/p1').expectedAmount, 3600);
  assert.equal(f.get('periods/p1').paidAmount, 0);
  assert.equal(f.get('periods/p1').planSnapshot.splitValue, 0.6);
  assert.equal(f.rows('transactions').length, 0);
});
test('retrying tuition creation does not duplicate periods or initial payments', async () => {
  const f = fixture(), data = request(); data.periods[0].transactions = [{ id: 'pay1', amount: 1800, date: '2026-09-07' }];
  await f.context.adminSaveTuitionPeriods(data); await f.context.adminSaveTuitionPeriods(data);
  assert.equal(f.rows('periods').length, 1); assert.equal(f.rows('transactions').length, 1);
});
test('a failed initial payment leaves no partially-created tuition', async () => {
  const f = fixture(), data = request(); data.periods[0].transactions = [{ id: 'pay1', amount: 1800, date: '2026-09-07' }]; f.fail();
  await assert.rejects(f.context.adminSaveTuitionPeriods(data));
  assert.equal(f.rows('periods').length, 0); assert.equal(f.rows('transactions').length, 0);
});
test('two devices cannot create the same numbered period', async () => {
  const f = fixture(), second = request(); second.operationId = 'op2'; second.periods[0].id = 'p2';
  const results = await Promise.allSettled([f.context.adminSaveTuitionPeriods(request()), f.context.adminSaveTuitionPeriods(second)]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(f.rows('periods').length, 1);
});
test('editing tuition preserves existing lesson usage and independent receipts', async () => {
  const f = fixture(); await f.context.adminSaveTuitionPeriods(request());
  f.put('periods/p1', { ...f.get('periods/p1'), usedCount: 2 });
  const data = request(); data.edit = true; data.periods[0].expectedAmount = 4000;
  await f.context.adminSaveTuitionPeriods(data);
  assert.equal(f.get('periods/p1').usedCount, 2); assert.equal(f.get('periods/p1').expectedAmount, 4000);
});
test('concurrent refunds serialize against the latest confirmed receipts', async () => {
  const f = fixture(); await f.context.adminSaveTuitionPeriods(request());
  await f.context.adminRecordTuitionTransaction({ id: 'pay1', periodId: 'p1', type: 'payment', amount: 1800, date: '2026-09-07' });
  const results = await Promise.allSettled(['refund1', 'refund2'].map(id => f.context.adminRecordTuitionTransaction({ id, periodId: 'p1', type: 'refund', amount: 1800, date: '2026-09-07',lessonSlotNos:[3,4] })));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(f.rows('transactions').length, 2);
});
test('payment retry survives an uncertain response and records only one receipt', async () => {
  const f = fixture(); await f.context.adminSaveTuitionPeriods(request());
  const payment = { id: 'pay1', periodId: 'p1', type: 'payment', amount: 1800, date: '2026-09-07' };
  await f.context.adminRecordTuitionTransaction(payment);
  const retried = await f.context.adminRecordTuitionTransaction(payment);
  assert.equal(retried.duplicate, true); assert.equal(f.rows('transactions').length, 1);
});
test('the live write lock prevents financial writes during incomplete migration', async () => {
  const f = fixture(); f.put('runtime/version', { writesBlocked: true });
  await assert.rejects(f.context.adminSaveTuitionPeriods(request()), /blocked/);
  assert.equal(f.rows('periods').length, 0);
});

async function paidFixture() {
  const f=fixture(); await f.context.adminSaveTuitionPeriods(request());
  await f.context.adminRecordTuitionTransaction({id:'pay',periodId:'p1',type:'payment',amount:3600,date:'2026-10-02'});
  f.put('periods/p1',{...f.get('periods/p1'),usedCount:2});
  return f;
}
const refundRequest=(extra={})=>({id:'refund',periodId:'p1',type:'refund',amount:1800,date:'2026-10-02',lessonSlotNos:[3,4],...extra});
test('refund writes selected third/fourth lesson status atomically and retry returns it',async()=>{
  const f=await paidFixture(),result=await f.context.adminRecordTuitionTransaction(refundRequest());
  assert.deepEqual(Array.from(result.lessonAdjustments,row=>row.slotNo),[3,4]);
  assert.equal(f.get('periods/p1').usedCount,2);
  assert.equal(f.get('periods/p1').voidedLessonCount,2);
  assert.equal(f.get('periods/p1').lessonAdjustments[0].type,'refund');
  const retried=await f.context.adminRecordTuitionTransaction(refundRequest());
  assert.equal(retried.duplicate,true);assert.equal(retried.lessonAdjustments.length,2);
  assert.equal(f.rows('transactions').length,2);
  await assert.rejects(f.context.adminRecordTuitionTransaction(refundRequest({lessonSlotNos:[1,2]})),/不同退款堂次/);
});
test('attended, duplicate, missing and out-of-range refund selections are rejected',async()=>{
  for(const slots of [[1,2],[3,3],[],[5],undefined]){
    const f=await paidFixture();await assert.rejects(f.context.adminRecordTuitionTransaction(refundRequest({lessonSlotNos:slots})));
    assert.equal(f.rows('transactions').length,1);assert.equal((f.get('periods/p1').lessonAdjustments||[]).length,0);
  }
});
test('a new half lesson or absence after opening the dialog prevents refunding its slot',async()=>{
  for(const status of ['attended','absent']){
    const f=await paidFixture();f.put('attendance/a',{id:'a',studentId:'student1',periodId:'p1',status,lessonUnits:0.5,lessonNo:3});
    await assert.rejects(f.context.adminRecordTuitionTransaction(refundRequest()),/已有上課/);
    assert.equal(f.rows('transactions').length,1);
  }
});
test('failed ledger creation also rolls back the lesson adjustment',async()=>{
  const f=await paidFixture();f.fail();await assert.rejects(f.context.adminRecordTuitionTransaction(refundRequest()));
  assert.equal(f.get('periods/p1').voidedLessonCount||0,0);assert.equal(f.rows('transactions').length,1);
});
test('two different requests cannot refund the same lesson even with enough balance',async()=>{
  const f=await paidFixture();
  const results=await Promise.allSettled(['r1','r2'].map(id=>f.context.adminRecordTuitionTransaction(refundRequest({id,amount:900,lessonSlotNos:[3]}))));
  assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
  assert.equal(f.get('periods/p1').voidedLessonCount,1);
});
test('linking a legacy refund only adds lesson metadata without paying again',async()=>{
  const f=await paidFixture();
  f.put('transactions/old',{id:'old',periodId:'p1',studentId:'student1',type:'refund',amount:1800,date:'2026-09-30',method:'cash',status:'confirmed',active:true});
  const before=f.rows('transactions').length;
  const result=await f.context.adminRecordTuitionTransaction(refundRequest({id:'old',linkExistingRefund:true}));
  assert.equal(f.rows('transactions').length,before);assert.equal(result.transaction.amount,1800);assert.equal(result.transaction.date,'2026-09-30');
  assert.equal(f.get('periods/p1').voidedLessonCount,2);
  assert.deepEqual(Array.from(f.get('transactions/old').lessonSlotNos),[3,4]);
  const again=await f.context.adminRecordTuitionTransaction(refundRequest({id:'old',linkExistingRefund:true}));
  assert.equal(again.duplicate,true);assert.equal(f.get('periods/p1').voidedLessonCount,2);
});
test('backfill rejects changing the original refund amount or inventing a refund',async()=>{
  const f=await paidFixture();
  await assert.rejects(f.context.adminRecordTuitionTransaction(refundRequest({linkExistingRefund:true})),/找不到/);
  f.put('transactions/old',{id:'old',periodId:'p1',type:'refund',amount:1400,date:'2026-09-30',status:'confirmed',active:true});
  await assert.rejects(f.context.adminRecordTuitionTransaction(refundRequest({id:'old',linkExistingRefund:true})),/另一筆/);
});
