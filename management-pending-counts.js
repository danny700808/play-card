(function(root){
 'use strict';
 const policy=typeof module==='object'&&module.exports?require('./management-pending-records'):root.ManagementPendingRecords;
 const clean=v=>String(v??'').trim(),kinds=['leave','clock','temporary','profile','registration','contract'];
 const suffix={leave:'leave-review',clock:'clock',temporary:'temporary',profile:'profile',registration:'registration',contract:'contract-review'};
 function pending(r){if(r.deleted===true||r.archived===true)return false;if(['approved','rejected','已核准','已駁回','已退回','已取消','已刪除','封存','已同意','未通過','已完成','已結案','cancelled','archived'].includes(clean(r.approvalStatus||r.status||r['狀態']).toLowerCase()))return false;return r.pending===true||['','pending','pending_review','待審核','待主管審核','審核中','待簽核','未處理','待處理'].includes(clean(r.status||r['狀態']).toLowerCase());}
 const rentalAlerts=policy.rentalAlerts;
 function countsFor(sources,roster,scope){
  const index=scope.indexEmployees(roster),counts={},all=new Set(),unknown=new Set(),roles={staff:new Set(),parttime:new Set(),external:new Set()};let failed=false;
  for(const kind of kinds){
   const source=sources[kind],valid=Array.isArray(source);if(!valid)failed=true;
   const sets={staff:new Set(),parttime:new Set(),external:new Set(),unknown:new Set()};
   if(valid)for(const [i,r] of source.entries()){
    if(kind==='clock'&&r.managedByLeaveApproval)continue;
    if(kind==='contract'?!policy.isPendingAdminContract(r):kind!=='registration'&&!pending(r))continue;
    const role=kind==='contract'?'external':scope.classify(r,index),id=kind+':'+clean(r.requestId||r.applicationId||r.assignmentId||r.__id||r.id||('row-'+i));
    sets[role].add(id);all.add(id);(roles[role]||unknown).add(id);
   }
   for(const role of ['staff','parttime','external'])counts[role+'-'+suffix[kind]]=valid?sets[role].size:null;
   counts['unclassified-'+kind]=valid?sets.unknown.size:null;
   if(kind==='contract'){counts['external-teacher-review']=valid?policy.teacherReviewRows(source,'registration').length:null;counts['external-contract-review']=valid?policy.teacherReviewRows(source,'contract').length:null;}
   if(kind==='registration')counts['recruit-registration']=valid?new Set(source.map((r,i)=>r.applicationId||r.__id||r.id||i)).size:null;
  }
  for(const role of Object.keys(roles)){counts[role]=failed?null:roles[role].size;counts[role==='parttime'?'parttime-attendance':role+'-approvals']=counts[role];}
  counts.people=counts.approvals=failed?null:all.size;counts['approval-unclassified']=failed?null:unknown.size;
  const extraFailures=[];
  function extras(kind,accept){const source=sources[kind];if(source===undefined)return [];if(!Array.isArray(source)){extraFailures.push(kind);return null;}return source.filter(accept);}
  function count(rows,id){counts[id]=rows===null?null:new Set((rows||[]).map((r,i)=>clean(r.caseKey||r.requestId||r.applicationId||r.inquiryId||r.__id||r.id)||String(i))).size;return counts[id];}
  const certificates=extras('certificate',pending),applications=extras('application',pending),rentals=sources.rental===null?extras('rental',()=>true):policy.rentalPendingRows(sources.rental||[]).map(r=>({...r,caseKey:policy.rentalCaseKey(r)})),goods=extras('goods',r=>['','待處理','未處理','待回覆','pending','pending_review'].includes(clean(r.status||r.replyStatus)));
  for(const role of ['staff','parttime','external']){const own=certificates===null?null:certificates.filter(r=>scope.classify(r,index)===role);count(own,role==='external'?'external-forms':role+'-certificate');if(own===null)counts[role]=null;else for(const [i,r] of own.entries()){const id='certificate:'+clean(r.requestId||r.__id||r.id||i);roles[role].add(id);all.add(id);}if(counts[role]!==null)counts[role]=roles[role].size;}
  if(certificates)for(const [i,r]of certificates.entries()){const id='certificate:'+clean(r.requestId||r.__id||r.id||i);all.add(id);if(scope.classify(r,index)==='unknown')unknown.add(id);}
  count(certificates===null?null:certificates.filter(r=>clean(r.certificateType)==='employment'),'employment-review');counts.employment=counts['employment-review'];
  count(certificates===null?null:certificates.filter(r=>clean(r.certificateType)==='teaching'),'teaching-review');counts.teaching=counts['teaching-review'];count(certificates,'forms');
  count(applications,'recruit-applications');counts.recruit=counts['recruit-registration']===null||applications===null?null:counts['recruit-registration']+counts['recruit-applications'];
  if(applications)for(const [i,r]of applications.entries())all.add('application:'+clean(r.applicationId||r.__id||r.id||i));
  count(goods,'external-goods');if(goods)for(const [i,r]of goods.entries()){const id='goods:'+clean(r.inquiryId||r.__id||r.id||i);roles.external.add(id);all.add(id);}counts.external=counts.external===null||goods===null?null:roles.external.size;
  count(rentals,'rental-applications');counts.rental=counts['rental-applications'];
  count(rentals===null?null:rentals.filter(r=>rentalAlerts(r).overdue),'rental-overdue');
  count(rentals===null?null:rentals.filter(r=>rentalAlerts(r).reminder),'rental-reminder');
  counts.people=failed||certificates===null||applications===null||goods===null?null:all.size;
  const enrollments=extras('enrollment',policy.enrollmentPending);count(enrollments,'online-enrollment');counts.enrollment=counts['online-enrollment'];
  counts.root=counts.people===null||rentals===null||enrollments===null?null:all.size+counts.rental+counts.enrollment;
  counts['approval-unclassified']=failed||certificates===null?null:unknown.size;
  const coreMap={registration:'approval-0',clock:'approval-1',temporary:'approval-2',leave:'approval-3',profile:'approval-4'};
  for(const[kind,id]of Object.entries(coreMap)){const source=sources[kind];counts[id]=Array.isArray(source)?new Set(source.filter(r=>kind==='registration'||pending(r)).filter(r=>kind!=='clock'||!r.managedByLeaveApproval).map((r,i)=>clean(r.requestId||r.applicationId||r.__id||r.id||i))).size:null;}
  counts.__failed=failed||extraFailures.length>0;return counts;
 }
 const pure={countsFor,pending,rentalAlerts};if(typeof module==='object'&&module.exports){module.exports=pure;return;}
 let busy=false,last=0;
 async function refresh(){
  if(busy||!root.InternalManagementTree)return;busy=true;
  let status=document.getElementById('pendingTreeStatus');if(!status){status=document.createElement('div');status.id='pendingTreeStatus';status.className='personal-pending-status';status.setAttribute('role','status');document.querySelector('[data-management-tree]')?.after(status);}
  root.InternalManagementTree.clearCounts();
  try{
   const user=root.getUser();if(!user||!root.hasSettingsZoneAccess(user))return;
   status.textContent='待處理數字讀取中…';await root.ensureHrSession(user);
   const roster=await root.api('getEmployeeManagementData',{userId:user.id,statusMode:'all'});if(!roster||roster.ok===false||!Array.isArray(roster.rows))throw Error('人員分類讀取失敗');
   const request=async(action)=>{const r=await root.api(action,{userId:user.id});if(!r||r.ok===false||!Array.isArray(r.rows||r.list))throw Error(r?.message||action);return r.rows||r.list;};
   const server=async(name)=>{const r=await root.YZProtectedData.call(name,{});if(!Array.isArray(r.rows))throw Error(name);return r.rows;};
   const readCollection=async name=>(await root.firebase.firestore().collection(name).get()).docs.map(d=>({...d.data(),id:d.id,__id:d.id}));
   const teacherSource=async()=>{const [contracts,profiles,assignments]=await Promise.all([readCollection('externalTeacherContracts'),readCollection('externalTeacherProfiles'),server('personDataAdminContractInventory')]);return policy.mergeExternalTeacherRows(contracts,profiles).concat(assignments);};
   const rentalSource=async()=>{const [applications,contracts]=await Promise.all([readCollection('rentalApplications'),readCollection('rentalContracts')]);return applications.map(r=>({...r,kind:'application'})).concat(contracts.map(r=>({...r,kind:'contract'})));};
   const enrollmentSource=async()=>{const rows=await policy.readEnrollmentRows((name,data)=>root.YZProtectedData.call(name,data));return rows.map(r=>({id:r.id,status:r.status}));};
   // Legacy GAS applications are retained under Common functions. They are not current teacher registrations.
   const jobs=[request('getPendingLeaveApprovals'),request('getPendingClockCorrections'),readCollection('temporaryAttendanceRequests'),server('personDataAdminProfileChangeInventory'),request('getPendingRegistrations'),teacherSource(),readCollection('certificateApplications'),Promise.resolve([]),rentalSource(),readCollection('teacherGoodsInquiry'),enrollmentSource()];
   const allKinds=kinds.concat(['certificate','application','rental','goods','enrollment']),labels=['請假','打卡','臨時出勤','個資','入職','老師資料及合約','證明','舊版應聘','租賃','老師詢價','線上報名'];
   const sources=Object.fromEntries(allKinds.map(kind=>[kind,null]));
   const results=await Promise.allSettled(jobs.map((job,i)=>job.then(rows=>{sources[allKinds[i]]=rows;return rows;})));
   const counts=countsFor(sources,roster.rows,root.PersonnelApprovalScope);for(const[id,count]of Object.entries(counts))root.InternalManagementTree.setNodeCount(id,count);root.InternalManagementTree.setCount('badge-approval',counts.people);
   const errors=results.flatMap((r,i)=>r.status==='rejected'?[labels[i]+'：'+(r.reason?.message||'讀取失敗')]:[]);
   status.textContent=errors.length?'部分待辦尚未能讀取，相關數字暫不顯示。'+errors.join('；'):'';last=Date.now();
  }catch(e){root.InternalManagementTree.clearCounts();status.textContent='待處理資料讀取失敗，數字暫不顯示，請重新整理。';}finally{busy=false;}
 }
 root.PersonalPendingCounts={refresh};root.addEventListener('load',refresh);root.addEventListener('focus',()=>{if(Date.now()-last>30000)refresh();});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-last>30000)refresh();});
})(typeof window==='object'?window:this);
