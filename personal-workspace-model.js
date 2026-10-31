(function(root){
 'use strict';
 const fields={mobilePhone:'手機',birthDate:'生日',idNumber:'證件號碼',address:'聯絡地址',householdAddress:'戶籍地址',emergencyContact:'緊急聯絡人',emergencyPhone:'緊急聯絡電話',bankCode:'銀行代碼',bankName:'銀行名稱',bankAccount:'薪資帳號',accountName:'戶名'};
 function tabs(capabilities){return [...(capabilities.teacher?[['schedule','課表']]:[]),...(capabilities.attendance?[['attendance','出勤'],['salary','薪資']]:[]),...(capabilities.renter?[['rental','租用']]:[]),['more','其他']];}
 function sample(role='parttime',teacher=false,renter=false){return {ok:true,user:{id:'DEMO',name:'示範'+(role==='parttime'?'工讀生':'專職人員'),identityType:role,identityLabel:role==='parttime'?'工讀生':'專職人員'},capabilities:{attendance:true,teacher,renter},profile:{mobilePhone:'',birthDate:'',idNumber:'',address:'',householdAddress:'',emergencyContact:'',emergencyPhone:'',bankCode:'',bankName:'',bankAccount:'',accountName:''},missingFields:Object.keys(fields),profilePending:false,payments:[{month:'2026-09',paidDate:'2026-10-05',amount:role==='parttime'?12800:32000}]};}
 const api={fields,tabs,sample};if(typeof module==='object'&&module.exports)module.exports=api;else root.PersonalWorkspaceModel=api;
})(typeof window==='object'?window:this);
