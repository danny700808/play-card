/**
 * functions/externalTeacherContractFlow.js
 *
 * 外聘老師年度契約 Firebase 版：
 * - 老師端只保留基本資料、LINE 綁定、身分證明照片、契約簽名。
 * - 老師送出後只產生「預覽契約／非正式契約」。
 * - 管理端確認後才變成「正式契約」，並用 LINE 傳正式契約連結。
 * - 合約以民國年度管理，例如 115 年度、116 年度。
 * - 後台可修改年度契約條文、查詢簽約紀錄、退回修改、不續聘、解除合作。
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

const REGION = 'us-central1';
const WATERMARK_TEXT = '僅供柚子樂器外聘教師契約簽署與身份確認使用';

function db(){ return admin.firestore(); }
function bucket(){ return admin.storage().bucket(); }
function ts(){ return admin.firestore.FieldValue.serverTimestamp(); }
function clean(v){ return String(v == null ? '' : v).trim(); }
function bool(v){ return v === true || ['true','1','yes','是','啟用','active'].includes(clean(v).toLowerCase()); }
function pad(n){ return String(n).padStart(2,'0'); }
function today(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function nowIso(){ return new Date().toISOString(); }
function rocYear(date=new Date()){ return date.getFullYear() - 1911; }
function adYearFromRoc(y){ return Number(y) + 1911; }
function makeId(prefix){ return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function makeToken(){ return crypto.randomBytes(20).toString('hex'); }
function makeBindCode(){ return 'EXT-' + crypto.randomBytes(3).toString('hex').toUpperCase(); }
function appBaseUrl(){ return clean(process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || ''); }
function onboardingUrl(teacherId, token){ const q=`teacherId=${encodeURIComponent(teacherId||'')}&token=${encodeURIComponent(token||'')}`; return (appBaseUrl() || '') + `/external-teacher-onboarding.html?${q}`; }
function contractViewUrl(contractId, token){ const q=`contractId=${encodeURIComponent(contractId||'')}&token=${encodeURIComponent(token||'')}`; return (appBaseUrl() || '') + `/external-teacher-contract-view.html?${q}`; }
function isAdminPayload(data){
  const u = data && data.adminUser ? data.adminUser : {};
  const role = clean(u.role || u.type || u.userRole).toLowerCase();
  const email = clean(u.email).toLowerCase();
  return !!(u.isAdmin || u.admin || ['admin','owner','manager','主管','管理者'].includes(role) || email === 'danny700808@gmail.com');
}
function requireAdmin(data){ if(!isAdminPayload(data)) throw new HttpsError('permission-denied','需要管理者權限。'); }
async function validateTeacherToken(teacherId, token, allowMissingForExisting=false){
  if(!teacherId) throw new HttpsError('invalid-argument','缺少外聘老師 ID。');
  const ref = db().collection('employees').doc(teacherId);
  const snap = await ref.get();
  if(!snap.exists) throw new HttpsError('not-found','找不到外聘老師資料。');
  const data = snap.data() || {};
  const ext = data.externalTeacher || {};
  if(allowMissingForExisting && !token) return { ref, snap, data };
  if(!token || ext.onboardingToken !== token) throw new HttpsError('permission-denied','外聘老師連結已失效，請重新取得連結。');
  return { ref, snap, data };
}
function templateDocId(yearRoc){ return `roc_${Number(yearRoc || rocYear())}`; }
function yearRange(yearRoc){ const y = adYearFromRoc(yearRoc); return { start:`${y}-01-01`, end:`${y}-12-31` }; }

const DEFAULT_CLAUSES = [
  ['第一條','委任職務','甲方委任乙方擔任外聘才藝教師，乙方同意受任並依本契約約定執行相關教學事務。'],
  ['第二條','委任期間','本契約委任期間自 {{contractStartDate}} 起至 {{contractEndDate}} 止。委任期間屆滿後，除雙方另以書面、電子文件或系統紀錄續約外，本契約當然終止。'],
  ['第三條','委任工作內容','乙方受甲方委任執行教學及相關事項，包含課程教學、學生學習狀況回報、必要之課程溝通、補課或調課配合，以及其他經雙方同意之教學相關事項。'],
  ['第四條','保密義務','乙方因執行本契約所知悉或持有甲方之學生資料、家長資料、課表資料、營業資料、行政文件、教學資料、管理資料、電腦系統資料、帳號密碼、商業資訊及其他非公開資訊，均負保密義務。乙方非經甲方事前同意，不得將前項資料洩漏、公開、散布、交付、轉傳或提供予第三人，亦不得為本契約目的以外之使用。'],
  ['第五條','教材、教具與著作權','乙方使用教材、樂譜、講義、音檔、影像、圖片、軟體或其他教學資料時，應確認來源合法，不得侵害他人著作權、商標權、專利權、營業秘密或其他智慧財產權。'],
  ['第六條','身份資料與個人資料','乙方同意提供姓名、行動電話、Email、身分證字號及身分證明照片，作為外聘教師契約簽署、身份確認、通知聯繫及契約管理使用。甲方應於合理必要範圍內保存及使用前述資料。'],
  ['第七條','LINE 通知','乙方同意綁定柚子樂器官方 LINE 作為契約簽署、年度續約、資料補正、合作通知及其他外聘教師相關事項之通知管道。'],
  ['第八條','提前終止與不續聘','任一方得依本契約約定或雙方協議終止合作。甲方得依營運需求、課程安排、教學品質、學生需求或其他合理因素決定次年度不續聘乙方。'],
  ['第九條','契約確認與生效','乙方於系統送出資料與簽名後，僅產生預覽契約，尚未正式生效。經甲方管理端確認後，本契約始成立正式契約，並以系統產生之正式契約連結作為雙方留存依據。'],
  ['第十條','準據法與管轄法院','本契約之成立、效力、解釋、履行及爭議處理，均以中華民國法律為準據法。甲乙雙方因本契約發生爭議而涉訟者，雙方同意以甲方所在地之地方法院為第一審管轄法院。']
];

async function ensureTemplate(yearRoc){
  const id = templateDocId(yearRoc);
  const ref = db().collection('externalTeacherContractTemplates').doc(id);
  const snap = await ref.get();
  if(!snap.exists){
    await ref.set({
      templateId:id,
      yearRoc:Number(yearRoc),
      title:`民國 ${yearRoc} 年度外聘才藝教師委任契約書`,
      version:`${yearRoc}-01`,
      status:'active',
      watermarkText: WATERMARK_TEXT,
      createdAt: ts(),
      updatedAt: ts()
    });
    const batch = db().batch();
    DEFAULT_CLAUSES.forEach((row, idx)=>{
      batch.set(ref.collection('clauses').doc(`clause_${pad(idx+1)}`), {
        clauseId:`clause_${pad(idx+1)}`,
        articleNo:row[0], title:row[1], content:row[2], sortOrder:idx+1, enabled:true,
        createdAt:ts(), updatedAt:ts()
      });
    });
    await batch.commit();
    const next = await ref.get();
    return { id:ref.id, ...next.data() };
  }
  return { id:ref.id, ...snap.data() };
}
async function getTemplateWithClauses(yearRoc){
  const template = await ensureTemplate(yearRoc);
  const snap = await db().collection('externalTeacherContractTemplates').doc(template.id).collection('clauses').get();
  const clauses = snap.docs.map(d=>({id:d.id,...d.data()})).filter(c=>c.enabled !== false).sort((a,b)=>Number(a.sortOrder||0)-Number(b.sortOrder||0));
  return { template, clauses };
}
function replaceVars(text, vars){ let out=String(text||''); Object.keys(vars).forEach(k=>{ out=out.replace(new RegExp(`{{\\s*${k}\\s*}}`,'g'), vars[k] == null ? '' : String(vars[k])); }); return out; }
function renderContractText({ template, clauses, teacher, yearRoc, statusLabel }){
  const ext = teacher.externalTeacher || {};
  const range = yearRange(yearRoc);
  const vars = {
    companyName: process.env.COMPANY_NAME || '柚子樂器',
    companyRepresentative: process.env.COMPANY_REPRESENTATIVE || '',
    companyAddress: process.env.COMPANY_ADDRESS || '',
    yearRoc: Number(yearRoc),
    contractStartDate: range.start,
    contractEndDate: range.end,
    teacherName: teacher.name || ext.name || '',
    teacherMobile: teacher.mobile || teacher.phone || ext.mobile || '',
    teacherEmail: teacher.email || ext.email || '',
    teacherIdNumber: ext.idNumber || ''
  };
  let text = `${template.title || `民國 ${yearRoc} 年度外聘才藝教師委任契約書`}\n`;
  text += `契約狀態：${statusLabel || '預覽契約'}\n\n`;
  text += `甲方：${vars.companyName}\n`;
  text += `代表人：${vars.companyRepresentative}\n`;
  text += `地址：${vars.companyAddress}\n\n`;
  text += `乙方：${vars.teacherName}\n`;
  text += `行動電話：${vars.teacherMobile}\n`;
  text += `Email：${vars.teacherEmail}\n`;
  text += `身分證字號：${vars.teacherIdNumber}\n\n`;
  text += `契約年度：民國 ${yearRoc} 年度\n`;
  text += `契約期間：${range.start} 至 ${range.end}\n\n`;
  clauses.forEach(c=>{ text += `${c.articleNo || ''}　${c.title || ''}\n${replaceVars(c.content, vars)}\n\n`; });
  text += `立契約書人\n\n甲方：${vars.companyName}\n乙方：${vars.teacherName}\n簽署日期：${today()}\n`;
  return text;
}

function decodeDataUrl(dataUrl){
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if(!m) throw new HttpsError('invalid-argument','檔案格式錯誤。');
  return { mimeType:m[1], buffer:Buffer.from(m[2], 'base64') };
}
async function saveDataUrl({ dataUrl, path, contentType }){
  const file = bucket().file(path);
  const decoded = decodeDataUrl(dataUrl);
  await file.save(decoded.buffer, {
    resumable:false,
    metadata:{ contentType: contentType || decoded.mimeType, cacheControl:'private, max-age=0' }
  });
  return { storagePath:path, mimeType:contentType || decoded.mimeType, size:decoded.buffer.length };
}
async function signedUrl(storagePath){
  if(!storagePath) return '';
  try{
    const [url] = await bucket().file(storagePath).getSignedUrl({ action:'read', expires: Date.now() + 1000*60*60*24*7 });
    return url;
  }catch(err){ return `gs://${bucket().name}/${storagePath}`; }
}
async function withSignedFiles(contract){
  const out = Object.assign({}, contract);
  if(out.signatureFile && out.signatureFile.storagePath) out.signatureFile.signedUrl = await signedUrl(out.signatureFile.storagePath);
  if(Array.isArray(out.identityFiles)){
    out.identityFiles = await Promise.all(out.identityFiles.map(async f=>Object.assign({}, f, { signedUrl: await signedUrl(f.storagePath) })));
  }
  return out;
}

async function pushQueue({ eventCode, teacherId, lineUserId, message, title, contractId }){
  await db().collection('notificationQueue').add({
    eventCode, teacherId:teacherId||'', contractId:contractId||'', channel:'line', targetLineUserId:lineUserId||'', title:title||'', body:message||'', message:message||'', status:'queued', createdAt:ts()
  });
}
async function pushTeacherLine(lineUserId, message, tools){
  if(!lineUserId) return;
  if(tools && typeof tools.pushLineMessage === 'function'){
    try{ await tools.pushLineMessage(lineUserId, message); return; }catch(err){ console.warn('[external teacher LINE push failed]', err.message || err); }
  }
  await pushQueue({ eventCode:'external_teacher_line_message', lineUserId, message, title:'外聘老師通知' });
}

async function handleExternalTeacherContractLineEvent(event, tools={}){
  const text = event && event.message && event.message.type === 'text' ? clean(event.message.text) : '';
  const m = text.match(/^外聘老師綁定\s+([A-Z0-9-]+)$/i);
  if(!m) return false;
  const bindCode = m[1].toUpperCase();
  const replyToken = event.replyToken;
  const lineUserId = event.source && event.source.userId;
  const ref = db().collection('externalTeacherLineBindings').doc(bindCode);
  const snap = await ref.get();
  if(!snap.exists){
    if(tools.replyLineMessage) await tools.replyLineMessage(replyToken, '查不到這組外聘老師綁定碼。\n\n請確認您貼上的文字是否完整，例如：\n外聘老師綁定 EXT-123456');
    return true;
  }
  const b = snap.data() || {};
  if(b.expiresAt && b.expiresAt.toMillis && b.expiresAt.toMillis() < Date.now()){
    await ref.set({ status:'expired', updatedAt:ts() }, { merge:true });
    if(tools.replyLineMessage) await tools.replyLineMessage(replyToken, '這組外聘老師綁定碼已逾期。請重新開啟外聘老師資料頁，產生新的綁定碼。');
    return true;
  }
  const teacherId = b.teacherId;
  const teacherRef = db().collection('employees').doc(teacherId);
  const teacherSnap = await teacherRef.get();
  if(!teacherSnap.exists){
    if(tools.replyLineMessage) await tools.replyLineMessage(replyToken, '找不到此外聘老師資料，請重新產生綁定碼或聯絡柚子樂器。');
    return true;
  }
  await ref.set({ status:'bound', lineUserId, boundAt:ts(), updatedAt:ts() }, { merge:true });
  await teacherRef.set({
    lineUserId,
    lineNotifyEnabled:true,
    externalTeacher:{ lineBindStatus:'bound', lineUserId, lineBoundAt:ts(), bindCode, status:'line_bound', updatedAt:ts() },
    updatedAt:ts()
  }, { merge:true });
  const data = teacherSnap.data() || {};
  const ext = data.externalTeacher || {};
  const url = onboardingUrl(teacherId, b.token || ext.onboardingToken || '');
  if(tools.replyLineMessage) await tools.replyLineMessage(replyToken, `外聘老師 LINE 綁定完成 ✅\n\n您好 ${data.name || ext.name || ''}，系統已完成您的 LINE 綁定。\n\n請回到資料填寫頁，繼續完成身分證明上傳與契約簽署。\n\n${url}`);
  await pushQueue({ eventCode:'external_teacher_line_bound', teacherId, lineUserId, title:'外聘老師 LINE 綁定完成', message:`${data.name || ext.name || ''} 已完成 LINE 綁定。` });
  return true;
}

function registerExternalTeacherContractFlow(exportsObj){
  exportsObj.externalTeacherCreateBindCode = onCall({ region:REGION }, async (request)=>{
    const data = request.data || {};
    const name = clean(data.name);
    const mobile = clean(data.mobile);
    const email = clean(data.email);
    const yearRoc = Number(data.yearRoc || rocYear());
    if(!name) throw new HttpsError('invalid-argument','請填寫姓名。');
    if(!mobile) throw new HttpsError('invalid-argument','請填寫行動電話。');
    if(!email) throw new HttpsError('invalid-argument','請填寫 Email。');
    const teacherId = clean(data.teacherId) || db().collection('employees').doc().id;
    const token = makeToken();
    const bindCode = makeBindCode();
    await ensureTemplate(yearRoc);
    await db().collection('employees').doc(teacherId).set({
      name, mobile, phone:mobile, email, role:'externalTeacher', employmentType:'external',
      externalTeacher:{ name, mobile, email, onboardingToken:token, bindCode, lineBindStatus:'pending', status:'pending_line', currentYearRoc:yearRoc, contractStatus:'not_submitted', updatedAt:ts() },
      updatedAt:ts(), createdAt:ts()
    }, { merge:true });
    await db().collection('externalTeacherLineBindings').doc(bindCode).set({ bindCode, teacherId, teacherName:name, mobile, email, token, yearRoc, status:'pending', expiresAt: admin.firestore.Timestamp.fromMillis(Date.now()+7*24*60*60*1000), createdAt:ts(), updatedAt:ts() });
    return { ok:true, teacherId, token, bindCode, bindText:`外聘老師綁定 ${bindCode}`, onboardingUrl:onboardingUrl(teacherId, token), yearRoc };
  });

  exportsObj.externalTeacherGetFlow = onCall({ region:REGION }, async (request)=>{
    const data = request.data || {};
    const teacherId = clean(data.teacherId);
    const token = clean(data.token);
    const allowMissing = bool(data.allowLocalUser);
    let teacher = {};
    if(teacherId){
      const found = await validateTeacherToken(teacherId, token, allowMissing);
      teacher = { id:teacherId, ...found.data };
    }
    const yearRoc = Number(data.yearRoc || (teacher.externalTeacher && teacher.externalTeacher.currentYearRoc) || rocYear());
    const { template, clauses } = await getTemplateWithClauses(yearRoc);
    const contractText = renderContractText({ template, clauses, teacher, yearRoc, statusLabel:'預覽契約（尚未正式生效）' });
    return { ok:true, teacher, yearRoc, template, clauses, contractText, watermarkText:WATERMARK_TEXT };
  });

  exportsObj.externalTeacherSubmitPreviewContract = onCall({ region:REGION, timeoutSeconds:60, memory:'512MiB' }, async (request)=>{
    const data = request.data || {};
    const teacherId = clean(data.teacherId);
    const token = clean(data.token);
    const found = await validateTeacherToken(teacherId, token, true);
    if(!data.agreeTerms) throw new HttpsError('failed-precondition','請先勾選同意契約內容。');
    if(!data.signatureDataUrl) throw new HttpsError('invalid-argument','請完成簽名。');
    if(!Array.isArray(data.identityPhotos) || data.identityPhotos.length < 1) throw new HttpsError('invalid-argument','請至少上傳一張身分證明照片。');
    const yearRoc = Number(data.yearRoc || rocYear());
    const profile = {
      name: clean(data.name), mobile: clean(data.mobile), email: clean(data.email), idNumber: clean(data.idNumber)
    };
    if(!profile.name || !profile.mobile || !profile.email || !profile.idNumber) throw new HttpsError('invalid-argument','姓名、行動電話、Email、身分證字號皆需填寫。');
    const { template, clauses } = await getTemplateWithClauses(yearRoc);
    const contractId = makeId('ETC');
    const viewToken = makeToken();
    const range = yearRange(yearRoc);
    const identityFiles=[];
    for(let i=0;i<data.identityPhotos.length;i++){
      const item = data.identityPhotos[i] || {};
      const path = `externalTeachers/${teacherId}/identity/${contractId}_${i+1}.jpg`;
      const saved = await saveDataUrl({ dataUrl:item.dataUrl, path, contentType:'image/jpeg' });
      identityFiles.push(Object.assign(saved, { fileName:item.fileName || `identity_${i+1}.jpg`, watermarkText:WATERMARK_TEXT }));
    }
    const signaturePath = `externalTeachers/${teacherId}/signatures/${contractId}.png`;
    const signatureFile = Object.assign(await saveDataUrl({ dataUrl:data.signatureDataUrl, path:signaturePath, contentType:'image/png' }), { fileName:`${contractId}_signature.png` });
    const teacher = Object.assign({}, found.data, { name:profile.name, mobile:profile.mobile, phone:profile.mobile, email:profile.email, externalTeacher:Object.assign({}, found.data.externalTeacher || {}, profile) });
    const contractText = renderContractText({ template, clauses, teacher, yearRoc, statusLabel:'預覽契約（尚未正式生效）' });
    const doc = {
      contractId, teacherId, teacherName:profile.name, yearRoc, yearAD:adYearFromRoc(yearRoc),
      contractStartDate:range.start, contractEndDate:range.end,
      status:'pending_admin_confirm', statusText:'待管理端確認',
      templateId:template.id, templateSnapshot:template, clauseSnapshots:clauses,
      profileSnapshot:profile, contractTextSnapshot:contractText,
      identityFiles, signatureFile, viewToken,
      previewUrl:contractViewUrl(contractId, viewToken), formalUrl:'',
      submittedAt:ts(), createdAt:ts(), updatedAt:ts()
    };
    await db().collection('externalTeacherAnnualContracts').doc(contractId).set(doc);
    await found.ref.set({
      name:profile.name, mobile:profile.mobile, phone:profile.mobile, email:profile.email,
      externalTeacher:Object.assign({}, profile, { currentYearRoc:yearRoc, contractStatus:'pending_admin_confirm', currentContractId:contractId, status:'pending_admin_confirm', identityPhotoStatus:'uploaded', lineBindStatus: found.data.externalTeacher && found.data.externalTeacher.lineBindStatus || 'pending', updatedAt:ts() }),
      updatedAt:ts()
    }, { merge:true });
    await pushQueue({ eventCode:'external_teacher_contract_pending_admin_confirm', teacherId, contractId, title:'外聘老師契約待確認', message:`${profile.name} 已送出 ${yearRoc} 年度外聘老師預覽契約，等待管理端確認。` });
    return { ok:true, contractId, viewToken, status:'pending_admin_confirm', previewUrl:contractViewUrl(contractId, viewToken) };
  });

  exportsObj.externalTeacherGetContractView = onCall({ region:REGION }, async (request)=>{
    const data = request.data || {};
    const contractId = clean(data.contractId);
    const token = clean(data.token);
    if(!contractId || !token) throw new HttpsError('invalid-argument','缺少契約連結資訊。');
    const snap = await db().collection('externalTeacherAnnualContracts').doc(contractId).get();
    if(!snap.exists) throw new HttpsError('not-found','找不到契約。');
    const c = snap.data() || {};
    if(c.viewToken !== token) throw new HttpsError('permission-denied','契約連結無效。');
    return { ok:true, contract:await withSignedFiles(c), isFormal:c.status==='formal_active', watermarkText:c.status==='formal_active' ? '' : '預覽契約　非正式契約' };
  });

  exportsObj.externalTeacherAdminListContracts = onCall({ region:REGION }, async (request)=>{
    const data = request.data || {}; requireAdmin(data);
    const yearRoc = Number(data.yearRoc || rocYear());
    const status = clean(data.status || '');
    let snap = await db().collection('externalTeacherAnnualContracts').where('yearRoc','==',yearRoc).get();
    let rows = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    if(status && status !== 'all') rows = rows.filter(r=>r.status === status);
    rows.sort((a,b)=>String(b.submittedAtText || b.createdAt || '').localeCompare(String(a.submittedAtText || a.createdAt || '')));
    rows = await Promise.all(rows.map(withSignedFiles));
    return { ok:true, yearRoc, rows };
  });

  exportsObj.externalTeacherAdminListTeachers = onCall({ region:REGION }, async (request)=>{
    const data = request.data || {}; requireAdmin(data);
    const snap = await db().collection('employees').get();
    const rows=[];
    snap.forEach(doc=>{ const d=doc.data()||{}; const ext=d.externalTeacher || {}; if(d.role==='externalTeacher' || d.employmentType==='external' || ext.status){ rows.push({ id:doc.id, name:d.name||ext.name||'', mobile:d.mobile||d.phone||ext.mobile||'', email:d.email||ext.email||'', lineBindStatus:ext.lineBindStatus||'', status:ext.status||'', contractStatus:ext.contractStatus||'', currentYearRoc:ext.currentYearRoc||'', currentContractId:ext.currentContractId||'', nonRenewReason:ext.nonRenewReason||'', terminatedReason:ext.terminatedReason||'' }); } });
    rows.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));
    return { ok:true, rows };
  });

  exportsObj.externalTeacherAdminApproveContract = onCall({ region:REGION }, async (request)=>{
    const data = request.data || {}; requireAdmin(data);
    const contractId = clean(data.contractId);
    const adminName = clean((data.adminUser && (data.adminUser.name || data.adminUser.email)) || '管理端');
    const ref = db().collection('externalTeacherAnnualContracts').doc(contractId);
    const snap = await ref.get();
    if(!snap.exists) throw new HttpsError('not-found','找不到契約。');
    const c = snap.data() || {};
    if(c.status !== 'pending_admin_confirm') throw new HttpsError('failed-precondition','只有待確認契約可以轉正式。');
    const formalUrl = contractViewUrl(contractId, c.viewToken);
    await ref.set({ status:'formal_active', statusText:'正式生效', formalUrl, confirmedBy:adminName, confirmedAt:ts(), updatedAt:ts() }, { merge:true });
    await db().collection('employees').doc(c.teacherId).set({ externalTeacher:{ contractStatus:'formal_active', currentContractId:contractId, status:'active', formalContractUrl:formalUrl, updatedAt:ts() }, updatedAt:ts() }, { merge:true });
    const emp = await db().collection('employees').doc(c.teacherId).get();
    const lineUserId = clean((emp.data() || {}).lineUserId || ((emp.data() || {}).externalTeacher || {}).lineUserId);
    const msg = `外聘老師正式契約已成立 ✅\n\n您的民國 ${c.yearRoc} 年度外聘才藝教師委任契約已由柚子樂器確認完成。\n\n請點選下方連結查看正式契約：\n${formalUrl}`;
    await pushTeacherLine(lineUserId, msg, data._lineTools || {});
    await pushQueue({ eventCode:'external_teacher_contract_formal_active', teacherId:c.teacherId, contractId, lineUserId, title:'外聘老師正式契約已成立', message:msg });
    return { ok:true, formalUrl };
  });

  exportsObj.externalTeacherAdminRejectContract = onCall({ region:REGION }, async (request)=>{
    const data = request.data || {}; requireAdmin(data);
    const contractId = clean(data.contractId); const reason = clean(data.reason || '資料需補正');
    const ref = db().collection('externalTeacherAnnualContracts').doc(contractId);
    const snap = await ref.get(); if(!snap.exists) throw new HttpsError('not-found','找不到契約。');
    const c = snap.data() || {};
    await ref.set({ status:'returned_for_revision', statusText:'退回修改', rejectReason:reason, rejectedAt:ts(), updatedAt:ts() }, { merge:true });
    await db().collection('employees').doc(c.teacherId).set({ externalTeacher:{ contractStatus:'returned_for_revision', currentContractId:contractId, status:'returned_for_revision', rejectReason:reason, updatedAt:ts() }, updatedAt:ts() }, { merge:true });
    const emp = await db().collection('employees').doc(c.teacherId).get();
    const ext = ((emp.data() || {}).externalTeacher || {});
    const lineUserId = clean((emp.data() || {}).lineUserId || ext.lineUserId);
    const url = onboardingUrl(c.teacherId, ext.onboardingToken || '');
    const msg = `外聘老師資料需補正\n\n原因：${reason}\n\n請點選下方連結重新補件：\n${url}`;
    await pushTeacherLine(lineUserId, msg, data._lineTools || {});
    await pushQueue({ eventCode:'external_teacher_contract_returned', teacherId:c.teacherId, contractId, lineUserId, title:'外聘老師資料需補正', message:msg });
    return { ok:true };
  });

  exportsObj.externalTeacherAdminSetTeacherStatus = onCall({ region:REGION }, async (request)=>{
    const data = request.data || {}; requireAdmin(data);
    const teacherId = clean(data.teacherId); const status = clean(data.status);
    const reason = clean(data.reason || '');
    if(!teacherId) throw new HttpsError('invalid-argument','缺少老師 ID。');
    const allowed = ['non_renewed','terminated','active'];
    if(!allowed.includes(status)) throw new HttpsError('invalid-argument','狀態不正確。');
    const patch = { status, updatedAt:ts() };
    if(status === 'non_renewed'){ patch.nonRenewReason = reason; patch.nonRenewedAt = ts(); }
    if(status === 'terminated'){ patch.terminatedReason = reason; patch.terminatedAt = ts(); }
    await db().collection('employees').doc(teacherId).set({ externalTeacher:patch, updatedAt:ts() }, { merge:true });
    return { ok:true };
  });

  exportsObj.externalTeacherAdminGetTemplate = onCall({ region:REGION }, async (request)=>{
    const data = request.data || {}; requireAdmin(data);
    const yearRoc = Number(data.yearRoc || rocYear());
    const out = await getTemplateWithClauses(yearRoc);
    return { ok:true, yearRoc, ...out };
  });

  exportsObj.externalTeacherAdminSaveTemplate = onCall({ region:REGION }, async (request)=>{
    const data = request.data || {}; requireAdmin(data);
    const yearRoc = Number(data.yearRoc || rocYear());
    const id = templateDocId(yearRoc);
    const ref = db().collection('externalTeacherContractTemplates').doc(id);
    const title = clean(data.title) || `民國 ${yearRoc} 年度外聘才藝教師委任契約書`;
    await ref.set({ templateId:id, yearRoc, title, version:clean(data.version)||`${yearRoc}-01`, status:'active', watermarkText:WATERMARK_TEXT, updatedAt:ts(), createdAt:ts() }, { merge:true });
    const existing = await ref.collection('clauses').get();
    const batch = db().batch();
    existing.docs.forEach(d=>batch.delete(d.ref));
    const clauses = Array.isArray(data.clauses) ? data.clauses : [];
    clauses.forEach((c,idx)=>{
      const cid = clean(c.id) || `clause_${pad(idx+1)}`;
      batch.set(ref.collection('clauses').doc(cid), { clauseId:cid, articleNo:clean(c.articleNo), title:clean(c.title), content:clean(c.content), sortOrder:Number(c.sortOrder || idx+1), enabled:c.enabled !== false, updatedAt:ts(), createdAt:ts() });
    });
    await batch.commit();
    return { ok:true };
  });
}

module.exports = { registerExternalTeacherContractFlow, handleExternalTeacherContractLineEvent, WATERMARK_TEXT };
