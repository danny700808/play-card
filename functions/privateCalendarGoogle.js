'use strict';
const ROOT='https://www.googleapis.com/auth/';
const REQUIRED=[ROOT+'calendar.calendarlist.readonly',ROOT+'calendar.events'];
function requireScopes(scope){
 const granted=new Set(String(scope||'').split(/\s+/));
 if(granted.has(ROOT+'calendar'))return;
 if(!granted.has(ROOT+'calendar.events')||(!granted.has(ROOT+'calendar.calendarlist.readonly')&&!granted.has(ROOT+'calendar.calendarlist')))throw Error('尚未同意完整行事曆權限。請重新連接，勾選「查看日曆清單」與「查看及編輯日曆活動」；只同意登入無法同步。');
}
function apiError(status,data){
 const reasons=(data?.error?.errors||[]).map(e=>e.reason);
 if(status===401)return {code:'failed-precondition',message:'Google 授權已失效，請重新連接。'};
 if(status===429||status>=500||reasons.some(r=>['rateLimitExceeded','userRateLimitExceeded','quotaExceeded'].includes(r)))return {code:'unavailable',message:'Google 暫時忙碌，請稍後按同步更新。'};
 if(reasons.includes('insufficientPermissions')||data?.error?.details?.some(d=>d.reason==='ACCESS_TOKEN_SCOPE_INSUFFICIENT'))return {code:'failed-precondition',message:'Google 行事曆權限尚未完整授權，請重新連接並勾選日曆清單與活動權限。'};
 if(status===412)return {code:'aborted',message:'Google 行程已被修改，請重新整理再編輯。'};
 return {code:'permission-denied',message:'Google 無法存取這個行事曆或執行這項操作（'+status+'），請檢查該日曆的存取設定。'};
}
module.exports={REQUIRED,requireScopes,apiError};
