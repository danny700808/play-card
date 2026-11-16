'use strict';
const ADMIN_PAGE='https://danny700808.github.io/play-card/enrollment-admin.html';
const clean=v=>String(v??'').trim();
function managerNotification(id,record,createdAt){
 if(!/^enr-[\w-]{1,120}$/.test(id)||!record?.consent?.verifiedAt||!/^U[a-f0-9]{32}$/i.test(record.line?.lineUserId||''))throw new Error('報名尚未完成 LINE 驗證，無法通知管理者。');
 const f=record.form,queueId='enrollment-received-'+id,approvalUrl=ADMIN_PAGE+'?enrollment='+encodeURIComponent(id);
 const body=['【新課程報名】',clean(f.name)+(f.secondName?'、'+clean(f.secondName):''),clean(f.courseName)+'｜'+clean(f.optionName),'希望時間：'+clean(f.date)+' '+clean(f.time),'報名費用：NT$ '+clean(f.price)+'／'+Number(f.lessons)+' 堂','LINE：'+clean(record.line.lineDisplayName)+'（身分已驗證）',record.line.lineFriendFlag?'已確認為官方 LINE 好友。':'尚未確認加入官方 LINE 好友，請先核對聯絡方式。','請查看資料、聯絡學生，再確認正式排課。',approvalUrl].join('\n');
 // The existing delivery service resolves PRIMARY_MANAGER_LINE. Never use the applicant as recipient.
 return {queueId,channel:'line',status:'待發送',source:'online-enrollment-received',eventCode:'online_enrollment_received',target:'admin',targetRole:'manager',targetEmployeeId:'PRIMARY_MANAGER_LINE',targetName:'柚子樂器管理者',emailFallbackEnabled:false,title:'柚子樂器｜新課程報名',body,enrollmentId:id,approvalUrl,createdAt};
}
module.exports={managerNotification};
