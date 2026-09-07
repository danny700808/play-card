'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('payment selection excludes other subjects, children and completed requests', () => {
  const source = read('student-course-portal.html');
  const code = source.slice(source.indexOf('    function activeTuitionPayments()'), source.indexOf('    function paymentDate('));
  const context = vm.createContext({studentId:'child-a', selectedPaymentSubjectId:'guitar', data:{tuitionPayment:{requests:[
    {id:'g', studentId:'child-a', subjectId:'guitar', status:'payment_due'},
    {id:'p', studentId:'child-a', subjectId:'piano', status:'payment_due'},
    {id:'other', studentId:'child-b', subjectId:'guitar', status:'payment_due'},
    {id:'paid', studentId:'child-a', subjectId:'guitar', status:'confirmed'}
  ]}}});
  vm.runInContext(code, context);
  const selected = () => Array.from(vm.runInContext('activeTuitionPayments().filter(tuitionPaymentMatchesSelection).map(row=>row.id)', context));
  assert.deepEqual(selected(), ['g']);
  context.selectedPaymentSubjectId = 'piano';
  assert.deepEqual(selected(), ['p']);
  context.studentId = 'child-b';
  assert.deepEqual(selected(), []);
});

test('administrator continuation selects the latest period of the chosen subject', () => {
  const code = read('operations-course-inline-runtime.js').split('\n').find(line=>line.includes('function latestPeriod('));
  const context = vm.createContext({state:{tuitionPeriods:[
    {id:'g1',studentId:'a',subjectId:'g',startDate:'2026-07-21',periodNo:1},
    {id:'g2',studentId:'a',subjectId:'g',startDate:'2026-08-21',periodNo:2},
    {id:'p3',studentId:'a',subjectId:'p',startDate:'2026-09-01',periodNo:3},
    {id:'other',studentId:'b',subjectId:'g',startDate:'2026-09-02',periodNo:4}
  ]}, clean:String, numberOf:Number});
  vm.runInContext(code, context);
  assert.equal(context.latestPeriod('a','g').id, 'g2');
  assert.equal(context.latestPeriod('a','p').id, 'p3');
  assert.equal(context.latestPeriod('a','missing').id, undefined);
});

test('shared history updates payment subject and includes a subject awaiting its first period', async () => {
  const elements = new Map();
  const element = key => {
    if (!elements.has(key)) elements.set(key, {innerHTML:'', value:'', addEventListener(type, fn){this[type]=fn;}});
    return elements.get(key);
  };
  const host = {isConnected:true, querySelector:element};
  const window = {};
  vm.runInNewContext(read('course-history-view.js'), {window});
  const seen = [];
  window.CourseHistoryView.mount(host, {
    call:async()=>({subjects:[{id:'g',name:'吉他'}],periods:[],lessons:[]}),
    additionalSubjects:[{id:'p',name:'鋼琴'}], onSubjectChange:id=>seen.push(id)
  });
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(seen,['g']);
  assert.match(element('select').innerHTML,/value="p"/);
  element('select').value='p';
  element('select').change();
  assert.deepEqual(seen,['g','p']);
  assert.match(element('[data-history-cards]').innerHTML,/沒有期別/);
});
