'use strict';
const ADMIN_PAGE='https://danny700808.github.io/play-card/enrollment-admin.html';
const clean=v=>String(v??'').trim();
function managerNotification(id,record,createdAt){
 if(!/^enr-[\w-]{1,120}$/.test(id)||!record?.consent?.verifiedAt||!/^U[a-f0-9]{32}$/i.test(record.line?.lineUserId||''))throw new Error('報名尚未完成 LINE 驗證，無法通知管理者。');
 const f=record.form,queueId='enrollment-received-'+id,approvalUrl=ADMIN_PAGE+'?enrollment='+encodeURIComponent(id);
 const trialScope=f.courseId===8&&f.subjectId==='648823805bce9600b204d45c'&&typeof f.willingToDiscussPaidTrial==='boolean'?'：爵士鼓':'';
 const paidTrial=f.willingToDiscussPaidTrial===true?'若無法安排免費試上，報名者願意先討論一堂付費試上。請先告知單堂費用，經同意再安排。':f.willingToDiscussPaidTrial===false?'報名者未表示可接受付費試上。請先討論其他時段，勿直接安排付費試上。':'舊版報名未記錄付費試上偏好。請聯絡確認，不可視為同意。';
 const body=['【新課程報名】',clean(f.name)+(f.secondName?'、'+clean(f.secondName):''),clean(f.courseName)+'｜'+clean(f.optionName),'希望時間：'+(f.times?.length>12?f.times.slice(0,12).join('、')+'（共 '+f.times.length+' 個，完整時段請見報名資料）':f.times?.join('、')||clean(f.date)+' '+clean(f.time)),...(f.preferFreeTrial===true?['優先安排免費試上（待確認）'+trialScope+'。',paidTrial]:[]),(f.preferFreeTrial===true?'正式課程參考學費：NT$ ':'報名費用：NT$ ')+clean(f.price)+'／'+Number(f.lessons)+' 堂','LINE：'+clean(record.line.lineDisplayName)+'（身分已驗證）',record.line.lineFriendFlag?'已確認為官方 LINE 好友。':'尚未確認加入官方 LINE 好友，請先核對聯絡方式。','請查看資料、聯絡學生，再確認正式排課。',approvalUrl].join('\n');
 // The existing delivery service resolves PRIMARY_MANAGER_LINE. Never use the applicant as recipient.
 return {queueId,channel:'line',status:'待發送',source:'online-enrollment-received',eventCode:'online_enrollment_received',target:'admin',targetRole:'manager',targetEmployeeId:'PRIMARY_MANAGER_LINE',targetName:'柚子樂器管理者',emailFallbackEnabled:false,title:'柚子樂器｜新課程報名',body,enrollmentId:id,approvalUrl,createdAt};
}
module.exports={managerNotification};
