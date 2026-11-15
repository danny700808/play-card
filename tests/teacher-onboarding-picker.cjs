const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');const {JSDOM}=require('jsdom');
const html=fs.readFileSync('external-teacher-onboarding.html','utf8');
const dom=new JSDOM('<div id="teachingAbilityRows"></div><input id="teachingItems">');
const code=html.slice(html.indexOf('function textValue('),html.indexOf('async function createOrResumeBinding'));
const c=vm.createContext({document:dom.window.document,teachingSubjectCatalog:[{id:'jazz',name:'爵士鼓'},{id:'box',name:'木箱鼓'}],esc:s=>String(s),clearFieldError(){},saveDraft(){}});vm.runInContext(code,c);
vm.runInContext("setTeachingAbilities([{subjectId:'jazz',item:'爵士鼓',level:'專業'}]);",c);
assert.equal(dom.window.document.querySelector('.teaching-ability-item').tagName,'SELECT');
assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('getTeachingAbilities()',c))),[{subjectId:'jazz',item:'爵士鼓',level:'專業'}]);
vm.runInContext("addTeachingAbilityRow({subjectId:'box',item:'木箱鼓',level:'普通'});",c);assert.equal(vm.runInContext('getTeachingAbilities().length',c),2);
vm.runInContext("setTeachingAbilities([{item:'鼓',level:'專業'}]);",c);assert.equal(vm.runInContext('getTeachingAbilities().length',c),0);assert.match(dom.window.document.querySelector('select').textContent,/原資料「鼓」請重新選擇/);
vm.runInContext("setTeachingAbilities([]);",c);assert.equal(dom.window.document.querySelector('.teaching-ability-level').value,'');
console.log('PASS onboarding picker: official IDs and levels, multiple subjects, unresolved legacy warning, explicit level selection');

(async()=>{
 const errors=[],requests=[];
 const page=html.replace(/<script\b[^>]*\bsrc=[^>]*>[\s\S]*?<\/script>/gi,'');
 const {VirtualConsole}=require('jsdom');const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));vc.on('warn',e=>console.log('PAGE WARNING',e));
 const full=new JSDOM(page,{url:'https://example.invalid/external-teacher-onboarding.html',runScripts:'dangerously',virtualConsole:vc,beforeParse(w){
  w.firebase={apps:[{}],app:()=>({})};w.APP_CONFIG={FIREBASE_CONFIG:{projectId:'mock'},FUNCTION_REGION:'asia-east1'};
  w.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});assert.match(url,/legacyTeacherTemplateHttp$/);return{ok:true,json:async()=>({ok:true,template:{},subjectCatalog:[{id:'g',name:'木吉他'},{id:'d',name:'爵士鼓'}]})};};
  w.HTMLCanvasElement.prototype.getContext=()=>({setTransform(){},clearRect(){}});w.scrollTo=()=>{};
 }});
 await new Promise(r=>setTimeout(r,80));const d=full.window.document;
 assert.deepEqual(errors,[]);assert.equal(d.querySelectorAll('.teaching-row').length,1);
 assert.equal(d.querySelector('.teaching-ability-item').options.length,3,d.getElementById('startMsg').textContent+' requests='+JSON.stringify(requests));
 const add=d.querySelector('[onclick="addTeachingAbilityRow()"]');add.click();assert.equal(d.querySelectorAll('.teaching-row').length,2);
 d.querySelectorAll('.teaching-remove')[1].click();assert.equal(d.querySelectorAll('.teaching-row').length,1);
 d.querySelector('.teaching-ability-item').value='g';d.querySelector('.teaching-ability-level').value='專業';
 assert.deepEqual(JSON.parse(JSON.stringify(full.window.getTeachingAbilities())),[{subjectId:'g',item:'木吉他',level:'專業'}]);
 assert.equal(requests.length,1);assert.deepEqual(errors,[]);full.window.close();
 console.log('PASS full onboarding page: initialization, catalog request, real add/remove clicks and subject+level payload; no registration submitted');
})().catch(e=>{console.error(e);process.exitCode=1;});


