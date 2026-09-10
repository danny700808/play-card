const {test}=require('node:test');
const assert=require('node:assert/strict'), fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('functions/coursePortal.js','utf8');
const code=source.slice(source.indexOf('async function studentBindingAccounts('),source.indexOf('async function updateStudentReminder('));
function fixture(){
 const rows={own:{studentId:'a',lineUserId:'me',status:'active'},peer:{studentId:'a',lineUserId:'other',status:'active'},second:{studentId:'b',lineUserId:'me',status:'active'}};
 const writes=[],notices=[];
 const docs=Object.entries(rows).map(([id,row])=>({id,data:()=>row,exists:true,ref:{id}}));
 const ctx={clean:v=>String(v||''),requireSession:async()=>({role:'student'}),activeStudentBindingsForSession:async()=>docs.filter(d=>d.data().lineUserId==='me'&&d.data().status==='active').map(d=>({...d.data(),__id:d.id,__ref:d.ref})),
  db:{collection:name=>{let filters=[];return {where(k,op,v){filters.push([k,v]);return this},async get(){return {docs:name==='coursePortalStudentBindings'?docs.filter(d=>filters.every(([k,v])=>d.data()[k]===v)):[]}}}},runTransaction:async fn=>fn({get:async ref=>docs.find(d=>d.id===ref.id),set:(ref,value)=>{writes.push(ref.id);Object.assign(rows[ref.id],value)}})},
  HttpsError:class extends Error{},FieldValue:{serverTimestamp:()=>0,arrayUnion:x=>[x]},recipientFields:r=>r,randomToken:()=>'',queueCoursePortalNotice:async(...x)=>notices.push(x)};
 vm.createContext(ctx);vm.runInContext(code,ctx);return {ctx,rows,writes,notices};
}
test('self removal requires confirmation and affects only own selected student binding',async()=>{
 const f=fixture();await assert.rejects(f.ctx.studentBindingAccounts({studentId:'a',action:'remove-self'}));assert.equal(f.writes.length,0);
 await f.ctx.studentBindingAccounts({studentId:'a',bindingId:'peer',action:'remove-self',confirmed:true});
 assert.deepEqual(f.writes,['own']);assert.equal(f.rows.peer.status,'active');assert.equal(f.rows.second.status,'active');assert.equal(f.rows.own.revokedReason,'self-unbound');assert.equal(f.notices.length,0);
 await assert.rejects(f.ctx.studentBindingAccounts({studentId:'a',action:'remove-self',confirmed:true}));
});
test('peer removal continues to notify; cannot remove own binding through peer action',async()=>{
 const f=fixture();await assert.rejects(f.ctx.studentBindingAccounts({studentId:'a',bindingId:'own',action:'remove',confirmed:true}));
 await f.ctx.studentBindingAccounts({studentId:'a',bindingId:'peer',action:'remove',confirmed:true});assert.deepEqual(f.writes,['peer']);assert.equal(f.notices.length,1);
});
