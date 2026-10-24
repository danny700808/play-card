'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {database} = require('./helpers/security-fixtures.cjs');
const password = 'FixturePassword1';
function encoded(value) { const salt='test-only-salt'; return 'scrypt$16384$8$1$'+salt+'$'+crypto.scryptSync(value,salt,64,{N:16384,r:8,p:1}).toString('hex'); }
function fixture(options={}) {
  const f=database({'admins/a1':{employeeId:'ADMIN-1',email:'manager@example.test',name:'管理者',role:'admin',passwordHash:encoded(password),...options.row}});
  const updates=[],creations=[],claimUpdates=[],sent=[];
  let user=options.newUser?null:{uid:'firebase-1',displayName:'管理者',providerData:[{providerId:'password'}],...options.user};
  const auth={
    async getUserByEmail(){if(!user)throw Object.assign(new Error('missing'),{code:'auth/user-not-found'});return user;},
    async updateUser(uid,patch){updates.push({...patch});user={...user,...patch};if(patch.password)user.providerData=[{providerId:'password'}];return user;},
    async createUser(data){creations.push({...data});user={...data,providerData:[{providerId:'password'}]};return user;},
    async setCustomUserClaims(uid,claims){claimUpdates.push({...claims});}
  };
  const firestore=()=>f.db;
  firestore.FieldValue={...f.FieldValue,delete:()=>null,increment:value=>value};
  const module={exports:{}};
  const context={module,exports:module.exports,Buffer,console,require(name){
    if(name==='crypto')return crypto;
    if(name==='firebase-admin')return {auth:()=>auth,firestore};
    if(name==='firebase-functions/v2/https')return {onCall:(_,handler)=>handler,HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}}};
    throw new Error('Unexpected dependency: '+name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../functions/employeeAuth.js'),'utf8'),context);
  const api={};module.exports.registerEmployeeAuth(api,{sendEmail:async data=>{if(options.emailFails)throw new Error('mail unavailable');sent.push(data);}});
  const request=data=>({data:{email:'manager@example.test',...data},rawRequest:{ip:'127.0.0.1'}});
  return {...f,api,updates,creations,claimUpdates,sent,request,login:value=>api.employeeSecureLogin(request({password:value||password}))};
}

test('ordinary and concurrent password logins never reset the Firebase password',async()=>{
  const f=fixture();
  for(const result of await Promise.all([f.login(),f.login(),f.login()])){assert.equal(result.ok,true);assert.equal(result.authMode,'email-password');}
  assert.equal(f.updates.length,0);assert.equal(f.creations.length,0);assert.equal(f.claimUpdates.length,3);
  assert(f.claimUpdates.every(claims=>claims.manager&&claims.employeeId==='ADMIN-1'));
});
test('updating the display name does not change credentials',async()=>{
  const f=fixture({user:{displayName:'舊名稱'}});await f.login();
  assert.deepEqual(f.updates,[{displayName:'管理者'}]);
});
test('first account setup and adding password login synchronize credentials only once',async()=>{
  for(const options of [{newUser:true},{user:{providerData:[]}}]){
    const f=fixture(options);assert.equal((await f.login()).ok,true);assert.equal((await f.login()).ok,true);
    assert.equal([...f.updates,...f.creations].filter(row=>row.password).length,1);
    assert.equal(f.rows.get('admins/a1').firebasePasswordSyncRequired,false);
  }
});
test('legacy password migration synchronizes once, then preserves existing sessions',async()=>{
  const f=fixture({row:{passwordHash:'',password}});assert.equal((await f.login()).passwordMigrated,true);await f.login();
  assert.equal(f.updates.filter(row=>row.password).length,1);assert.equal(f.rows.get('admins/a1').password,null);
});
test('real password changes still update Firebase and reject the old password',async()=>{
  const f=fixture(),next='NewFixturePassword2';
  assert.equal((await f.api.employeeChangePassword(f.request({oldPassword:password,newPassword:next,confirmPassword:next}))).ok,true);
  assert.equal(f.updates.filter(row=>row.password===next).length,1);
  assert.equal((await f.login(next)).ok,true);assert.equal((await f.login(password)).ok,false);
  assert.equal(f.updates.filter(row=>row.password).length,1);
});
test('temporary password reset synchronizes once, even when logging in twice before changing it',async()=>{
  const f=fixture();await f.api.employeeForgotPassword(f.request({}));
  const temporary=f.sent[0].body.match(/暫時密碼是：([^\n]+)/)[1];
  assert.equal((await f.login(temporary)).ok,true);assert.equal((await f.login(temporary)).ok,true);
  assert.equal(f.updates.filter(row=>row.password===temporary).length,1);
  assert.equal((await f.login(password)).ok,false);
});
test('a failed reset email restores the password synchronization flag and the old password',async()=>{
  const f=fixture({emailFails:true,row:{firebasePasswordSyncRequired:false}});
  await assert.rejects(f.api.employeeForgotPassword(f.request({})),/暫時密碼寄送失敗/);
  assert.equal(f.rows.get('admins/a1').firebasePasswordSyncRequired,false);
  assert.equal((await f.login()).ok,true);assert.equal(f.updates.length,0);
});
test('wrong passwords and disabled Firebase accounts never alter credentials or grant access',async()=>{
  const wrong=fixture();assert.equal((await wrong.login('wrong')).ok,false);assert.equal(wrong.updates.length,0);assert.equal(wrong.claimUpdates.length,0);
  const disabled=fixture({user:{disabled:true}});await assert.rejects(disabled.login(),error=>error.code==='permission-denied');
  assert.equal(disabled.updates.length,0);assert.equal(disabled.claimUpdates.length,0);
});
