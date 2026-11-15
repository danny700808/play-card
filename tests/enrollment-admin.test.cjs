'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM,VirtualConsole}=require('jsdom');
test('admin inbox requires manager session, creates invitation, escapes details, and explicitly admits student',async()=>{
 const errors=[],calls=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(fs.readFileSync('enrollment-admin.html','utf8'),{url:'https://danny700808.github.io/play-card/enrollment-admin.html',runScripts:'outside-only',virtualConsole:vc});
 const w=dom.window,d=w.document,$=id=>d.getElementById(id);let authorized=0,admitted=false;
 const row=()=>({id:'enr-fixture',version:admitted?2:1,status:admitted?'admitted':'received',createdAt:Date.now(),form:{name:'<img src=x onerror=alert(1)>',secondName:'',courseName:'鋼琴',optionName:'單人班',phone:'0912345678',email:'test@example.invalid',price:'2800～3000',lessons:4,date:'2026-11-21',time:'13:00',note:'<script>bad</script>'},line:{lineUserId:'U'+'a'.repeat(32),lineDisplayName:'測試 LINE',lineFriendFlag:true},messages:[],managerNote:'',studentIds:admitted?['new-student']:[]});
 w.YZManagerAuth={requireManager:async()=>{authorized++;}};
 w.firebase={app:()=>({functions:region=>{assert.equal(region,'asia-east1');return {httpsCallable:name=>{assert.equal(name,'enrollmentAdmin');return async data=>{calls.push(data);let result;
  if(data.action==='list')result={records:[row()],nextCursor:''};
  else if(data.action==='invites')result={invites:[]};
  else if(data.action==='createInvite')result={url:'https://danny700808.github.io/play-card/enrollment.html#invite='+'x'.repeat(43)};
  else if(data.action==='detail')result={record:row(),matches:[]};
  else if(data.action==='admit'){assert.deepEqual(Array.from(data.studentIds),['new']);admitted=true;result={studentIds:['new-student']};}
  else throw Error('Unexpected operation '+data.action);
  return {data:result};
 };}};}})};
 w.confirm=()=>true;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const settled=async()=>{for(let n=0;n<10;n++)await new Promise(r=>setImmediate(r));};
 w.eval(fs.readFileSync('enrollment-admin.js','utf8'));await settled();assert.match($('notice').textContent,/1 份/);assert.equal($('records').querySelectorAll('img').length,0);
 $('createInvite').click();await settled();assert.match($('inviteUrl').value,/#invite=/);assert.equal($('openInvite').href,$('inviteUrl').value);
 d.querySelector('[data-open]').click();await settled();assert($('detailDialog').open);assert.equal($('detailContent').querySelectorAll('script,img').length,0);assert.match($('detailContent').textContent,/2800～3000/);
 $('admit').click();await settled();assert(admitted);assert.equal($('admit'),null);assert.match($('detailNotice').textContent,/建檔完成/);assert.equal(authorized,calls.length);assert(!calls.some(c=>c.action==='message'));assert.deepEqual(errors,[]);w.close();
});
test('native form loads all course image assets from its own asset directory and private data collections are not client allowlisted',()=>{
 const html=fs.readFileSync('enrollment.html','utf8'),js=fs.readFileSync('enrollment-assets/app.js','utf8');
 assert.match(html,/src="enrollment-assets\/app.js"/);assert.match(js,/document.currentScript/);assert(!html.includes('lineDialog'));assert.match(html,/id="accessPanel"/);
 for(let n=1;n<=23;n++)assert(fs.existsSync('enrollment-assets/assets/course-'+String(n).padStart(2,'0')+'.jpg'));
 const rules=fs.readFileSync('firestore.rules','utf8');assert(!/onlineEnrollment/.test(rules));assert.match(rules,/match \/\{document=\*\*\} \{\s+allow read, write: if false;/);
 const routes=require('../internal-workspace-routes');assert.deepEqual(routes.pageContext('/enrollment-admin.html','','').map(n=>n.id),['root','enrollment','online-enrollment']);
});
