'use strict';
const crypto = require('crypto');
const { hash, random, validId, fail } = require('./sharedCalendarAccess');
const PAGE = 'https://danny700808.github.io/play-card/shared-calendar.html';
const CALLBACK = 'https://asia-east1-youzi-c1b74.cloudfunctions.net/coursePortalLineLoginCallback';
const validToken = v => typeof v === 'string' && /^[\w-]{43}$/.test(v);
const validState = v => typeof v === 'string' && /^sc_[\w-]{43}$/.test(v);
const emailValue = v => String(v || '').trim().toLowerCase();
function createSharedLogin({ db, auth, sendEmail, authorizationUrl }) {
  const members = db.collection('sharedCalendarMembers');
  const tickets = db.collection('sharedCalendarLoginTickets');
  async function context(d, request) {
    const ownerUid = await auth.ownerUid();
    if (d.invite) {
      if (!validToken(d.invite)) fail('邀請連結無效。');
      const inviteHash = hash(d.invite), i = (await db.doc('sharedCalendarInvites/' + inviteHash).get()).data();
      if (!i || i.used || i.expiresAt <= Date.now() || i.ownerUid !== ownerUid) fail('邀請已使用或過期，請管理者重新邀請。');
      const m = (await members.doc(i.memberId).get()).data();
      if (!m || m.status !== 'invited' || m.version !== i.version || m.ownerUid !== ownerUid) fail('邀請已撤銷。');
      return { ownerUid, memberId: i.memberId, version: m.version, inviteHash, mode: 'invite' };
    }
    if (d.link === true) {
      const who = await auth.identity(request);
      if (who.role !== 'member') fail('請從自己的成員帳號操作。');
      const m = await auth.member(who.id);
      return { ownerUid, memberId: who.id, version: m.version, mode: 'link' };
    }
    if (d.memberId) {
      const m = await auth.member(d.memberId);
      return { ownerUid, memberId: m.id, version: m.version, mode: 'login' };
    }
    return { ownerUid, mode: 'login' };
  }
  function proof(d) {
    if (!/^[a-f0-9]{64}$/.test(d.challenge || '')) fail('請重新開啟登入頁面。');
    return d.challenge;
  }
  async function rate(key) {
    const ref = db.doc('sharedCalendarLoginLimits/' + hash(key));
    await db.runTransaction(async tx => {
      const r = (await tx.get(ref)).data() || {}, now = Date.now(), count = r.until > now ? r.count : 0;
      if (r.sentAt > now - 60000 || count >= 5) fail('請稍後再寄送驗證碼。', 'resource-exhausted');
      tx.set(ref, { count: count + 1, sentAt: now, until: r.until > now ? r.until : now + 3600000 });
    });
  }
  async function startLine(d, request) {
    const challenge = proof(d), c = await context(d, request), state = 'sc_' + random();
    await tickets.doc(hash(state)).set({ ...c, method: 'line', challenge, status: 'pending', callbackUrl: CALLBACK, expiresAt: Date.now() + 600000 });
    return { authorizationUrl: authorizationUrl(state) };
  }
  async function startEmail(d, request) {
    const challenge = proof(d), email = emailValue(d.email);
    if (email.length > 254 || !/^[^\s@,;<>]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(email)) fail('請填有效的 Email。');
    const c = await context(d, request);
    await rate('email|' + email);
    const ticket = random(), salt = random(), code = String(crypto.randomInt(100000, 1000000));
    // An unknown email gets the same response, but no account is created or exposed.
    let eligible = true;
    if (c.mode === 'login') {
      const matches = (await members.where('email', '==', email).get()).docs.filter(x => {
        const m = x.data(); return m.ownerUid === c.ownerUid && m.status === 'active' && m.emailVerifiedAt && (!c.memberId || c.memberId === x.id);
      });
      eligible = matches.length === 1;
      if (eligible) Object.assign(c, { memberId: matches[0].id, version: matches[0].data().version });
    }
    await tickets.doc(hash(ticket)).set({ ...c, email, method: 'email', challenge, salt, codeHash: hash(salt + '|' + code), status: eligible ? 'verified' : 'unknown', attempts: 0, expiresAt: Date.now() + 600000 });
    if (eligible) await sendEmail(email, '柚子共用行事曆登入驗證碼', '你的驗證碼：' + code + '\n10 分鐘內有效。');
    return { ticket };
  }
  async function callback(req, res, { exchange, profile }) {
    res.set('Cache-Control', 'no-store, max-age=0');
    if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');
    const state = String(req.query?.state || '');
    try {
      if (!validState(state)) fail('LINE 登入已失效，請重試。');
      const ref = tickets.doc(hash(state));
      const row = await db.runTransaction(async tx => {
        const r = (await tx.get(ref)).data();
        if (!r || r.method !== 'line' || r.status !== 'pending' || r.expiresAt <= Date.now()) fail('LINE 登入已失效，請重試。');
        tx.update(ref, { status: 'processing' }); return r;
      });
      if (req.query.error || !req.query.code) fail('已取消 LINE 登入，請重新選擇。');
      const token = await exchange(String(req.query.code), row.callbackUrl), p = await profile(token.access_token);
      if (!/^U[0-9a-f]{32}$/i.test(p.lineUserId || '')) fail('LINE 身分驗證未完成。');
      // The OAuth initiator knows state. Never let it redeem someone else's callback.
      // A new, unpredictable ticket goes only to the browser receiving the callback.
      const grant = random();
      await db.runTransaction(async tx => {
        const current = (await tx.get(ref)).data();
        if (!current || current.status !== 'processing' || current.expiresAt <= Date.now()) fail('LINE 登入已失效，請重試。');
        tx.create(tickets.doc(hash(grant)), { ...row, status: 'verified', lineUserId: p.lineUserId, lineFriendFlag: p.lineFriendFlag === true });
        tx.update(ref, { status: 'callback-complete' });
      });
      return res.redirect(302, PAGE + '#lineTicket=' + encodeURIComponent(grant));
    } catch (e) {
      return res.redirect(302, PAGE + '#loginError=' + encodeURIComponent(e.message || 'LINE 登入未完成，請重試。'));
    }
  }
  async function redeem(d) {
    if (!validToken(d.ticket) || !validToken(d.verifier)) fail('請回原本的瀏覽器重新登入。');
    const ref = tickets.doc(hash(d.ticket)), preliminary = (await ref.get()).data();
    if (!preliminary || preliminary.challenge !== hash(d.verifier)) fail('請回原本的瀏覽器重新登入。');
    // Resolve only server-verified identities. The final transaction rechecks every binding.
    let memberId = preliminary.memberId;
    if (!memberId && preliminary.method === 'line' && preliminary.status === 'verified') {
      const matches = (await members.where('lineUserId', '==', preliminary.lineUserId).get()).docs.filter(x => x.data().status === 'active' && x.data().ownerUid === preliminary.ownerUid);
      if (matches.length === 1) memberId = matches[0].id;
    }
    const session = random();
    const result = await db.runTransaction(async tx => {
      const t = (await tx.get(ref)).data(), owner = (await tx.get(db.doc('privateCalendarServer/access'))).data();
      if (!t || t.status !== 'verified' || t.expiresAt <= Date.now() || t.challenge !== hash(d.verifier) || t.ownerUid !== owner?.uid || (t.attempts || 0) >= 5) fail('驗證已失效，請重新登入。');
      if (t.method === 'email' && hash(t.salt + '|' + String(d.code || '')) !== t.codeHash) { tx.update(ref, { attempts: (t.attempts || 0) + 1 }); return null; }
      if (!validId(memberId)) fail('這個帳號尚未加入，請使用管理者的邀請連結。');
      const mr = members.doc(memberId), m = (await tx.get(mr)).data();
      const ir = t.inviteHash ? db.doc('sharedCalendarInvites/' + t.inviteHash) : null, i = ir ? (await tx.get(ir)).data() : null;
      if (!m || m.ownerUid !== owner.uid || (t.version && t.version !== m.version)) fail('成員權限已更新，請重新登入。');
      if (t.mode === 'invite') {
        if (m.status !== 'invited' || !i || i.used || i.expiresAt <= Date.now() || i.version !== m.version || i.memberId !== memberId || i.ownerUid !== m.ownerUid) fail('邀請已使用或過期，請管理者重新邀請。');
      } else if (m.status !== 'active') fail('成員已停用。');
      const value = t.method === 'line' ? t.lineUserId : t.email;
      if (t.mode === 'login' && (t.method === 'line' ? m.lineUserId !== value : m.email !== value || !m.emailVerifiedAt)) fail('請使用這位成員已綁定的帳號登入。');
      const claims = db.collection(t.method === 'line' ? 'sharedCalendarLineOwners' : 'sharedCalendarEmailOwners');
      const cr = claims.doc(hash(value)), claim = (await tx.get(cr)).data();
      const other = claim && claim.memberId !== memberId ? (await tx.get(members.doc(claim.memberId))).data() : null;
      if (other && ['active', 'invited'].includes(other.status)) fail('這個帳號已綁定另一位成員，請聯絡管理者。');
      const oldValue = t.method === 'line' ? m.lineUserId : m.email;
      const oldRef = oldValue && oldValue !== value ? claims.doc(hash(oldValue)) : null, oldClaim = oldRef ? (await tx.get(oldRef)).data() : null;
      if (oldClaim?.memberId === memberId) tx.delete(oldRef);
      tx.set(cr, { memberId, ownerUid: m.ownerUid });
      const patch = t.method === 'line' ? { lineUserId: value, lineLinkedAt: Date.now(), lineFriendFlag: t.lineFriendFlag, contactKey: '', lineBindHash: '' } : { email: value, emailVerifiedAt: Date.now() };
      tx.update(mr, { ...patch, status: 'active', passwordHash: '', passwordSalt: '', ...(t.mode === 'invite' ? { activatedAt: Date.now() } : {}) });
      if (ir) tx.update(ir, { used: true });
      tx.update(ref, { status: 'used', salt: '', codeHash: '' });
      tx.create(db.doc('sharedCalendarSessions/' + hash(session)), { memberId, ownerUid: m.ownerUid, version: m.version, createdAt: Date.now(), expiresAt: Date.now() + 8 * 3600000 });
      return { token: session, memberId, name: m.name, lineFriendFlag: t.method === 'line' ? t.lineFriendFlag : undefined };
    });
    if (!result) fail('驗證碼不正確。');
    return result;
  }
  async function api(request) {
    const d = request.data || {};
    if (d.action === 'lineLoginStart') return startLine(d, request);
    if (d.action === 'emailLoginStart') return startEmail(d, request);
    if (d.action === 'loginRedeem') return redeem(d);
    fail('不支援的登入方式。');
  }
  return { api, callback };
}
module.exports = { createSharedLogin };
