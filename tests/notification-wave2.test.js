const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {queueBlockReason,deletedPersonMatches}=require('../functions/notificationDeliveryGuard');
const goods=require('../functions/goodsInquiryNotifications');
test('cancelled and sent notices cannot be forced through; old retries expire but future schedules survive',()=>{
 for(const status of ['cancelled','已取消','已發送','sent','已轉寄Email']) assert.ok(queueBlockReason({status}));
 const now=Date.now();assert.ok(queueBlockReason({status:'發送失敗',createdAt:new Date(now-8*86400000).toISOString()},now));
 assert.equal(queueBlockReason({status:'待發送',createdAt:new Date(now-8*86400000).toISOString(),sendAfterAt:new Date(now+86400000).toISOString()},now),'');
 assert.equal(queueBlockReason({status:'待發送',createdAt:new Date(now).toISOString()},now),'');
});
test('deleted people are detected in legacy approval links without matching names',()=>{
 const tomb={teacherIds:['teacher-removed-123'],employeeIds:['employee-123']};
 assert.ok(deletedPersonMatches({body:'https://example.test/?contractId=teacher-removed-123'},tomb));
 assert.ok(deletedPersonMatches({employeeId:'employee-123'},tomb));
 assert.equal(deletedPersonMatches({targetName:'teacher-removed-123'},tomb),false);
});
test('inquiry notifications fire for new inquiry or changed reply, not status edits, identical saves or deletes',()=>{
 const row={status:'待處理',itemName:'琴弦'};
 assert.equal(goods.inquiryEvent(null,row),'submitted');
 assert.equal(goods.inquiryEvent(row,{...row,replyNote:'有現貨',status:'已回覆'}),'replied');
 assert.equal(goods.inquiryEvent(row,{...row,status:'已完成'}),'');
 assert.equal(goods.inquiryEvent({...row,replyNote:'有現貨'},{...row,replyNote:'有現貨',repliedAt:123}),'');
 assert.equal(goods.inquiryEvent(row,null),'');
 assert.equal(goods.inquiryEvent(null,{...row,deleted:true}),'');
});
test('inquiry trigger retries create only one queue and do not send any real message',async()=>{
 const src=fs.readFileSync('functions/goodsInquiryNotifications.js','utf8');
 const context={module:{exports:{}},require:n=>n==='firebase-functions/v2/firestore'?{onDocumentWritten:(_,fn)=>fn}:n==='crypto'?require(n):require('../functions/'+n.replace('./',''))};
 vm.runInNewContext(src,context);
 const queues=new Map();const row={teacherId:'teacher-1',userId:'staff-1',itemName:'琴弦',quantity:'2',teacherName:'測試老師',status:'待處理'};
 const ref={kind:'inquiry'};
 const db={collection:n=>({get:async()=>({docs:[]}),doc:id=>({id,kind:n})}),runTransaction:async fn=>fn({get:async r=>r===ref?{exists:true,data:()=>row}:{exists:queues.has(r.id)},create:(r,d)=>queues.set(r.id,d)})};
 const out={};context.module.exports.registerGoodsInquiryNotifications(out,{db,admin:{firestore:{FieldValue:{serverTimestamp:()=>123}}},managerRecipient:async()=>({employeeId:'manager',lineUserId:'line-test',email:'owner@example.test'})});
 const event={params:{inquiryId:'test-1'},data:{before:{exists:false},after:{exists:true,data:()=>row,ref}}};
 await out.teacherGoodsInquiryNotification(event);await out.teacherGoodsInquiryNotification(event);
 assert.equal(queues.size,1);const q=[...queues.values()][0];assert.equal(q.channel,'line');assert.equal(q.emailFallbackEnabled,true);assert.match(q.body,/數量：2/);
});
test('all automatic feature notices choose one channel, manual choices remain explicit',async()=>{
 const source=fs.readFileSync('firebase-client.js','utf8'),start=source.indexOf('  async function queueManualNotification(payload){'),end=source.indexOf('\n  function ',start),writes=[];
 const ctx={clean:v=>String(v??'').trim(),lower:v=>String(v??'').trim().toLowerCase(),currentUser:()=>({}),serverTs:()=>0,docSet:async(c,id,row)=>writes.push({c,row})};vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 await ctx.queueManualNotification({page:'auto:clock',message:'補打卡申請',channels:['line','email'],targets:[{employeeId:'manager',lineUserId:'line-test',email:'owner@example.test'}]});
 assert.equal(writes.filter(x=>x.c==='notificationQueue').length,1);
 assert.equal(writes.find(x=>x.c==='notificationQueue').row.emailFallbackEnabled,true);
});
