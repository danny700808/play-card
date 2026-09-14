'use strict';

// Login bindings are separate from the legacy notification address book.
// An existing LINE notification address is never proof of employee ownership.
const { HttpsError } = require('firebase-functions/v2/https');
const { findAccount, normalizeUser, accountStatus, isManager } = require('./employeeAuth');

function createUnifiedLogin(deps) {
  const {db, auth, hash, randomToken, Timestamp, FieldValue, now = Date.now} = deps;
  const clean = value => String(value == null ? '' : value).trim();
  const active = row => ['active','enabled','啟用','是'].includes(accountStatus(row));
  const bindingRef = lineId => db.collection('employeeLoginBindings').doc(hash('line-login|' + lineId));
  const ticketRef = token => {
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(clean(token))) throw new HttpsError('unauthenticated','登入連結已失效，請重新使用 LINE 登入。');
    return db.collection('unifiedLoginTickets').doc(hash(token));
  };
  function checkTicket(snapshot) {
    const row = snapshot.exists ? snapshot.data() : null;
    if (!row || Number(row.expiresAtMs) <= now() || row.status !== 'pending') throw new HttpsError('unauthenticated','登入連結已失效，請重新使用 LINE 登入。');
    return row;
  }
  async function issue(profile, options = {}) {
    if (!/^[a-f0-9]{64}$/.test(clean(options.challenge))) throw new HttpsError('invalid-argument','登入驗證資料不完整，請重新開啟入口。');
    const ticket = randomToken(32);
    await ticketRef(ticket).set({profile, challenge:options.challenge, forceEmployeeLink:options.forceEmployeeLink===true, status:'pending',expiresAtMs:now()+10*60*1000,expiresAt:Timestamp.fromMillis(now()+10*60*1000),createdAt:FieldValue.serverTimestamp()});
    return ticket;
  }
  async function employeeAccount(binding) {
    if (!binding || binding.active === false || !['admins','employees'].includes(binding.collection)) return null;
    const doc = await db.collection(binding.collection).doc(binding.documentId).get();
    if (!doc.exists || !active(doc.data())) return null;
    const account = {collection:binding.collection,id:doc.id,ref:doc.ref,data:doc.data()};
    const user = normalizeUser(account);
    const firebaseUser = await auth.getUser(binding.uid).catch(() => null);
    if (!firebaseUser || firebaseUser.disabled || !firebaseUser.customClaims || firebaseUser.customClaims.employee !== true || clean(firebaseUser.customClaims.employeeId) !== user.employeeId) return null;
    return {account,user,firebaseUser};
  }
  async function status(data) {
    const row = checkTicket(await ticketRef(data.ticket).get());
    checkProof(row,data.proof);
    const choices = [];
    const binding = await bindingRef(row.profile.lineUserId).get();
    if (binding.exists) {
      const employee = await employeeAccount(binding.data());
      if (employee) choices.push({id:'employee',label:employee.user.identityLabel+'｜'+employee.user.name});
    }
    for (const role of ['teacher','student','renter']) {
      const decision = deps.decideLineLoginBinding(role,await deps.bindingsForLine(role,row.profile.lineUserId));
      if (decision.action === 'login') choices.push({id:role,label:{teacher:'老師課務',student:'學生／家長',renter:'教室租用'}[role]});
    }
    if (!choices.length && deps.findPortalAccount) {
      const saved = await db.collection('unifiedPortalEmailBindings').doc(hash('line-login|'+row.profile.lineUserId)).get();
      if (saved.exists && await deps.findPortalAccount(saved.data().role,saved.data().email)) choices.push({id:'email-portal',label:'進入系統'});
    }
    return {ok:true,choices,forceEmployeeLink:row.forceEmployeeLink===true};
  }
  async function link(data, request) {
    const caller = request && request.auth;
    const claims = caller && caller.token || {};
    if (!caller || claims.employee !== true || !claims.firebase || claims.firebase.sign_in_provider !== 'password' || !Number(claims.auth_time) || now()/1000-Number(claims.auth_time)>600) throw new HttpsError('unauthenticated','請先用原本的 Email 與密碼登入，再完成 LINE 綁定。');
    const account = await findAccount(db,clean(claims.email).toLowerCase());
    if (!account || !active(account.data)) throw new HttpsError('permission-denied','這個員工帳號尚未啟用。');
    const user = normalizeUser(account);
    if (user.passwordResetRequired || clean(claims.employeeId)!==user.employeeId) throw new HttpsError('permission-denied','請先確認帳號身分並完成密碼更新。');
    const firebaseUser = await auth.getUser(caller.uid);
    if (firebaseUser.disabled || clean(firebaseUser.email).toLowerCase()!==clean(user.email).toLowerCase()) throw new HttpsError('permission-denied','登入身分不一致。');
    const ref=ticketRef(data.ticket),reverseRef=db.collection('employeeLoginOwners').doc(caller.uid);
    const snapshot=await ref.get(),row=checkTicket(snapshot),lineRef=bindingRef(row.profile.lineUserId);
    checkProof(row,data.proof);
    await db.runTransaction(async tx=>{
      checkTicket(await tx.get(ref));
      const existing=await tx.get(lineRef),reverse=await tx.get(reverseRef);
      if(existing.exists&&existing.data().uid!==caller.uid)throw new HttpsError('already-exists','這個 LINE 已綁定其他員工帳號，請先核對原有帳號。');
      if(reverse.exists&&reverse.data().lineKey!==lineRef.id)throw new HttpsError('already-exists','此員工帳號已綁定其他 LINE，請先解除原綁定。');
      tx.set(lineRef,{uid:caller.uid,collection:account.collection,documentId:account.id,active:true,linkedAt:FieldValue.serverTimestamp()});
      tx.set(reverseRef,{lineKey:lineRef.id,linkedAt:FieldValue.serverTimestamp()});
      tx.update(ref,{status:'used',usedAt:FieldValue.serverTimestamp()});
    });
    return {ok:true,user};
  }
  async function redeem(data) {
    const ref=ticketRef(data.ticket),row=checkTicket(await ref.get()),choice=clean(data.choice);
    checkProof(row,data.proof);
    let result;
    if(choice==='employee'){
      const binding=await bindingRef(row.profile.lineUserId).get();
      const employee=await employeeAccount(binding.exists?binding.data():null);
      if(!employee)throw new HttpsError('permission-denied','請先用原帳密綁定 LINE；已停用的帳號無法登入。');
      const {account,user,firebaseUser}=employee;
      const claims={employee:true,manager:isManager(account.data,account.collection),role:user.role,employeeId:user.employeeId,identityType:user.identityType,sourceCollection:account.collection,sourceDocId:account.id};
      await auth.setCustomUserClaims(firebaseUser.uid,claims);
      result={ok:true,kind:'employee',token:await auth.createCustomToken(firebaseUser.uid),user};
    }else if(choice==='email-portal' && deps.findPortalAccount){
      const saved=await db.collection('unifiedPortalEmailBindings').doc(hash('line-login|'+row.profile.lineUserId)).get();
      const account=saved.exists && await deps.findPortalAccount(saved.data().role,saved.data().email);
      if(!account)throw new HttpsError('permission-denied','帳號目前無法登入。');
      const session=await deps.issuePortalSession({...account,authMethod:'line'});
      result={ok:true,kind:'portal-session',role:account.type,sessionToken:session.sessionToken};
    }else if(['teacher','student','renter'].includes(choice)){
      const decision=deps.decideLineLoginBinding(choice,await deps.bindingsForLine(choice,row.profile.lineUserId));
      if(['pending','blocked','conflict'].includes(decision.action))throw new HttpsError('permission-denied',decision.action==='pending'?'這個身分正在等待審核。':'此身分目前無法登入，請聯絡管理者核對。');
      const params={method:'line',role:choice};
      if(decision.action==='login')params.access=await deps.issueAccessToken({type:choice,profile:row.profile,binding:decision.binding});
      else params.lineSetup=await deps.issueSetupToken(choice,row.profile);
      result={ok:true,kind:'portal',url:deps.portalEntryUrl(params)};
    }else throw new HttpsError('invalid-argument','請選擇登入身分。');
    await db.runTransaction(async tx=>{checkTicket(await tx.get(ref));tx.update(ref,{status:'used',usedAt:FieldValue.serverTimestamp()});});
    return result;
  }
  async function unlink(request) {
    const caller=request&&request.auth,claims=caller&&caller.token||{};
    if(!caller||claims.employee!==true||!claims.firebase||claims.firebase.sign_in_provider!=='password'||!Number(claims.auth_time)||now()/1000-Number(claims.auth_time)>600)throw new HttpsError('unauthenticated','請輸入原帳密後，再解除 LINE 登入綁定。');
    const account=await findAccount(db,clean(claims.email).toLowerCase());
    if(!account||!active(account.data)||normalizeUser(account).employeeId!==clean(claims.employeeId))throw new HttpsError('permission-denied','帳號身分不一致。');
    const reverseRef=db.collection('employeeLoginOwners').doc(caller.uid);
    await db.runTransaction(async tx=>{
      const reverse=await tx.get(reverseRef);if(!reverse.exists)return;
      const lineRef=db.collection('employeeLoginBindings').doc(reverse.data().lineKey),binding=await tx.get(lineRef);
      if(binding.exists&&binding.data().uid===caller.uid)tx.delete(lineRef);
      tx.delete(reverseRef);
    });
    return {ok:true};
  }
  return {issue,status,link,redeem,unlink};
  function checkProof(row,proof){
    if(!/^[A-Za-z0-9_-]{32,100}$/.test(clean(proof))||hash(proof)!==row.challenge)throw new HttpsError('unauthenticated','請回到開始 LINE 登入的同一個瀏覽器，或重新登入。');
  }
}
module.exports={createUnifiedLogin};
