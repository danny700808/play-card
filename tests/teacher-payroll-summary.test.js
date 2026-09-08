const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('teacher-course-portal-v8.js','utf8');
const fn=source.slice(source.indexOf('  function renderPayroll()'),source.indexOf('  function renderIrregularCourses()'));
function render(payroll,adjustments){const node={innerHTML:''};vm.runInNewContext(fn+';renderPayroll();',{data:{payroll,adjustments},payrollMonth:'2026-09',clean:v=>String(v||''),payrollShareLabel:()=> '60%',money:v=>'$'+v,escapeHtml:v=>String(v).replace(/</g,'&lt;'),document:{getElementById:()=>node}});return node.innerHTML;}
const html=render([{date:'2026-09-08',studentName:'A',teacherAmount:450}], [{date:'2026-09-08',type:'teacher_bonus',amount:100,note:'教材獎金'},{date:'2026-09-08',type:'reward',amount:500,note:'活動協助'},{date:'2026-09-08',type:'deduction',amount:50,note:'扣款原因'},{date:'2026-09-08',type:'adjustment',amount:-20,note:'其他扣款'}]);
for(const pair of [['課堂收入',450],['額外獎金',600],['扣款',70],['合計',980]])assert(html.includes(pair[0]+'</span><strong>$'+pair[1]));
assert(html.indexOf('payroll-summary')<html.indexOf('payroll-day'));
assert(html.includes('教材獎金')&&html.includes('活動協助')&&!html.includes('teacher_bonus'));
assert(render([],[]).includes('合計</span><strong>$0'));
assert(render([],[{type:'reward',amount:500,note:'僅獎金'}]).includes('合計</span><strong>$500'));
console.log('Payroll summary: approved and manual bonuses, deductions, empty month and bonus-only month passed');
