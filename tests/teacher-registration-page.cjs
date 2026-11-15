'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
for(const filename of ['external-teacher-onboarding.html','external-teacher-admin.html']){
 const html=fs.readFileSync(filename,'utf8');
 for(const match of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(match[1],{filename});
}
(async()=>{
 const errors=[],requests=[];
 const record={id:'test',name:'測試老師',mobile:'0912345678',lineBindStatus:'bound',status:'waiting_contract',idNumber:'A123456789',birthDate:'1990-01-01',householdAddress:'地址',mailingAddress:'地址',emergencyContact:'聯絡人',emergencyPhone:'0912345679',identityUrls:['https://example.invalid/private/id.jpg'],teachingAbilities:[{subjectId:'g',item:'木吉他',level:'專業'}]};
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const page=fs.readFileSync('external-teacher-onboarding.html','utf8').replace(/<script\b[^>]*\bsrc=[^>]*>[\s\S]*?<\/script>/gi,'');
 const dom=new JSDOM(page,{url:'https://example.invalid/external-teacher-onboarding.html',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
  w.firebase={apps:[{}],app:()=>({})};w.APP_CONFIG={FIREBASE_CONFIG:{projectId:'mock'},FUNCTION_REGION:'asia-east1'};
  w.HTMLCanvasElement.prototype.getContext=()=>({setTransform(){},clearRect(){}});w.scrollTo=()=>{};
  w.fetch=async(url,options)=>{
   const body=JSON.parse(options.body);requests.push({url,body});
   if(url.endsWith('legacyTeacherTemplateHttp'))return{ok:true,json:async()=>({ok:true,template:{},subjectCatalog:[{id:'g',name:'木吉他'}]})};
   if(url.endsWith('legacyTeacherReadHttp'))return{ok:true,json:async()=>({ok:true,record})};
   assert.match(url,/legacyTeacherUpdateHttp$/);assert.equal(body.action,'submit-profile');
   assert.equal(body.record.signatureUrl,undefined);assert.equal(body.record.contractHtmlUrl,undefined);assert.equal(body.record.bankAccountNumber,undefined);
   return{ok:true,json:async()=>({ok:true,record:{...record,...body.record,registrationOnly:true,status:'submitted_pending_admin',contractStatus:'not_requested'}})};
  };
 }});
 await new Promise(r=>setTimeout(r,100));
 const w=dom.window,d=w.document;w.fixture=record;
 w.eval("currentId='test';currentCode='test-token';currentRecord=fixture;loadRecordToForm(fixture);go(3);");
 assert.equal(d.getElementById('step4').hidden,true);
 const btn=d.getElementById('previewContractBtn');assert.match(btn.textContent,/送出老師資料/);btn.click();
 await new Promise(r=>setTimeout(r,80));
 assert(d.getElementById('step5').classList.contains('active'));
 assert.match(d.getElementById('doneBox').textContent,/本次沒有簽署契約/);
 assert.match(d.getElementById('doneBox').textContent,/銀行帳戶.*核准後/);
 assert.equal(requests.filter(r=>r.body.action==='submit-profile').length,1);
 assert.deepEqual(errors,[]);w.close();
 console.log('PASS complete page: step 3 click submits without signature/bank, shows review and bank instructions; both inline scripts parse');
})().catch(e=>{console.error(e);process.exitCode=1;});
