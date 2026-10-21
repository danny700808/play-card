'use strict';
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const equal = (a,b) => /^[a-f0-9]{64}$/.test(a||'') && /^[a-f0-9]{64}$/.test(b||'') &&
  crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const fail = (message,status=400) => {const e=new Error(message);e.status=status;throw e;};
const commands = new Set(['refresh','preview','process','handling','document-link','print-event']);
const validKey = key => /^(?:(?:EasyStore|Coupang):\d{1,30}|MOMO:\d{1,30}:\d{1,6}(?:,\d{1,6}){0,99})$/.test(key||'');

function validateCommand(action,body={}) {
  if(!commands.has(action))fail('此入口只能處理包貨與列印。',403);
  if(action==='refresh')return {days:3};
  if(!validKey(body.key))fail('訂單編號不正確。');
  const result={key:body.key};
  if(action==='handling'){
    if(!['printed','shipped','processed','reopen'].includes(body.action))fail('處理狀態不正確。');
    result.action=body.action;
  }
  if(['preview','process'].includes(action)){
    const opts=body.options||{};
    result.options={};
    for(const key of ['carrier','outboundShippingPlaceCode','returnCenterCode']){
      const value=String(opts[key]||'');
      if(value.length>80||!/^[A-Za-z0-9_-]*$/.test(value))fail('物流資料不正確。');
      result.options[key]=value;
    }
    if(action==='process'){
      if(!/^[a-f0-9]{64}$/.test(body.fingerprint||''))fail('請重新核對訂單。');
      result.fingerprint=body.fingerprint;
    }
  }
  return result;
}

