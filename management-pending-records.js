/* Shared read-only rules: a badge and its destination must select the same records. */
(function(root){
'use strict';
const clean=v=>String(v??'').trim();
function profileToContractRow(row){row=row||{};const contractId=String(row.currentContractId||row.contractId||row.latestExternalContractId||'').trim();const id=contractId||String(row.id||row.__id||'').trim();const out=Object.assign({},row,{id,contractId:contractId||row.contractId||id,profileId:row.id||row.__id||row.profileId||'',teacherId:row.teacherId||row.id||row.__id||'',_profileSource:true});if(!out.teacherName)out.teacherName=row.teacherName||row.name||row.displayName||'';if(!out.mobile)out.mobile=row.mobile||row.phone||'';if(!out.email)out.email=row.email||row.emailLower||'';if(!out.contractRocYear)out.contractRocYear=row.contractRocYear||row.currentContractRocYear||row.latestExternalContractRocYear||row.latestExternalContractYear||row.contractYearKey||'';if(!out.progressStatus)out.progressStatus=row.progressStatus||row.latestExternalContractProgress||row.contractStatus||row.profileStatus||row.status||'';return out;}
function mergeExternalTeacherRows(contractRows,profileRows){const map=new Map();function keyOf(row){return String((row&&(row.contractId||row.currentContractId||row.latestExternalContractId||row.id||row.__id||row.profileId||row.teacherId))||'').trim();}function put(row){if(!row)return;const key=keyOf(row);if(!key)return;const old=map.get(key)||{};const merged=Object.assign({},old,row);if(!merged.teacherName)merged.teacherName=old.teacherName||row.name||row.displayName||'';if(!merged.name)merged.name=old.name||row.teacherName||row.displayName||'';if(!merged.mobile)merged.mobile=old.mobile||row.phone||'';if(!merged.email)merged.email=old.email||row.emailLower||'';map.set(key,merged);}profileRows.forEach(r=>put(profileToContractRow(r)));contractRows.forEach(r=>put(r));return Array.from(map.values());}
function statusValuesOf(c){return [c&&c.status,c&&c.contractStatus,c&&c.profileStatus,c&&c.progressStatus,c&&c.latestExternalContractStatus,c&&c.latestExternalContractProgress,c&&c.externalContractRenewalStatus].map(v=>String(v||'').trim()).filter(Boolean);}
function isPendingAdminContract(c){
 if(!c||c.deleted===true)return false;
 const primary=clean(c.status||c.contractStatus||c.profileStatus);
 if(/^(active|approved|confirmed|contract_effective|needs_revision|waiting_contract|waiting_bindings|overdue_unsigned|archived|deleted|void|cancelled|draft)$|契約生效|已確認|已核准|退回補件|封存|刪除|取消|作廢/i.test(primary))return false;
 return /submitted_pending_admin|老師已送出|已送出|待主管確認|待管理端確認|等待.*確認/i.test(statusValuesOf(c).join('|'));
}
function teacherReviewRows(rows,type){return rows.filter(r=>isPendingAdminContract(r)&&(!type||(type==='registration'?r.registrationOnly===true:r.registrationOnly!==true)));}
function hasFormalSubmittedData(c){ c=c||{}; return !!(c.paperSignedConfirmedAt || c.paperSignedPdfUrl || (Array.isArray(c.paperSignedDocuments)&&c.paperSignedDocuments.length) || c.customerSubmittedFormalAt || c.customerSignedAt || c.customerSignatureDataUrl || c.signatureDataUrl || c.customerSignatureUrl || c.signatureUrl || c.customerIdImageWatermarkedDataUrl || c.idImageWatermarkedDataUrl || c.customerIdImageUrl || c.idImageUrl); }
function hasFormalLinkSent(c){ c=c||{}; return !!(c.signUrl || c.signLinkNoticeQueueCreated || c.signLinkLineQueueCreated || c.signLinkEmailQueueCreated || c.signLinkNoticeQueueCreatedAt || c.signLinkNoticeQueueIds || c.formalDataLinkSentAt || c.formalNoticeSentAt); }
function isWaitingSendFormalLink(x){ const st=clean((x&&x.status)||''); return !!(x && x.kind==='contract' && !hasFormalSubmittedData(x) && !hasFormalLinkSent(x) && ['草稿','待店家確認','待傳正式資料連結','formal_draft','pending_send_formal_link',''].includes(st)); }
function isPaymentPendingContract(x){ const st=clean((x&&x.status)||''); return !!(x && x.kind==='contract' && (['待付款確認','已補資料，待付款確認','客人已送出','待店家確認成立','customer_submitted','pending_shop_confirm','已簽署'].includes(st) || (st==='待店家確認' && hasFormalSubmittedData(x)))); }
function isRenewalPendingContract(x){ const st=clean((x&&x.status)||''); return !!(x && x.kind==='contract' && (['續約待確認','續約待付款'].includes(st) || (x.pendingRenewal && (x.pendingRenewal.startDate || x.pendingRenewal.periods)))); }
function isAdminActionRental(x){ return !!(x && ((x.kind==='application' && ['待店家確認','新申請','主管確認中',''].includes(clean(x.status||'待店家確認'))) || isWaitingSendFormalLink(x) || isPaymentPendingContract(x) || isRenewalPendingContract(x) || ['退租申請中','退租待安排','待收回'].includes(clean(x.status)))); }
function rentalAlerts(row,today=new Date(Date.now()+8*60*60*1000).toISOString().slice(0,10)){
  const status=clean(row.status),end=clean(row.endDate),contract=row.kind==='contract';
  const date=/^\d{4}-\d{2}-\d{2}$/.test(end)?new Date(end+'T00:00:00Z'):null;
  const valid=date&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===end;
  const outstanding=contract&&['租賃中','租用中','已成立','active','待配送 / 待安裝','到期提醒中','續約待確認','續約待付款','續約詢問中','退租申請中','退租待安排','待收回'].includes(status);
  return {overdue:!!(outstanding&&valid&&end<today),reminder:contract&&status==='到期提醒中'};
 }
function rentalVisible(r){return r&&r.deleted!==true&&r.archived!==true&&!['已取消','取消申請','已封存','封存','archived','cancelled','deleted','已退租'].includes(clean(r.status))&&!(r.kind==='application'&&(['已轉正式契約','converted'].includes(clean(r.status))||r.linkedContractId||r.contractId));}
function rentalPending(r,today){const a=rentalAlerts(r,today);return !!(rentalVisible(r)&&(isAdminActionRental(r)||a.overdue||a.reminder));}
function rentalCaseKey(r){return clean(r.applicationId||r.caseKey)||(r.kind==='application'?clean(r.__id||r.id):'contract:'+clean(r.contractId||r.__id||r.id));}
function rentalPendingRows(rows,today){const map=new Map();for(const r of rows){if(!rentalPending(r,today))continue;const key=rentalCaseKey(r);if(!map.has(key)||r.kind==='contract')map.set(key,r);}return [...map.values()];}
function enrollmentPending(r){return ['received','contacted','admitted'].includes(clean(r.status));}
async function readEnrollmentRows(call){const rows=[],seen=new Set();let cursor='';do{const r=await call('enrollmentAdmin',{action:'list',...(cursor?{cursor}:{})});if(!r||!Array.isArray(r.records))throw Error('報名清單讀取失敗');rows.push(...r.records);cursor=r.nextCursor||'';if(cursor&&seen.has(cursor))throw Error('報名分頁讀取失敗');seen.add(cursor);}while(cursor);return rows;}
const api={profileToContractRow,mergeExternalTeacherRows,isPendingAdminContract,teacherReviewRows,rentalAlerts,rentalPending,rentalPendingRows,rentalCaseKey,enrollmentPending,readEnrollmentRows};
if(typeof module==='object'&&module.exports)module.exports=api;else root.ManagementPendingRecords=api;
})(typeof window==='object'?window:this);
