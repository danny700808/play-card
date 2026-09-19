'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {database}=require('./helpers/security-fixtures.cjs');
const source=fs.readFileSync('functions/courseLoginAuthV3.js','utf8');
const US='https://us-central1-youzi-c1b74.cloudfunctions.net/coursePortalLineLoginCallback';
const TW='https://asia-east1-youzi-c1b74.cloudfunctions.net/coursePortalLineLoginCallback';
class Stamp extends Date {toDate(){return new Date(this);}}
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function harness({fixture=database(),env={},tokenFails=false}={}){
  const calls=[],api={},admin={apps:[{}],firestore:()=>fixture.db,auth:()=>({})};
  admin.firestore.FieldValue=fixture.FieldValue;admin.firestore.Timestamp={fromMillis:ms=>new Stamp(ms)};
  const module={exports:{}};
  const imports={
    'firebase-functions/v2/https':{onCall:(_,fn)=>fn,onRequest:(_,fn)=>fn,HttpsError:class extends Error{}},
    'firebase-functions/params':{defineSecret:()=>({value:()=> 'fixture-only-secret'})},
    'firebase-admin':admin,crypto,
    './courseLoginPolicy':require('../functions/courseLoginPolicy'),
    './unifiedLogin':{createUnifiedLogin:()=>({issue:async()=> 'fixture-ticket'})},
    './coursePortal':{}
  };
  vm.runInNewContext(source,{module,exports:module.exports,require:name=>{if(!(name in imports))throw Error('Unexpected import '+name);return imports[name];},process:{env},URL,URLSearchParams,Buffer,Date,setTimeout,console:{error(){}},fetch:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/token'))return {ok:!tokenFails,status:tokenFails?400:200,json:async()=>tokenFails?{error:'invalid_grant'}:{access_token:'fixture-access'}};
    if(url.endsWith('/profile'))return {ok:true,json:async()=>({userId:'fixture-line-user',displayName:'Fixture'})};
    return {ok:true,json:async()=>({friendFlag:true})};
  }});
  module.exports.registerCourseLoginAuthV3(api);
  async function start(type='unified'){
    const result=await api.coursePortalStartLineLogin({data:{type,challenge:'a'.repeat(64)}});
    const url=new URL(result.authorizationUrl),state=url.searchParams.get('state'),path='coursePortalLineOAuthStates/'+hash(state);
    return {url,state,path,row:fixture.rows.get(path)};
  }
  async function callback(query){
    const res={set(){},status(n){this.statusCode=n;return this;},send(body){this.body=body;},redirect(status,url){this.statusCode=status;this.url=url;}};
    await api.coursePortalLineLoginCallback({method:'GET',query},res);return res;
  }
  return {fixture,calls,start,callback};
}
test('new authorizations for all portal roles pin the exact Taiwan callback in server state',async()=>{
 const h=harness();
 for(const type of ['teacher','student','renter','unified']){const s=await h.start(type);assert.equal(s.url.searchParams.get('client_id'),'2010902226');assert.equal(s.url.searchParams.get('redirect_uri'),TW);assert.equal(s.row.callbackUrl,TW);assert.equal(s.row.type,type);}
});
test('pre-migration pending login without callback metadata still exchanges against the US URL',async()=>{
 const h=harness(),s=await h.start();delete s.row.callbackUrl;
 const result=await h.callback({state:s.state,code:'fixture-code',callbackUrl:TW});
 assert.equal(new URLSearchParams(h.calls[0].options.body).get('redirect_uri'),US);
 assert.equal(h.fixture.rows.get(s.path).status,'used');assert(result.url.includes('unifiedTicket='));
});
test('Taiwan state is used for token exchange and query parameters cannot replace it',async()=>{
 const h=harness(),s=await h.start();await h.callback({state:s.state,code:'fixture-code',callbackUrl:US,redirect_uri:'https://attacker.invalid/'});
 assert.equal(new URLSearchParams(h.calls[0].options.body).get('redirect_uri'),TW);
 assert.equal(h.fixture.rows.get(s.path).status,'used');
});
test('an explicitly pinned US login survives an intervening deployment with Taiwan defaults',async()=>{
 const old=harness({env:{LINE_LOGIN_CALLBACK_URL:US}}),s=await old.start();
 const updated=harness({fixture:old.fixture});await updated.callback({state:s.state,code:'fixture-code'});
 assert.equal(new URLSearchParams(updated.calls[0].options.body).get('redirect_uri'),US);
});
test('cancelled, expired and unknown states never exchange a code',async()=>{
 const h=harness();
 for(const role of ['teacher','student','renter','unified']){const s=await h.start(role);await h.callback({state:s.state,error:'access_denied'});assert.equal(h.fixture.rows.get(s.path).status,'cancelled');}
 const expired=await h.start();expired.row.expiresAt=new Date(0);await h.callback({state:expired.state,code:'fixture-code'});
 await h.callback({state:'unknown',code:'fixture-code'});assert.equal(h.calls.length,0);
});
test('completed callback replay returns the same redirect without repeating token exchange',async()=>{
 const h=harness(),s=await h.start(),query={state:s.state,code:'fixture-code'};
 const first=await h.callback(query),second=await h.callback(query);assert.equal(first.url,second.url);assert.equal(h.calls.filter(c=>c.url.endsWith('/token')).length,1);
});
test('invalid stored callback and unknown configured origins fail closed',async()=>{
 assert.throws(()=>harness({env:{LINE_LOGIN_CALLBACK_URL:'https://attacker.invalid/'}}),/Unsupported/);
 const h=harness(),s=await h.start();s.row.callbackUrl='https://attacker.invalid/';await h.callback({state:s.state,code:'fixture-code'});assert.equal(h.calls.length,0);assert.notEqual(h.fixture.rows.get(s.path).status,'used');
});
test('a rejected authorization code is not retried at another regional callback',async()=>{
 const h=harness({tokenFails:true}),s=await h.start();await h.callback({state:s.state,code:'fixture-code'});assert.equal(h.calls.length,1);assert.equal(new URLSearchParams(h.calls[0].options.body).get('redirect_uri'),TW);
});
test('deployment verifies both compatible callbacks before publishing new starters',()=>{
 const workflow=fs.readFileSync('.github/workflows/deploy-course-portal-auth.yml','utf8');
 const before=workflow.indexOf('name: Deploy compatible LINE callbacks before switching login starters'),after=workflow.indexOf('name: Deploy portal and protected internal Functions');
 assert(before>0&&before<after);const gate=workflow.slice(before,after);assert(gate.includes('--only functions:coursePortalLineLoginCallback'));assert(gate.includes('for region in us-central1 asia-east1'));assert(gate.includes('exit 1'));
});
