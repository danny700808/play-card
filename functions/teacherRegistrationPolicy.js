'use strict';
const clean=value=>String(value==null?'':value).trim();
function assertRegistrationProfile(row){
  const fields={name:'姓名',mobile:'手機',idNumber:'身分證字號',birthDate:'出生年月日',householdAddress:'戶籍地址',mailingAddress:'通訊地址',emergencyContact:'緊急聯絡人',emergencyPhone:'緊急聯絡人電話'};
  for(const [field,label] of Object.entries(fields))if(!clean(row[field]))throw Error('請填寫'+label+'。');
  if(!Array.isArray(row.identityUrls)||!row.identityUrls.length)throw Error('請上傳身分證明文件。');
  if(!Array.isArray(row.teachingAbilities)||!row.teachingAbilities.length||row.teachingAbilities.some(a=>!clean(a.subjectId)||!clean(a.level)))throw Error('請選擇授課科目與程度。');
}
function isRegistrationOnly(row){return row.registrationOnly===true&&row.contractStatus==='not_requested';}
module.exports={assertRegistrationProfile,isRegistrationOnly};