function createAccess({db,now=Date.now,requireManager}){
  const cfgRef=db.collection('shippingDeskPrivate').doc('config');
  const stateRef=db.collection('shippingDeskPrivate').doc('state');
  const sessionRef=token=>db.collection('shippingDeskSessions').doc(hash(token));
  const jobRef=id=>db.collection('shippingDeskJobs').doc(id);
  async function settings(){const s=(await cfgRef.get()).data();if(!s||s.enabled!==true)fail('包貨入口尚未開放。',503);return s;}
  async function rateLimit(ip){
    const ref=db.collection('shippingDeskLimits').doc(hash(ip||'unknown')),time=now();
    await db.runTransaction(async tx=>{
      const r=(await tx.get(ref)).data()||{},recent=time-r.startedAt<15*60000,count=recent?r.count:0;
      if(count>=12)fail('密碼嘗試次數過多，請 15 分鐘後再試。',429);
      tx.set(ref,{startedAt:recent?r.startedAt:time,count:count+1,expiresAt:new Date(time+30*60000)});
    });
  }
  async function login(password,remember,ip){
    await rateLimit(ip);
    const cfg=await settings();
    if(typeof password!=='string'||password.length>200)fail('密碼不正確。',401);
    const derived=(await scrypt(password,cfg.passwordSalt,32)).toString('hex');
    if(!equal(derived,cfg.passwordHash))fail('密碼不正確。',401);
    const token=crypto.randomBytes(32).toString('base64url'),expiresAtMs=now()+(remember?90*86400000:8*3600000);
    await sessionRef(token).set({scope:'packing',version:cfg.version,expiresAtMs,expiresAt:new Date(expiresAtMs)});
    return {token,expiresAtMs};
  }
  async function session(token){
    // Portal requests use their existing Firebase identity, checked on every request.
    if(typeof token==='string'&&token.split('.').length===3&&requireManager){
      const claims=await requireManager({headers:{authorization:'Bearer '+token}});
      const cfg=await settings();
      if(!claims.uid||!Number.isFinite(claims.exp)||claims.exp*1000<=now())fail('系統登入已失效，請重新登入系統。',401);
      const id=hash('system:'+claims.uid+':'+claims.auth_time);
      const record={scope:'packing',source:'system',uid:claims.uid,version:cfg.version,
        expiresAtMs:claims.exp*1000,expiresAt:new Date(claims.exp*1000)};
      await db.collection('shippingDeskSessions').doc(id).set(record);
      return {id,...record};
    }
    if(!/^[A-Za-z0-9_-]{43}$/.test(token||''))fail('請輸入包貨密碼。',401);
    return sessionByHash(hash(token));
  }
  async function sessionByHash(id){
    const [cfg,doc]=await Promise.all([settings(),db.collection('shippingDeskSessions').doc(id).get()]);
    const r=doc.data();
    if(!r||r.scope!=='packing'||r.revoked||r.expiresAtMs<=now()||r.version!==cfg.version)fail('登入已失效，請重新輸入密碼。',401);
    return {id,...r};
  }
  async function logout(token){await session(token);await sessionRef(token).set({revoked:true},{merge:true});return {ok:true};}
  async function agent(key){const cfg=await settings();if(!equal(hash(key||''),cfg.agentHash))fail('Agent authentication required',403);}
  async function orders(token){
    await session(token);
    const r=(await stateRef.get()).data()||{};
    const online=now()-(r.agentSeenAt||0)<90000;
    return {...(r.snapshot||{orders:[],errors:{},connectors:[],days:3}),agentOnline:online,remote:true};
  }
  async function enqueue(token,data){
    const owner=await session(token),body=validateCommand(data.command,data.body);
    if(!/^[a-zA-Z0-9_-]{16,100}$/.test(data.requestId||''))fail('請重新操作。');
    const state=(await stateRef.get()).data()||{};
    if(now()-(state.agentSeenAt||0)>90000)fail('店內主機未連線，請先開啟主機的出貨工作台。',503);
    const fingerprint=hash(JSON.stringify([data.command,body]));
    const id=hash(owner.id+'|'+data.requestId),ref=jobRef(id);
    await db.runTransaction(async tx=>{
      const old=(await tx.get(ref)).data();
      if(old){if(old.fingerprint!==fingerprint)fail('同一操作不能變更內容。',409);return;}
      tx.set(ref,{owner:owner.id,version:owner.version,command:data.command,body,fingerprint,
        status:'queued',createdAtMs:now(),expiresAtMs:now()+10*60000,expiresAt:new Date(now()+86400000)});
    });
    return {jobId:id};
  }
  async function result(token,id){
    const owner=await session(token);
    if(!/^[a-f0-9]{64}$/.test(id||''))fail('工作不存在。',404);
    const r=(await jobRef(id).get()).data();
    if(!r||r.owner!==owner.id)fail('工作不存在。',404);
    if(r.expiresAtMs<=now())fail('操作逾時，請重新讀取訂單確認結果。',409);
    return {status:r.status,result:r.result,error:r.error};
  }
  async function poll(key){
    await agent(key);
    await stateRef.set({agentSeenAt:now()},{merge:true});
    const docs=(await db.collection('shippingDeskJobs').where('status','==','queued').limit(20).get()).docs;
    for(const doc of docs){
      const initial=doc.data();
      if(initial.expiresAtMs<=now()){await doc.ref.set({status:'error',error:'操作已過期，請重新操作。'},{merge:true});continue;}
      try{await sessionByHash(initial.owner);}catch(e){await doc.ref.set({status:'error',error:'登入已失效，操作未執行。'},{merge:true});continue;}
      const claimed=await db.runTransaction(async tx=>{
        const r=(await tx.get(doc.ref)).data();
        if(r.status!=='queued')return null;
        const claim=crypto.randomBytes(24).toString('base64url');
        tx.update(doc.ref,{status:'running',claim,startedAtMs:now()});
        return {id:doc.id,command:r.command,body:r.body,claim};
      });
      if(claimed)return {job:claimed};
    }
    return {job:null};
  }
  async function updateSnapshot(key,snapshot){
    await agent(key);
    if(!snapshot||!Array.isArray(snapshot.orders)||JSON.stringify(snapshot).length>850000)fail('Snapshot too large');
    await stateRef.set({snapshot,agentSeenAt:now()},{merge:true});
  }
  async function claimed(key,id,claim){
    await agent(key);
    if(!/^[a-f0-9]{64}$/.test(id||''))fail('Invalid job');
    const ref=jobRef(id),r=(await ref.get()).data();
    if(!r||!['running','done','error'].includes(r.status)||r.claim!==claim)fail('Invalid claim',409);
    return {ref,row:r};
  }
  async function complete(key,id,claim,result,error,extra={}){
    const {ref}=await claimed(key,id,claim);
    if(JSON.stringify(result||{}).length>850000)fail('Result too large');
    await ref.set({status:error?'error':'done',result:result||{},error:error||'',completedAtMs:now(),
      expiresAtMs:now()+3600000,...extra},{merge:true});
    return {ok:true};
  }
  async function document(id,ticket){
    if(!/^[a-f0-9]{64}$/.test(id||'')||!/^[A-Za-z0-9_-]{43}$/.test(ticket||''))fail('文件連結無效。',403);
    const r=(await jobRef(id).get()).data();
    if(!r||r.status!=='done'||r.expiresAtMs<=now()||!equal(hash(ticket),r.documentTicketHash))fail('文件連結已失效，請重新開啟。',403);
    await sessionByHash(r.owner);
    return r;
  }
  return {login,session,logout,agent,orders,enqueue,result,poll,updateSnapshot,claimed,complete,document};
}
module.exports={createAccess,validateCommand,hash};
