'use strict';
(function(root,factory){
 const build=factory();
 if(typeof module==='object'&&module.exports)module.exports=build;
 else root.EnrollmentConfirmationMessage=build;
})(typeof window==='object'?window:globalThis,function(){
 const text=v=>String(v??'').trim(),days='日一二三四五六';
 return function confirmationMessage(schedule,form={}){
  const names=schedule.studentNames||[form.name,form.secondName].filter(Boolean);
  const day=/^\d{4}-\d{2}-\d{2}$/.test(schedule.date||'')?days[new Date(schedule.date+'T12:00:00+08:00').getUTCDay()]:'';
  const date=schedule.date?text(schedule.date).replace(/-/g,'/')+'（星期'+day+'）':'日期待選';
  const time=schedule.time&&schedule.endTime?schedule.time+'–'+schedule.endTime:'時間待選';
  const fee=schedule.plan?'NT$ '+Number(schedule.plan.amount).toLocaleString('zh-TW')+'／'+Number(schedule.plan.lessonCount)+' 堂':'學費待選';
  return ['【柚子樂器｜報名確認】',names.map(text).join('、')+' 您好，您的課程報名已確認！','',
   '課程：'+(text(schedule.subjectName)||'科目待選')+(form.optionName?'（'+text(form.optionName)+'）':''),
   '老師：'+(text(schedule.teacherName)||'老師待選'),
   '首次上課：'+date+' '+time,
   '固定上課：'+(schedule.frequency==='biweekly'?'隔週':'每週')+'星期'+(day||'待選')+' '+time,
   '教室：'+(text(schedule.roomName)||'教室待選'),
   '學費：'+fee,
   ...(text(schedule.studentMessageNote)?['','補充說明：'+text(schedule.studentMessageNote)]:[]),
   '','如需調整，請回覆此 LINE 與教室聯絡。'].join('\n');
 };
});
