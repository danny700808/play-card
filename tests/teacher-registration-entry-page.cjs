'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
(async()=>{
 const html=fs.readFileSync('external-teacher-onboarding.html','utf8').replace(/<script\b[^>]*\bsrc=[^>]*>[\s\S]*?<\/script>/gi,''),requests=[],errors=[];
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));let row;
 const dom=new JSDOM(html,{url:'https://example.test/external-teacher-onboarding.html',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
  w.firebase={apps:[{}],app:()=>({})};w.APP_CONFIG={FIREBASE_CONFIG:{projectId:'mock'},FUNCTION_REGION:'asia-east1'};w.scrollTo=()=>{};w.HTMLCanvasElement.prototype.getContext=()=>({setTransform(){},clearRect(){}});
  w.fetch=async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);let result;
   if(url.endsWith('legacyTeacherTemplateHttp'))result={template:{},subjectCatalog:[{id:'g',name:'木吉他'}]};
   else if(url.endsWith('legacyTeacherCreateHttp')){assert.equal(body.record.bindingMethod,'email');row={...body.record,id:'p1',bindingCode:'test-code',emailBindStatus:'pending',lineBindStatus:'pending',status:'waiting_bindings'};result={record:row};}
   else result={record:{...row,emailBindStatus:'bound',status:'waiting_contract'}};
   return {ok:true,json:async()=>({ok:true,...result})};};
 }});
 await new Promise(r=>setTimeout(r,60));const w=dom.window,d=w.document;
 d.getElementById('name').value='測試老師';d.getElementById('mobile').value='0912345678';d.getElementById('email').value='teacher@example.test';
 w.setTeachingAbilities([{subjectId:'g',item:'木吉他',level:'專業'}]);d.getElementById('startBindingBtn').click();await new Promise(r=>setTimeout(r,30));
 assert(d.getElementById('step2').classList.contains('active'));assert.match(d.getElementById('bindingInstruction').textContent,/現在不需要貼 LINE 綁定碼/);assert(!d.querySelector('.codebox'));
 d.getElementById('checkBindingBtn').click();await new Promise(r=>setTimeout(r,30));assert(d.getElementById('step3').classList.contains('active'));
 w.showDone({registrationOnly:true,status:'submitted_pending_admin'});assert.match(d.getElementById('doneBox').textContent,/核准後會寄 Email/);assert(!d.querySelector('#doneBox a'));
 w.showDone({registrationOnly:true,status:'active',courseLoginReady:true});assert(d.querySelector('#doneBox a').href.endsWith('login.html?next=teacher-home.html'));assert.match(d.getElementById('doneBox').textContent,/六碼驗證碼/);assert.equal(d.getElementById('step4').hidden,true);assert.deepEqual(errors,[]);w.close();
 const source=fs.readFileSync('unified-login.js','utf8'),items=new Map(),calls=[];
 const context={global:{firebase:{auth:()=>({setPersistence:async()=>{},signInWithCustomToken:async()=>{}})},saveUser:()=>{},requestedLoginTarget:()=>'',loginDestination:()=> 'teacher-home.html',redirectToLoginTarget:url=>calls.push(['redirect',url])},localStorage:{setItem:(k,v)=>items.set(k,v)},sessionStorage:{removeItem:()=>{}},clearTicket:()=>{},call:async(name,payload,authenticated)=>{calls.push([name,payload,authenticated]);return {sessionToken:'verified-own-session'};}};
 context.global.firebase.auth.Auth={Persistence:{LOCAL:'local'}};vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  async function prepareTeacherEntry('),source.indexOf('  async function resumeSession('))+source.slice(source.indexOf('  async function finish('),source.indexOf('  let challenge=')),context);
 await context.finish({kind:'employee',token:'test-token',user:{identityType:'external',courseLoginReady:true}});
 assert.equal(calls[0][0],'personalWorkspace');assert.equal(calls[0][1].action,'open-role');assert.equal(calls[0][2],true);assert.equal(items.get('youzi.coursePortal.teacher.session.v1'),'verified-own-session');assert.equal(calls[1][0],'redirect');
 console.log('PASS new teacher Email-only registration, explicit waiting/approved screens, and authenticated own-course session before redirect');
})().catch(e=>{console.error(e);process.exitCode=1;});
