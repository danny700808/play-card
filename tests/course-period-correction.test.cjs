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
    db, cents, validateTransaction, Map, Set, Date, Object, Array, Number, Math, readCourseGroups: async () => [],
    clean: value => String(value ?? '').trim(), dateKey: value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '',
    sourceId: row => row && (row.id || row.__id) || '', jsonValue: value => value,
    HttpsError: class extends Error { constructor(code, message) { super(message); this.code = code; } },
    MIRROR: { tuitionPeriods: 'mirror' }, TUITION_PERIODS: 'periods', TUITION_TRANSACTIONS: 'transactions', TUITION_RECEIPTS:'receipts', nowText:()=> '2026-09-18',
    FieldValue: { serverTimestamp: () => 'server-time' },
    scheduleVersionRef: () => collection('runtime').doc('version'),
    assertScheduleWritable: value => { if (value.exists && value.data().writesBlocked) throw Error('blocked'); },
    mirrorRows: async () => [{ id: 'student1' }]
  };
  vm.createContext(context);
  for (const name of ['firstFiniteNumber','transactionAmount','tuitionBasePaidAmount','mergePortalTuitionRows','adminManageTuitionPeriod','adminSaveTuitionPeriods','adminRecordTuitionTransaction']) vm.runInContext(extract(name), context);
  return { context, put: (key, value) => records.set(key, value), get: key => records.get(key), rows: prefix => [...records].filter(([key]) => key.startsWith(prefix+'/')), fail: () => { failCreate = true; } };
}

const base={id:'p1',studentId:'student1',subjectId:'drums',periodNo:28,lessonCount:4,expectedAmount:2800,paidAmount:2800,transactions:[{id:'pay1',type:'payment',date:'2026-09-18',amount:2800,method:'現金'}]};
function seeded(){const f=fixture();f.put('mirror/m1',{source:structuredClone(base)});f.put('transactions/pay1',{...base.transactions[0],periodId:'p1',studentId:'student1',active:true,status:'confirmed'});f.put('receipts/r1',{periodId:'p1',transactionId:'pay1',transactionIndex:0,status:'issued',active:true,imageUrl:'https://example.com/r.png'});return f;}
test('delete paid historical period atomically voids money and receipt and cannot resurrect from mirror',async()=>{const f=seeded();await f.context.adminSaveTuitionPeriods({action:'delete-period',periodId:'p1',operationId:'del1'});assert.equal(f.get('periods/p1').active,false);assert.equal(f.get('transactions/pay1').status,'voided');assert.equal(f.get('receipts/r1').status,'voided');assert.equal(f.get('coursePortalTuitionCorrections/del1').before.paidAmount,2800);assert.equal(f.context.mergePortalTuitionRows([base],[f.get('periods/p1')],[]).length,0);await f.context.adminSaveTuitionPeriods({action:'delete-period',periodId:'p1',operationId:'del1'});assert.equal(f.rows('coursePortalTuitionCorrections').length,1);});
test('failure rolls back deletion and preserves original payment and receipt',async()=>{const f=seeded();f.fail();await assert.rejects(f.context.adminSaveTuitionPeriods({action:'delete-period',periodId:'p1',operationId:'del1'}));assert.equal(f.get('periods/p1'),undefined);assert.equal(f.get('transactions/pay1').status,'confirmed');assert.equal(f.get('receipts/r1').status,'issued');});
test('correction replaces imported money, invalidates receipt, and does not double count ledger',async()=>{const f=seeded();await f.context.adminSaveTuitionPeriods({action:'correct-transaction',periodId:'p1',operationId:'fix1',transactionIndex:0,expected:base.transactions[0],amount:2400,date:'2026-09-17',method:'轉帳'});const p=f.context.mergePortalTuitionRows([base],[f.get('periods/p1')],[{id:'pay1',...f.get('transactions/pay1')}])[0];assert.equal(p.paidAmount,2400);assert.equal(p.transactions.length,1);assert.equal(p.transactions[0].amount,2400);assert.equal(p.transactions[0].date,'2026-09-17');assert.equal(f.get('receipts/r1').status,'voided');});
test('stale correction is rejected without overwriting another device',async()=>{const f=seeded();await assert.rejects(f.context.adminSaveTuitionPeriods({action:'correct-transaction',periodId:'p1',operationId:'fix1',transactionIndex:0,expected:{...base.transactions[0],amount:2000},amount:2400,date:'2026-09-17',method:'轉帳'}),/變更/);assert.equal(f.get('transactions/pay1').amount,2800);});
test('deleted period refuses subsequent collection',async()=>{const f=seeded();await f.context.adminSaveTuitionPeriods({action:'delete-period',periodId:'p1',operationId:'del1'});await assert.rejects(f.context.adminRecordTuitionTransaction({id:'newpay',periodId:'p1',type:'payment',date:'2026-09-18',amount:10}),/有效/);});
