
(function(global){
  const cfg = (global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG) || null;
  let db = null;

  function enabled(){
    return !!(global.APP_CONFIG && global.APP_CONFIG.FIREBASE_ENABLED && cfg && cfg.projectId && global.firebase && global.firebase.firestore);
  }
  function init(){
    if(!enabled()) return null;
    if(db) return db;
    try{
      const apps = global.firebase.apps || [];
      const app = apps.length ? apps[0] : global.firebase.initializeApp(cfg);
      db = global.firebase.firestore(app);
      return db;
    }catch(err){ console.warn('[Firebase] init failed:', err); return null; }
  }
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ const s=lower(v); return v===true || ['是','yes','true','1','啟用','enabled','active'].indexOf(s)>=0; }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function todayKey(){ return ymd(new Date()); }
  function timeText(d){ return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function addDays(dateKey, days){ const d=new Date(clean(dateKey)+'T00:00:00'); if(isNaN(d.getTime())) return ''; d.setDate(d.getDate()+Number(days||0)); return ymd(d); }
  function inTodayOrYesterday(dateKey){ const t=todayKey(); return clean(dateKey)===t || clean(dateKey)===addDays(t,-1); }
  function fmtDate(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') return ymd(v.toDate());
    if(v instanceof Date && !isNaN(v.getTime())) return ymd(v);
    const s=clean(v); if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const d=new Date(s); return isNaN(d.getTime()) ? s : ymd(d);
  }
  function fmtDateTime(v){
    if(!v) return '';
    const d = v && typeof v.toDate==='function' ? v.toDate() : (v instanceof Date ? v : new Date(v));
    if(isNaN(d.getTime())) return clean(v);
    return ymd(d)+' '+timeText(d);
  }
  function currentUser(){ try{return JSON.parse(localStorage.getItem('employeeUser')||'null')}catch(e){return null} }
  async function getAll(collection){ const d=init(); if(!d) throw new Error('Firebase 尚未啟用'); const snap=await d.collection(collection).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  async function queryEq(collection, field, value){ const d=init(); if(!d) throw new Error('Firebase 尚未啟用'); const snap=await d.collection(collection).where(field,'==', value).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  async function getDocByIdOrField(collection, id, field){
    const d=init(); if(!d) throw new Error('Firebase 尚未啟用');
    const key=clean(id); if(!key) return null;
    const doc=await d.collection(collection).doc(key).get();
    if(doc.exists) return Object.assign({__id:doc.id}, doc.data()||{});
    const rows=await queryEq(collection, field||'employeeId', key);
    return rows[0] || null;
  }

  function normalizeEmployee(o){
    o=o||{};
    const identityType = lower(o.identityType || o['身分類型']) || (truthy(o.isPartTime || o['是否工讀生']) ? 'parttime' : 'staff');
    return {
      employeeId: clean(o.employeeId || o['員工ID'] || o.__id),
      id: clean(o.employeeId || o['員工ID'] || o.__id),
      name: clean(o.name || o['姓名']),
      email: lower(o.email || o['Email']),
      role: lower(o.role || o['角色'] || 'staff') || 'staff',
      identityType: identityType,
      identityLabel: identityType==='parttime'?'工讀生':(identityType==='external'?'外聘老師':'專職員工'),
      isPartTime: identityType==='parttime',
      accountStatus: clean(o.accountStatus || o['帳號狀態'] || 'active'),
      lineUserId: clean(o.lineUserId || o['LINE User ID']),
      lineNotifyEnabled: truthy(o.lineNotifyEnabled || o['LINE 通知啟用']),
      mobilePhone: clean(o.mobilePhone || o['行動電話']),
      address: clean(o.address || o.contactAddress || o['聯絡地址']),
      birthDate: fmtDate(o.birthDate || o['出生年月日']),
      hireDate: fmtDate(o.hireDate || o['到職日']),
      emergencyContact: clean(o.emergencyContact || o['緊急聯絡人']),
      emergencyPhone: clean(o.emergencyPhone || o['緊急聯絡人電話']),
      idNumberMasked: maskId(o.idNumber || o['身分證字號']),
      annualLeaveTotal: Number(o.annualLeaveTotal || o['年度可用特休天數'] || 0) || 0,
      annualLeaveUsed: Number(o.annualLeaveUsed || o['已使用特休'] || 0) || 0,
      annualLeaveRemaining: Number(o.annualLeaveRemaining || o['剩餘特休'] || 0) || 0
    };
  }
  function maskId(v){ const s=clean(v).toUpperCase(); if(!s) return ''; return s.length<=4 ? s : s.slice(0,1)+'*****'+s.slice(-4); }
  async function getEmployee(employeeId){ const o=await getDocByIdOrField('employees', employeeId, 'employeeId'); return o ? normalizeEmployee(o) : null; }
  async function getMyProfile(userId){ const emp=await getEmployee(userId); if(!emp) return {ok:false,message:'Firebase 找不到員工資料'}; return {ok:true,profile:{ employeeId:emp.employeeId,name:emp.name,birthDate:emp.birthDate,idNumberMasked:emp.idNumberMasked,hireDate:emp.hireDate,emergencyContact:emp.emergencyContact,emergencyPhone:emp.emergencyPhone,mobilePhone:emp.mobilePhone,address:emp.address,email:emp.email,annualLeaveTotal:emp.annualLeaveTotal,annualLeaveUsed:emp.annualLeaveUsed,annualLeaveRemaining:emp.annualLeaveRemaining }}; }

  function normalizeClockDoc(doc){
    const data = doc.data ? (doc.data() || {}) : (doc || {});
    const date = clean(data.clockDate || data.date || data['打卡日期']);
    const time = clean(data.clockTime || data.time || data['打卡時間']);
    const status = clean(data.status || data['狀態'] || '正常') || '正常';
    return { id:clean(data.recordId||data.id||doc.id||data['紀錄ID']), recordId:clean(data.recordId||data.id||doc.id||data['紀錄ID']), employeeId:clean(data.employeeId||data['員工ID']), name:clean(data.name||data['姓名']), email:lower(data.email||data['Email']), date, time, actionName:clean(data.actionName||data['打卡動作']), clockType:clean(data.clockType||data['打卡方式']||'標準打卡')||'標準打卡', status, lateMinutes:Number(data.lateMinutes||data['遲到分鐘']||0)||0, note:clean(data.note||data['備註']), sourceIp:clean(data.sourceIp||data.clientIp||data['來源IP']), isSupplement:data.isSupplement===true||clean(data.isSupplement||data['是否補登'])==='是', originalRef:clean(data.originalRecordId||data.originalRef||data['原始紀錄ID']), canModify:inTodayOrYesterday(date) };
  }
  function sortClockRows(rows){ return (rows||[]).slice().sort((a,b)=>(clean(b.date)+' '+clean(b.time)).localeCompare(clean(a.date)+' '+clean(a.time))); }
  async function getClockRowsByEmployee(employeeId){ const rows=await queryEq('clockRecords','employeeId',clean(employeeId)); return sortClockRows(rows.map(normalizeClockDoc)); }
  async function getEditableClockHistory(employeeId){ return (await getClockRowsByEmployee(employeeId)).filter(r=>inTodayOrYesterday(r.date)); }
  async function getClockHistoryRange(employeeId,startDate,endDate){ const s=clean(startDate),e=clean(endDate); return (await getClockRowsByEmployee(employeeId)).filter(r=>clean(r.date)>=s&&clean(r.date)<=e); }
  async function addClockRecordFromClient(payload){ const d=init(); if(!d) return {ok:false,message:'Firebase 尚未啟用'}; const now=new Date(); const employeeId=clean(payload.employeeId||payload.userId); const recordId=clean(payload.recordId)||('WEB_'+employeeId+'_'+now.getTime()); const row={recordId,employeeId,name:clean(payload.name),email:lower(payload.email),clockDate:clean(payload.clockDate)||ymd(now),clockTime:clean(payload.clockTime)||timeText(now),actionName:clean(payload.actionName),clockType:clean(payload.clockType||'標準打卡')||'標準打卡',status:clean(payload.status||'正常')||'正常',lateMinutes:Number(payload.lateMinutes||0)||0,note:clean(payload.note||''),sourceIp:clean(payload.sourceIp||''),isSupplement:false,originalRecordId:'',source:'web-after-gas-ok',createdAt:global.firebase.firestore.FieldValue.serverTimestamp(),updatedAt:global.firebase.firestore.FieldValue.serverTimestamp()}; await d.collection('clockRecords').doc(recordId).set(row,{merge:true}); return {ok:true,recordId}; }

  function normalizeLeave(o){
    o=o||{};
    const requestId=clean(o.requestId||o.leaveId||o['請假ID']||o.__id);
    const reason=clean(o.reason||o.leaveName||o['請假原因']||'請假');
    const start=fmtDate(o.startDate||o.leaveDate||o['開始日期']||o['請假日期']);
    const end=fmtDate(o.endDate||o['結束日期']||start);
    const hours=Number(o.hours||o.leaveHours||o['請假時數']||0)||0;
    const status=clean(o.status||o['狀態']||'待審核')||'待審核';
    const simple=(start && end && start!==end) ? `${reason}｜${start}～${end}｜${hours}小時` : `${reason}｜${hours?hours+'小時':''}`;
    return { requestId, employeeId:clean(o.employeeId||o['員工ID']), name:clean(o.name||o['姓名']), email:lower(o.email||o['Email']), reason, leaveCode:clean(o.leaveCode||o['假別代碼']), leaveDate:start, startDate:start, endDate:end, startTime:clean(o.startTime||o['請假開始時間']), endTime:clean(o.endTime||o['請假結束時間']), session:clean(o.session||o['請假時段']), hours, note:clean(o.note||o['備註']), attachmentUrl:clean(o.attachmentUrl||o['附件連結']), status, modifyCount:Number(o.modifyCount||o['修改次數']||0)||0, requestedAt:fmtDateTime(o.requestedAt||o.createdAt||o['建立時間']), createdAt:fmtDateTime(o.createdAt||o['建立時間']), simpleText:simple, canEdit:status==='待審核'||status==='已駁回', canDelete:status==='待審核'||status==='已駁回' };
  }
  async function getLeaveHistory(userId){ const rows=(await queryEq('leaveRequests','employeeId',clean(userId))).map(normalizeLeave).sort((a,b)=>clean(b.leaveDate).localeCompare(clean(a.leaveDate))); return {ok:true,year:(new Date()).getFullYear(),rows,eventCandidates:[]}; }
  async function getPendingLeaveApprovals(){ const rows=(await queryEq('leaveRequests','status','待審核')).map(normalizeLeave); return {ok:true,rows}; }
  async function getAdminLeaveEmployeeSummary(){ const [emps, leaves]=await Promise.all([getAll('employees'), getAll('leaveRequests')]); const by={}; leaves.map(normalizeLeave).forEach(r=>{ by[r.employeeId]=by[r.employeeId]||[]; by[r.employeeId].push(r); }); const rows=emps.map(normalizeEmployee).filter(e=>e.employeeId).map(e=>{ const list=by[e.employeeId]||[]; const approved=list.filter(x=>x.status==='已核准').reduce((s,x)=>s+(Number(x.hours)||0),0); const pending=list.filter(x=>x.status==='待審核').length; return {name:e.name, identityLabel:e.identityLabel, lines:[`已核准請假：${approved} 小時`, `待審核：${pending} 筆`]}; }); return {ok:true,rows}; }

  function normalizeParttime(o){ o=o||{}; const total=Number(o.totalHours||o['總時數']||o.hours||o['時數']||0)||0; return {id:clean(o.recordId||o['紀錄ID']||o.__id),employeeId:clean(o.employeeId||o['員工ID']),date:fmtDate(o.date||o.workDate||o['日期']),hours:Number(o.hours||o['時數']||0)||0,totalHours:total,halfHour:truthy(o.halfHour||o['是否加半小時']),status:clean(o.status||o['狀態']||'正常')||'正常',note:clean(o.note||o['備註']),scheduleLabel:clean(o.scheduleLabel||o['班表狀態']),hourlyRate:Number(o.hourlyRate||o['時薪']||0)||0,grossPay:Number(o.grossPay||o['當筆毛額']||0)||0}; }
  async function getParttimeHistory(userId, monthText){ const month=clean(monthText)||ymd(new Date()).slice(0,7); const rows=(await queryEq('parttimeRecords','employeeId',clean(userId))).map(normalizeParttime).filter(r=>clean(r.date).slice(0,7)===month).sort((a,b)=>clean(b.date).localeCompare(clean(a.date))); const total=Math.round(rows.reduce((s,r)=>s+(Number(r.totalHours)||0),0)*100)/100; const pay=Math.round(rows.reduce((s,r)=>s+(Number(r.grossPay)||0),0)); return {ok:true,monthText:month,monthTotalHours:total,monthGrossPay:pay,rows,list:rows}; }

  function normalizeNotify(o){ o=o||{}; return Object.assign({},o,{eventCode:clean(o.eventCode||o['事件代碼']||o.__id),eventName:clean(o.eventName||o['事件名稱'])}); }
  async function getNotificationSettings(){ return {ok:true,rows:(await getAll('notificationSettings')).map(normalizeNotify)}; }
  async function getNotificationTimeRules(){ let rows=[]; try{ rows=await getAll('notificationTimeRules'); }catch(e){} return {ok:true,rows}; }
  async function mirrorNotificationSettings(rows){ const d=init(); if(!d) return; const batch=d.batch(); (rows||[]).forEach(r=>{ const id=clean(r.eventCode||r.eventKey||r.eventName); if(id) batch.set(d.collection('notificationSettings').doc(id), Object.assign({},r,{updatedAt:global.firebase.firestore.FieldValue.serverTimestamp()}), {merge:true}); }); await batch.commit(); }
  async function mirrorNotificationTimeRules(rows){ const d=init(); if(!d) return; const batch=d.batch(); (rows||[]).forEach(r=>{ const id=clean(r.ruleCode||r.identityType); if(id) batch.set(d.collection('notificationTimeRules').doc(id), Object.assign({},r,{updatedAt:global.firebase.firestore.FieldValue.serverTimestamp()}), {merge:true}); }); await batch.commit(); }

  async function getDashboardSummary(payload){ const user=currentUser()||{}; const role=lower(payload&&payload.role || user.role); const uid=clean(payload&&payload.userId || user.id || user.employeeId); if(role==='admin' || user.showSettingsZone){ const [leaves, corrections]=await Promise.all([getPendingLeaveApprovals().catch(()=>({rows:[]})), queryEq('clockCorrections','status','待審核').catch(()=>[])]); return {ok:true,counts:{leaves:(leaves.rows||[]).length,clocks:corrections.length,clockCorrections:corrections.length,tasks:0,routines:0,announcements:0,registrations:0,contracts:0,goodsInquiries:0}}; } const [leaves, clocks, pts]=await Promise.all([getLeaveHistory(uid).catch(()=>({rows:[]})), getEditableClockHistory(uid).catch(()=>[]), getParttimeHistory(uid,'').catch(()=>({rows:[]}))]); return {ok:true,counts:{leaves:(leaves.rows||[]).filter(x=>x.status==='待審核').length,clocks:(clocks||[]).length,parttime:(pts.rows||[]).length,tasks:0,routines:0,announcements:0}}; }
  async function getPendingCounts(payload){ return getDashboardSummary(Object.assign({},payload,{role:'admin'})); }


  function pick(obj, keys){ for(const k of keys){ if(obj && obj[k] != null && clean(obj[k]) !== '') return obj[k]; } return ''; }
  function serverTs(){ return global.firebase.firestore.FieldValue.serverTimestamp(); }
  async function setCollectionDoc(collection, id, data){
    const d=init(); if(!d) return {ok:false,message:'Firebase 尚未啟用'};
    const docId=clean(id) || ('WEB_'+Date.now()+'_'+Math.random().toString(36).slice(2,8));
    await d.collection(collection).doc(docId).set(Object.assign({}, data, {updatedAt:serverTs()}), {merge:true});
    return {ok:true,id:docId};
  }
  function flattenLeaveResult(payload, result){
    const row = (result && result.row) || {};
    const requestId = clean(pick(row, ['請假ID','requestId','leaveId'])) || clean(result && (result.requestId || result.leaveId)) || clean(payload.requestId) || clean(payload.leaveId);
    const user = currentUser() || {};
    const firstSeg = Array.isArray(payload.segments) && payload.segments.length ? payload.segments[0] : {};
    return {
      requestId: requestId || ('LV_'+clean(payload.userId||user.id||'USER')+'_'+Date.now()),
      employeeId: clean(pick(row, ['員工ID','employeeId'])) || clean(payload.userId || user.id || user.employeeId),
      name: clean(pick(row, ['姓名','name'])) || clean(user.name),
      email: lower(pick(row, ['Email','email']) || user.email),
      reason: clean(payload.reason || payload.leaveName || pick(row, ['請假原因','reason']) || '請假'),
      leaveCode: clean(payload.leaveCode || pick(row, ['假別代碼','leaveCode'])),
      bereavementRelation: clean(payload.bereavementRelation || pick(row, ['喪假關係人','bereavementRelation'])),
      leaveDate: fmtDate(pick(row, ['請假日期','leaveDate']) || firstSeg.date || firstSeg.startDate),
      startDate: fmtDate(pick(row, ['開始日期','startDate']) || firstSeg.startDate || firstSeg.date),
      endDate: fmtDate(pick(row, ['結束日期','endDate']) || firstSeg.endDate || firstSeg.date || firstSeg.startDate),
      startTime: clean(pick(row, ['請假開始時間','startTime']) || firstSeg.startTime),
      endTime: clean(pick(row, ['請假結束時間','endTime']) || firstSeg.endTime),
      session: clean(pick(row, ['請假時段','session']) || firstSeg.session),
      hours: Number(pick(row, ['請假時數','hours']) || firstSeg.hours || 0) || 0,
      note: clean(payload.note || pick(row, ['備註','note'])),
      attachmentUrl: clean(pick(row, ['附件連結','attachmentUrl'])),
      status: clean(pick(row, ['狀態','status']) || '待審核') || '待審核',
      modifyCount: Number(pick(row, ['修改次數','modifyCount']) || 0) || 0,
      segments: Array.isArray(payload.segments) ? payload.segments : [],
      source: 'gs-double-write',
      createdAt: serverTs()
    };
  }
  function flattenParttimeResult(payload, result){
    const row = (result && result.row) || {};
    const user = currentUser() || {};
    const recordId = clean(pick(row, ['紀錄ID','recordId'])) || clean(result && result.recordId) || ('PT_'+clean(payload.userId||user.id||'USER')+'_'+Date.now());
    return {
      recordId,
      employeeId: clean(pick(row, ['員工ID','employeeId'])) || clean(payload.userId || user.id || user.employeeId),
      name: clean(pick(row, ['姓名','name'])) || clean(user.name),
      email: lower(pick(row, ['Email','email']) || user.email),
      date: fmtDate(pick(row, ['日期','date']) || payload.workDate || payload.date),
      hours: Number(pick(row, ['時數','hours']) || payload.hours || payload.workHours || 0) || 0,
      halfHour: truthy(pick(row, ['是否加半小時','halfHour']) || payload.halfHour || payload.addHalfHour),
      totalHours: Number(pick(row, ['總時數','totalHours']) || result.totalHours || 0) || 0,
      status: clean(pick(row, ['狀態','status']) || '正常') || '正常',
      supplementReason: clean(pick(row, ['補時數原因','supplementReason'])),
      scheduleLabel: clean(pick(row, ['班表狀態','scheduleLabel'])),
      startTime: clean(pick(row, ['班表開始時間','startTime'])),
      endTime: clean(pick(row, ['班表結束時間','endTime'])),
      hourlyRate: Number(pick(row, ['時薪','hourlyRate']) || 0) || 0,
      grossPay: Number(pick(row, ['當筆毛額','grossPay']) || 0) || 0,
      laborSelfPaySnapshot: Number(pick(row, ['勞保自付額快照','laborSelfPaySnapshot']) || 0) || 0,
      note: clean(payload.note || pick(row, ['備註','note'])),
      source: 'gs-double-write',
      createdAt: serverTs()
    };
  }
  async function mirrorLeaveRequest(action, payload, result){
    const row = flattenLeaveResult(payload, result);
    if(action === 'deleteLeaveRequest'){
      const d=init(); if(!d) return;
      const id=clean(payload.requestId || payload.leaveId || row.requestId); if(id) await d.collection('leaveRequests').doc(id).set({status:'已刪除', deletedAt:serverTs(), updatedAt:serverTs(), source:'gs-double-write'}, {merge:true});
      return;
    }
    if(action === 'reviewLeaveRequest'){
      const id=clean(payload.requestId || payload.leaveId || row.requestId); if(!id) return;
      const status = /reject/i.test(clean(payload.decision || payload.action)) ? '已駁回' : '已核准';
      await setCollectionDoc('leaveRequests', id, {status, rejectReason:clean(payload.rejectReason||payload.reason), reviewedAt:serverTs(), source:'gs-double-write'});
      if(status === '已核准') await setCollectionDoc('leaveRecords', id, Object.assign({}, row, {status:'已核准'}));
      return;
    }
    await setCollectionDoc('leaveRequests', row.requestId, row);
  }
  async function mirrorParttime(payload, result){
    const row = flattenParttimeResult(payload, result);
    await setCollectionDoc('parttimeRecords', row.recordId, row);
  }
  async function mirrorClockCorrection(action, payload, result){
    const row=(result&&result.row)||{};
    const requestId=clean(pick(row,['申請ID','修正ID','requestId']) || result.requestId || payload.requestId) || ('CCR_'+clean(payload.userId||'USER')+'_'+Date.now());
    if(action==='approveClockCorrectionApi' || action==='rejectClockCorrectionApi'){
      await setCollectionDoc('clockCorrections', requestId, {status: action==='approveClockCorrectionApi'?'已核准':'已駁回', rejectReason:clean(payload.rejectReason||''), reviewedAt:serverTs(), source:'gs-double-write'});
      return;
    }
    await setCollectionDoc('clockCorrections', requestId, Object.assign({}, payload, row, {requestId, employeeId:clean(payload.userId||pick(row,['員工ID','employeeId'])), status:clean(pick(row,['狀態','status'])||'待審核')||'待審核', source:'gs-double-write', createdAt:serverTs()}));
  }
  async function mirrorApiWrite(action, payload, result){
    const a=clean(action);
    if(!enabled() || !(result && result.ok)) return;
    if(a==='leaveRequest' || a==='modifyLeaveRequest' || a==='deleteLeaveRequest' || a==='reviewLeaveRequest') return await mirrorLeaveRequest(a, payload||{}, result||{});
    if(a==='parttime') return await mirrorParttime(payload||{}, result||{});
    if(a==='submitClockCorrection' || a==='approveClockCorrectionApi' || a==='rejectClockCorrectionApi') return await mirrorClockCorrection(a, payload||{}, result||{});
    if(a==='saveNotificationSettings') return await mirrorNotificationSettings((payload&&payload.rows)||[]);
    if(a==='saveNotificationTimeRules') return await mirrorNotificationTimeRules((payload&&payload.rows)||[]);
  }

  async function handleApi(action,payload){
    if(!enabled()) return null;
    const a=clean(action);
    if(a==='getMyProfile') return await getMyProfile(payload&&payload.userId);
    if(a==='getLeaveHistory') return await getLeaveHistory(payload&&payload.userId);
    if(a==='getPendingLeaveApprovals') return await getPendingLeaveApprovals();
    if(a==='getAdminLeaveEmployeeSummary') return await getAdminLeaveEmployeeSummary();
    if(a==='getParttimeHistory') return await getParttimeHistory(payload&&payload.userId, payload&&payload.monthText);
    if(a==='getDashboardSummary') return await getDashboardSummary(payload||{});
    if(a==='getPendingCounts') return await getPendingCounts(payload||{});
    if(a==='getNotificationSettings') return await getNotificationSettings();
    if(a==='getNotificationTimeRules') return await getNotificationTimeRules();
    return null;
  }

  global.YZFirebase = {init,enabled,handleApi,getEmployee,getMyProfile,normalizeClockDoc,getClockRowsByEmployee,getEditableClockHistory,getClockHistoryRange,addClockRecordFromClient,getLeaveHistory,getPendingLeaveApprovals,getAdminLeaveEmployeeSummary,getParttimeHistory,getNotificationSettings,getNotificationTimeRules,mirrorNotificationSettings,mirrorNotificationTimeRules,getDashboardSummary,getPendingCounts,mirrorApiWrite};
})(window);


/* =========================================================
 * Firebase 全站接上橋接層（第4階段）
 * 原則：Firebase 有資料就優先讀 Firebase；沒有資料或格式不合，回退原 GS。
 * 寫入：仍由 app.js 原本流程先寫 GS，成功後 mirrorApiWrite 鏡像到 Firebase。
 * ========================================================= */
(function(global){
  const old = global.YZFirebase || {};
  if(!old.enabled) return;
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ const s=lower(v); return v===true || ['是','yes','true','1','啟用','enabled','active','true'].indexOf(s)>=0; }
  function db(){ try{return old.init && old.init()}catch(e){return null} }
  async function all(col){ const d=db(); if(!d) return []; const snap=await d.collection(col).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  async function where(col, field, val){ const d=db(); if(!d) return []; const snap=await d.collection(col).where(field,'==',val).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  function date(v){
    if(!v) return ''; if(v && typeof v.toDate==='function') v=v.toDate();
    if(v instanceof Date && !isNaN(v.getTime())) return v.getFullYear()+'-'+String(v.getMonth()+1).padStart(2,'0')+'-'+String(v.getDate()).padStart(2,'0');
    const s=clean(v); if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10); const d=new Date(s); return isNaN(d.getTime())?s:date(d);
  }
  function time(v){ const s=clean(v); if(/^\d{1,2}:\d{2}/.test(s)){ const p=s.split(':'); return String(p[0]).padStart(2,'0')+':'+p[1]+(p[2]?':'+p[2]:''); } return s; }
  function user(){ try{return JSON.parse(localStorage.getItem('employeeUser')||'null')||{}}catch(e){return{}} }
  function idOf(){ const u=user(); return clean(u.id||u.employeeId||u.adminId); }
  function isAdmin(){ const u=user(); return lower(u.role)==='admin' || !!u.showSettingsZone || !!u.canViewSettings || !!u.isManagerAccount; }
  function money(n){ return Math.round(Number(n||0)||0); }
  function normalizeEmployee(o){
    o=o||{}; const type=lower(o.identityType||o['身分類型']) || (truthy(o.isPartTime||o['是否工讀生'])?'parttime':'staff');
    return {id:clean(o.employeeId||o.adminId||o['員工ID']||o.__id),employeeId:clean(o.employeeId||o['員工ID']||o.__id),name:clean(o.name||o['姓名']),email:lower(o.email||o['Email']),role:lower(o.role||o['角色']||'staff')||'staff',identityType:type,identityLabel:type==='parttime'?'工讀生':(type==='external'?'外聘老師':'專職員工'),isPartTime:type==='parttime',accountStatus:clean(o.accountStatus||o['帳號狀態']||'active'),lineUserId:clean(o.lineUserId||o['LINE User ID']),lineNotifyEnabled:truthy(o.lineNotifyEnabled||o['LINE 通知啟用'])};
  }
  function normalizeAdmin(o){ return {id:clean(o.adminId||o['管理者代碼']||o.__id),adminId:clean(o.adminId||o['管理者代碼']||o.__id),name:clean(o.name||o['姓名']||'管理者'),email:lower(o.loginAccount||o.email||o['登入帳號']),role:lower(o.role||o['角色']||'admin')||'admin',identityType:'admin',identityLabel:'管理者',showSettingsZone:truthy(o.canViewSettings||o['可看設定區']),showApprovalZone:truthy(o.canViewApproval||o['可看審核區']),canManageLeavePolicy:truthy(o.canManageLeavePolicy||o['可操作假勤制度']),isManagerAccount:true}; }
  async function getEmployeeOptions(){ const rows=(await all('employees')).map(normalizeEmployee).filter(x=>x.employeeId && lower(x.accountStatus)!=='rejected'); return {ok:true,rows,employees:rows,list:rows}; }
  function normClock(o){ return {id:clean(o.recordId||o['紀錄ID']||o.__id),recordId:clean(o.recordId||o['紀錄ID']||o.__id),employeeId:clean(o.employeeId||o['員工ID']),name:clean(o.name||o['姓名']),email:lower(o.email||o['Email']),date:date(o.clockDate||o.date||o['打卡日期']),time:time(o.clockTime||o.time||o['打卡時間']),actionName:clean(o.actionName||o['打卡動作']),clockType:clean(o.clockType||o['打卡方式']||'標準打卡'),status:clean(o.status||o['狀態']||'正常')||'正常',lateMinutes:Number(o.lateMinutes||o['遲到分鐘']||0)||0,note:clean(o.note||o['備註']),sourceIp:clean(o.sourceIp||o['來源IP'])}; }
  async function getAdminClockRecords(p){ let rows=(await all('clockRecords')).map(normClock); if(p&&p.employeeId) rows=rows.filter(r=>r.employeeId===clean(p.employeeId)); if(p&&p.startDate) rows=rows.filter(r=>r.date>=clean(p.startDate)); if(p&&p.endDate) rows=rows.filter(r=>r.date<=clean(p.endDate)); rows.sort((a,b)=>(b.date+' '+b.time).localeCompare(a.date+' '+a.time)); return {ok:true,rows,list:rows}; }
  function normCorrection(o){ return {requestId:clean(o.requestId||o['申請ID']||o.__id),employeeId:clean(o.employeeId||o['員工ID']),name:clean(o.name||o['姓名']),email:lower(o.email||o['Email']),originalRecordId:clean(o.originalRecordId||o['原始紀錄ID']),correctDate:date(o.correctionDate||o.correctDate||o['修正日期']),correctTime:time(o.correctionTime||o.correctTime||o['修正時間']),correctAction:clean(o.actionName||o.correctAction||o['修正動作']),correctionType:clean(o.clockType||o.correctionType||o['修正打卡方式']),reason:clean(o.reason||o['修正原因']),status:clean(o.status||o['狀態']||'待審核')||'待審核',reviewedAt:clean(o.reviewedAtText||o['審核時間']),rejectReason:clean(o.rejectReason||o['駁回理由'])}; }
  async function getPendingClockCorrections(){ const rows=(await all('clockCorrections')).map(normCorrection).filter(r=>r.status==='待審核'||!r.status); return {ok:true,rows,list:rows}; }
  async function getPendingRegistrations(){ const rows=(await all('employees')).map(normalizeEmployee).filter(r=>lower(r.accountStatus)==='pending'); return {ok:true,rows,list:rows}; }
  async function getScheduleSetupData(){ const [templates,assignments,single,emps]=await Promise.all([all('scheduleTemplates'),all('employeeSchedules'),all('singleDaySchedules'),getEmployeeOptions()]); return {ok:true,templates:templates.map(o=>Object.assign({templateId:clean(o.templateId||o.__id),templateName:clean(o.templateName||o.name),enabled:truthy(o.enabled)},o)),assignments:assignments.map(o=>Object.assign({assignmentId:clean(o.assignmentId||o.__id),employeeId:clean(o.employeeId),employeeName:clean(o.employeeName),templateId:clean(o.templateId),templateName:clean(o.templateName),startDate:date(o.startDate),endDate:date(o.endDate),indefinite:truthy(o.indefinite),enabled:truthy(o.enabled)},o)),singleDaySchedules:single.map(o=>Object.assign({recordId:clean(o.recordId||o.__id),employeeId:clean(o.employeeId),employeeName:clean(o.employeeName),date:date(o.date),clockType:clean(o.clockType),startTime:time(o.startTime),endTime:time(o.endTime),allowSpecial:truthy(o.allowSpecial),enabled:truthy(o.enabled)},o)),employees:emps.rows}; }
  function normPart(o){ const total=Number(o.totalHours||o['總時數']||o.hours||0)||0; return {id:clean(o.recordId||o.__id),recordId:clean(o.recordId||o.__id),employeeId:clean(o.employeeId||o['員工ID']),name:clean(o.name||o['姓名']),email:lower(o.email||o['Email']),date:date(o.workDate||o.date||o['日期']),totalHours:total,hours:Number(o.hours||0)||0,status:clean(o.status||'正常')||'正常',hourlyRate:Number(o.hourlyRate||0)||0,grossPay:money(o.grossPay||0),note:clean(o.note),scheduleLabel:clean(o.scheduleLabel)}; }
  async function getParttimePayrollAdminData(){ const emps=(await getEmployeeOptions()).rows.filter(e=>e.identityType==='parttime'); return {ok:true,employees:emps,defaultMonth:date(new Date()).slice(0,7)}; }
  async function getParttimePayrollSummary(p){ const empId=clean(p&&p.employeeId); if(!empId) return null; let rows=(await all('parttimeRecords')).map(normPart).filter(r=>r.employeeId===empId); if(p&&p.startDate) rows=rows.filter(r=>r.date>=clean(p.startDate)); if(p&&p.endDate) rows=rows.filter(r=>r.date<=clean(p.endDate)); if(p&&p.monthText) rows=rows.filter(r=>r.date.slice(0,7)===clean(p.monthText)); const totalHours=Math.round(rows.reduce((s,r)=>s+(Number(r.totalHours)||0),0)*100)/100; const grossPay=money(rows.reduce((s,r)=>s+(Number(r.grossPay)||0),0)); return {ok:true,rows,summary:{totalHours,grossPay,netPay:grossPay,recordCount:rows.length,supplementCount:rows.filter(r=>r.status==='補時數').length}}; }
  async function getSettingsKV(){ const rows=await all('systemSettings'); const obj={}; rows.forEach(r=>{obj[clean(r.key||r.__id)]=clean(r.value)}); return obj; }
  async function getPublicSystemLinks(){ const s=await getSettingsKV(); return {ok:true,lineAddFriendUrl:s['LINE 加好友網址']||'',lineBotBasicId:s['LINE Bot Basic ID']||'',settingsPageUrl:s['設定區頁面網址']||'',leavePageUrl:s['請假頁面網址']||''}; }
  async function getNotificationSettings(){ let rows=(await all('notificationUniversal')).concat(await all('notificationSettings')); rows=rows.map(o=>Object.assign({},o,{eventCode:clean(o.eventCode||o.__id),eventName:clean(o.eventName),enabled:truthy(o.enabled),targetLineEnabled:truthy(o.partyLine||o.targetLineEnabled),targetEmailEnabled:truthy(o.partyEmail||o.targetEmailEnabled),managerLineEnabled:truthy(o.managerLine||o.managerLineEnabled),managerEmailEnabled:truthy(o.managerEmail||o.managerEmailEnabled)})); return rows.length?{ok:true,rows}:null; }
  async function getGenericList(collection, mapper){ const rows=(await all(collection)).map(mapper||((x)=>x)); return rows.length?{ok:true,rows,list:rows}:null; }
  function normAnnouncement(o){return {announcementId:clean(o.announcementId||o.id||o.__id),title:clean(o.title||o['標題']),category:clean(o.category||o['分類']),summary:clean(o.summary),content:clean(o.content||o['內容']),published:truthy(o.published||o.enabled),pinned:truthy(o.pinned),isRead:false,myReply:null,createdAt:clean(o.createdAtText||o.createdAt||'')};}
  function normTask(o){return {id:clean(o.taskId||o.id||o.__id),taskId:clean(o.taskId||o.id||o.__id),title:clean(o.title||o['標題']),content:clean(o.content||o['內容']),assigneeId:clean(o.assigneeId||o.employeeId),assigneeName:clean(o.assigneeName||o.employeeName),status:clean(o.status||'待處理'),dueDate:date(o.dueDate),dueTime:time(o.dueTime)};}
  async function getDashboardSummary(p){
    const [leaves,cc,pt,tasks,ann]=await Promise.all([all('leaveRequests').catch(()=>[]),all('clockCorrections').catch(()=>[]),all('parttimeRecords').catch(()=>[]),all('tasks').catch(()=>[]),all('announcements').catch(()=>[])]);
    return {ok:true,counts:{leaves:leaves.filter(x=>clean(x.status)==='待審核').length,clockCorrections:cc.filter(x=>clean(x.status)==='待審核').length,clocks:cc.filter(x=>clean(x.status)==='待審核').length,parttime:pt.length,tasks:tasks.filter(x=>clean(x.status)!=='已完成').length,announcements:ann.length,registrations:(await all('employees')).filter(x=>lower(x.accountStatus)==='pending').length,contracts:0,goodsInquiries:0}};
  }
  async function handleApi(action,payload){
    const a=clean(action), p=payload||{};
    try{
      if(a==='getPublicSystemLinks') return await getPublicSystemLinks();
      if(a==='getEmployeeOptions') return await getEmployeeOptions();
      if(a==='getPendingRegistrations') return await getPendingRegistrations();
      if(a==='getAdminClockRecords') return await getAdminClockRecords(p);
      if(a==='getPendingClockCorrections') return await getPendingClockCorrections(p);
      if(a==='getScheduleSetupData') return await getScheduleSetupData(p);
      if(a==='getParttimePayrollAdminData') return await getParttimePayrollAdminData(p);
      if(a==='getParttimePayrollSummary') return await getParttimePayrollSummary(p);
      if(a==='getNotificationSettings') return await getNotificationSettings();
      if(a==='getDashboardSummary'||a==='getPendingCounts') return await getDashboardSummary(p);
      if(a==='getAnnouncementAdminList') return await getGenericList('announcements', normAnnouncement);
      if(a==='getAnnouncements') return await getGenericList('announcements', normAnnouncement);
      if(a==='getTasks') { let r=await getGenericList('tasks', normTask); if(r&&!isAdmin()) r.rows=r.list=r.rows.filter(x=>x.assigneeId===idOf()); return r; }
      if(a==='getRoutinePageData') return await getGenericList('routineTemplates');
      if(a==='getTrainingPageData') return await getGenericList('trainingItems');
      if(a==='getTrainingRecords') return await getGenericList('trainingRecords');
      if(a==='getTeacherContractAdminList'||a==='getTeacherContracts'||a==='getTeacherContractStatus') return await getGenericList('teacherContractLogs');
      if(a==='getTeacherGoodsList') return await getGenericList('teacherGoods');
      if(a==='getTeacherGoodsInquiries'||a==='getTeacherGoodsInquiryAdminList') return await getGenericList('teacherGoodsInquiry');
      if(a==='getRentalContracts') return await getGenericList('rentalContracts');
      if(a==='getQuotationList') return await getGenericList('quotations');
      if(a==='getSalarySetupOptions') return {ok:true,employees:(await getEmployeeOptions()).rows};
      if(a==='getMySalaryInfo') { const emp=(await where('employees','employeeId',clean(p.userId)))[0]; return emp?{ok:true,info:emp,salary:emp}:null; }
    }catch(e){ console.warn('[Firebase stage4 fallback]', a, e); }
    if(old.handleApi) return old.handleApi(action,payload);
    return null;
  }
  global.YZFirebase = Object.assign({}, old, {handleApi,getEmployeeOptions,getAdminClockRecords,getPendingClockCorrections,getScheduleSetupData,getParttimePayrollAdminData,getParttimePayrollSummary});
})(window);
