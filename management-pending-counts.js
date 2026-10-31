(function(root){
 'use strict';
 const clean=v=>String(v??'').trim(),kinds=['leave','clock','temporary','profile','registration','contract'];
 const suffix={leave:'leave-review',clock:'clock',temporary:'temporary',profile:'profile',registration:'registration',contract:'contract-review'};
 function pending(r){if(['approved','rejected','已核准','已駁回'].includes(clean(r.approvalStatus).toLowerCase()))return false;return r.pending===true||['','pending','pending_review','待審核','待主管審核','未處理'].includes(clean(r.status||r['狀態']).toLowerCase());}
 function countsFor(sources,roster,scope){
  const index=scope.indexEmployees(roster),counts={},all=new Set(),unknown=new Set(),roles={staff:new Set(),parttime:new Set(),external:new Set()};let failed=false;
  for(const kind of kinds){
   const source=sources[kind],valid=Array.isArray(source);if(!valid)failed=true;
   const sets={staff:new Set(),parttime:new Set(),external:new Set(),unknown:new Set()};
   if(valid)for(const [i,r] of source.entries()){
    if(kind==='clock'&&r.managedByLeaveApproval)continue;
    if(kind==='contract'?r.status!=='submitted_pending_admin':kind!=='registration'&&!pending(r))continue;
    const role=kind==='contract'?'external':scope.classify(r,index),id=kind+':'+clean(r.requestId||r.applicationId||r.assignmentId||r.__id||r.id||('row-'+i));
    sets[role].add(id);all.add(id);(roles[role]||unknown).add(id);
   }
   for(const role of ['staff','parttime','external'])counts[role+'-'+suffix[kind]]=valid?sets[role].size:null;
   counts['unclassified-'+kind]=valid?sets.unknown.size:null;
   if(kind==='registration')counts['recruit-registration']=valid?new Set(source.map((r,i)=>r.applicationId||r.__id||r.id||i)).size:null;
  }
  for(const role of Object.keys(roles)){counts[role]=failed?null:roles[role].size;counts[role==='parttime'?'parttime-attendance':role+'-approvals']=counts[role];}
  counts.people=counts.approvals=failed?null:all.size;counts['approval-unclassified']=failed?null:unknown.size;
  counts.recruit=counts['recruit-registration'];return counts;
 }
 const pure={countsFor,pending};if(typeof module==='object'&&module.exports){module.exports=pure;return;}
 let busy=false,last=0;
 async function refresh(){
  if(busy||!root.InternalManagementTree)return;busy=true;
  let status=document.getElementById('pendingTreeStatus');if(!status){status=document.createElement('div');status.id='pendingTreeStatus';status.className='personal-pending-status';status.setAttribute('role','status');document.querySelector('[data-management-tree]')?.after(status);}
  try{
   const user=root.getUser();if(!user||!root.hasSettingsZoneAccess(user))return;
   status.textContent='待處理數字讀取中…';await root.ensureHrSession(user);
   const roster=await root.api('getEmployeeManagementData',{userId:user.id,statusMode:'all'});if(!roster||roster.ok===false||!Array.isArray(roster.rows))throw Error('人員分類讀取失敗');
   const request=async(action)=>{const r=await root.api(action,{userId:user.id});if(!r||r.ok===false||!Array.isArray(r.rows||r.list))throw Error(action);return r.rows||r.list;};
   const server=async(name)=>{const r=await root.YZProtectedData.call(name,{});if(!Array.isArray(r.rows))throw Error(name);return r.rows;};
   const results=await Promise.allSettled([request('getPendingLeaveApprovals'),request('getPendingClockCorrections'),root.firebase.firestore().collection('temporaryAttendanceRequests').get().then(s=>s.docs.map(d=>({__id:d.id,...d.data()}))),server('personDataAdminProfileChangeInventory'),request('getPendingRegistrations'),server('personDataAdminContractInventory')]);
   const sources=Object.fromEntries(kinds.map((kind,i)=>[kind,results[i].status==='fulfilled'?results[i].value:null]));
   const counts=countsFor(sources,roster.rows,root.PersonnelApprovalScope);
   for(const [id,count] of Object.entries(counts))root.InternalManagementTree.setNodeCount(id,count);
   const failed=results.some(r=>r.status==='rejected');status.textContent=failed?'部分待處理數字未能讀取，請重新整理。':'';last=Date.now();
  }catch(e){status.textContent='待處理數字讀取失敗，請重新整理。';for(const id of ['people','staff','parttime','external'])root.InternalManagementTree.setNodeCount(id,null);}finally{busy=false;}
 }
 root.PersonalPendingCounts={refresh};root.addEventListener('load',refresh);root.addEventListener('focus',()=>{if(Date.now()-last>30000)refresh();});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-last>30000)refresh();});
})(typeof window==='object'?window:this);
