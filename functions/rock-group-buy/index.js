'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const admin=require('firebase-admin');
const {hash,fail,text,manager,sanitizeSettings,orderPlan,changeReservation}=require('./logic');
const {validateConsent}=require('./consent');
admin.initializeApp({projectId:'youzi-c1b74'});
const db=admin.firestore(),root=db.collection('clubGroupBuyPrivate').doc('rock-2026'),orders=root.collection('orders');
function publicConfig(c){return{title:c.title,intro:c.intro,open:c.open,revision:c.revision,roster:[],products:c.products.map(p=>({...p,remaining:p.unlimited||p.total===null?null:p.total-p.reserved}))};}
exports.rockGroupBuyApi=onRequest({region:'asia-east1',cors:['https://danny700808.github.io'],invoker:'public',maxInstances:5,timeoutSeconds:60,memory:'256MiB'},async(req,res)=>{
 res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({error:'請由團購頁面操作'});
 try{
  const {action,payload={}}=req.body||{};let isAdmin=false,uid='';
  const bearer=String(req.headers.authorization||'').replace(/^Bearer /,'');
  if(bearer){try{const t=await admin.auth().verifyIdToken(bearer,true);isAdmin=manager(t);uid=t.uid;}catch(e){fail('登入已失效，請重新登入',401);}}
  const snap=await root.get();if(!snap.exists)fail('團購資料準備中',503);const config=snap.data();
  if(!['catalog','submit','teacherLoad'].includes(action))fail('不支援的操作',404);
  const adminAction=['adminLoad','getConsent','saveSettings','updateOrder','cancelOrder'].includes(action);
  if(adminAction&&!isAdmin)fail('需要管理者登入',403);
  if(action==='catalog')return res.json({data:publicConfig(config),isAdmin});
  if(action==='teacherLoad'){
   if(!config.teacherPasswordHash||hash(String(payload.password||''))!==config.teacherPasswordHash)fail('密碼不正確',403);
   const rows=await orders.orderBy('createdAt','desc').limit(2000).get();
   return res.json({data:{...publicConfig(config),orders:rows.docs.map(d=>{const o=d.data();return{id:d.id,className:o.className,name:o.name,items:o.items,total:o.total,noPurchase:o.noPurchase,status:o.status,createdAt:o.createdAt};})}});
  }
  if(action==='adminLoad'){
const s=await orders.orderBy('createdAt','desc').limit(2000).get();return res.json({data:{...config,codeHash:undefined,orders:s.docs.map(d=>{const {consent,...o}=d.data();return{id:d.id,...o,consentSummary:consent?{parentName:consent.parentName,signedAt:consent.signedAt}:null};})}});}
  if(action==='getConsent'){const id=text(payload.id,80);if(!/^[a-zA-Z0-9_-]{16,80}$/.test(id))fail('登記編號無效');const o=await orders.doc(id).get();if(!o.exists)fail('找不到登記',404);return res.json({data:o.data().consent||null});}
  if(action==='saveSettings'){
   await db.runTransaction(async tx=>{const s=await tx.get(root),old=s.data();if(payload.revision!==old.revision)fail('資料剛有更新，請重新整理後再儲存',409);const next=sanitizeSettings(payload,old);delete next.clubCode;delete next.codeHash;next.updatedAt=new Date().toISOString();next.updatedBy=uid;tx.set(root,next);});return res.json({ok:true});
  }
  if(action==='submit'){
   const requestId=text(payload.requestId,80);if(!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId))fail('送單識別碼無效');
   const freeClass=text(payload.className,140),freeName=text(payload.name,60);const ref=orders.doc(requestId),memberId=hash(freeClass+'\n'+freeName).slice(0,32);if(!freeClass||!freeName)fail('請填寫班級姓名');if(!/^[a-f0-9]{32}$/.test(memberId))fail('請選擇姓名');
   if(payload.noPurchase!==true&&(!Array.isArray(payload.items)||!payload.items.length||payload.items.length>3||payload.items.some(p=>p.quantity!==1)))fail('每位同學最多選一把樂器、一台音箱及一款鼓棒');
   const consent=validateConsent(payload.consent,payload.noPurchase);
   const fingerprint=hash(JSON.stringify({memberId,items:payload.items,noPurchase:payload.noPurchase,consent}));
   const result=await db.runTransaction(async tx=>{
    const [cs,os,ms]=await Promise.all([tx.get(root),tx.get(ref),tx.get(root.collection('members').doc(memberId))]);const c=cs.data();
    if(os.exists){if(os.data().fingerprint!==fingerprint)fail('送單資料不同，請重新送出',409);return{id:ref.id,total:os.data().total};}
    if(!c.open)fail('目前尚未開放填單');if(ms.exists&&ms.data().activeOrder)fail('這位社員已填過表單，若需修改請聯絡老師',409);
    if(payload.noPurchase!==true){const selected=payload.items.map(i=>c.products.find(p=>p.id===i.id));if(selected.some(p=>!p)||selected.filter(p=>p.kind==='amp').length>1||selected.filter(p=>['guitar','bass'].includes(p.kind)).length>1||selected.filter(p=>p.kind==='drumsticks').length>1)fail('每位同學最多選一把樂器、一台音箱及一款鼓棒');if(selected.some(p=>p.kind==='amp')&&consent.version!=='2026-10-02-v2')fail('請重新整理頁面並確認音箱選購內容');}
    const validationConfig={...c,roster:[{id:memberId,className:freeClass,name:freeName}]};const plan=orderPlan(validationConfig,memberId,payload.items,payload.noPurchase);changeReservation(c,plan.items,1);
    if(consent&&payload.expectedTotal!==plan.total)fail('商品價格已更新，請重新確認金額並簽名',409);
    const order={...plan,consent:consent?{...consent,signedAt:new Date().toISOString(),className:plan.className,studentName:plan.name,total:plan.total,items:plan.items.map(p=>({...p,description:c.products.find(x=>x.id===p.id).description}))}:null,status:'active',fingerprint,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    tx.set(root,c);tx.create(ref,order);tx.set(root.collection('members').doc(memberId),{activeOrder:ref.id});return{id:ref.id,total:order.total};
   });return res.json({data:result});
  }
  if(action==='cancelOrder'||action==='updateOrder'){
   const id=text(payload.id,80);if(!/^[a-zA-Z0-9_-]{16,80}$/.test(id))fail('訂單編號無效');
   await db.runTransaction(async tx=>{const [cs,os]=await Promise.all([tx.get(root),tx.get(orders.doc(id))]);if(!os.exists)fail('找不到訂單',404);const c=cs.data(),o=os.data();if(o.status==='cancelled'){if(action==='cancelOrder')return;fail('訂單已取消');}
    if(payload.updatedAt&&payload.updatedAt!==o.updatedAt)fail('訂單已被更新，請重新整理',409);
    if(action==='cancelOrder'){changeReservation(c,o.items,-1);tx.set(root,c);tx.update(orders.doc(id),{status:'cancelled',updatedAt:new Date().toISOString(),updatedBy:uid});tx.set(root.collection('members').doc(o.memberId),{activeOrder:null});}
    else{const patch={updatedAt:new Date().toISOString(),updatedBy:uid};if(payload.items){const prior=o.items.map(({id,quantity})=>({id,quantity})).sort((a,b)=>a.id.localeCompare(b.id));const next=payload.items.map(({id,quantity})=>({id,quantity})).sort((a,b)=>a.id.localeCompare(b.id));if(JSON.stringify(prior)!==JSON.stringify(next)||payload.noPurchase!==o.noPurchase)fail('更改選購內容需由家長重新同意，請取消原登記後重新填寫');if(o.consent)return;changeReservation(c,o.items,-1);const plan=orderPlan({...c,roster:[{id:o.memberId,className:o.className,name:o.name}]},o.memberId,payload.items,payload.noPurchase);changeReservation(c,plan.items,1);Object.assign(patch,plan);tx.set(root,c);}tx.update(orders.doc(id),patch);}
   });return res.json({ok:true});
  }
  fail('不支援的操作',404);
 }catch(e){if(!e.status)console.error('group-buy',e.code||e.message);res.status(e.status||500).json({error:e.status?e.message:'暫時無法完成，請稍後重試'});}
});
