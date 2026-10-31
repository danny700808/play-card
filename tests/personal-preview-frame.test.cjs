'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
test('isolated teacher preview keeps original markup, virtualizes navigation and storage, and disables submits',async()=>{
 const dom=new JSDOM('<main id="root"></main>',{url:'https://danny700808.github.io/play-card/dashboard.html',runScripts:'outside-only'}),w=dom.window;
 w.localStorage.setItem('employeeUser','manager-session');
 const source='<html><head><script src="config.js"></script></head><body><h1>現有老師畫面</h1><button type="button">課表</button><form><button>送出</button></form></body></html>';
 w.fetch=async url=>({ok:true,text:async()=>url.endsWith('config.js')?"window.pageName=location.pathname;window.saved=localStorage.getItem('employeeUser');":source});
 w.eval(fs.readFileSync('personal-preview-frame.js','utf8'));
 await w.PersonalPreviewFrame.open({container:w.document.getElementById('root'),page:'teacher-course-portal.html',user:{id:'selected',portalSessionBridge:true},read:async()=>({ok:true})});
 const frame=w.document.querySelector('iframe');assert.equal(frame.getAttribute('sandbox'),'allow-scripts');assert.match(frame.srcdoc,/現有老師畫面/);assert.equal(w.localStorage.getItem('employeeUser'),'manager-session');
 const child=new JSDOM(frame.srcdoc,{url:'https://isolated.test/',runScripts:'dangerously'});await new Promise(r=>setTimeout(r,10));
 assert.equal(child.window.pageName,'/play-card/teacher-course-portal.html');assert.equal(JSON.parse(child.window.saved).id,'selected');assert.equal(child.window.document.querySelector('form button').disabled,true);assert.equal(child.window.document.querySelector('button[type=button]').disabled,false);
 assert.equal(child.window.localStorage.getItem('youzi.coursePortal.authStateMigration.20260805.v1'),'done');
 w.PersonalPreviewFrame.close();child.window.close();dom.window.close();
});
