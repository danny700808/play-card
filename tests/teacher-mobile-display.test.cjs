'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const view = require('../payroll-payout-view');

test('selected salary month pays on next month tenth, with weekends moved to Monday', () => {
  for (const [month, expected] of [
    ['2026-10', '2026-11-10'], ['2026-09', '2026-10-12'],
    ['2026-04', '2026-05-11'], ['2026-12', '2027-01-11']
  ]) assert.equal(view.expectedPaymentDate({expectedPayDate:'2026-08-10'}, month), expected);
  assert.equal(view.expectedPaymentDate({batchMonth:'2026-09'}), '2026-10-12');
  assert.equal(view.expectedPaymentDate({expectedPayDate:'2026-10-10'}), '2026-10-12');
  assert.equal(view.expectedPaymentDate({expectedPayDate:'2026-02-31'}), '');
});

test('mobile payout is compact, preserves details and leaves manager display and data unchanged', () => {
  const batch = {
    payout:{batchMonth:'2026-09',expectedPayDate:'2026-10-10',cutoffAt:'2026-10-10 00:00'},
    teacherPayoutPayroll:[{teacherId:'t',studentName:'<姓名>',date:'2026-09-28',teacherAmount:420,attendanceSignedAt:'2026-10-01',expectedPayDate:'2026-10-10'}],
    teacherPayoutAdjustments:[{teacherId:'t',type:'late_attendance_fee',amount:50,note:'補簽費用'}],
    paidBatches:[{teacherId:'t',transferDate:'2026-10-12',amount:370}]
  };
  const before = JSON.stringify(batch);
  const html = view.render(batch,'t',{teacherMobile:true,month:'2026-09'});
  assert.match(html,/本期預計發放時間｜2026-10-12/);
  assert.match(html,/每月 10 日發放，遇週六、週日順延至下週一。/);
  assert.doesNotMatch(html,/本期應付合計|已確認匯款|尚未確認匯款/);
  assert.match(html,/補簽截止：2026-10-10 00:00（台灣時間）/);
  assert.match(html,/截止後補簽順延下期/);
  assert.match(html,/補簽行政處理費隨該堂課發放時扣除/);
  assert.ok(html.indexOf('補簽截止') < html.indexOf('<details>'));
  assert.match(html,/補簽到｜10\/1 補簽 9\/28 的課/);
  assert.match(html,/<details>/); assert.match(html,/NT\$420/); assert.match(html,/NT\$-50/);
  assert.match(html,/&lt;姓名&gt;/); assert.match(html,/10\/12 發放/);
  assert.match(view.render(batch,'t'),/本期發放明細｜2026-10-10/);
  assert.match(view.render(batch,'t'),/本期應付合計：<strong>NT\$370/);
  assert.equal(JSON.stringify(batch),before);
});

test('signed-in lesson cards show only signed-in status regardless of duration', () => {
  const source = fs.readFileSync(require.resolve('../teacher-course-portal-v8.js'),'utf8');
  const fn = source.slice(source.indexOf('  function lessonCard('),source.indexOf('  function overlapGroups('));
  const context = {clean:v=>String(v||''),teacherOperations:{busy:()=>false},operationKey:()=>'',escapeHtml:v=>String(v||'')};
  vm.createContext(context); vm.runInContext(fn+';this.render=lessonCard',context);
  for (const status of ['attended','checked_in','present']) for (const duration of [30,60,90]) {
    const event = {id:'a',status,studentNames:['學生'],subjectName:'木吉他',roomName:'教室三',attendanceDurationMinutes:duration,attendanceDeductUnits:duration/30};
    const before = JSON.stringify(event), html = context.render(event,false);
    assert.match(html,/已簽到/); assert.doesNotMatch(html,/已上課|分鐘|扣\d+格/);
    assert.equal(JSON.stringify(event),before);
    assert.match(html,/<strong class="lesson-student-subject">學生・木吉他<\/strong><small class="lesson-room-status">教室三/);
  }
  for (const [status,label] of [['leave','請假'],['absent','曠課'],['cancelled','已取消']])
    assert.ok(context.render({status},false).includes(label));
});
