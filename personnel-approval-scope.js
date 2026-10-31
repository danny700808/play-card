/* Read-only personnel grouping for approval lists. Never grants authority or changes records. */
(function(root){
 'use strict';
 const labels={all:'全部人員',staff:'專職人員',parttime:'工讀生',external:'外聘老師',unknown:'待分類'};
 const clean=v=>String(v??'').trim();
 function normalize(v){const s=clean(v).toLowerCase();if(['staff','fulltime','full-time','專職','專職人員','正職','正職員工'].includes(s))return 'staff';if(['parttime','part-time','工讀','工讀生','兼職'].includes(s))return 'parttime';if(['external','外聘','外聘老師','外聘教師','外聘人員'].includes(s))return 'external';return '';}
 function explicit(row){for(const source of [row,row?.raw]){if(!source)continue;for(const key of ['requestedIdentityType','identityType','employeeType','身分類型','身份類型','員工身分','identityLabel']){if(clean(source[key]))return normalize(source[key])||'unknown';}}return '';}
 function employeeIds(row){return [...new Set([row?.employeeId,row?.['員工ID'],row?.userId,row?.['申請人ID'],row?.raw?.employeeId,row?.raw?.['員工ID']].map(clean).filter(Boolean))];}
 function indexEmployees(rows){const map=new Map();for(const row of rows||[]){const type=explicit(row)||'unknown';for(const id of [...employeeIds(row),clean(row.id),clean(row.__id)].filter(Boolean)){map.set(id,map.has(id)&&map.get(id)!==type?'unknown':type);}}return map;}
 function classify(row,index){const type=explicit(row);if(type)return type;const matches=[...new Set(employeeIds(row).map(id=>index?.get(id)).filter(Boolean))];if(matches.length)return matches.length===1?matches[0]:'unknown';if(clean(row?.teacherId))return 'external';return 'unknown';}
 const pure={normalize,indexEmployees,classify};
 if(typeof module==='object'&&module.exports){module.exports=pure;return;}
 let index=new Map(),loaded=false,inflight=null,select=null,rerender=()=>{};
 let scope=new URLSearchParams(location.search).get('identity')||'all';if(!labels[scope])scope='all';
 function filter(rows){return (rows||[]).filter(row=>scope==='all'||classify(row,index)===scope);}
 function mount(onChange){
  rerender=onChange||rerender;if(select)return;
  const toolbar=document.querySelector('.approval-toolbar')||document.querySelector('#leaveApprovalSearch')?.parentElement;
  if(!toolbar)return;
  const label=document.createElement('label');label.className='personnel-approval-filter';label.textContent='人員';select=document.createElement('select');select.setAttribute('aria-label','簽核人員分類');
  for(const [value,text] of Object.entries(labels)){const o=document.createElement('option');o.value=value;o.textContent=text;select.append(o);}select.value=scope;label.append(select);toolbar.prepend(label);
  select.addEventListener('change',()=>{scope=select.value;const u=new URL(location.href);u.searchParams.delete('nav');if(scope==='all')u.searchParams.delete('identity');else u.searchParams.set('identity',scope);history.replaceState(null,'',u.pathname+u.search+u.hash);root.InternalWorkspaceNavigation?.refresh?.();rerender();});
 }
 async function load(onChange,{roster=true}={}){
  mount(onChange);if(loaded)return;
  if(!inflight)inflight=(async()=>{
   const user=JSON.parse(localStorage.getItem('employeeUser')||'null');
   if(!user||typeof root.hasSettingsZoneAccess!=='function'||!root.hasSettingsZoneAccess(user))throw new Error('無法讀取人員分類，請重新登入管理帳號。');
   if(typeof root.ensureHrSession==='function')await root.ensureHrSession(user);
   else if(root.YZManagerAuth?.requireManagerSession)await root.YZManagerAuth.requireManagerSession({expectedManager:user,next:location.pathname.split('/').pop()+location.search});
   else throw new Error('登入服務尚未就緒，請重新整理。');
   if(roster){
    const res=await root.api('getEmployeeManagementData',{userId:user.id,statusMode:'all'});
    if(!res||res.ok===false||!Array.isArray(res.rows))throw new Error('人員分類讀取失敗，請重新整理。');
    index=indexEmployees(res.rows);
   }
   loaded=true;
  })().finally(()=>{inflight=null;});
  await inflight;
 }
 root.PersonnelApprovalScope={...pure,load,filter,get scope(){return scope;}};
})(typeof window==='object'?window:this);
