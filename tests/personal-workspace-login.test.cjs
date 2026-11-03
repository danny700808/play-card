'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 const dom=new JSDOM(fs.readFileSync('dashboard.html','utf8'),{url:'https://example.test/dashboard.html',runScripts:'outside-only'}),w=dom.window;
 const person={id:'employee-test',name:'測試員工',identityType:'parttime',identityLabel:'工讀生'};
 let local={...person},listener,unsubscribed=0;
 const calls=[];
 const auth={currentUser:null,onAuthStateChanged(fn){listener=fn;return ()=>{unsubscribed++;};}};
 const user={uid:'auth-test',getIdTokenResult:async()=>({claims:{employee:true,employeeId:person.id}})};
 w.APP_CONFIG={FIREBASE_CONFIG:{projectId:'test'}};w.firebase={apps:[{}],auth:()=>auth};
 w.getUser=()=>local;w.saveUser=value=>{local=value;};w.isManager=()=>false;
 w.YZProtectedData={call:async(name,data)=>{calls.push(data);return {user:person,capabilities:{attendance:true},profile:{},missingFields:[]};}};
 w.api=async()=>({ok:true,rows:[],schedules:[]});
 w.eval(fs.readFileSync('employee-attendance-view.js','utf8'));
 w.eval(fs.readFileSync('personal-workspace-model.js','utf8'));
 w.eval(fs.readFileSync('personal-workspace.js','utf8'));
 return {w,dom,auth,user,calls,restore(value=user){auth.currentUser=value;listener?.(value);},unsubscribed:()=>unsubscribed};
}
test('LINE redirect waits for compat Firebase restoration before reading employee data',async()=>{
 const f=fixture();try{
  await tick();assert.doesNotMatch(f.w.document.getElementById('personalStatus').textContent,/帳號已切換|登入到期/);
  assert.equal(f.calls.length,0);
  f.restore();await tick();await tick();
  assert.equal(f.w.document.getElementById('personalName').textContent,'測試員工');
  assert.equal(f.calls[0].expectedEmployeeId,'employee-test');
  assert(f.w.document.querySelector('[data-action=clock]'));assert.equal(f.unsubscribed(),1);
 }finally{f.dom.window.close();}
});
test('a confirmed signed-out or mismatched account never reads workspace data',async()=>{
 for(const mismatch of [false,true]){
  const f=fixture();try{
   if(mismatch)f.user.getIdTokenResult=async()=>({claims:{employee:true,employeeId:'another-employee'}});
   f.restore(mismatch?f.user:null);await tick();await tick();
   assert.equal(f.calls.length,0);
   assert.match(f.w.document.getElementById('personalStatus').textContent,/帳號已切換|登入到期/);
   assert.equal(f.w.document.querySelector('#personalBody a').getAttribute('href'),'login.html?next=dashboard.html');
  }finally{f.dom.window.close();}
 }
});
test('an account switch during token retrieval cannot render the former employee',async()=>{
 const f=fixture();try{
  f.user.getIdTokenResult=async()=>{f.auth.currentUser={uid:'different-account'};return {claims:{employee:true,employeeId:'employee-test'}};};
  f.restore();await tick();await tick();assert.equal(f.calls.length,0);
  assert.notEqual(f.w.document.getElementById('personalName').textContent,'測試員工');
 }finally{f.dom.window.close();}
});
