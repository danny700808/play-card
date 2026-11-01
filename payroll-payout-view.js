(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.YouziPayrollPayout=api;})(typeof window!=='undefined'?window:this,function(){
'use strict';
var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});},money=function(v){return 'NT$'+Number(v||0).toLocaleString('zh-TW',{maximumFractionDigits:2});};
function signed(r){return ['deduction','penalty','late_attendance_fee','attendance_cancellation_fee'].includes(r.type)?-Math.abs(Number(r.amount||0)):Number(r.amount||0);}
function label(r,options){
 if(!r.attendanceSignedAt)return r.payoutNeedsReview?r.payoutLabel||'發放日期待核對':'';
 var short=function(v){var parts=String(v||'').slice(0,10).split('-');return parts.length===3?Number(parts[1])+'/'+Number(parts[2]):String(v||'');},pay=options&&options.teacherMobile?expectedPaymentDate({expectedPayDate:r.expectedPayDate}):String(r.expectedPayDate||'');
 return '補簽到｜'+short(r.attendanceSignedAt)+' 補簽 '+short(r.lessonDate||r.date)+' 的課｜'+(pay?Number(pay.slice(5,7))+' 月薪資・'+short(pay)+' 發放':'發放日期待核對');
}
function expectedPaymentDate(pay,month){
 var monthKey=String(month||pay.batchMonth||''),date;
 if(/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)){var parts=monthKey.split('-');date=new Date(Date.UTC(Number(parts[0]),Number(parts[1]),10));}
 else {var text=String(pay.expectedPayDate||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return '';date=new Date(text+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==text)return '';}
 var weekday=date.getUTCDay();if(weekday===6)date.setUTCDate(date.getUTCDate()+2);else if(weekday===0)date.setUTCDate(date.getUTCDate()+1);
 return date.toISOString().slice(0,10);
}
function render(batch,teacherId,options){
 options=options||{};var mobile=options.teacherMobile===true;
 if(!batch||!batch.payout)return '';
 var lessons=(batch.teacherPayoutPayroll||batch.payoutPayroll||[]).filter(function(r){return !teacherId||r.teacherId===teacherId;}),fees=(batch.teacherPayoutAdjustments||batch.payoutAdjustments||[]).filter(function(r){return !teacherId||r.teacherId===teacherId;}),paid=(batch.paidBatches||[]).find(function(r){return r.teacherId===teacherId;}),amount=lessons.reduce(function(n,r){return n+Number(r.teacherAmount||0);},0)+fees.reduce(function(n,r){return n+signed(r);},0),pay=batch.payout;
 return '<section class="settings-card payroll-payout-summary" style="padding:16px;margin:16px 0;background:#eef6f2;border-radius:12px"><h3>'+ (mobile?'本期預計發放時間｜'+esc(expectedPaymentDate(pay,options.month)):'本期發放明細｜'+esc(pay.expectedPayDate))+'</h3>'+ (mobile?'':'<p>本期應付合計：<strong>'+money(amount)+'</strong>　'+(paid?'已確認匯款：'+esc(paid.transferDate)+'／'+money(paid.amount):'尚未確認匯款')+'</p>')+'<p>補簽截止：'+esc(pay.cutoffAt)+'（台灣時間）。截止後補簽順延下期，原上課月份的紀錄仍保留。補簽行政處理費隨該堂課發放時扣除。</p><details><summary>查看本期 '+lessons.length+' 堂課與 '+fees.length+' 筆獎勵／扣款</summary><div style="overflow:auto"><table style="width:100%;text-align:left"><thead><tr><th>原上課日／記帳日</th><th>學生／項目</th><th>金額</th></tr></thead><tbody>'+lessons.map(function(r){return '<tr><td>'+esc(r.date)+'</td><td>'+esc(r.studentName||r.subjectName||'課堂')+(r.attendanceSignedAt?'<small style="display:block">'+esc(label(r,{teacherMobile:mobile}))+'</small>':'')+'</td><td>'+money(r.teacherAmount)+'</td></tr>';}).concat(fees.map(function(r){return '<tr><td>'+esc(r.lessonDate||r.date)+'</td><td>'+esc(r.note||'獎勵／扣款')+'</td><td style="color:'+(signed(r)<0?'#b42318':'inherit')+'">'+money(signed(r))+'</td></tr>';})).join('')+'</tbody></table></div></details></section>';
}
return {render:render,signed:signed,label:label,expectedPaymentDate:expectedPaymentDate};
});
