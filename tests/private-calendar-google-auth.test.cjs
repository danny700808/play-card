'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const auth=require('../functions/privateCalendarGoogle');
test('login-only and partial grants cannot replace a calendar connection',()=>{
 for(const scope of ['openid email',auth.REQUIRED[0],auth.REQUIRED[1],''])assert.throws(()=>auth.requireScopes(scope),/完整行事曆權限/);
 assert.doesNotThrow(()=>auth.requireScopes(auth.REQUIRED.join(' ')));
 assert.doesNotThrow(()=>auth.requireScopes('https://www.googleapis.com/auth/calendar'));
});
test('quota and temporary failures do not request reconnection',()=>{
 for(const [status,body] of [[429,{}],[503,{}],[403,{error:{errors:[{reason:'rateLimitExceeded'}]}}]]){
  const e=auth.apiError(status,body);assert.equal(e.code,'unavailable');assert.doesNotMatch(e.message,/授權|重新連接/);
 }
});
test('scope errors differ from access restrictions and edit conflicts',()=>{
 assert.match(auth.apiError(403,{error:{errors:[{reason:'insufficientPermissions'}]}}).message,/勾選/);
 assert.doesNotMatch(auth.apiError(403,{error:{errors:[{reason:'forbidden'}]}}).message,/授權|重新連接/);
 assert.equal(auth.apiError(412,{}).code,'aborted');
});
