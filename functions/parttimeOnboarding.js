'use strict';

const crypto = require('node:crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { findAccount } = require('./employeeAuth');

const APPLICATIONS = 'registrationApplications';
const DOCUMENTS = 'parttimeIdentitySubmissions';
const BASE_URL = 'https://danny700808.github.io/play-card/';
const BASIC_FIELDS = ['name', 'email', 'birthDate', 'mobilePhone', 'householdAddress',
  'contactAddress', 'emergencyContact', 'emergencyPhone'];
const TYPES = ['national_id', 'resident_certificate', 'passport'];
const clean = value => String(value ?? '').trim();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = bytes => crypto.randomBytes(bytes).toString('hex');

function makeActions(db, FieldValue, lookupAccount = findAccount) {
  const timestamp = () => FieldValue.serverTimestamp();
  const applications = db.collection(APPLICATIONS);
  const submissions = db.collection(DOCUMENTS);
  const employees = db.collection('employees');

  async function register(data, ip) {
    const fields = Object.fromEntries(BASIC_FIELDS.map(key => [key, clean(data[key])]));
    fields.email = fields.email.toLowerCase();
    if (BASIC_FIELDS.some(key => !fields[key] || fields[key].length > 500) ||
        !/^\S+@\S+\.\S+$/.test(fields.email) || !/^\d{4}-\d{2}-\d{2}$/.test(fields.birthDate)) {
      throw new HttpsError('invalid-argument', '請完整填寫基本資料。');
    }
    const pref = ['both', 'line', 'email'].includes(data.notificationPreference)
      ? data.notificationPreference : 'both';
    const emailToken = pref === 'line' ? '' : random(24);
    const lineCode = pref === 'email' ? '' : 'EMP-' + random(4).toUpperCase();
    const bindText = lineCode ? '柚子人員綁定 ' + lineCode : '';
    const status = { both: 'waiting_verification', line: 'waiting_line_binding', email: 'waiting_email_verify' }[pref];
    const label = { both: '等待 LINE 或 Email 驗證', line: '等待 LINE 綁定', email: '等待 Email 驗證' }[pref];
    const ref = applications.doc();
    const emailKey = db.collection('parttimeRegistrationKeys').doc(hash(fields.email));
    const limiter = db.collection('publicFormRateLimits').doc(hash('parttime-registration|' + ip));
    const now = Date.now();
    await db.runTransaction(async tx => {
      const { count = 0, startedAt = 0 } = (await tx.get(limiter)).data() || {};
      const recent = now - startedAt < 3600000;
      if (recent && count >= 15) throw new HttpsError('resource-exhausted', '操作過於頻繁，請稍後再試。');
      tx.set(limiter, { count: recent ? count + 1 : 1, startedAt: recent ? startedAt : now,
        expiresAt: admin.firestore.Timestamp.fromMillis(now + 7200000) });
    });
    if (await lookupAccount(db, fields.email)) {
      throw new HttpsError('already-exists', '這個 Email 已有帳號或申請，請聯絡主管確認。');
    }
    await db.runTransaction(async tx => {
      // Serialize new registrations for the same email, including two first submissions.
      await tx.get(emailKey);
      const existing = await tx.get(applications.where('email', '==', fields.email));
      if (existing.docs.some(doc => !['rejected', 'archived'].includes(doc.data().applicationStatus))) {
        throw new HttpsError('already-exists', '這個 Email 已有申請，請聯絡主管確認。');
      }
      tx.set(emailKey, { applicationId: ref.id, updatedAt: timestamp() });
      tx.create(ref, {
        ...fields, address: fields.contactAddress, applicationId: ref.id, registrationType: 'parttime',
        requestedIdentityType: 'parttime', requestedIdentityLabel: '工讀生', onboardingDraft: { identityType: 'parttime' },
        identityVerificationStatus: 'missing', parttimeIdentityDeferred: true,
        applicationStatus: status, status: label, accountStatus: 'pending', currentStep: label,
        notificationPreference: pref, lineBindStatus: lineCode ? 'pending' : 'not_required',
        emailBindStatus: emailToken ? 'pending' : 'not_required', employeeBindCode: lineCode, employeeBindText: bindText,
        parttimeEmailTokenHash: emailToken ? hash(emailToken) : '', parttimeEmailTokenExpiresAt: emailToken ? now + 7 * 86400000 : 0,
        createdAt: timestamp(), createdAtText: new Date(now).toISOString(), updatedAt: timestamp(), source: 'parttime-onboarding'
      });
      if (lineCode) tx.create(db.collection('employeeLineBindings').doc(lineCode), {
        bindingCode: lineCode, employeeBindCode: lineCode, bindText, applicationId: ref.id,
        targetCollection: APPLICATIONS, name: fields.name, email: fields.email,
        requestedIdentityType: 'parttime', notificationPreference: pref, status: 'pending', createdAt: timestamp()
      });
      if (emailToken) {
        const url = BASE_URL + 'register.html?mode=parttimeEmailVerify&applicationId=' + ref.id + '&token=' + emailToken;
        const queue = db.collection('notificationQueue').doc();
        const body = fields.name + ' 您好，請點選下方連結驗證 Email，完成後即可進入主管審核。證件可於入職後登入補齊。\n\n' + url;
        tx.create(queue, { queueId: queue.id, channel: 'email', title: '柚子樂器工讀生註冊驗證',
          targetEmail: fields.email, targetName: fields.name, body, message: body, applicationId: ref.id,
          status: '待發送', source: 'parttime-onboarding', createdAt: timestamp() });
      }
    });
    return { ok: true, deferredIdentity: true, notificationPreference: pref, employeeBindText: bindText,
      message: '申請已送出。帳號開通後，系統會提醒您補填證件號碼與上傳證件正面。' };
  }

  async function verifyEmail(data) {
    const id = clean(data.applicationId);
    const token = clean(data.token);
    const invalid = () => new HttpsError('invalid-argument', 'Email 驗證連結不正確或已失效。');
    if (!/^[a-zA-Z0-9]{20}$/.test(id) || !/^[a-f0-9]{48}$/.test(token)) throw invalid();
    const ref = applications.doc(id);
    await db.runTransaction(async tx => {
      const app = (await tx.get(ref)).data();
      if (!app?.parttimeIdentityDeferred || app.parttimeEmailTokenHash !== hash(token) ||
          app.parttimeEmailTokenExpiresAt < Date.now() || ['rejected','archived'].includes(app.applicationStatus)) throw invalid();
      if (app.emailBindStatus === 'bound') return;
      const patch = { emailBindStatus: 'bound', emailVerifiedAt: timestamp(), updatedAt: timestamp() };
      if (['waiting_verification', 'waiting_email_verify'].includes(app.applicationStatus)) {
        Object.assign(patch, { applicationStatus: 'pending_setup', status: '待主管建檔', currentStep: '等待主管審核' });
      }
      tx.update(ref, patch);
    });
    return { ok: true, message: 'Email 驗證完成，主管可以接續處理入職建檔。' };
  }

  async function ownEmployee(auth) {
    const id = clean(auth?.token?.employeeId);
    if (auth?.token?.employee !== true || !id || id.includes('/')) throw new HttpsError('unauthenticated', '請先登入工讀生帳號。');
    const direct = await employees.doc(id).get();
    const doc = direct.exists && (!direct.data().employeeId || direct.data().employeeId === id)
      ? direct : (await employees.where('employeeId', '==', id).limit(1).get()).docs[0];
    const row = doc?.data();
    if (!row || row.identityType !== 'parttime' || row.accountStatus !== 'active' || row.parttimeIdentityDeferred !== true) return null;
    return doc;
  }

  async function ownStatus(auth) {
    const doc = await ownEmployee(auth);
    return { ok: true, status: doc?.data()?.identityVerificationStatus || '', note: clean(doc?.data()?.parttimeIdentityNote) };
  }

  async function submit(data, auth) {
    const doc = await ownEmployee(auth);
    const idNumber = clean(data.idNumber).toUpperCase();
    const identityDocumentType = clean(data.identityDocumentType);
    const jpeg = clean(data.image);
    if (!/^[A-Z0-9-]{4,32}$/.test(idNumber) || !TYPES.includes(identityDocumentType) || data.consent !== true ||
        jpeg.length > 850000 || !jpeg.startsWith('/9j/') || !/^[A-Za-z0-9+/]+={0,2}$/.test(jpeg)) {
      throw new HttpsError('invalid-argument', '請確認證件號碼、類型、清楚的正面照片及同意欄位。');
    }
    const image = Buffer.from(jpeg, 'base64');
    if (image.length < 128 || image.at(-2) !== 255 || image.at(-1) !== 217) {
      throw new HttpsError('invalid-argument', '證件圖片格式不正確。');
    }
    if (!doc) throw new HttpsError('permission-denied', '目前沒有可以補交的證件資料。');
    await db.runTransaction(async tx => {
      const row = (await tx.get(doc.ref)).data();
      if (row?.accountStatus !== 'active' || row.identityVerificationStatus !== 'missing') {
        throw new HttpsError('failed-precondition', '目前沒有待補件項目，請先重新整理。');
      }
      tx.set(submissions.doc(doc.id), { name: clean(row.name), idNumber, identityDocumentType, image,
        status: 'submitted', consent: true, submittedAt: timestamp() });
      tx.update(doc.ref, { identityVerificationStatus: 'submitted', parttimeIdentityNote: '', updatedAt: timestamp() });
    });
    return { ok: true };
  }

  async function managerAction(action, data, auth) {
    if (auth?.token?.employee !== true || auth?.token?.manager !== true || !auth.token.employeeId) {
      throw new HttpsError('permission-denied', '請以主管帳號登入。');
    }
    if (action === 'list') {
      const rows = (await submissions.where('status', '==', 'submitted').select('name').get()).docs;
      return { ok: true, rows: rows.map(doc => ({ id: doc.id, name: clean(doc.data().name) })) };
    }
    const id = clean(data.id);
    if (!id || id.length > 120 || id.includes('/') || id === '.' || id === '..') {
      throw new HttpsError('invalid-argument', '請先選擇一筆補件。');
    }
    const ref = submissions.doc(id);
    if (action === 'detail') {
      const row = (await ref.get()).data();
      if (row?.status !== 'submitted') throw new HttpsError('not-found', '這筆補件已處理。');
      return { ok: true, name: row.name, idNumber: row.idNumber,
        identityDocumentType: row.identityDocumentType, image: Buffer.from(row.image).toString('base64') };
    }
    const note = clean(data.note).slice(0, 500);
    if (action === 'return' && !note) throw new HttpsError('invalid-argument', '請填寫退回原因。');
    const employee = employees.doc(id);
    await db.runTransaction(async tx => {
      const [item, person] = await Promise.all([tx.get(ref), tx.get(employee)]);
      const row = item.data();
      if (row?.status !== 'submitted' || person.data()?.identityVerificationStatus !== 'submitted') {
        throw new HttpsError('failed-precondition', '這筆補件已處理，請重新整理。');
      }
      if (action === 'approve') {
        tx.update(employee, { idNumber: row.idNumber, identityDocumentType: row.identityDocumentType,
          identityDocumentVerified: true, identityVerificationStatus: 'verified',
          identityVerifiedAt: timestamp(), identityVerifiedBy: auth.token.employeeId, updatedAt: timestamp() });
        tx.update(ref, { status: 'verified', reviewedAt: timestamp(), reviewedBy: auth.token.employeeId });
      } else {
        tx.update(employee, { identityVerificationStatus: 'missing', parttimeIdentityNote: note, updatedAt: timestamp() });
        tx.delete(ref);
      }
    });
    return { ok: true };
  }

  return async (data, request) => {
    switch (data.action) {
      case 'register': return register(data, request.rawRequest?.ip || 'unknown');
      case 'verifyEmail': return verifyEmail(data);
      case 'status': return ownStatus(request.auth);
      case 'submit': return submit(data, request.auth);
      case 'list': case 'detail': case 'approve': case 'return':
        return managerAction(data.action, data, request.auth);
      default: throw new HttpsError('invalid-argument', '未知的補件操作。');
    }
  };
}

function register(exportsObject) {
  const handle = makeActions(admin.firestore(), admin.firestore.FieldValue);
  exportsObject.parttimeOnboarding = onCall({ region: ['us-central1', 'asia-east1'], timeoutSeconds: 60 },
    request => handle(request.data || {}, request));
}

module.exports = { makeActions, register };
