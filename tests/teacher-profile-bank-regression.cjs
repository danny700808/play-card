const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, '../functions/coursePortal.js'), 'utf8');
function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }
const clean = x => String(x == null ? '' : x).trim();
const first = (rows, keys) => { for (const row of rows) for (const key of keys) if (clean(row[key])) return clean(row[key]); return ''; };
async function scenario(id, legacy) {
  const original = {bankAccountName: '測試戶名', bankAccountNumber: '0012345678'};
  const records = new Map([
    ['externalTeacherProfiles/' + id, {name: '測試老師', status: 'approved', ...(legacy ? original : {})}],
    ['teacherPrivateProfiles/' + id, legacy ? {} : {...original}],
    ['employees/' + id, {active: true}]
  ]);
  const writes = [];
  const ctx = {clean, normalizePhone: clean, normalizeEmail: clean, jsonValue: x => x,
    teacherUtilityFirstText: first, teacherUtilityTeachingAbilities: () => [], teacherUtilityIdentityUrls: () => [],
    teacherUtilityMaskedId: clean, teacherPortalProfileUrl: () => 'teacher-profile.html',
    teacherUtilityDraftAbilities: x => x, teacherUtilityDraftText: (d,k,n) => Object.hasOwn(d,k) ? clean(d[k]).slice(0,n) : undefined,
    requireSession: async () => ({teacherId:id}), teacherPortalProfileIsCurrent: () => true,
    teacherPortalProfileStatusIsConfirmed: x => x.status === 'approved', isExternalTeacherEmployee: () => true,
    profileDraftSnapshot: (a,b) => ({...a,...b}),
    profileChangeRows: (a,b) => Object.keys(b).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(key => ({key})),
    externalTeacherProfileMissingFields: x => ['bankAccountName','bankAccountNumber'].filter(k => !x[k]).map(label => ({label})),
    FieldValue: {serverTimestamp: () => 'TIMESTAMP', delete: () => 'DELETE'}, nowText: () => 'TEST',
    HttpsError: class extends Error { constructor(code,msg) {super(msg);this.code=code;} },
    TEACHER_PROFILE_DRAFTS:'teacherProfileDrafts', TEACHER_PROFILE_CHANGE_DRAFTS:'teacherProfileChangeDrafts',
    TEACHER_SUBJECT_ASSIGNMENTS_COLLECTION:'subjects', TEACHER_PORTAL_PROFILE_VERSION:1, TEACHER_PORTAL_PROFILE_SOURCE:'test',
    db: {collection: c => ({doc: (key='request') => ({id:key, path:c+'/'+key, get: async () => ({exists:records.has(c+'/'+key),data: () => records.get(c+'/'+key)})})}),
      batch: () => {const queue=[];return {set:(r,d,o)=>queue.push([r.path,d,o]),commit:async()=>{for(const [p,d,o] of queue){writes.push(p);records.set(p,o?.merge?{...records.get(p),...d}:d);}}};}}
  };
  vm.createContext(ctx);
  vm.runInContext(section('function teacherUtilityProfileBundle(', 'async function resolveTeacherUtilityEmployee(') + section('function teacherUtilityPublicProfile(', 'async function teacherUtilitySession('),ctx);
  ctx.resolveTeacherUtilityEmployee = async () => ({employeeId:id,user:{portalProfileId:id},profile:ctx.teacherUtilityProfileBundle({externalProfile:records.get('externalTeacherProfiles/'+id),privateProfile:records.get('teacherPrivateProfiles/'+id)}).profile});
  const call = d => ctx.teacherUtilitySaveProfileDraft(d);
  // Unchanged displayed legacy accounts must save without a false confirmation error.
  await call({...original});
  assert.equal(records.get('teacherProfileDrafts/'+id).privateProfile.bankAccountNumber,original.bankAccountNumber);
  assert(!writes.some(p=>p.startsWith('profileChangeRequests/')));
  await assert.rejects(call({bankAccountNumber:'00999'}),/再次核對/);
  await assert.rejects(call({bankAccountNumber:'00-999',bankConfirmed:true}),/只接受數字/);
  // Blank values survive a save and a fresh session instead of refilling from official data.
  const cleared = await call({bankAccountName:'',bankAccountNumber:''});
  assert.equal(cleared.profile.bankAccountName,'');assert.equal(cleared.profile.bankAccountNumber,'');
  await assert.rejects(call({submitForReview:true}),/資料尚缺/);
  const submitted = await call({bankAccountName:'新測試戶名',bankAccountNumber:'00999',bankConfirmed:true,submitForReview:true});
  assert.equal(submitted.profileChangePending,true);
  assert(records.has('profileChangeRequests/request'));
  assert(!Object.hasOwn(records.get('teacherProfileChangeDrafts/request'),'revisionReason'));
  await assert.rejects(call({name:'其他'}),/已送出主管確認/);
  assert(!writes.some(p=>/contract/i.test(p)));
  const bundle = ctx.teacherUtilityProfileBundle({externalProfile:original,privateProfile:{bankAccountName:'',bankAccountNumber:''}});
  assert.equal(bundle.profile.bankAccountNumber,'');
  console.log('PASS '+id+': save, clear/reload, validation, confirmed submit, review lock, no contract writes');
}
(async()=>{await scenario('teacher-current',false);await scenario('teacher-legacy',true);})().catch(e=>{console.error(e);process.exit(1);});
