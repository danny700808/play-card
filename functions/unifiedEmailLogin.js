'use strict';
const crypto = require('crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { findAccount, normalizeUser, accountStatus, isManager } = require('./employeeAuth');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const clean = value => String(value || '').trim();
const active = row => ['active','enabled','啟用','是'].includes(accountStatus(row));

function createUnifiedEmailLogin({ db, auth, FieldValue, sendEmail, findPortalAccount, issuePortalSession, now = Date.now }) {
  async function identity(email) {
    const account = await findAccount(db, email);
    if (account) return active(account.data) && normalizeUser(account).email.toLowerCase() === email
      ? { kind:'employee', account } : null;
    for (const role of ['teacher','student','renter']) {
      const account = await findPortalAccount(role, email);
      if (account) return { kind:'portal', account, role };
    }
    return null;
  }
  function ticketRow(snapshot, proof) {
    const row = snapshot.exists && snapshot.data();
    if (!row || row.status !== 'pending' || row.expiresAtMs <= now() || hash(clean(proof)) !== row.challenge)
      throw new HttpsError('unauthenticated','登入已逾時，請重新按 LINE 登入。');
    return row;
  }
  async function send(data, request = {}) {
    const email = clean(data.email).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new HttpsError('invalid-argument','請輸入正確的 Email。');
    const proof = clean(data.proof);
    if (!/^[a-f0-9]{64}$/.test(proof)) throw new HttpsError('invalid-argument','請重新開啟登入頁。');
    if (data.ticket) ticketRow(await db.collection('unifiedLoginTickets').doc(hash(data.ticket)).get(), proof);
    const ip = clean(request.rawRequest && request.rawRequest.ip) || 'unknown';
    const limits = [db.collection('employeeAuthRateLimits').doc(hash('otp-email|'+email)), db.collection('employeeAuthRateLimits').doc(hash('otp-ip|'+ip))];
    await db.runTransaction(async tx => {
      const snapshots = await Promise.all(limits.map(ref => tx.get(ref)));
      snapshots.forEach((snap,i) => {
        const row = snap.exists ? snap.data() : {}, recent = Number(row.until) > now(), count = recent ? Number(row.count || 0) : 0;
        if (count >= (i ? 30 : 5)) throw new HttpsError('resource-exhausted','寄送次數較多，請 15 分鐘後再試。');
        tx.set(limits[i], { count:count+1, until:recent ? row.until : now()+900000 });
      });
    });
    const found = await identity(email), challenge = crypto.randomBytes(32).toString('hex'), code = String(crypto.randomInt(100000,1000000));
    const ref = db.collection('unifiedEmailOtps').doc(hash(challenge));
    await ref.set({ email, codeHash:hash(challenge+'|'+code), proofHash:hash(proof), ticket:clean(data.ticket), status:'pending', attempts:0, expiresAtMs:now()+300000, eligible:!!found });
    if (found) {
      try { await sendEmail({ targetEmail:email, title:'柚子樂器登入驗證碼', body:'您的六碼驗證碼是：'+code+'\n\n五分鐘內有效，請勿提供給他人。若不是您本人操作，請忽略此信。' }); }
      catch (error) { await ref.set({status:'failed'},{merge:true}); throw new HttpsError('unavailable','驗證信暫時無法寄出，請稍後再試。'); }
    }
    return { ok:true, challengeToken:challenge, message:'若此 Email 有既有帳號，驗證碼將寄到信箱。' };
  }
  async function verify(data) {
    const challenge = clean(data.challengeToken), code = clean(data.code);
    if (!/^[a-f0-9]{64}$/.test(challenge) || !/^\d{6}$/.test(code)) throw new HttpsError('invalid-argument','請輸入六碼驗證碼。');
    const ref = db.collection('unifiedEmailOtps').doc(hash(challenge));
    const source = await db.runTransaction(async tx => {
      const snap = await tx.get(ref), row = snap.exists && snap.data();
      if (!row || row.status !== 'pending' || row.expiresAtMs <= now() || row.attempts >= 5 || row.proofHash !== hash(clean(data.proof))) throw new HttpsError('unauthenticated','驗證碼已失效，請重新寄送。');
      if (row.codeHash !== hash(challenge+'|'+code) || !row.eligible) {
        tx.update(ref,{attempts:row.attempts+1}); return null;
      }
      tx.update(ref,{status:'used'}); return row;
    });
    if (!source) throw new HttpsError('permission-denied','驗證碼不正確。');
    const found = await identity(source.email);
    if (!found) throw new HttpsError('permission-denied','帳號目前無法登入，請聯絡管理者確認資料。');
    let result, binding;
    if (found.kind === 'employee') {
      const {account} = found, user = normalizeUser(account);
      let firebaseUser;
      try { firebaseUser = await auth.getUserByEmail(source.email); }
      catch (error) {
        if (error.code !== 'auth/user-not-found') throw error;
        firebaseUser = await auth.createUser({uid:'employee-'+hash(account.collection+'|'+account.id).slice(0,40),email:source.email,emailVerified:true});
      }
      if (firebaseUser.disabled) throw new HttpsError('permission-denied','帳號目前已停用。');
      const claims = {employee:true,manager:isManager(account.data,account.collection),role:user.role,employeeId:user.employeeId,identityType:user.identityType,sourceCollection:account.collection,sourceDocId:account.id};
      await auth.setCustomUserClaims(firebaseUser.uid, claims);
      binding = {uid:firebaseUser.uid,collection:account.collection,documentId:account.id,active:true};
      result = {ok:true,kind:'employee',user,token:await auth.createCustomToken(firebaseUser.uid)};
    } else {
      const session = await issuePortalSession({...found.account,authMethod:'email-otp'});
      result = {ok:true,kind:'portal-session',role:found.role,sessionToken:session.sessionToken};
    }
    if (source.ticket) {
      const ticketRef = db.collection('unifiedLoginTickets').doc(hash(source.ticket));
      await db.runTransaction(async tx => {
        const row = ticketRow(await tx.get(ticketRef), data.proof);
        if (binding) {
          const lineRef = db.collection('employeeLoginBindings').doc(hash('line-login|'+row.profile.lineUserId)), reverseRef = db.collection('employeeLoginOwners').doc(binding.uid);
          const existing = await tx.get(lineRef), reverse = await tx.get(reverseRef);
          if ((existing.exists && existing.data().uid !== binding.uid) || (reverse.exists && reverse.data().lineKey !== lineRef.id)) throw new HttpsError('already-exists','LINE 與原有帳號資料不一致，請聯絡管理者確認。');
          tx.set(lineRef,{...binding,linkedAt:FieldValue.serverTimestamp()});
          tx.set(reverseRef,{lineKey:lineRef.id,linkedAt:FieldValue.serverTimestamp()});
        } else {
          const lineRef = db.collection('unifiedPortalEmailBindings').doc(hash('line-login|'+row.profile.lineUserId));
          const existing = await tx.get(lineRef);
          if (existing.exists && existing.data().email !== source.email) throw new HttpsError('already-exists','LINE 與原有帳號資料不一致，請聯絡管理者確認。');
          tx.set(lineRef,{email:source.email,role:found.role,linkedAt:FieldValue.serverTimestamp()});
        }
        tx.update(ticketRef,{status:'used'});
      });
    }
    return result;
  }
  return {send,verify};
}
module.exports = {createUnifiedEmailLogin};
