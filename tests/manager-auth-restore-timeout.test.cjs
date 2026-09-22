const {test}=require('node:test');
const assert=require('node:assert/strict');
const Auth=require('../operations-manager-auth.js');
test('slow restore is retryable and does not request logout',async()=>{
 let timer,unsubscribed=false;
 const auth={currentUser:null,onAuthStateChanged(){return ()=>{unsubscribed=true;};}};
 const pending=Auth.ensureManagerAuth({firebase:{auth:()=>auth},setTimeout(fn){timer=fn;return 1;},clearTimeout(){}},{role:'manager'});
 timer();const result=await pending;
 assert.equal(result.ok,false);assert.equal(result.reauth,false);assert.equal(result.reason,'auth-restore-failed');assert.equal(unsubscribed,true);
});
test('confirmed missing login still requests authentication',async()=>{
 const auth={currentUser:null,onAuthStateChanged(fn){fn(null);return ()=>{};}};
 const result=await Auth.ensureManagerAuth({firebase:{auth:()=>auth},setTimeout,clearTimeout},{role:'manager'});
 assert.equal(result.ok,false);assert.equal(result.reauth,true);assert.equal(result.reason,'firebase-session-missing');
});
