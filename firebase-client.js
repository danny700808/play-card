
(function(global){
  const cfg = (global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG) || null;
  let db = null;

  function enabled(){
    return !!(global.APP_CONFIG && global.APP_CONFIG.FIREBASE_ENABLED && cfg && cfg.projectId && global.firebase && global.firebase.firestore);
  }
  function firebaseApp_(){
    if(!(global.APP_CONFIG && global.APP_CONFIG.FIREBASE_ENABLED && cfg && cfg.projectId && global.firebase)) return null;
    try{
      const apps = global.firebase.apps || [];
      return apps.length ? apps[0] : global.firebase.initializeApp(cfg);
    }catch(err){ console.warn('[Firebase] app init failed:', err); return null; }
  }
  function init(){
    if(!enabled()) return null;
    if(db) return db;
    try{
      const app = firebaseApp_();
      if(!app) return null;
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
  function num(v){ if(v==null||v==='') return 0; const n=Number(String(v).replace(/,/g,'').trim()); return isFinite(n)?n:0; }
  function normalizeHourValue_(v){
    if(v==null || v==='') return 0;
    if(typeof v === 'number'){ return (isFinite(v) && v >= 0 && v <= 24) ? Math.round(v*100)/100 : 0; }
    if(v && typeof v.toDate === 'function'){
      const d=v.toDate();
      const hh=d.getHours() + d.getMinutes()/60 + d.getSeconds()/3600;
      return (isFinite(hh) && hh >= 0 && hh <= 24) ? Math.round(hh*100)/100 : 0;
    }
    if(v instanceof Date && !isNaN(v.getTime())){
      const hh=v.getHours() + v.getMinutes()/60 + v.getSeconds()/3600;
      return (isFinite(hh) && hh >= 0 && hh <= 24) ? Math.round(hh*100)/100 : 0;
    }
    const raw=String(v).replace(/小時/g,'').replace(/hours?/ig,'').replace(/hr/ig,'').trim();
    const m=raw.match(/^-?\d+(?:\.\d+)?/);
    if(!m) return 0;
    const n=Number(m[0]);
    return (isFinite(n) && n >= 0 && n <= 24) ? Math.round(n*100)/100 : 0;
  }
  function normPart(o){
    o=o||{};
    const baseHours = normalizeHourValue_(o.hours||o['時數']);
    const halfHour = truthy(o.halfHour||o.addHalfHour||o['是否加半小時']) ? 0.5 : 0;
    let total = normalizeHourValue_(o.totalHours||o['總時數']);
    if(!total) total = Math.round((baseHours + halfHour) * 100) / 100;
    const hourly=num(o.hourlyRate||o['時薪']);
    const grossRaw=num(o.grossPay||o['當筆毛額']);
    return {
      id:clean(o.recordId||o['紀錄ID']||o.__id),recordId:clean(o.recordId||o['紀錄ID']||o.__id),
      employeeId:clean(o.employeeId||o['員工ID']),name:clean(o.name||o['姓名']),email:lower(o.email||o['Email']),
      date:date(o.workDate||o.date||o['日期']),totalHours:total,hours:baseHours,halfHour:halfHour>0,
      status:clean(o.status||o['狀態']||'正常')||'正常',hourlyRate:hourly,grossPay:grossRaw,
      laborSelfPaySnapshot:num(o.laborSelfPaySnapshot||o['勞保自付額快照']),note:clean(o.note||o['備註']),scheduleLabel:clean(o.scheduleLabel||o['班表狀態'])
    };
  }
  function latestHourlyRateForEmployee(rows, empId){
    const own=(rows||[]).filter(r=>r.employeeId===empId && num(r.hourlyRate)>0).sort((a,b)=>clean(b.date).localeCompare(clean(a.date)));
    return own[0] ? num(own[0].hourlyRate) : 0;
  }
  async function getDefaultHourlyRate(){
    try{
      const settings=await all('systemSettings');
      const row=settings.find(x=>clean(x.key||x.name||x['設定名稱']||x.__id)==='工讀預設時薪');
      const v=num(row && (row.value||row['設定值']));
      return v || 196;
    }catch(e){ return 196; }
  }
  function employeeHourlyRate_(e){
    return num(e.hourlyRate||e['時薪']||e.hourlyAmount||e['時薪金額']||(e.source&&(e.source['時薪金額']||e.source['時薪'])));
  }
  function employeeLaborSelfPay_(e){
    return num(e.laborSelfPay||e['勞保自付額']||e.laborSelfPayAmount||(e.source&&e.source['勞保自付額']));
  }
  async function getParttimePayrollAdminData(){
    const [empRes, allParts, defaultHourly] = await Promise.all([getEmployeeOptions(), all('parttimeRecords').catch(()=>[]), getDefaultHourlyRate()]);
    const parts=allParts.map(normPart);
    const emps=empRes.rows.filter(e=>e.identityType==='parttime').map(e=>{
      const rate = employeeHourlyRate_(e) || latestHourlyRateForEmployee(parts, e.employeeId) || defaultHourly;
      const laborSelfPay = employeeLaborSelfPay_(e) || Math.max(0, ...parts.filter(r=>r.employeeId===e.employeeId).map(r=>num(r.laborSelfPaySnapshot)));
      return Object.assign({}, e, {hourlyRate: rate, laborSelfPay: laborSelfPay});
    });
    return {ok:true,employees:emps,defaultMonth:date(new Date()).slice(0,7),defaultHourlyRate:defaultHourly};
  }
  async function getParttimePayrollSummary(p){
    const empId=clean(p&&p.employeeId); if(!empId) return null;
    const defaultHourly=await getDefaultHourlyRate();
    let allRows=(await all('parttimeRecords')).map(normPart);
    let rows=allRows.filter(r=>r.employeeId===empId);
    if(p&&p.startDate) rows=rows.filter(r=>r.date>=clean(p.startDate));
    if(p&&p.endDate) rows=rows.filter(r=>r.date<=clean(p.endDate));
    if(p&&p.monthText) rows=rows.filter(r=>r.date.slice(0,7)===clean(p.monthText));
    const empList = (await getEmployeeOptions().catch(()=>({rows:[]}))).rows || [];
    const emp = empList.find(e=>e.employeeId===empId || e.id===empId) || {};
    const fallbackRate=employeeHourlyRate_(emp) || latestHourlyRateForEmployee(allRows, empId) || defaultHourly;
    rows=rows.map(r=>{
      const rate=num(r.hourlyRate)||fallbackRate;
      const gross=num(r.grossPay) || money(num(r.totalHours)*rate);
      return Object.assign({}, r, {hourlyRate:rate, grossPay:gross});
    });
    const totalHours=Math.round(rows.reduce((s,r)=>s+num(r.totalHours),0)*100)/100;
    const grossPay=money(rows.reduce((s,r)=>s+num(r.grossPay),0));
    const laborSelfPay=money(employeeLaborSelfPay_(emp) || rows.reduce((max,r)=>Math.max(max,num(r.laborSelfPaySnapshot)),0));
    const netPay=Math.max(0,grossPay-laborSelfPay);
    return {ok:true,rows,summary:{totalHours,hourlyRate:fallbackRate,grossPay,laborSelfPay,lateMinutes:0,lateDeduction:0,lateDeductionValue:0,netPay,recordCount:rows.length,supplementCount:rows.filter(r=>r.status==='補時數').length}};
  }
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


/* =========================================================
 * Firebase 第5階段：正式主寫入 Firebase
 * 說明：
 * - 資料型動作先直接寫 Firestore，降低 GS/Sheet 依賴與等待時間。
 * - Email、LINE、PDF、Excel、Cloudinary/Google Drive 等外部服務仍保留原 GS。
 * - 若遇到未支援 action，app.js 會照原流程回 GS。
 * ========================================================= */
(function(global){
  const fb = global.YZFirebase || {};
  if(!fb.enabled) return;
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ const s=lower(v); return v===true || ['是','yes','true','1','啟用','enabled','active'].indexOf(s)>=0; }
  function pad(n){ return String(n).padStart(2,'0'); }
  function nowDate(){ return new Date(); }
  function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function timeText(d){ return pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds()); }
  function ts(){ return global.firebase.firestore.FieldValue.serverTimestamp(); }
  function db(){ try{return fb.init && fb.init()}catch(e){console.warn('[Firebase stage5 init]',e); return null;} }
  function currentUser(){ try{return JSON.parse(localStorage.getItem('employeeUser')||'null')}catch(e){return null} }
  async function rowsWhere(col, field, value){ const d=db(); if(!d) throw new Error('Firebase 尚未啟用'); const snap=await d.collection(col).where(field,'==',value).get(); const out=[]; snap.forEach(x=>out.push(Object.assign({__id:x.id},x.data()||{}))); return out; }
  async function docSet(col, id, data, merge=true){ const d=db(); if(!d) throw new Error('Firebase 尚未啟用'); const key=clean(id)||('WEB_'+Date.now()+'_'+Math.random().toString(36).slice(2,8)); await d.collection(col).doc(key).set(Object.assign({},data,{updatedAt:ts()}),{merge}); return key; }
  async function docUpdate(col, id, data){ return await docSet(col,id,data,true); }
  function normalizeUserDoc(o){
    const isAdmin = !!(o.adminId || o.managerId || o['管理者代碼'] || o.__collection === 'admins');
    const identity = isAdmin ? 'admin' : (lower(o.identityType || o['身分類型']) || (truthy(o.isPartTime || o['是否工讀生'])?'parttime':'staff'));
    return {
      id: clean(o.employeeId || o.adminId || o.managerId || o['員工ID'] || o['管理者代碼'] || o.__id),
      employeeId: clean(o.employeeId || o['員工ID'] || ''),
      name: clean(o.name || o['姓名'] || '使用者'),
      email: lower(o.email || o.loginAccount || o['Email'] || o['登入帳號']),
      role: lower(o.role || o['角色'] || (isAdmin?'admin':'staff')) || (isAdmin?'admin':'staff'),
      identityType: identity,
      identityLabel: identity==='admin'?'管理者':(identity==='parttime'?'工讀生':(identity==='external'?'外聘老師':'專職員工')),
      isPartTime: identity==='parttime',
      isExternalTeacher: identity==='external',
      isManagerAccount: isAdmin,
      showSettingsZone: isAdmin || truthy(o.showSettingsZone || o['是否顯示設定區'] || o['可看設定區']),
      showApprovalZone: isAdmin || truthy(o.showApprovalZone || o['可看審核區']),
      canManageLeavePolicy: isAdmin || truthy(o.canManageLeavePolicy || o['可操作假勤制度']),
      lineUserId: clean(o.lineUserId || o['LINE User ID']),
      lineNotifyEnabled: truthy(o.lineNotifyEnabled || o['LINE 通知啟用'])
    };
  }
  async function firebaseLogin(payload){
    const account=lower(payload.email || payload.account);
    const password=String(payload.password||'');
    if(!account || !password) return {ok:false,message:'請輸入帳號與密碼。'};
    let rows = await rowsWhere('admins','email',account);
    if(!rows.length) rows = await rowsWhere('admins','loginAccount',account);
    let kind='admin';
    if(!rows.length){ rows = await rowsWhere('employees','email',account); kind='employee'; }
    if(!rows.length) return {ok:false,message:'查無此帳號，請先註冊。'};
    const o=rows[0]; o.__collection = kind==='admin'?'admins':'employees';
    const status=lower(o.accountStatus || o.status || o['帳號狀態'] || 'active');
    if(status==='pending') return {ok:false,message:'此帳號尚未通過主管審核。'};
    if(status && ['active','enabled','啟用','是'].indexOf(status)<0) return {ok:false,message:'此帳號目前無法登入。'};
    const stored=String(o.password || o.loginPassword || o['密碼'] || o['登入密碼'] || '');
    if(stored !== password) return {ok:false,message:'密碼錯誤，請重新輸入。'};
    const user=normalizeUserDoc(o);
    await docUpdate(kind==='admin'?'admins':'employees', clean(o.__id || user.id), {lastLoginAt:ts()});
    return {ok:true,message:kind==='admin'?'管理者登入成功':'登入成功',user};
  }
  async function firebaseRegister(payload){
    const email=lower(payload.email); const name=clean(payload.name);
    if(!email || !name) return {ok:false,message:'註冊資料不完整。'};
    const existed=await rowsWhere('employees','email',email);
    if(existed.length && lower(existed[0].accountStatus||existed[0]['帳號狀態'])==='active') return {ok:false,message:'這個 Email 已經註冊過了，請直接登入。'};
    const id=clean(payload.employeeId)||clean(existed[0]&&existed[0].employeeId)||('EMP_'+Math.random().toString(36).slice(2,10));
    const identity=clean(payload.identityType || (truthy(payload.isPartTime)?'parttime':'staff')) || 'staff';
    await docSet('employees', id, {
      employeeId:id, name, email, password:'', role:'staff', identityType:identity, isPartTime:identity==='parttime', accountStatus:'pending',
      idNumber:clean(payload.idNumber).toUpperCase(), birthDate:clean(payload.birthDate), mobilePhone:clean(payload.mobilePhone), address:clean(payload.contactAddress||payload.address),
      emergencyContact:clean(payload.emergencyContact), emergencyPhone:clean(payload.emergencyPhone), hireDate:clean(payload.hireDate||payload.joinDate),
      lineUserId:'', lineNotifyEnabled:false, createdAt:ts(), source:'firebase-primary'
    });
    return {ok:true,message:'註冊申請已送出，待主管審核。'};
  }
  async function firebaseClock(payload){
    const user=currentUser()||{}; const now=nowDate();
    const employeeId=clean(payload.userId || user.id || user.employeeId);
    const actionName=clean(payload.actionName); if(!employeeId || !actionName) return {ok:false,message:'缺少打卡資料。'};
    const clockDate=clean(payload.supplementDate)||ymd(now);
    const clockTime=clean(payload.supplementTime)||timeText(now);
    const recordId='CLK_'+employeeId+'_'+Date.now();
    // Firebase 主寫入版先保留前端能取得的資料；公司 Wi-Fi/IP、請假、班表深層規則仍需後續以 Cloud Functions 完整補強。
    await docSet('clockRecords', recordId, {
      recordId, employeeId, name:clean(user.name), email:lower(user.email), clockDate, clockTime,
      actionName, clockType:clean(payload.clockType || payload.supplementClockType || '標準打卡')||'標準打卡',
      status: truthy(payload.isSupplement)?'補打卡':'正常', lateMinutes:0, note:clean(payload.supplementReason || payload.note), sourceIp:clean(payload.clientIp),
      isSupplement:truthy(payload.isSupplement), source:'firebase-primary', createdAt:ts()
    });
    return {ok:true,message:(truthy(payload.isSupplement)?'補打卡已送出。':actionName+'成功'),recordId,lateMinutes:0,lateDeductionAmount:0,lateDeductionText:'$0'};
  }
  function leaveDoc(payload, base={}){
    const user=currentUser()||{}; const first=Array.isArray(payload.segments)&&payload.segments.length?payload.segments[0]:{};
    const id=clean(payload.requestId||payload.leaveId||base.requestId)||('LV_'+clean(payload.userId||user.id||'USER')+'_'+Date.now());
    return Object.assign({}, base, {
      requestId:id, employeeId:clean(payload.userId||base.employeeId||user.id||user.employeeId), name:clean(base.name||user.name), email:lower(base.email||user.email),
      reason:clean(payload.reason||payload.leaveName||base.reason||'請假'), leaveCode:clean(payload.leaveCode||base.leaveCode),
      bereavementRelation:clean(payload.bereavementRelation||base.bereavementRelation),
      leaveDate:clean(payload.date||payload.leaveDate||first.date||first.startDate||base.leaveDate),
      startDate:clean(payload.startDate||first.startDate||first.date||base.startDate), endDate:clean(payload.endDate||first.endDate||first.date||base.endDate),
      startTime:clean(payload.startTime||first.startTime||base.startTime), endTime:clean(payload.endTime||first.endTime||base.endTime),
      session:clean(payload.session||first.session||base.session), hours:Number(payload.hours||payload.leaveHours||first.hours||base.hours||0)||0,
      note:clean(payload.note||base.note), attachmentUrl:clean(payload.attachmentUrl||base.attachmentUrl), status:clean(base.status||'待審核')||'待審核',
      segments:Array.isArray(payload.segments)?payload.segments:(base.segments||[]), source:'firebase-primary'
    });
  }
  async function firebaseLeave(action,payload){
    const id=clean(payload.requestId||payload.leaveId);
    if(action==='deleteLeaveRequest'){ if(id) await docUpdate('leaveRequests',id,{status:'已刪除',deletedAt:ts(),source:'firebase-primary'}); return {ok:true,message:'請假申請已刪除。'}; }
    if(action==='reviewLeaveRequest'){
      if(!id) return {ok:false,message:'缺少請假ID'};
      const status=/reject/i.test(clean(payload.decision||payload.action))?'已駁回':'已核准';
      await docUpdate('leaveRequests',id,{status,rejectReason:clean(payload.rejectReason||payload.reason),reviewedAt:ts(),source:'firebase-primary'});
      if(status==='已核准') await docSet('leaveRecords',id,{requestId:id,status,reviewedAt:ts(),source:'firebase-primary'},true);
      return {ok:true,message:status==='已核准'?'請假已核准。':'請假已駁回。'};
    }
    const doc=leaveDoc(payload,{requestId:id,status:'待審核'}); await docSet('leaveRequests',doc.requestId,Object.assign({},doc,{createdAt:ts()}));
    return {ok:true,message:action==='modifyLeaveRequest'?'請假申請已更新。':'請假申請已送出。',row:doc,requestId:doc.requestId};
  }
  async function firebaseParttime(payload){
    const user=currentUser()||{}; const employeeId=clean(payload.userId||user.id||user.employeeId); const date=clean(payload.workDate||payload.date)||ymd(nowDate());
    const hours=Number(payload.hours||payload.workHours||0)||0; const half=truthy(payload.halfHour||payload.addHalfHour); const total=Math.round((hours+(half?0.5:0))*100)/100;
    if(!employeeId || !total) return {ok:false,message:'請填寫工讀時數。'};
    const recordId='PT_'+employeeId+'_'+Date.now();
    const allParts=(await all('parttimeRecords').catch(()=>[])).map(normPart);
    const hourlyRate=latestHourlyRateForEmployee(allParts, employeeId) || (await getDefaultHourlyRate());
    const grossPay=money(total*hourlyRate);
    const row={recordId,employeeId,name:clean(user.name),email:lower(user.email),date,hours,halfHour:half,totalHours:total,status:'正常',hourlyRate,grossPay,note:clean(payload.note),source:'firebase-primary',createdAt:ts()};
    await docSet('parttimeRecords',recordId,row); return {ok:true,message:'工讀時數已送出。',recordId,totalHours:total,row};
  }
  async function firebaseClockCorrection(action,payload){
    const id=clean(payload.requestId)||('CCR_'+clean(payload.userId||'USER')+'_'+Date.now());
    if(action==='approveClockCorrectionApi'||action==='rejectClockCorrectionApi'){
      const status=action==='approveClockCorrectionApi'?'已核准':'已駁回'; await docUpdate('clockCorrections',id,{status,rejectReason:clean(payload.rejectReason),reviewedAt:ts(),source:'firebase-primary'}); return {ok:true,message:status};
    }
    const user=currentUser()||{}; const row=Object.assign({},payload,{requestId:id,employeeId:clean(payload.userId||user.id),name:clean(user.name),email:lower(user.email),status:'待審核',source:'firebase-primary',createdAt:ts()});
    await docSet('clockCorrections',id,row); return {ok:true,message:'打卡修正申請已送出。',requestId:id,row};
  }
  async function simpleSave(collection, idFields, payload, okMessage){
    const id=clean(idFields.map(k=>payload&&payload[k]).find(Boolean)) || ('WEB_'+Date.now()+'_'+Math.random().toString(36).slice(2,8));
    await docSet(collection,id,Object.assign({},payload,{source:'firebase-primary',createdAt:ts()}));
    return {ok:true,message:okMessage||'已儲存。',id};
  }
  async function firebaseSaveNotification(action,payload){
    if(action==='saveNotificationSettings' && fb.mirrorNotificationSettings){ await fb.mirrorNotificationSettings((payload&&payload.rows)||[]); return {ok:true,message:'通知設定已儲存。'}; }
    if(action==='saveNotificationTimeRules' && fb.mirrorNotificationTimeRules){ await fb.mirrorNotificationTimeRules((payload&&payload.rows)||[]); return {ok:true,message:'提醒時間規則已儲存。'}; }
    return null;
  }
  const primaryMap = {
    saveScheduleTemplate:['scheduleTemplates',['templateId','模板ID'],'班表模板已儲存。'], deleteScheduleTemplate:['scheduleTemplates',['templateId','模板ID'],'班表模板已刪除。'],
    saveEmployeeSchedule:['employeeSchedules',['assignmentId','套用ID'],'員工班表已儲存。'], deleteEmployeeSchedule:['employeeSchedules',['assignmentId','套用ID'],'員工班表已刪除。'],
    saveSingleDaySchedule:['singleDaySchedules',['recordId','單日ID'],'單日班表已儲存。'], deleteSingleDaySchedule:['singleDaySchedules',['recordId','單日ID'],'單日班表已刪除。'],
    createTask:['tasks',['taskId','id','任務ID'],'任務已儲存。'], deleteTask:['tasks',['taskId','id','任務ID'],'任務已刪除。'], completeTask:['tasks',['taskId','id','任務ID'],'任務已完成。'], markTaskRedo:['tasks',['taskId','id','任務ID'],'已退回重做。'],
    saveAnnouncement:['announcements',['announcementId','id','公告ID'],'公告已儲存。'], deleteAnnouncement:['announcements',['announcementId','id','公告ID'],'公告已刪除。'], toggleAnnouncement:['announcements',['announcementId','id','公告ID'],'公告狀態已更新。'],
    saveTrainingItem:['trainingItems',['itemId','id','教材ID'],'教材已儲存。'], deleteTrainingItem:['trainingItems',['itemId','id','教材ID'],'教材已刪除。'], toggleTrainingItem:['trainingItems',['itemId','id','教材ID'],'教材狀態已更新。'],
    saveEmployeeSalaryConfig:['employees',['employeeId','userId','員工ID'],'薪資設定已儲存。'],
    approveRegistrationApi:['employees',['employeeId','id','email'],'已同意註冊。'], rejectRegistrationApi:['employees',['employeeId','id','email'],'已駁回註冊。'],
    submitProfileChangeRequest:['profileChangeRequests',['requestId','申請ID'],'個人資料修改申請已送出。']
  };
  async function primaryWrite(action,payload){
    const a=clean(action);
    if(a==='login') return await firebaseLogin(payload||{});
    if(a==='register') return await firebaseRegister(payload||{});
    if(a==='clock') return await firebaseClock(payload||{});
    if(a==='leaveRequest'||a==='modifyLeaveRequest'||a==='deleteLeaveRequest'||a==='reviewLeaveRequest') return await firebaseLeave(a,payload||{});
    if(a==='parttime') return await firebaseParttime(payload||{});
    if(a==='submitClockCorrection'||a==='approveClockCorrectionApi'||a==='rejectClockCorrectionApi') return await firebaseClockCorrection(a,payload||{});
    if(a==='saveNotificationSettings'||a==='saveNotificationTimeRules') return await firebaseSaveNotification(a,payload||{});
    if(primaryMap[a]){ const [col,ids,msg]=primaryMap[a]; return await simpleSave(col,ids,payload||{},msg); }
    return null;
  }
  const oldHandle = fb.handleApi;
  fb.handleApi = async function(action,payload){
    const w = await primaryWrite(action,payload||{});
    if(w) return w;
    if(typeof oldHandle==='function') return await oldHandle(action,payload||{});
    return null;
  };
  fb.primaryWrite = primaryWrite;
  global.YZFirebase = fb;
})(window);


/* 薪資與投保資訊：Firebase 直讀加速版 */
(function(global){
  const fb = global.YZFirebase;
  if(!fb || fb.__salaryFastReadPatched) return;
  const oldHandle = fb.handleApi;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function num(v){ const n = Number(v || 0); return Number.isFinite(n) ? n : 0; }
  function firstNonEmpty(obj, keys, fallback){
    obj = obj || {};
    for(const k of keys){
      if(obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
    }
    return fallback;
  }
  function normalizeEmployee(raw, id){
    raw = raw || {};
    const hourly = firstNonEmpty(raw, ['hourlyRate','parttimeHourlyRate','hourRate','時薪'], '');
    const salary = firstNonEmpty(raw, ['baseSalary','monthlySalary','salary','本薪','月薪'], '');
    const laborLevel = firstNonEmpty(raw, ['laborInsuranceLevel','laborLevel','勞保級距'], '');
    const healthLevel = firstNonEmpty(raw, ['healthInsuranceLevel','healthLevel','健保級距'], '');
    const laborSelf = firstNonEmpty(raw, ['laborInsuranceSelfPay','laborSelfPay','勞保自付額'], '');
    const healthSelf = firstNonEmpty(raw, ['healthInsuranceSelfPay','healthSelfPay','健保自付額'], '');
    const role = clean(firstNonEmpty(raw, ['role','type','employeeType','職務類型'], ''));
    const isPartTime = !!raw.isPartTime || /工讀|part/i.test(role) || clean(firstNonEmpty(raw, ['employmentType','聘用類型'], '')).includes('工讀');
    return {
      ok: true,
      source: 'firebase',
      employeeId: clean(raw.employeeId || raw.id || id),
      name: clean(raw.name || raw.displayName || raw.nickname || ''),
      email: clean(raw.email || raw.loginEmail || ''),
      role,
      isPartTime,
      hourlyRate: hourly === '' ? '' : num(hourly),
      salary: salary === '' ? '' : num(salary),
      baseSalary: salary === '' ? '' : num(salary),
      monthlySalary: salary === '' ? '' : num(salary),
      laborInsuranceStatus: clean(firstNonEmpty(raw, ['laborInsuranceStatus','laborStatus','勞保狀態'], '')),
      healthInsuranceStatus: clean(firstNonEmpty(raw, ['healthInsuranceStatus','healthStatus','健保狀態'], '')),
      isPartialWorkingTime: !!raw.isPartialWorkingTime || clean(firstNonEmpty(raw, ['partialWorkingTime','是否部分工時'], '')).includes('是'),
      laborInsuranceLevel: laborLevel,
      healthInsuranceLevel: healthLevel,
      laborInsuranceSelfPay: laborSelf,
      healthInsuranceSelfPay: healthSelf,
      lateMinutesThisMonth: num(firstNonEmpty(raw, ['lateMinutesThisMonth','monthlyLateMinutes','本月遲到分鐘'], 0)),
      lateDeductionThisMonth: num(firstNonEmpty(raw, ['lateDeductionThisMonth','monthlyLateDeduction','本月遲到扣薪'], 0)),
      raw
    };
  }
  async function getMySalaryInfo(payload){
    const db = global.firebase && global.firebase.apps && global.firebase.apps.length ? global.firebase.firestore() : null;
    if(!db) return {ok:false, message:'Firebase 尚未啟用'};
    const p = payload || {};
    const userId = clean(p.userId || p.employeeId || p.id || (global.currentUser && global.currentUser.id));
    const email = clean(p.email || (global.currentUser && global.currentUser.email));
    let doc = null;
    if(userId){
      const byId = await db.collection('employees').doc(userId).get();
      if(byId.exists) doc = byId;
    }
    if(!doc && email){
      const snap = await db.collection('employees').where('email','==',email).limit(1).get();
      if(!snap.empty) doc = snap.docs[0];
    }
    if(!doc){
      return {ok:false, source:'firebase', message:'找不到員工薪資投保資料'};
    }
    return normalizeEmployee(doc.data() || {}, doc.id);
  }

  fb.handleApi = async function(action, payload){
    if(String(action || '') === 'getMySalaryInfo') return await getMySalaryInfo(payload || {});
    if(typeof oldHandle === 'function') return await oldHandle(action, payload || {});
    return null;
  };
  fb.__salaryFastReadPatched = true;
})(window);


/* 薪資與投保資訊：Firebase 直讀完整版 */
(function(global){
  const fb = global.YZFirebase;
  if(!fb || fb.__salaryDirectOnlyV2) return;
  const oldHandle = fb.handleApi;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function num(v){ const n = Number(String(v ?? '').replace(/[^\d.-]/g,'')); return Number.isFinite(n) ? n : 0; }
  function money(v){ const n = num(v); return n ? '$' + Math.round(n).toLocaleString('zh-TW') : '0 元'; }
  function moneyBlank(v){ const s = clean(v); return s ? '$' + Math.round(num(s)).toLocaleString('zh-TW') : '-'; }
  function pick(o, keys, fallback=''){
    o = o || {};
    for(const k of keys){
      if(o[k] !== undefined && o[k] !== null && clean(o[k]) !== '') return o[k];
    }
    return fallback;
  }
  function truthy(v){
    const s = lower(v);
    return v === true || ['是','yes','true','1','啟用','enabled','active','在保','已投保','投保'].includes(s);
  }
  function fmtDate(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function'){
      const d = v.toDate();
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
    return clean(v).slice(0,10);
  }
  function normalize(raw, id){
    raw = raw || {};
    const identityType = lower(pick(raw, ['identityType','身分類型','employeeType','type'], '')) || (truthy(pick(raw,['isPartTime','是否工讀生'],'')) ? 'parttime' : 'staff');
    const isParttime = identityType === 'parttime' || clean(pick(raw,['role','職務類型'],'')).includes('工讀');
    const hourly = pick(raw, ['hourlyRate','parttimeHourlyRate','hourRate','時薪'], '');
    const base = pick(raw, ['staffBaseSalary','baseSalary','monthlySalary','salary','本薪','月薪'], '');
    const mainAmountText = isParttime ? (hourly ? moneyBlank(hourly) + ' / 小時' : '-') : (base ? moneyBlank(base) : '-');

    const laborStatus = clean(pick(raw, ['laborStatus','laborInsuranceStatus','laborInsurance','勞保狀態'], '未設定'));
    const healthStatus = clean(pick(raw, ['healthStatus','healthInsuranceStatus','healthInsurance','健保狀態'], '未設定'));

    const laborLevelText = clean(pick(raw, ['laborLevelText','laborInsuranceLevel','laborLevel','勞保級距'], ''));
    const healthLevelText = clean(pick(raw, ['healthLevelText','healthInsuranceLevel','healthLevel','健保級距'], ''));
    const laborSalaryText = clean(pick(raw, ['laborSalaryText','laborInsuranceSalary','laborSalary','勞保投保薪資'], ''));
    const healthSalaryText = clean(pick(raw, ['healthSalaryText','healthInsuranceSalary','healthSalary','健保投保薪資'], ''));
    const laborSelf = pick(raw, ['laborSelfPayText','laborInsuranceSelfPay','laborSelfPay','勞保自付額'], '');
    const healthSelf = pick(raw, ['healthSelfPayText','healthInsuranceSelfPay','healthSelfPay','健保自付額'], '');

    const info = {
      employeeId: clean(pick(raw, ['employeeId','員工ID'], id)),
      name: clean(pick(raw, ['name','姓名','displayName'], '')),
      email: clean(pick(raw, ['email','Email'], '')),
      identityType: isParttime ? 'parttime' : 'staff',
      mainAmountLabel: isParttime ? '時薪' : '本薪',
      mainAmountText,
      staffBaseSalaryText: base ? moneyBlank(base) : '-',
      parttimeHourlyRateText: hourly ? moneyBlank(hourly) + ' / 小時' : '-',
      parttimePartialHoursText: truthy(pick(raw, ['isPartialWorkingTime','partialWorkingTime','是否部分工時'], '')) ? '是' : '否',
      parttimeAverageSalaryText: pick(raw, ['parttimeAverageSalaryText','averageSalaryText','averageSalary','目前申報月平均薪資總額'], '-') || '-',
      jobAllowanceText: pick(raw, ['jobAllowanceText','jobAllowance','職務加給'], '-'),
      allowanceText: pick(raw, ['allowanceText','allowance','津貼'], '-'),
      laborStatus,
      healthStatus,
      laborActive: truthy(laborStatus),
      healthActive: truthy(healthStatus),
      laborLevelText,
      healthLevelText,
      laborSalaryText: laborSalaryText ? moneyBlank(laborSalaryText) : '',
      healthSalaryText: healthSalaryText ? moneyBlank(healthSalaryText) : '',
      laborSelfPayText: laborSelf ? moneyBlank(laborSelf) : '0 元',
      healthSelfPayText: healthSelf ? moneyBlank(healthSelf) : '0 元',
      retirementEmployerText: pick(raw, ['retirementEmployerText','retirementEmployer','雇主提撥勞退'], ''),
      selfRetirementText: pick(raw, ['selfRetirementText','retirementSelf','勞退自提'], ''),
      effectiveDate: fmtDate(pick(raw, ['salaryEffectiveDate','effectiveDate','生效日期'], '')) || '-',
      lateMinutesText: (num(pick(raw, ['lateMinutesThisMonth','monthlyLateMinutes','本月遲到分鐘'], 0)) || 0) + ' 分鐘',
      lateDeductionText: money(pick(raw, ['lateDeductionThisMonth','monthlyLateDeduction','本月遲到扣薪'], 0)),
      note: clean(pick(raw, ['salaryNote','note','備註'], ''))
    };
    return {ok:true, source:'firebase-direct', info, salary:info};
  }

  async function getMySalaryInfo(payload){
    const db = global.firebase && global.firebase.apps && global.firebase.apps.length ? global.firebase.firestore() : null;
    if(!db) return {ok:false, message:'Firebase 尚未啟用'};
    const p = payload || {};
    const userId = clean(p.userId || p.employeeId || p.id || (JSON.parse(localStorage.getItem('employeeUser') || '{}').id));
    const email = clean(p.email || (JSON.parse(localStorage.getItem('employeeUser') || '{}').email));
    let doc = null;

    if(userId){
      const direct = await db.collection('employees').doc(userId).get();
      if(direct.exists) doc = direct;
      if(!doc){
        const byEmployeeId = await db.collection('employees').where('employeeId','==',userId).limit(1).get();
        if(!byEmployeeId.empty) doc = byEmployeeId.docs[0];
      }
    }
    if(!doc && email){
      const byEmail = await db.collection('employees').where('email','==',email).limit(1).get();
      if(!byEmail.empty) doc = byEmail.docs[0];
    }
    if(!doc) return {ok:false, source:'firebase-direct', message:'找不到員工薪資投保資料'};
    return normalize(doc.data() || {}, doc.id);
  }

  fb.handleApi = async function(action, payload){
    if(String(action || '') === 'getMySalaryInfo') return await getMySalaryInfo(payload || {});
    if(typeof oldHandle === 'function') return await oldHandle(action, payload || {});
    return null;
  };
  fb.__salaryDirectOnlyV2 = true;
})(window);


/* 薪資與投保資訊：員工端顯示欄位最終對應版 20260527 */
(function(global){
  const fb = global.YZFirebase;
  if(!fb || fb.__salaryDisplayFinalV20260527) return;
  const oldHandle = fb.handleApi;

  const DEFAULT_LABOR_PLANS = [
    { code:'LAB_PART_11100', name:'第 1 級｜11,100 元', salary:11100, salaryText:'11,100 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_PART_12540', name:'第 2 級｜12,540 元', salary:12540, salaryText:'12,540 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_13500', name:'13,500 元', salary:13500, salaryText:'13,500 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_15840', name:'15,840 元', salary:15840, salaryText:'15,840 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_16500', name:'16,500 元', salary:16500, salaryText:'16,500 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_17280', name:'17,280 元', salary:17280, salaryText:'17,280 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_17880', name:'17,880 元', salary:17880, salaryText:'17,880 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_19047', name:'19,047 元', salary:19047, salaryText:'19,047 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_20008', name:'20,008 元', salary:20008, salaryText:'20,008 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_21009', name:'21,009 元', salary:21009, salaryText:'21,009 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_22000', name:'22,000 元', salary:22000, salaryText:'22,000 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_23100', name:'23,100 元', salary:23100, salaryText:'23,100 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_24000', name:'24,000 元', salary:24000, salaryText:'24,000 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_25250', name:'25,250 元', salary:25250, salaryText:'25,250 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_26400', name:'26,400 元', salary:26400, salaryText:'26,400 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_27600', name:'27,600 元', salary:27600, salaryText:'27,600 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_28590', name:'28,590 元', salary:28590, salaryText:'28,590 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_REG_29500', name:'第 1 級｜29,500 元', salary:29500, salaryText:'29,500 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_30300', name:'第 2 級｜30,300 元', salary:30300, salaryText:'30,300 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_31800', name:'第 3 級｜31,800 元', salary:31800, salaryText:'31,800 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_33300', name:'第 4 級｜33,300 元', salary:33300, salaryText:'33,300 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_34800', name:'第 5 級｜34,800 元', salary:34800, salaryText:'34,800 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_36300', name:'第 6 級｜36,300 元', salary:36300, salaryText:'36,300 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_38200', name:'第 7 級｜38,200 元', salary:38200, salaryText:'38,200 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_40100', name:'第 8 級｜40,100 元', salary:40100, salaryText:'40,100 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_42000', name:'第 9 級｜42,000 元', salary:42000, salaryText:'42,000 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_43900', name:'第 10 級｜43,900 元', salary:43900, salaryText:'43,900 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_45800', name:'第 11 級｜45,800 元', salary:45800, salaryText:'45,800 元', selfPayText:'依勞保局級距計算', group:'regular' }
  ];
  const DEFAULT_HEALTH_PLANS = [28590,28800,30300,31800,33300,34800,36300,38200,40100,42000,43900,45800,48200,50600,53000,55400,57800,60800,63800,66800,69800,72800,76500,80200,83900,87600,92100,96600,101100,105600,110100,115500,120900,126300,131700,137100,142500,147900,150000].map(function(v, i){ return { code:'NHI_' + v, name:'健保｜第 ' + (i + 1) + ' 級｜' + v.toLocaleString('zh-TW') + ' 元', salary:v, salaryText:v.toLocaleString('zh-TW') + ' 元', selfPayText:'依健保署級距計算' }; });

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function num(v){ const n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g,'')); return Number.isFinite(n) ? n : 0; }
  function money(v){ const n = num(v); return n ? '$' + Math.round(n).toLocaleString('zh-TW') : ''; }
  function percent(v){ const n = num(v); return n ? n + '%' : ''; }
  function truthy(v){ const s = lower(v); return v === true || ['是','yes','true','1','啟用','enabled','active','在保','已投保','投保'].includes(s); }
  function fmtDate(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function'){
      const d = v.toDate();
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
    return clean(v).slice(0,10);
  }
  function pick(o, keys, fallback){
    o = o || {};
    for(const k of keys){
      if(o[k] !== undefined && o[k] !== null && clean(o[k]) !== '') return o[k];
    }
    return fallback == null ? '' : fallback;
  }
  function localUser(){ try{return JSON.parse(localStorage.getItem('employeeUser') || '{}') || {}}catch(e){return {}} }
  function db(){
    try{
      if(fb && typeof fb.init === 'function') return fb.init();
      if(global.firebase && global.firebase.apps && global.firebase.apps.length) return global.firebase.firestore();
    }catch(e){ console.warn('[salary display db]', e); }
    return null;
  }
  function planByCode(list, code){
    const c = clean(code);
    if(!c) return null;
    return (list || []).find(x => clean(x.code) === c) || null;
  }
  function formatPlan(plan, fallbackCode){
    if(plan){
      const name = clean(plan.name || plan.label || '');
      const salaryText = clean(plan.salaryText || (plan.salary ? Number(plan.salary).toLocaleString('zh-TW') + ' 元' : ''));
      if(name) return name;
      if(salaryText) return salaryText;
    }
    return clean(fallbackCode);
  }
  function formatItems(items){
    if(!Array.isArray(items)) return '';
    return items.filter(x => x && (clean(x.name) || num(x.amount))).map(x => {
      const name = clean(x.name || '未命名');
      const amount = money(x.amount);
      return amount ? (name + '：' + amount) : name;
    }).join('\n');
  }
  function statusVisible(v){
    const s = clean(v);
    if(!s || s === '未設定') return '';
    return s;
  }
  function insuranceActive(status){ return ['在保','已投保','投保'].includes(clean(status)); }

  async function findEmployeeDoc(p){
    const database = db();
    if(!database) throw new Error('Firebase 尚未啟用，無法讀取薪資投保資訊');
    const u = localUser();
    const userId = clean(p.userId || p.employeeId || p.id || u.id || u.employeeId);
    const email = clean(p.email || u.email);
    let doc = null;
    if(userId){
      const direct = await database.collection('employees').doc(userId).get();
      if(direct.exists) doc = direct;
      if(!doc){
        const byEmployeeId = await database.collection('employees').where('employeeId','==',userId).limit(1).get();
        if(!byEmployeeId.empty) doc = byEmployeeId.docs[0];
      }
      if(!doc){
        const byId = await database.collection('employees').where('id','==',userId).limit(1).get();
        if(!byId.empty) doc = byId.docs[0];
      }
    }
    if(!doc && email){
      const byEmail = await database.collection('employees').where('email','==',email).limit(1).get();
      if(!byEmail.empty) doc = byEmail.docs[0];
    }
    if(!doc) throw new Error('找不到員工薪資投保資料');
    return doc;
  }

  function normalizeSalary(raw, docId){
    raw = raw || {};
    const identityRaw = lower(pick(raw, ['identityType','employeeType','type','身分類型'], ''));
    const roleText = clean(pick(raw, ['role','identityLabel','職務類型','聘用類型'], ''));
    const isParttime = identityRaw === 'parttime' || roleText.indexOf('工讀') >= 0 || truthy(pick(raw, ['isPartTime','是否工讀生'], ''));
    const baseSalary = pick(raw, ['baseSalary','staffBaseSalary','monthlySalary','salary','本薪','月薪'], '');
    const hourlyRate = pick(raw, ['hourlyRate','parttimeHourlyRate','hourRate','時薪'], '');
    const averageSalary = pick(raw, ['averageSalary','parttimeAverageSalary','averageSalaryText','目前申報月平均薪資總額'], '');
    const isPartialHours = pick(raw, ['isPartialHours','isPartialWorkingTime','partialWorkingTime','是否部分工時'], '');
    const laborStatus = statusVisible(pick(raw, ['laborStatus','laborInsuranceStatus','laborInsurance','勞保狀態'], ''));
    const healthStatus = statusVisible(pick(raw, ['healthStatus','healthInsuranceStatus','healthInsurance','健保狀態'], ''));
    const laborPlanCode = pick(raw, ['laborPlan','laborPlanCode','laborInsuranceLevel','laborLevel','勞保級距'], '');
    const healthPlanCode = pick(raw, ['healthPlan','healthPlanCode','healthInsuranceLevel','healthLevel','健保級距'], '');
    const laborPlan = planByCode(DEFAULT_LABOR_PLANS, laborPlanCode);
    const healthPlan = planByCode(DEFAULT_HEALTH_PLANS, healthPlanCode);
    const laborSelfRaw = pick(raw, ['laborSelfPayText','laborInsuranceSelfPay','laborSelfPay','勞保自付額'], '');
    const healthSelfRaw = pick(raw, ['healthSelfPayText','healthInsuranceSelfPay','healthSelfPay','健保自付額'], '');
    const laborActive = insuranceActive(laborStatus);
    const healthActive = insuranceActive(healthStatus);
    const selfRetirementEnabled = pick(raw, ['selfRetirementEnabled','laborRetirementSelfEnabled','勞退自提'], '');
    const selfRetirementRate = pick(raw, ['selfRetirementRate','laborRetirementSelfRate','勞退自提比率'], '');
    const selfRetirementText = truthy(selfRetirementEnabled) ? (percent(selfRetirementRate) || '已開啟') : '';
    const retirementEmployerText = laborActive ? '6%' : '';

    return {
      employeeId: clean(pick(raw, ['employeeId','id','員工ID'], docId)),
      name: clean(pick(raw, ['name','姓名','displayName'], '')),
      email: clean(pick(raw, ['email','Email'], '')),
      identityType: isParttime ? 'parttime' : 'staff',
      mainAmountLabel: isParttime ? '時薪' : '本薪',
      mainAmountText: isParttime ? (hourlyRate ? money(hourlyRate) + ' / 小時' : '') : (baseSalary ? money(baseSalary) : ''),
      staffBaseSalaryText: baseSalary ? money(baseSalary) : '',
      parttimeHourlyRateText: hourlyRate ? money(hourlyRate) + ' / 小時' : '',
      parttimePartialHoursText: isParttime && clean(isPartialHours) ? clean(isPartialHours) : '',
      parttimeAverageSalaryText: averageSalary ? money(averageSalary) : '',
      jobAllowanceText: formatItems(raw.jobAllowances || raw.jobAllowanceItems || []),
      allowanceText: formatItems(raw.allowances || raw.allowanceItems || []),
      laborStatus: laborStatus,
      healthStatus: healthStatus,
      laborActive: laborActive,
      healthActive: healthActive,
      laborPlanText: laborActive ? formatPlan(laborPlan, laborPlanCode) : '',
      healthPlanText: healthActive ? formatPlan(healthPlan, healthPlanCode) : '',
      laborLevelText: laborActive ? formatPlan(laborPlan, laborPlanCode) : '',
      healthLevelText: healthActive ? formatPlan(healthPlan, healthPlanCode) : '',
      laborSalaryText: laborActive && laborPlan && laborPlan.salary ? money(laborPlan.salary) : '',
      healthSalaryText: healthActive && healthPlan && healthPlan.salary ? money(healthPlan.salary) : '',
      laborSelfPayText: laborActive ? (laborSelfRaw ? (money(laborSelfRaw) || clean(laborSelfRaw)) : '') : '',
      healthSelfPayText: healthActive ? (healthSelfRaw ? (money(healthSelfRaw) || clean(healthSelfRaw)) : '') : '',
      retirementEmployerText: retirementEmployerText,
      selfRetirementText: selfRetirementText,
      effectiveDate: fmtDate(pick(raw, ['effectiveDate','salaryEffectiveDate','生效日期'], '')),
      note: clean(pick(raw, ['note','salaryNote','備註'], '')),
      raw: raw
    };
  }

  async function getMySalaryInfo(payload){
    const doc = await findEmployeeDoc(payload || {});
    const info = normalizeSalary(doc.data() || {}, doc.id);
    return {ok:true, source:'firebase-salary-display-final', info:info, salary:info};
  }

  fb.handleApi = async function(action, payload){
    if(clean(action) === 'getMySalaryInfo') return await getMySalaryInfo(payload || {});
    if(typeof oldHandle === 'function') return await oldHandle(action, payload || {});
    return null;
  };
  fb.__salaryDisplayFinalV20260527 = true;
  global.YZFirebase = fb;
})(window);

/* 打卡系統：多班表顯示、上班前一小時限制與快速打卡版 20260528 */
(function(global){
  const fb = global.YZFirebase || {};
  if(!fb || fb.__clockMultiScheduleV20260528) return;
  const oldHandle = fb.handleApi;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){
    const s = lower(v);
    return v === true || ['是','yes','true','1','啟用','enabled','active','在保','已核准'].includes(s);
  }
  function isDisabled(v){
    const s = lower(v);
    return v === false || ['false','0','否','no','停用','disabled','inactive','已刪除','deleted'].includes(s);
  }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function today(){ return ymd(new Date()); }
  function timeNow(){ const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function dateText(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') v = v.toDate();
    if(v instanceof Date && !isNaN(v.getTime())) return ymd(v);
    const s = clean(v);
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : ymd(d);
  }
  function timeText(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') v = v.toDate();
    if(v instanceof Date && !isNaN(v.getTime())) return pad(v.getHours()) + ':' + pad(v.getMinutes()) + ':' + pad(v.getSeconds());
    const s = clean(v);
    const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if(m) return pad(m[1]) + ':' + m[2] + ':' + (m[3] || '00');
    return s;
  }
  function shortTime(v){ return timeText(v).slice(0,5); }
  function minutes(v){
    const t = timeText(v);
    const m = t.match(/^(\d{1,2}):(\d{2})/);
    if(!m) return NaN;
    return Number(m[1]) * 60 + Number(m[2]);
  }
  function hhmmFromMinutes(v){
    if(!Number.isFinite(v)) return '';
    const m = ((Math.round(v) % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }
  function nowMinutes(){ const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function tsValue(v){
    if(!v) return 0;
    if(v && typeof v.toMillis === 'function') return v.toMillis();
    if(v && typeof v.toDate === 'function') return v.toDate().getTime();
    if(v instanceof Date) return v.getTime();
    const n = Number(v);
    if(Number.isFinite(n) && n > 0) return n;
    const d = new Date(v);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  function db(){
    try{
      if(fb && typeof fb.init === 'function') return fb.init();
      if(global.firebase && global.firebase.apps && global.firebase.apps.length) return global.firebase.firestore();
    }catch(e){ console.warn('[clock multi schedule db]', e); }
    return null;
  }
  function serverTs(){
    try{ return global.firebase.firestore.FieldValue.serverTimestamp(); }
    catch(e){ return new Date().toISOString(); }
  }
  async function all(col){
    const d = db();
    if(!d) throw new Error('Firebase 尚未啟用');
    const snap = await d.collection(col).get();
    const rows = [];
    snap.forEach(doc => rows.push(Object.assign({__id:doc.id}, doc.data() || {})));
    return rows;
  }
  async function queryEq(col, field, value){
    const d = db();
    if(!d) throw new Error('Firebase 尚未啟用');
    const snap = await d.collection(col).where(field, '==', value).get();
    const rows = [];
    snap.forEach(doc => rows.push(Object.assign({__id:doc.id}, doc.data() || {})));
    return rows;
  }
  function mergeByDocId(list){
    const map = new Map();
    (list || []).forEach(row => {
      if(!row) return;
      const key = clean(row.__id || row.recordId || row.assignmentId || row.templateId || JSON.stringify(row));
      map.set(key, row);
    });
    return Array.from(map.values());
  }
  async function rowsByEmployee(col, employeeId){
    employeeId = clean(employeeId);
    if(!employeeId) return [];
    const jobs = [
      queryEq(col, 'employeeId', employeeId).catch(()=>[]),
      queryEq(col, '員工ID', employeeId).catch(()=>[])
    ];
    const res = await Promise.all(jobs);
    return mergeByDocId([].concat.apply([], res));
  }
  async function setDoc(col, id, data){
    const d = db();
    if(!d) throw new Error('Firebase 尚未啟用');
    await d.collection(col).doc(id).set(Object.assign({}, data, {updatedAt:serverTs()}), {merge:true});
  }
  async function deleteDoc(col, id){
    const d = db();
    if(!d) throw new Error('Firebase 尚未啟用');
    await d.collection(col).doc(clean(id)).delete();
  }
  function currentUser(){ try{return JSON.parse(localStorage.getItem('employeeUser') || 'null') || {}}catch(e){return {}} }
  function employeeIdFrom(payload){
    const u = currentUser();
    return clean((payload && (payload.userId || payload.employeeId || payload.id)) || u.id || u.employeeId || localStorage.getItem('employeeUserId') || '');
  }
  function isEnabledRow(o){
    o = o || {};
    if(isDisabled(o.deleted) || isDisabled(o.isDeleted) || isDisabled(o.status) || clean(o.status) === '已刪除') return false;
    if(o.enabled === undefined && o['啟用'] === undefined && o.active === undefined) return true;
    return !isDisabled(o.enabled !== undefined ? o.enabled : (o['啟用'] !== undefined ? o['啟用'] : o.active));
  }

  const DAY_KEYS = [
    {idx:0,key:'sunday',label:'星期日',zh:'星期日'},
    {idx:1,key:'monday',label:'星期一',zh:'星期一'},
    {idx:2,key:'tuesday',label:'星期二',zh:'星期二'},
    {idx:3,key:'wednesday',label:'星期三',zh:'星期三'},
    {idx:4,key:'thursday',label:'星期四',zh:'星期四'},
    {idx:5,key:'friday',label:'星期五',zh:'星期五'},
    {idx:6,key:'saturday',label:'星期六',zh:'星期六'}
  ];
  function dayInfo(dateKey){
    const d = new Date(clean(dateKey) + 'T00:00:00');
    if(isNaN(d.getTime())) return DAY_KEYS[0];
    return DAY_KEYS[d.getDay()] || DAY_KEYS[0];
  }
  function pick(o, keys, fallback){
    o = o || {};
    for(const k of keys){
      if(o[k] !== undefined && o[k] !== null && clean(o[k]) !== '') return o[k];
    }
    return fallback == null ? '' : fallback;
  }
  function normalizeSingle(o){
    o = o || {};
    return Object.assign({}, o, {
      id: clean(o.recordId || o['單日ID'] || o.__id),
      employeeId: clean(o.employeeId || o['員工ID']),
      employeeName: clean(o.employeeName || o['員工姓名'] || o.name || o['姓名']),
      date: dateText(o.date || o['日期']),
      clockType: clean(o.clockType || o['打卡類型'] || o.type || '標準打卡') || '標準打卡',
      startTime: shortTime(o.startTime || o['上班時間'] || o.time || o['開始時間']),
      endTime: shortTime(o.endTime || o['下班時間'] || o['結束時間']),
      allowSpecial: truthy(o.allowSpecial || o['允許特殊打卡']),
      enabled: isEnabledRow(o)
    });
  }
  function normalizeAssignment(o){
    o = o || {};
    return Object.assign({}, o, {
      id: clean(o.assignmentId || o['套用ID'] || o.__id),
      employeeId: clean(o.employeeId || o['員工ID']),
      employeeName: clean(o.employeeName || o['員工姓名'] || o.name || o['姓名']),
      templateId: clean(o.templateId || o['模板ID']),
      templateName: clean(o.templateName || o['模板名稱']),
      startDate: dateText(o.startDate || o['開始日期']),
      endDate: dateText(o.endDate || o['結束日期']),
      indefinite: truthy(o.indefinite || o['無期限']),
      enabled: isEnabledRow(o)
    });
  }
  function normalizeTemplate(o){
    o = o || {};
    return Object.assign({}, o, {
      id: clean(o.templateId || o['模板ID'] || o.__id),
      templateId: clean(o.templateId || o['模板ID'] || o.__id),
      templateName: clean(o.templateName || o['模板名稱'] || o.name || '班表模板'),
      enabled: isEnabledRow(o)
    });
  }
  function dayFromTemplate(template, dateKey){
    const info = dayInfo(dateKey);
    const days = Array.isArray(template.days) ? template.days : [];
    const dayRow = days.find(d => clean(d.dayKey || d.key) === info.key || clean(d.dayLabel || d.label) === info.label || clean(d.dayLabel || d.label) === info.zh) || {};
    const type = clean(pick(template, [info.key+'Type', info.zh+'類型'], pick(dayRow, ['type','clockType','打卡類型'], '無班'))) || '無班';
    const start = shortTime(pick(template, [info.key+'StartTime', info.key+'Time', info.zh+'上班時間'], pick(dayRow, ['startTime','time','上班時間'], '')));
    const end = shortTime(pick(template, [info.key+'EndTime', info.zh+'下班時間'], pick(dayRow, ['endTime','下班時間'], '')));
    const allowSpecial = truthy(pick(template, [info.key+'AllowSpecial', info.zh+'允許特殊打卡'], pick(dayRow, ['allowSpecial','允許特殊打卡'], '')));
    return { dayKey:info.key, dayLabel:info.label, clockType:type, startTime:start, endTime:end, allowSpecial };
  }
  function hasWorkTime(schedule){
    if(!schedule) return false;
    // 排班只代表今天是否有出勤時段；不要把班表鎖死成標準或特殊。
    if(schedule.startTime && schedule.endTime) return true;
    if(clean(schedule.clockType) === '特殊打卡') return true;
    return false;
  }
  function allowedClockTypes(schedule){
    if(!schedule || !schedule.hasSchedule) return [];
    const out = [];
    if(schedule.startTime && schedule.endTime) out.push('標準打卡');
    // 有班表但無法標準打卡時，可送特殊打卡審核。
    out.push('特殊打卡');
    return unique(out);
  }
  function scheduleKey(schedule){
    if(!schedule) return '';
    return [clean(schedule.source), clean(schedule.id || schedule.assignmentId || schedule.recordId), clean(schedule.date), clean(schedule.startTime), clean(schedule.endTime), clean(schedule.clockType)].join('|');
  }
  function scheduleSummary(schedule){
    if(!schedule || !schedule.hasSchedule) return '今日沒有排班';
    if(schedule.startTime && schedule.endTime) return schedule.startTime + '-' + schedule.endTime;
    return '今日班表';
  }
  function scheduleSort(a,b){
    const ma = Number.isFinite(minutes(a.startTime)) ? minutes(a.startTime) : 9999;
    const mb = Number.isFinite(minutes(b.startTime)) ? minutes(b.startTime) : 9999;
    if(ma !== mb) return ma - mb;
    const pa = a.source === 'singleDaySchedules' ? 0 : 1;
    const pb = b.source === 'singleDaySchedules' ? 0 : 1;
    if(pa !== pb) return pa - pb;
    return clean(a.key).localeCompare(clean(b.key));
  }
  function decorateSchedule(schedule, dateKey){
    const out = Object.assign({}, schedule);
    out.hasSchedule = hasWorkTime(out);
    out.key = scheduleKey(out);
    out.scheduleKey = out.key;
    out.allowedClockTypes = allowedClockTypes(out);
    out.summary = scheduleSummary(out);

    const todayKey = today();
    const n = nowMinutes();
    const startM = minutes(out.startTime);
    const endM = minutes(out.endTime);
    out.clockInOpenMinute = Number.isFinite(startM) ? Math.max(0, startM - 60) : null;
    out.clockInOpenAt = Number.isFinite(out.clockInOpenMinute) ? hhmmFromMinutes(out.clockInOpenMinute) : '';

    if(!out.hasSchedule){
      out.statusText = '此班表不開放一般打卡';
      out.canClockInNow = false;
      out.canClockOutNow = false;
    }else if(dateKey !== todayKey){
      out.statusText = dateKey < todayKey ? '班表日期已過' : '尚未到班表日期';
      out.canClockInNow = false;
      out.canClockOutNow = false;
    }else if(Number.isFinite(startM)){
      if(n < out.clockInOpenMinute){
        out.statusText = out.clockInOpenAt + ' 後可上班打卡';
        out.canClockInNow = false;
        out.canClockOutNow = false;
      }else{
        out.statusText = '已到可打卡時間';
        out.canClockInNow = true;
        out.canClockOutNow = n >= startM;
      }
    }else{
      out.statusText = '今日可送出打卡';
      out.canClockInNow = true;
      out.canClockOutNow = true;
    }
    return out;
  }
  function unique(list){ return Array.from(new Set((list || []).filter(Boolean))); }
  function makeNoSchedule(employeeId, dateKey, message, extra){
    return Object.assign({
      ok:true, employeeId, date:dateKey, hasSchedule:false, okToClock:false,
      allowedClockTypes:[], schedules:[], schedule:null, scheduleText:'今日沒有排班',
      message: message || '今天沒有排班，如主管臨時安排出勤，請使用「臨時出勤申請」。'
    }, extra || {});
  }
  async function approvedLeaveBlocks(employeeId, dateKey){
    const leaves = await rowsByEmployee('leaveRequests', employeeId).catch(()=>[]);
    return leaves.filter(o => {
      const status = clean(o.status || o['狀態']);
      if(status !== '已核准') return false;
      const start = dateText(o.startDate || o.leaveDate || o['開始日期'] || o['請假日期']);
      const end = dateText(o.endDate || o['結束日期'] || start);
      return start && dateKey >= start && dateKey <= (end || start);
    }).map(o => {
      const startTime = shortTime(o.startTime || o['請假開始時間']);
      const endTime = shortTime(o.endTime || o['請假結束時間']);
      const hours = Number(o.hours || o.leaveHours || o['請假時數'] || 0) || 0;
      const session = clean(o.session || o['請假時段']);
      const allDay = (!startTime && !endTime && (hours >= 8 || session.indexOf('全') >= 0 || !hours)) || session.indexOf('全天') >= 0;
      return {
        requestId: clean(o.requestId || o.leaveId || o['請假ID'] || o.__id),
        reason: clean(o.reason || o.leaveName || o['請假原因'] || '請假'),
        startTime, endTime, hours, session, allDay
      };
    });
  }
  async function resolveTodaySchedule(payload){
    const p = payload || {};
    const employeeId = employeeIdFrom(p);
    const dateKey = dateText(p.date || p.clockDate) || today();
    if(!employeeId) return {ok:false, message:'缺少員工資料，請重新登入。', hasSchedule:false, okToClock:false, allowedClockTypes:[], schedules:[]};

    const [singleRows, assignmentRows, templateRows, leaveBlocks] = await Promise.all([
      rowsByEmployee('singleDaySchedules', employeeId).catch(()=>[]),
      rowsByEmployee('employeeSchedules', employeeId).catch(()=>[]),
      all('scheduleTemplates').catch(()=>[]),
      approvedLeaveBlocks(employeeId, dateKey).catch(()=>[])
    ]);
    const templates = templateRows.map(normalizeTemplate).filter(t => t.enabled);
    const schedules = [];

    singleRows.map(normalizeSingle)
      .filter(x => x.enabled && x.employeeId === employeeId && x.date === dateKey)
      .forEach(single => {
        const s = decorateSchedule({
          id: single.id,
          source: 'singleDaySchedules',
          sourceLabel: '單日特別班表',
          employeeId,
          employeeName: single.employeeName,
          date: dateKey,
          clockType: single.clockType,
          startTime: single.startTime,
          endTime: single.endTime,
          allowSpecial: single.allowSpecial,
          note: clean(single.note || single['備註'])
        }, dateKey);
        if(s.hasSchedule) schedules.push(s);
      });

    assignmentRows.map(normalizeAssignment)
      .filter(x => x.enabled && x.employeeId === employeeId && x.startDate && dateKey >= x.startDate && (x.indefinite || !x.endDate || dateKey <= x.endDate))
      .forEach(assignment => {
        const template = templates.find(t => clean(t.templateId || t.id) === clean(assignment.templateId) || clean(t.__id) === clean(assignment.templateId));
        if(!template) return;
        const day = dayFromTemplate(template, dateKey);
        const s = decorateSchedule({
          id: assignment.id,
          source: 'employeeSchedules',
          sourceLabel: '固定班表',
          employeeId,
          employeeName: assignment.employeeName,
          date: dateKey,
          assignmentId: assignment.id,
          templateId: template.templateId || template.id,
          templateName: template.templateName || assignment.templateName,
          dayKey: day.dayKey,
          dayLabel: day.dayLabel,
          clockType: day.clockType,
          startTime: day.startTime,
          endTime: day.endTime,
          allowSpecial: day.allowSpecial,
          note: clean(assignment.note || assignment['備註'] || template.note || template['備註'])
        }, dateKey);
        if(s.hasSchedule) schedules.push(s);
      });

    schedules.sort(scheduleSort);
    if(!schedules.length) return makeNoSchedule(employeeId, dateKey);

    const allDayLeave = leaveBlocks.find(x => x.allDay);
    const allowed = unique([].concat.apply([], schedules.map(s => s.allowedClockTypes || [])));
    const okToClock = allowed.length > 0 && !allDayLeave;
    let message = '今日共有 ' + schedules.length + ' 筆班表，請依各班表可打卡時間打卡。';
    if(schedules.length === 1) message = '今日班表：' + scheduleSummary(schedules[0]);
    if(allDayLeave) message = '今天已有核准請假（' + allDayLeave.reason + '），不開放一般打卡。';

    return {
      ok:true,
      employeeId,
      date:dateKey,
      hasSchedule:true,
      okToClock,
      allowedClockTypes: allowed,
      schedules,
      schedule: schedules[0],
      scheduleText: schedules.map(scheduleSummary).join('\n'),
      leaveBlocks,
      message
    };
  }
  function canClockAction(schedule, mode, actionName, clockDate, clockTime){
    if(!schedule || !schedule.hasSchedule) return {ok:false, message:'請先選擇今日班表。'};
    const action = clean(actionName);
    const clockM = minutes(clockTime || timeNow());
    const startM = minutes(schedule.startTime);
    const openM = Number.isFinite(startM) ? Math.max(0, startM - 60) : NaN;
    if(mode === '標準打卡' && action.indexOf('上班') >= 0 && Number.isFinite(openM) && Number.isFinite(clockM) && clockM < openM){
      return {ok:false, message:'尚未到可打卡時間。此班表 ' + schedule.startTime + ' 上班，請於 ' + hhmmFromMinutes(openM) + ' 後再上班打卡。'};
    }
    if(mode === '標準打卡' && action.indexOf('下班') >= 0 && Number.isFinite(startM) && Number.isFinite(clockM) && clockM < startM){
      return {ok:false, message:'尚未到上班時間，暫不開放下班打卡。'};
    }
    return {ok:true, message:''};
  }
  function chooseScheduleForClock(info, mode, actionName, scheduleKeyValue, clockDate, clockTime){
    const schedules = (info && info.schedules) || [];
    if(scheduleKeyValue){
      const chosen = schedules.find(s => clean(s.scheduleKey || s.key) === clean(scheduleKeyValue));
      if(!chosen) return {ok:false, message:'找不到你選擇的班表，請重新整理後再試。'};
      const allowed = canClockAction(chosen, mode, actionName, clockDate, clockTime);
      return Object.assign({schedule:chosen}, allowed);
    }
    const candidates = schedules.filter(s => s && s.hasSchedule);
    if(!candidates.length) return {ok:false, message:'今天沒有可用班表。'};
    const available = candidates.map(s => Object.assign({schedule:s}, canClockAction(s, mode, actionName, clockDate, clockTime))).filter(x => x.ok);
    if(available.length) return available[0];
    const first = Object.assign({schedule:candidates[0]}, canClockAction(candidates[0], mode, actionName, clockDate, clockTime));
    return first;
  }
  function recordScheduleKey(o){
    if(!o) return '';
    return clean(o.scheduleKey || [clean(o.scheduleSource), clean(o.scheduleId), clean(o.scheduleDate || o.clockDate || o.date || o['打卡日期']), clean(o.scheduleStartTime), clean(o.scheduleEndTime), clean(o.scheduleClockType)].join('|'));
  }
  async function existingClock(employeeId, dateKey, actionName, scheduleKeyValue){
    const rows = await rowsByEmployee('clockRecords', employeeId).catch(()=>[]);
    return rows.find(o => {
      if(dateText(o.clockDate || o.date || o['打卡日期']) !== dateKey) return false;
      if(clean(o.actionName || o['打卡動作']) !== actionName) return false;
      if(clean(o.status || o['狀態']) === '已刪除') return false;
      const rk = recordScheduleKey(o);
      return scheduleKeyValue ? rk === clean(scheduleKeyValue) : true;
    }) || null;
  }
  function companyClockIp(){
    const cfg = global.APP_CONFIG || {};
    return clean(cfg.CLOCK_ALLOWED_IP || cfg.COMPANY_CLOCK_IP || '125.229.190.123');
  }
  async function clockWithSchedule(payload){
    const p = payload || {};
    const user = currentUser();
    const employeeId = employeeIdFrom(p);
    const actionName = clean(p.actionName);
    const clockType = clean(p.clockType || p.supplementClockType || '標準打卡') || '標準打卡';
    const clockDate = dateText(p.supplementDate || p.clockDate) || today();
    const clockTime = timeText(p.supplementTime || p.clockTime) || timeNow();
    if(!employeeId || !actionName) return {ok:false, message:'缺少打卡資料，請重新登入後再試。'};

    if(truthy(p.isSupplement)){
      if(typeof oldHandle === 'function') return await oldHandle('clock', p);
      return {ok:false, message:'補登請改用「補登 / 臨時出勤」申請。'};
    }

    const todayInfo = await resolveTodaySchedule(Object.assign({}, p, {employeeId, date:clockDate}));
    if(!todayInfo.okToClock){
      return Object.assign({}, todayInfo, {ok:false, message:todayInfo.message || '今天沒有可用班表，無法一般打卡。'});
    }
    const picked = chooseScheduleForClock(todayInfo, clockType, actionName, p.scheduleKey, clockDate, clockTime);
    if(!picked.ok){
      return Object.assign({}, todayInfo, {ok:false, message:picked.message || '目前不可打卡。'});
    }
    const schedule = picked.schedule || {};
    const key = clean(schedule.scheduleKey || schedule.key || scheduleKey(schedule));

    if(clockType === '特殊打卡'){
      const reason = clean(p.specialReason || p.reason || p.note);
      if(!reason) return {ok:false, message:'請填寫特殊打卡原因。'};
      const existed = await existingClock(employeeId, clockDate, actionName, key);
      if(existed){
        return {ok:false, message:'這一段班表今天已經有「' + actionName + '」紀錄，如時間錯誤請使用下方「修正這筆」。', existingRecordId:clean(existed.recordId || existed.__id)};
      }
      const corrections = await rowsByEmployee('clockCorrections', employeeId).catch(()=>[]);
      const pending = (corrections || []).find(c => {
        const status = clean(c.status || c['狀態']);
        const kind = clean(c.requestKind || c['申請種類']);
        return status === '待審核' && kind === 'specialClock' && dateText(c.correctDate || c['修正日期']) === clockDate && clean(c.correctAction || c.actionName || c['修正動作']) === actionName && clean(c.scheduleKey) === key;
      });
      if(pending) return {ok:false, message:'這一段班表已經送出特殊打卡申請，待主管審核。主管審核會更新，並自動歸位。', requestId:clean(pending.requestId || pending.__id)};
      const requestId = 'SPCLK_' + employeeId + '_' + clockDate.replace(/-/g,'') + '_' + (actionName.indexOf('下班') >= 0 ? 'OUT' : 'IN') + '_' + Date.now();
      const row = {
        requestId,
        '申請ID':requestId,
        requestKind:'specialClock',
        '申請種類':'specialClock',
        employeeId,
        '員工ID':employeeId,
        name:clean(user.name),
        '姓名':clean(user.name),
        email:lower(user.email),
        correctDate:clockDate,
        '修正日期':clockDate,
        correctTime:clockTime,
        '修正時間':clockTime,
        correctAction:actionName,
        '修正動作':actionName,
        correctionType:'特殊打卡',
        '修正打卡方式':'特殊打卡',
        reason,
        '修正原因':reason,
        scheduleKey:key,
        scheduleDate:clockDate,
        scheduleStartTime:clean(schedule.startTime),
        scheduleEndTime:clean(schedule.endTime),
        scheduleSource:clean(schedule.source),
        scheduleSourceLabel:clean(schedule.sourceLabel),
        scheduleTemplateName:clean(schedule.templateName),
        scheduleSnapshot:schedule,
        clientIp:clean(p.clientIp),
        sourceIp:clean(p.clientIp),
        status:'待審核',
        '狀態':'待審核',
        source:'firebase-special-clock-review',
        createdAt:serverTs()
      };
      await setDoc('clockCorrections', requestId, row);
      return {ok:true, message:'特殊打卡申請已送出，待主管審核。主管審核會更新，並自動歸位。', requestId, specialClockPending:true, row};
    }

    if(clockType === '標準打卡' && actionName.indexOf('上班') >= 0){
      const allowedIp = companyClockIp();
      const ip = clean(p.clientIp);
      if(!ip) return {ok:false, message:'無法確認公司 Wi-Fi IP，請確認已連上公司 Wi-Fi 後再試。'};
      if(allowedIp && ip !== allowedIp){
        return {ok:false, message:'目前偵測 IP 為 ' + ip + '，不是公司指定 Wi-Fi IP（' + allowedIp + '），無法上班打卡。'};
      }
    }

    const existed = await existingClock(employeeId, clockDate, actionName, key);
    if(existed){
      return {ok:false, message:'這一段班表今天已經有「' + actionName + '」紀錄，如時間錯誤請使用下方「提出補登修正」。', existingRecordId:clean(existed.recordId || existed.__id)};
    }

    const clockM = minutes(clockTime);
    const startM = minutes(schedule.startTime);
    const endM = minutes(schedule.endTime);
    let lateMinutes = 0;
    let earlyLeaveMinutes = 0;
    let status = '正常';
    if(clockType === '標準打卡' && actionName.indexOf('上班') >= 0 && Number.isFinite(clockM) && Number.isFinite(startM) && clockM > startM){
      lateMinutes = Math.max(0, Math.round(clockM - startM));
      if(lateMinutes > 0) status = '遲到';
    }
    if(clockType === '標準打卡' && actionName.indexOf('下班') >= 0 && Number.isFinite(clockM) && Number.isFinite(endM) && clockM < endM){
      earlyLeaveMinutes = Math.max(0, Math.round(endM - clockM));
      if(earlyLeaveMinutes > 0) status = '早退';
    }

    const recordId = 'CLK_' + employeeId + '_' + clockDate.replace(/-/g,'') + '_' + (actionName.indexOf('下班') >= 0 ? 'OUT' : 'IN') + '_' + Date.now();
    const row = {
      recordId,
      employeeId,
      '員工ID': employeeId,
      name: clean(user.name),
      '姓名': clean(user.name),
      email: lower(user.email),
      clockDate,
      '打卡日期': clockDate,
      clockTime,
      '打卡時間': clockTime,
      actionName,
      '打卡動作': actionName,
      clockType,
      '打卡方式': clockType,
      status,
      '狀態': status,
      lateMinutes,
      '遲到分鐘': lateMinutes,
      earlyLeaveMinutes,
      '早退分鐘': earlyLeaveMinutes,
      note: clean(p.note),
      '備註': clean(p.note),
      sourceIp: clean(p.clientIp),
      '來源IP': clean(p.clientIp),
      isSupplement: false,
      scheduleLinked: true,
      scheduleKey: key,
      scheduleId: clean(schedule.id || schedule.assignmentId || schedule.recordId),
      scheduleSource: clean(schedule.source),
      scheduleSourceLabel: clean(schedule.sourceLabel),
      scheduleDate: clean(schedule.date),
      scheduleClockType: clean(schedule.clockType),
      scheduleStartTime: clean(schedule.startTime),
      scheduleEndTime: clean(schedule.endTime),
      scheduleAllowSpecial: !!schedule.allowSpecial,
      scheduleTemplateId: clean(schedule.templateId),
      scheduleTemplateName: clean(schedule.templateName),
      source:'firebase-clock-multi-schedule',
      createdAt: serverTs()
    };
    await setDoc('clockRecords', recordId, row);

    let message = actionName + '成功';
    if(schedule.startTime || schedule.endTime) message += '（' + scheduleSummary(schedule) + '）';
    if(lateMinutes > 0) message += '，本次遲到 ' + lateMinutes + ' 分鐘';
    if(earlyLeaveMinutes > 0) message += '，本次早退 ' + earlyLeaveMinutes + ' 分鐘';
    return {ok:true, message, recordId, lateMinutes, earlyLeaveMinutes, lateDeductionAmount:0, lateDeductionText:'$0', schedule:todayInfo, usedSchedule:schedule};
  }

  function generatedId(prefix){ return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }
  async function saveScheduleDoc(collection, payload, idField, prefix, message){
    const p = Object.assign({}, payload || {});
    const id = clean(p[idField] || p.__id || p['模板ID'] || p['套用ID'] || p['單日ID']) || generatedId(prefix);
    p[idField] = id;
    if(idField === 'templateId') p['模板ID'] = id;
    if(idField === 'assignmentId') p['套用ID'] = id;
    if(idField === 'recordId') p['單日ID'] = id;
    p.source = 'firebase-clock-multi-schedule';
    if(!p.createdAt) p.createdAt = serverTs();
    await setDoc(collection, id, p);
    const out = {ok:true, message:message || '已儲存。', id};
    out[idField] = id;
    return out;
  }
  async function deleteScheduleDoc(collection, payload, fields, message){
    const p = payload || {};
    const id = clean(fields.map(k => p[k]).find(Boolean));
    if(!id) return {ok:false, message:'缺少要刪除的ID'};
    await deleteDoc(collection, id);
    return {ok:true, message:message || '已刪除。', id};
  }

  fb.handleApi = async function(action, payload){
    const a = clean(action);
    if(a === 'saveScheduleTemplate') return await saveScheduleDoc('scheduleTemplates', payload || {}, 'templateId', 'TPL', '班表模板已儲存。');
    if(a === 'saveEmployeeSchedule') return await saveScheduleDoc('employeeSchedules', payload || {}, 'assignmentId', 'SCH', '員工班表已儲存。');
    if(a === 'saveSingleDaySchedule') return await saveScheduleDoc('singleDaySchedules', payload || {}, 'recordId', 'SDS', '單日班表已儲存。');
    if(a === 'deleteScheduleTemplate') return await deleteScheduleDoc('scheduleTemplates', payload || {}, ['templateId','模板ID','id'], '班表模板已刪除。');
    if(a === 'deleteEmployeeSchedule') return await deleteScheduleDoc('employeeSchedules', payload || {}, ['assignmentId','套用ID','id'], '員工班表已刪除。');
    if(a === 'deleteSingleDaySchedule') return await deleteScheduleDoc('singleDaySchedules', payload || {}, ['recordId','單日ID','id'], '單日班表已刪除。');
    if(a === 'getTodaySchedule' || a === 'getTodayClockSchedule') return await resolveTodaySchedule(payload || {});
    if(a === 'clock') return await clockWithSchedule(payload || {});
    if(typeof oldHandle === 'function') return await oldHandle(action, payload || {});
    return null;
  };
  fb.__clockMultiScheduleV20260528 = true;
  global.YZFirebase = fb;
})(window);

/* 打卡紀錄讀取修正：讓近期與歷史查詢直接讀 Firebase clockRecords */
(function(global){
  const fb = global.YZFirebase;
  if(!fb || fb.__clockHistoryReadFixV20260528) return;
  const oldHandle = fb.handleApi;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function today(){ return ymd(new Date()); }
  function addDays(dateKey, days){
    const d = new Date(clean(dateKey) + 'T00:00:00');
    if(isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + Number(days || 0));
    return ymd(d);
  }
  function dateText(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') return ymd(v.toDate());
    if(v instanceof Date && !isNaN(v.getTime())) return ymd(v);
    const s = clean(v);
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : ymd(d);
  }
  function timeText(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function'){
      const d = v.toDate();
      return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    if(v instanceof Date && !isNaN(v.getTime())) return pad(v.getHours()) + ':' + pad(v.getMinutes()) + ':' + pad(v.getSeconds());
    const s = clean(v);
    if(/^\d{1,2}:\d{2}/.test(s)){
      const p = s.split(':');
      return pad(p[0]) + ':' + p[1] + ':' + (p[2] ? pad(p[2]) : '00');
    }
    return s;
  }
  function localUser(){ try{return JSON.parse(localStorage.getItem('employeeUser') || '{}') || {}}catch(e){return {}} }
  function employeeIdFrom(p){
    const u = localUser();
    return clean((p && (p.userId || p.employeeId || p.id)) || u.employeeId || u.id || u.userId || localStorage.getItem('employeeUserId'));
  }
  function emailFrom(p){
    const u = localUser();
    return lower((p && p.email) || u.email);
  }
  function inTodayOrYesterday(dateKey){
    const t = today();
    const d = clean(dateKey);
    return d === t || d === addDays(t, -1);
  }
  function db(){
    try{
      if(fb && typeof fb.init === 'function') return fb.init();
      if(global.firebase && global.firebase.apps && global.firebase.apps.length) return global.firebase.firestore();
    }catch(e){ console.warn('[clock history db]', e); }
    return null;
  }
  async function where(col, field, value){
    const d = db();
    if(!d) throw new Error('Firebase 尚未啟用');
    const v = clean(value);
    if(!v) return [];
    const snap = await d.collection(col).where(field, '==', v).get();
    const rows = [];
    snap.forEach(doc => rows.push(Object.assign({__id:doc.id}, doc.data() || {})));
    return rows;
  }
  function dedupe(rows){
    const map = new Map();
    (rows || []).forEach(r => {
      const key = clean(r.recordId || r.id || r['紀錄ID'] || r.__id) || JSON.stringify(r);
      map.set(key, r);
    });
    return Array.from(map.values());
  }
  async function readClockRows(p){
    const employeeId = employeeIdFrom(p || {});
    const email = emailFrom(p || {});
    const jobs = [];
    if(employeeId){
      jobs.push(where('clockRecords', 'employeeId', employeeId).catch(()=>[]));
      jobs.push(where('clockRecords', '員工ID', employeeId).catch(()=>[]));
      jobs.push(where('clockRecords', 'userId', employeeId).catch(()=>[]));
    }
    if(email){
      jobs.push(where('clockRecords', 'email', email).catch(()=>[]));
      jobs.push(where('clockRecords', 'Email', email).catch(()=>[]));
    }
    const chunks = await Promise.all(jobs);
    return dedupe([].concat.apply([], chunks));
  }
  function normalizeClock(o){
    o = o || {};
    const d = dateText(o.clockDate || o.date || o['打卡日期'] || o.createdAt || o.updatedAt);
    const t = timeText(o.clockTime || o.time || o['打卡時間'] || o.createdAt || o.updatedAt);
    const status = clean(o.status || o['狀態'] || '正常') || '正常';
    const clockType = clean(o.clockType || o['打卡方式'] || '標準打卡') || '標準打卡';
    const actionName = clean(o.actionName || o['打卡動作']);
    return {
      id: clean(o.recordId || o.id || o['紀錄ID'] || o.__id),
      recordId: clean(o.recordId || o.id || o['紀錄ID'] || o.__id),
      employeeId: clean(o.employeeId || o['員工ID'] || o.userId),
      name: clean(o.name || o['姓名']),
      email: lower(o.email || o.Email || o['Email']),
      date: d,
      time: t,
      actionName,
      clockType,
      status,
      statusLabel: status,
      lateMinutes: Number(o.lateMinutes || o['遲到分鐘'] || 0) || 0,
      earlyLeaveMinutes: Number(o.earlyLeaveMinutes || o['早退分鐘'] || 0) || 0,
      note: clean(o.note || o['備註']),
      sourceIp: clean(o.sourceIp || o.clientIp || o['來源IP']),
      originalRef: clean(o.originalRecordId || o.originalRef || o['原始紀錄ID']),
      scheduleLinked: o.scheduleLinked === true,
      scheduleKey: clean(o.scheduleKey),
      scheduleId: clean(o.scheduleId),
      scheduleSource: clean(o.scheduleSource),
      scheduleSourceLabel: clean(o.scheduleSourceLabel),
      scheduleStartTime: clean(o.scheduleStartTime),
      scheduleEndTime: clean(o.scheduleEndTime),
      scheduleTemplateName: clean(o.scheduleTemplateName),
      canModify: inTodayOrYesterday(d)
    };
  }
  function sortRows(rows){
    return (rows || []).slice().sort((a,b) => (clean(b.date) + ' ' + clean(b.time)).localeCompare(clean(a.date) + ' ' + clean(a.time)));
  }
  async function getEditableClockHistory(p){
    const rows = sortRows((await readClockRows(p)).map(normalizeClock).filter(r => r.date && inTodayOrYesterday(r.date)));
    return {ok:true, source:'firebase-clockRecords', rows};
  }
  async function getClockHistoryRange(p){
    const startDate = dateText(p && p.startDate);
    const endDate = dateText(p && p.endDate);
    const rows = sortRows((await readClockRows(p)).map(normalizeClock).filter(r => {
      if(!r.date) return false;
      if(startDate && r.date < startDate) return false;
      if(endDate && r.date > endDate) return false;
      return true;
    }));
    return {ok:true, source:'firebase-clockRecords', rows};
  }

  fb.handleApi = async function(action, payload){
    const a = clean(action);
    if(a === 'getEditableClockHistory') return await getEditableClockHistory(payload || {});
    if(a === 'getClockHistoryRange') return await getClockHistoryRange(payload || {});
    if(typeof oldHandle === 'function') return await oldHandle(action, payload || {});
    return null;
  };

  fb.__clockHistoryReadFixV20260528 = true;
  global.YZFirebase = fb;
})(window);


/* 打卡流程拆分修正：臨時出勤、打卡修正、有班未打卡補登、事後補假勾稽 */
(function(global){
  const fb = global.YZFirebase;
  if(!fb || fb.__clockCorrectionFlowFixV20260528) return;
  const oldHandle = fb.handleApi;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ const s = lower(v); return v === true || ['是','yes','true','1','啟用','enabled','active'].indexOf(s) >= 0; }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function today(){ return ymd(new Date()); }
  function addDays(dateKey, days){ const d = new Date(clean(dateKey) + 'T00:00:00'); if(isNaN(d.getTime())) return ''; d.setDate(d.getDate() + Number(days || 0)); return ymd(d); }
  function dateText(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') return ymd(v.toDate());
    if(v instanceof Date && !isNaN(v.getTime())) return ymd(v);
    const s = clean(v);
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : ymd(d);
  }
  function timeText(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function'){
      const d = v.toDate(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }
    if(v instanceof Date && !isNaN(v.getTime())) return pad(v.getHours()) + ':' + pad(v.getMinutes()) + ':' + pad(v.getSeconds());
    const s = clean(v);
    const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if(m) return pad(m[1]) + ':' + m[2] + ':' + (m[3] ? pad(m[3]) : '00');
    return s;
  }
  function shortTime(v){ const t = timeText(v); return t ? t.slice(0,5) : ''; }
  function minutes(v){ const m = clean(v).match(/^(\d{1,2}):(\d{2})/); if(!m) return NaN; return Number(m[1]) * 60 + Number(m[2]); }
  function nowMinutes(){ const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function serverTs(){ try{ return global.firebase.firestore.FieldValue.serverTimestamp(); }catch(e){ return new Date().toISOString(); } }
  function currentUser(){ try{return JSON.parse(localStorage.getItem('employeeUser') || 'null') || {}}catch(e){return {}} }
  function employeeIdFrom(payload){ const u = currentUser(); return clean((payload && (payload.userId || payload.employeeId || payload.id)) || u.employeeId || u.id || u.userId || localStorage.getItem('employeeUserId')); }
  function emailFrom(payload){ const u = currentUser(); return lower((payload && payload.email) || u.email || ''); }
  function db(){
    try{
      if(fb && typeof fb.init === 'function') return fb.init();
      if(global.firebase && global.firebase.apps && global.firebase.apps.length) return global.firebase.firestore();
    }catch(e){ console.warn('[clock flow db]', e); }
    return null;
  }
  async function all(col){ const d = db(); if(!d) throw new Error('Firebase 尚未啟用'); const snap = await d.collection(col).get(); const rows=[]; snap.forEach(doc => rows.push(Object.assign({__id:doc.id}, doc.data() || {}))); return rows; }
  async function where(col, field, value){ const d = db(); if(!d) throw new Error('Firebase 尚未啟用'); const snap = await d.collection(col).where(field, '==', value).get(); const rows=[]; snap.forEach(doc => rows.push(Object.assign({__id:doc.id}, doc.data() || {}))); return rows; }
  async function docGet(col, id){ const d = db(); if(!d) throw new Error('Firebase 尚未啟用'); const key = clean(id); if(!key) return null; const ref = await d.collection(col).doc(key).get(); return ref.exists ? Object.assign({__id:ref.id}, ref.data() || {}) : null; }
  async function docSet(col, id, data){ const d = db(); if(!d) throw new Error('Firebase 尚未啟用'); await d.collection(col).doc(clean(id)).set(Object.assign({}, data, {updatedAt:serverTs()}), {merge:true}); }
  async function docUpdate(col, id, data){ return await docSet(col, id, data); }
  function mergeRows(list){ const m = new Map(); (list || []).forEach(r => { if(!r) return; const k = clean(r.__id || r.recordId || r.requestId || JSON.stringify(r)); if(k) m.set(k, r); }); return Array.from(m.values()); }
  async function rowsByEmployee(col, employeeId){
    employeeId = clean(employeeId);
    if(!employeeId) return [];
    const res = await Promise.all([
      where(col, 'employeeId', employeeId).catch(()=>[]),
      where(col, '員工ID', employeeId).catch(()=>[]),
      where(col, 'userId', employeeId).catch(()=>[])
    ]);
    return mergeRows([].concat.apply([], res));
  }
  async function readClockRows(payload){
    const employeeId = employeeIdFrom(payload);
    const email = emailFrom(payload);
    const jobs = [];
    if(employeeId){ jobs.push(rowsByEmployee('clockRecords', employeeId)); }
    if(email){ jobs.push(where('clockRecords', 'email', email).catch(()=>[])); jobs.push(where('clockRecords', 'Email', email).catch(()=>[])); }
    const res = jobs.length ? await Promise.all(jobs) : [await all('clockRecords')];
    return mergeRows([].concat.apply([], res));
  }
  function normalizeClock(o){
    o = o || {};
    const date = dateText(o.clockDate || o.date || o['打卡日期']);
    const time = timeText(o.clockTime || o.time || o['打卡時間']);
    const actionName = clean(o.actionName || o['打卡動作']);
    const clockType = clean(o.clockType || o['打卡方式'] || '標準打卡') || '標準打卡';
    const status = clean(o.status || o['狀態'] || '正常') || '正常';
    return {
      id: clean(o.recordId || o.id || o['紀錄ID'] || o.__id),
      recordId: clean(o.recordId || o.id || o['紀錄ID'] || o.__id),
      __id: clean(o.__id),
      employeeId: clean(o.employeeId || o['員工ID']),
      name: clean(o.name || o['姓名']),
      email: lower(o.email || o.Email || o['Email']),
      date, time, actionName, clockType, status, statusLabel: status,
      lateMinutes: Number(o.lateMinutes || o['遲到分鐘'] || 0) || 0,
      earlyLeaveMinutes: Number(o.earlyLeaveMinutes || o['早退分鐘'] || 0) || 0,
      note: clean(o.note || o['備註']),
      sourceIp: clean(o.sourceIp || o.clientIp || o['來源IP']),
      originalRef: clean(o.originalRecordId || o.originalRef || o['原始紀錄ID']),
      scheduleLinked: o.scheduleLinked === true || truthy(o.scheduleLinked),
      scheduleKey: clean(o.scheduleKey),
      scheduleId: clean(o.scheduleId),
      scheduleSource: clean(o.scheduleSource),
      scheduleSourceLabel: clean(o.scheduleSourceLabel),
      scheduleDate: dateText(o.scheduleDate),
      scheduleStartTime: shortTime(o.scheduleStartTime),
      scheduleEndTime: shortTime(o.scheduleEndTime),
      scheduleClockType: clean(o.scheduleClockType),
      scheduleTemplateName: clean(o.scheduleTemplateName),
      isSupplement: o.isSupplement === true || truthy(o.isSupplement || o['是否補登']),
      canModify: date === today() || date === addDays(today(), -1),
      raw: o
    };
  }
  function sortClockRows(rows){ return (rows || []).slice().sort((a,b) => (clean(b.date)+' '+clean(b.time)).localeCompare(clean(a.date)+' '+clean(a.time))); }
  function normalizeCorrection(o){
    o = o || {};
    const requestKind = clean(o.requestKind || o['申請種類'] || (o.originalRecordId || o['原始紀錄ID'] ? 'recordCorrection' : 'missingClock')) || 'recordCorrection';
    return {
      requestId: clean(o.requestId || o['申請ID'] || o.__id),
      requestKind,
      employeeId: clean(o.employeeId || o['員工ID']),
      name: clean(o.name || o['姓名']),
      email: lower(o.email || o.Email || o['Email']),
      originalRecordId: clean(o.originalRecordId || o['原始紀錄ID']),
      originalDate: dateText(o.originalDate || o['原日期']),
      originalTime: timeText(o.originalTime || o['原時間']),
      originalAction: clean(o.originalAction || o['原打卡動作']),
      originalClockType: clean(o.originalClockType || o['原打卡方式']),
      correctDate: dateText(o.correctDate || o.correctionDate || o['修正日期']),
      correctTime: timeText(o.correctTime || o.correctionTime || o['修正時間']),
      correctAction: clean(o.correctAction || o.actionName || o['修正動作']),
      correctionType: clean(o.correctionType || o.clockType || o['修正打卡方式']),
      scheduleKey: clean(o.scheduleKey),
      scheduleDate: dateText(o.scheduleDate || o.correctDate || o['班表日期']),
      scheduleStartTime: shortTime(o.scheduleStartTime),
      scheduleEndTime: shortTime(o.scheduleEndTime),
      scheduleSource: clean(o.scheduleSource),
      scheduleSourceLabel: clean(o.scheduleSourceLabel),
      scheduleTemplateName: clean(o.scheduleTemplateName),
      reason: clean(o.reason || o['修正原因']),
      status: clean(o.status || o['狀態'] || '待審核') || '待審核',
      rejectReason: clean(o.rejectReason || o['駁回理由']),
      raw:o
    };
  }
  async function correctionsByEmployee(employeeId){ return (await rowsByEmployee('clockCorrections', employeeId).catch(()=>[])).map(normalizeCorrection); }
  function isPending(c){ return clean(c && c.status) === '待審核'; }
  async function findClockById(recordId){
    recordId = clean(recordId);
    if(!recordId) return null;
    const direct = await docGet('clockRecords', recordId).catch(()=>null);
    if(direct) return direct;
    const rows = mergeRows([].concat(
      await where('clockRecords', 'recordId', recordId).catch(()=>[]),
      await where('clockRecords', '紀錄ID', recordId).catch(()=>[])
    ));
    return rows[0] || null;
  }
  async function findCorrectionById(requestId){
    requestId = clean(requestId);
    if(!requestId) return null;
    const direct = await docGet('clockCorrections', requestId).catch(()=>null);
    if(direct) return direct;
    const rows = await where('clockCorrections', 'requestId', requestId).catch(()=>[]);
    return rows[0] || null;
  }
  function recordScheduleKey(row){
    row = row || {};
    return clean(row.scheduleKey || [clean(row.scheduleSource), clean(row.scheduleId), dateText(row.scheduleDate || row.clockDate || row.date || row['打卡日期']), shortTime(row.scheduleStartTime), shortTime(row.scheduleEndTime), clean(row.scheduleClockType)].join('|'));
  }
  function scheduleKeyOf(s){ return clean(s && (s.scheduleKey || s.key || [clean(s.source), clean(s.id || s.assignmentId || s.recordId), dateText(s.date), shortTime(s.startTime), shortTime(s.endTime), clean(s.clockType)].join('|'))); }
  function scheduleSummary(s){
    if(!s) return '班表';
    const timeRange = (shortTime(s.startTime) || '--:--') + ' - ' + (shortTime(s.endTime) || '--:--');
    return (shortTime(s.startTime) || shortTime(s.endTime)) ? timeRange : clean(s.sourceLabel || s.scheduleSourceLabel || '班表');
  }
  function existingRecordFor(schedule, actionName, rows){
    const key = scheduleKeyOf(schedule);
    const dateKey = dateText(schedule && schedule.date);
    const action = clean(actionName);
    return (rows || []).map(normalizeClock).find(r => {
      if(r.date !== dateKey) return false;
      if(clean(r.actionName) !== action) return false;
      if(clean(r.status) === '已刪除') return false;
      const rk = recordScheduleKey(r.raw || r);
      if(key && rk) return rk === key;
      return true;
    }) || null;
  }
  function actionIsDue(schedule, actionName, dateKey){
    const t = today();
    if(dateKey < t) return true;
    if(dateKey > t) return false;
    const now = nowMinutes();
    const startM = minutes(schedule && schedule.startTime);
    const endM = minutes(schedule && schedule.endTime);
    if(clean(actionName).indexOf('上班') >= 0) return !Number.isFinite(startM) || now >= startM + 5;
    if(clean(actionName).indexOf('下班') >= 0) return !Number.isFinite(endM) || now >= endM + 5;
    return true;
  }
  function leaveCoversDate(row, dateKey){
    const start = dateText(row.startDate || row.leaveDate || row.date || row['開始日期'] || row['請假日期']);
    const end = dateText(row.endDate || row['結束日期'] || start);
    return start && dateKey >= start && dateKey <= (end || start);
  }
  function isApprovedAllDayLeave(row){
    const status = clean(row.status || row['狀態']);
    if(status !== '已核准') return false;
    const session = clean(row.session || row['請假時段']);
    const st = shortTime(row.startTime || row['請假開始時間']);
    const en = shortTime(row.endTime || row['請假結束時間']);
    const hours = Number(row.hours || row.leaveHours || row['請假時數'] || 0) || 0;
    return session.indexOf('全天') >= 0 || (!st && !en && (!hours || hours >= 8));
  }
  function pendingLeaveForDate(leaves, dateKey){
    return (leaves || []).find(row => clean(row.status || row['狀態']) === '待審核' && leaveCoversDate(row, dateKey)) || null;
  }
  function approvedAllDayLeaveForDate(leaves, dateKey){
    return (leaves || []).find(row => leaveCoversDate(row, dateKey) && isApprovedAllDayLeave(row)) || null;
  }
  function approvedLeaveCoversSchedule(leaves, dateKey, schedule){
    const sStart = minutes(schedule && schedule.startTime);
    const sEnd = minutes(schedule && schedule.endTime);
    return (leaves || []).find(row => {
      if(!leaveCoversDate(row, dateKey)) return false;
      if(clean(row.status || row['狀態']) !== '已核准') return false;
      if(isApprovedAllDayLeave(row)) return true;
      const st = minutes(row.startTime || row['請假開始時間']);
      const en = minutes(row.endTime || row['請假結束時間']);
      if(!Number.isFinite(st) || !Number.isFinite(en) || !Number.isFinite(sStart) || !Number.isFinite(sEnd)) return false;
      return st <= sStart && en >= sEnd;
    }) || null;
  }
  function pendingMissingCorrection(corrections, issue, action){
    return (corrections || []).find(c => isPending(c) && c.requestKind === 'missingClock' && c.scheduleDate === issue.date && clean(c.scheduleKey) === clean(issue.scheduleKey) && clean(c.correctAction) === clean(action)) || null;
  }
  function pendingSpecialClock(corrections, issue, action){
    return (corrections || []).find(c => isPending(c) && c.requestKind === 'specialClock' && c.scheduleDate === issue.date && clean(c.scheduleKey) === clean(issue.scheduleKey) && clean(c.correctAction) === clean(action)) || null;
  }
  function pendingAnyClockRequest(corrections, issue, action){
    return pendingSpecialClock(corrections, issue, action) || pendingMissingCorrection(corrections, issue, action);
  }
  function pendingRecordCorrection(corrections, recordId){
    return (corrections || []).find(c => isPending(c) && c.originalRecordId && clean(c.originalRecordId) === clean(recordId)) || null;
  }
  async function withPendingFlags(rows, employeeId){
    const corrections = await correctionsByEmployee(employeeId).catch(()=>[]);
    return (rows || []).map(row => {
      const p = pendingRecordCorrection(corrections, row.recordId || row.id);
      return Object.assign({}, row, {pendingCorrection: !!p, pendingCorrectionId: p ? p.requestId : '', canModify: !!row.canModify && !p});
    });
  }
  function specialClockPendingRows(corrections){
    return (corrections || []).filter(c => isPending(c) && c.requestKind === 'specialClock' && (c.correctDate === today() || c.correctDate === addDays(today(), -1))).map(c => ({
      id:c.requestId,
      recordId:c.requestId,
      employeeId:c.employeeId,
      name:c.name,
      email:c.email,
      date:c.correctDate,
      time:c.correctTime,
      actionName:c.correctAction,
      clockType:'特殊打卡',
      status:'待主管審核',
      statusLabel:'特殊打卡待主管審核',
      lateMinutes:0,
      earlyLeaveMinutes:0,
      note:c.reason,
      sourceIp:'待審核',
      originalRef:'',
      scheduleLinked:true,
      scheduleKey:c.scheduleKey,
      scheduleDate:c.scheduleDate,
      scheduleStartTime:c.scheduleStartTime,
      scheduleEndTime:c.scheduleEndTime,
      scheduleSource:c.scheduleSource,
      scheduleSourceLabel:c.scheduleSourceLabel,
      scheduleTemplateName:c.scheduleTemplateName,
      isSupplement:false,
      pendingCorrection:true,
      pendingCorrectionId:c.requestId,
      canModify:false,
      raw:c.raw || c
    }));
  }
  async function getEditableClockHistory(payload){
    const employeeId = employeeIdFrom(payload);
    const corrections = await correctionsByEmployee(employeeId).catch(()=>[]);
    const rows = sortClockRows((await readClockRows(payload)).map(normalizeClock).filter(r => r.date === today() || r.date === addDays(today(), -1)).concat(specialClockPendingRows(corrections)));
    return {ok:true, source:'firebase-clock-flow', rows: await withPendingFlags(rows, employeeId)};
  }
  async function getClockHistoryRange(payload){
    const employeeId = employeeIdFrom(payload);
    const startDate = dateText(payload && payload.startDate);
    const endDate = dateText(payload && payload.endDate);
    const rows = sortClockRows((await readClockRows(payload)).map(normalizeClock).filter(r => {
      if(!r.date) return false;
      if(startDate && r.date < startDate) return false;
      if(endDate && r.date > endDate) return false;
      return true;
    }));
    return {ok:true, source:'firebase-clock-flow', rows: await withPendingFlags(rows, employeeId)};
  }
  async function getScheduleInfo(employeeId, dateKey){
    if(typeof oldHandle !== 'function') return {ok:false, schedules:[]};
    const res = await oldHandle('getTodaySchedule', {userId:employeeId, employeeId, date:dateKey}).catch(err => ({ok:false, message:err && err.message, schedules:[]}));
    return res || {ok:false, schedules:[]};
  }
  async function getClockCompletionIssues(payload){
    const employeeId = employeeIdFrom(payload);
    if(!employeeId) return {ok:false, message:'缺少員工資料', rows:[]};
    const dates = [today(), addDays(today(), -1)];
    const [clockRows, corrections, leaves] = await Promise.all([
      readClockRows({employeeId, userId:employeeId}).catch(()=>[]),
      correctionsByEmployee(employeeId).catch(()=>[]),
      rowsByEmployee('leaveRequests', employeeId).catch(()=>[])
    ]);
    const issues = [];
    for(const dateKey of dates){
      const info = await getScheduleInfo(employeeId, dateKey);
      const schedules = Array.isArray(info && info.schedules) ? info.schedules : ((info && info.schedule) ? [info.schedule] : []);
      if(approvedAllDayLeaveForDate(leaves, dateKey)) continue;
      for(const s0 of schedules){
        const s = Object.assign({}, s0 || {}, {date: dateText(s0 && s0.date) || dateKey});
        const key = scheduleKeyOf(s);
        if(!key) continue;
        if(approvedLeaveCoversSchedule(leaves, dateKey, s)) continue;
        const actions = [];
        if(shortTime(s.startTime)) actions.push('上班打卡');
        if(shortTime(s.endTime)) actions.push('下班打卡');
        if(!actions.length) continue;
        const existingIn = existingRecordFor(s, '上班打卡', clockRows);
        const existingOut = existingRecordFor(s, '下班打卡', clockRows);
        const dueMissingActions = actions.filter(action => actionIsDue(s, action, dateKey) && !existingRecordFor(s, action, clockRows));
        if(!dueMissingActions.length) continue;

        const issue = {
          issueKey: dateKey + '|' + key,
          employeeId,
          date:dateKey,
          scheduleKey:key,
          summary:scheduleSummary(s),
          scheduleLabel:scheduleSummary(s),
          startTime:shortTime(s.startTime),
          endTime:shortTime(s.endTime),
          clockType:clean(s.clockType),
          defaultClockType:(Array.isArray(s.allowedClockTypes) && s.allowedClockTypes.indexOf('標準打卡') >= 0) ? '標準打卡' : (clean(s.clockType) || '標準打卡'),
          sourceLabel:clean(s.sourceLabel),
          schedule:s,
          missingActions:dueMissingActions,
          existingClockInTime: existingIn ? shortTime(existingIn.clockTime || existingIn.time || existingIn['打卡時間']) : '',
          existingClockInRecordId: existingIn ? clean(existingIn.recordId || existingIn.__id || existingIn.id) : '',
          existingClockOutTime: existingOut ? shortTime(existingOut.clockTime || existingOut.time || existingOut['打卡時間']) : '',
          existingClockOutRecordId: existingOut ? clean(existingOut.recordId || existingOut.__id || existingOut.id) : '',
          canEarlyLeaveRetro: !!(existingIn && !existingOut && dueMissingActions.length === 1 && clean(dueMissingActions[0]).indexOf('下班') >= 0),
          pendingCorrection:false,
          pendingCorrectionId:'',
          pendingCorrectionAction:'',
          pendingSpecialClock:false,
          pendingSpecialClockId:'',
          pendingLeave:false,
          pendingLeaveId:''
        };

        const pendingLeave = pendingLeaveForDate(leaves, dateKey);
        if(pendingLeave){
          issue.pendingLeave = true;
          issue.pendingLeaveId = clean(pendingLeave.requestId || pendingLeave.leaveId || pendingLeave.__id);
          issues.push(issue);
          continue;
        }

        const pendingMissing = dueMissingActions.map(action => pendingMissingCorrection(corrections, issue, action)).find(Boolean);
        if(pendingMissing){
          issue.pendingCorrection = true;
          issue.pendingCorrectionId = pendingMissing.requestId;
          issue.pendingCorrectionAction = clean(pendingMissing.correctAction || pendingMissing.actionName || pendingMissing['修正動作']);
          issues.push(issue);
          continue;
        }

        const pendingSpecial = dueMissingActions.map(action => pendingSpecialClock(corrections, issue, action)).find(Boolean);
        if(pendingSpecial){
          // 特殊打卡待審核會在「待處理事項」上方以獨立綠色卡片顯示，這裡不再重複顯示缺卡按鈕。
          continue;
        }

        issues.push(issue);
      }
    }
    return {ok:true, rows:issues, count:issues.length};
  }

  function generatedId(prefix){ return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }
  function correctionOriginalFields(record){
    const r = normalizeClock(record || {});
    return {
      originalRecordId:r.recordId || r.__id,
      originalDate:r.date,
      originalTime:r.time,
      originalAction:r.actionName,
      originalClockType:r.clockType,
      scheduleKey:r.scheduleKey || recordScheduleKey(record || {}),
      scheduleDate:r.scheduleDate || r.date,
      scheduleStartTime:r.scheduleStartTime,
      scheduleEndTime:r.scheduleEndTime,
      scheduleSource:r.scheduleSource,
      scheduleSourceLabel:r.scheduleSourceLabel,
      scheduleTemplateName:r.scheduleTemplateName
    };
  }
  async function submitClockCorrection(payload){
    const p = payload || {};
    const user = currentUser();
    const employeeId = employeeIdFrom(p);
    const requestKind = clean(p.requestKind || (p.originalRecordId ? 'recordCorrection' : 'recordCorrection'));
    const reason = clean(p.reason);
    if(!employeeId) return {ok:false, message:'缺少員工資料，請重新登入。'};
    if(!reason) return {ok:false, message:'請填寫原因。'};
    const corrections = await correctionsByEmployee(employeeId).catch(()=>[]);
    const requestId = clean(p.requestId) || generatedId(requestKind === 'missingClock' ? 'MCLK' : 'CCR');

    if(requestKind === 'missingClock'){
      const correctDate = dateText(p.correctDate || p.scheduleDate);
      const correctTime = timeText(p.correctTime);
      const correctAction = clean(p.correctAction);
      const scheduleKey = clean(p.scheduleKey);
      if(!correctDate || !correctTime || !correctAction || !scheduleKey) return {ok:false, message:'缺少補打卡日期、時間或班表資料。'};
      const issue = {date:correctDate, scheduleKey};
      const pending = pendingMissingCorrection(corrections, issue, correctAction);
      if(pending) return {ok:false, message:'這一段班表已經送出補打卡申請，待主管審核。主管審核會更新，並自動歸位。', requestId:pending.requestId};
      const clockRows = await readClockRows({employeeId, userId:employeeId}).catch(()=>[]);
      const snap = Object.assign({}, p.scheduleSnapshot || {}, {
        date:correctDate,
        scheduleKey,
        startTime: shortTime(p.scheduleStartTime || (p.scheduleSnapshot && p.scheduleSnapshot.startTime)),
        endTime: shortTime(p.scheduleEndTime || (p.scheduleSnapshot && p.scheduleSnapshot.endTime)),
        source: clean(p.scheduleSource || (p.scheduleSnapshot && p.scheduleSnapshot.source)),
        sourceLabel: clean(p.scheduleSourceLabel || (p.scheduleSnapshot && p.scheduleSnapshot.sourceLabel)),
        templateName: clean(p.scheduleTemplateName || (p.scheduleSnapshot && p.scheduleSnapshot.templateName))
      });
      if(existingRecordFor(snap, correctAction, clockRows)) return {ok:false, message:'這一段班表已經有該打卡紀錄，不需要補打卡。'};
      const row = {
        requestId,
        requestKind:'missingClock',
        '申請種類':'missingClock',
        employeeId,
        '員工ID':employeeId,
        name:clean(user.name),
        '姓名':clean(user.name),
        email:lower(user.email),
        correctDate,
        '修正日期':correctDate,
        correctTime,
        '修正時間':correctTime,
        correctAction,
        '修正動作':correctAction,
        correctionType:clean(p.correctionType || snap.clockType || '標準打卡') || '標準打卡',
        '修正打卡方式':clean(p.correctionType || snap.clockType || '標準打卡') || '標準打卡',
        reason,
        '修正原因':reason,
        scheduleKey,
        scheduleDate:correctDate,
        scheduleStartTime:shortTime(snap.startTime || snap.scheduleStartTime),
        scheduleEndTime:shortTime(snap.endTime || snap.scheduleEndTime),
        scheduleSource:clean(snap.source || snap.scheduleSource),
        scheduleSourceLabel:clean(snap.sourceLabel || snap.scheduleSourceLabel),
        scheduleTemplateName:clean(snap.templateName || snap.scheduleTemplateName),
        scheduleSnapshot:snap,
        status:'待審核',
        '狀態':'待審核',
        source:'firebase-clock-flow',
        createdAt:serverTs()
      };
      await docSet('clockCorrections', requestId, row);
      return {ok:true, message:'補打卡申請已送出，待主管審核。主管審核會更新，並自動歸位。', requestId, row};
    }

    const originalRecordId = clean(p.originalRecordId);
    if(!originalRecordId) return {ok:false, message:'缺少原始打卡紀錄，無法修正。'};
    const original = await findClockById(originalRecordId);
    if(!original) return {ok:false, message:'找不到原始打卡紀錄，請重新整理後再試。'};
    const norm = normalizeClock(original);
    const pending = pendingRecordCorrection(corrections, norm.recordId || originalRecordId);
    if(pending) return {ok:false, message:'這筆打卡紀錄已送出修正申請，待主管審核。主管審核會更新，並自動歸位。', requestId:pending.requestId};
    const correctDate = dateText(p.correctDate || norm.date);
    const correctTime = timeText(p.correctTime || norm.time);
    if(!correctDate || !correctTime) return {ok:false, message:'請填寫正確日期與時間。'};
    const fixed = correctionOriginalFields(original);
    const row = Object.assign({}, fixed, {
      requestId,
      requestKind:'recordCorrection',
      '申請種類':'recordCorrection',
      employeeId,
      '員工ID':employeeId,
      name:clean(user.name || norm.name),
      '姓名':clean(user.name || norm.name),
      email:lower(user.email || norm.email),
      correctDate,
      '修正日期':correctDate,
      correctTime,
      '修正時間':correctTime,
      correctAction:norm.actionName,
      '修正動作':norm.actionName,
      correctionType:norm.clockType,
      '修正打卡方式':norm.clockType,
      reason,
      '修正原因':reason,
      status:'待審核',
      '狀態':'待審核',
      source:'firebase-clock-flow',
      createdAt:serverTs()
    });
    await docSet('clockCorrections', requestId, row);
    return {ok:true, message:'打卡修正申請已送出，待主管審核。主管審核會更新，並自動歸位。', requestId, row};
  }
  function statusBySchedule(action, clockType, correctTime, scheduleStart, scheduleEnd, supplement){
    const t = minutes(correctTime);
    const st = minutes(scheduleStart);
    const en = minutes(scheduleEnd);
    let status = supplement ? '補打卡' : '正常';
    let lateMinutes = 0;
    let earlyLeaveMinutes = 0;
    if(clean(clockType) === '標準打卡' && clean(action).indexOf('上班') >= 0 && Number.isFinite(t) && Number.isFinite(st) && t > st){ lateMinutes = Math.max(0, Math.round(t - st)); status = '遲到'; }
    if(clean(clockType) === '標準打卡' && clean(action).indexOf('下班') >= 0 && Number.isFinite(t) && Number.isFinite(en) && t < en){ earlyLeaveMinutes = Math.max(0, Math.round(en - t)); status = '早退'; }
    if(supplement && status === '正常') status = '補打卡';
    return {status, lateMinutes, earlyLeaveMinutes};
  }
  async function approveClockCorrection(payload){
    const p = payload || {};
    const requestId = clean(p.requestId);
    if(!requestId) return {ok:false, message:'缺少修正申請ID'};
    const raw = await findCorrectionById(requestId);
    if(!raw) return {ok:false, message:'找不到修正申請'};
    const c = normalizeCorrection(raw);
    if(c.status !== '待審核') return {ok:false, message:'這筆申請已處理過。'};
    const reviewer = currentUser();

    if(c.requestKind === 'missingClock' || c.requestKind === 'specialClock' || !c.originalRecordId){
      const isSpecialClock = c.requestKind === 'specialClock';
      const existing = await readClockRows({employeeId:c.employeeId, userId:c.employeeId}).then(rows => existingRecordFor({date:c.correctDate, scheduleKey:c.scheduleKey, startTime:c.scheduleStartTime, endTime:c.scheduleEndTime, clockType:c.correctionType}, c.correctAction, rows)).catch(()=>null);
      let appliedRecordId = existing ? clean(existing.recordId || existing.id) : '';
      if(!existing){
        const state = statusBySchedule(c.correctAction, c.correctionType, c.correctTime, c.scheduleStartTime, c.scheduleEndTime, !isSpecialClock);
        appliedRecordId = (isSpecialClock ? 'CLK_SP_' : 'CLK_SUP_') + c.employeeId + '_' + c.correctDate.replace(/-/g,'') + '_' + (c.correctAction.indexOf('下班') >= 0 ? 'OUT' : 'IN') + '_' + Date.now();
        await docSet('clockRecords', appliedRecordId, {
          recordId:appliedRecordId,
          '紀錄ID':appliedRecordId,
          employeeId:c.employeeId,
          '員工ID':c.employeeId,
          name:c.name,
          '姓名':c.name,
          email:c.email,
          clockDate:c.correctDate,
          '打卡日期':c.correctDate,
          clockTime:c.correctTime,
          '打卡時間':c.correctTime,
          actionName:c.correctAction,
          '打卡動作':c.correctAction,
          clockType:c.correctionType || '標準打卡',
          '打卡方式':c.correctionType || '標準打卡',
          status:state.status,
          '狀態':state.status,
          lateMinutes:state.lateMinutes,
          '遲到分鐘':state.lateMinutes,
          earlyLeaveMinutes:state.earlyLeaveMinutes,
          '早退分鐘':state.earlyLeaveMinutes,
          note:(isSpecialClock ? '特殊打卡核准：' : '補打卡核准：') + c.reason,
          '備註':(isSpecialClock ? '特殊打卡核准：' : '補打卡核准：') + c.reason,
          sourceIp:isSpecialClock ? '特殊打卡核准' : '補打卡核准',
          '來源IP':isSpecialClock ? '特殊打卡核准' : '補打卡核准',
          isSupplement:!isSpecialClock,
          scheduleLinked:true,
          scheduleKey:c.scheduleKey,
          scheduleDate:c.scheduleDate || c.correctDate,
          scheduleStartTime:c.scheduleStartTime,
          scheduleEndTime:c.scheduleEndTime,
          scheduleSource:c.scheduleSource,
          scheduleSourceLabel:c.scheduleSourceLabel,
          scheduleTemplateName:c.scheduleTemplateName,
          correctionRequestId:requestId,
          specialClockApproved:isSpecialClock,
          approvalRequestId:isSpecialClock ? requestId : '',
          source:isSpecialClock ? 'firebase-clock-flow-approved-special' : 'firebase-clock-flow-approved-missing',
          createdAt:serverTs()
        });
      }
      await docUpdate('clockCorrections', requestId, {status:'已核准','狀態':'已核准', reviewedAt:serverTs(), reviewedBy:clean(reviewer.id || reviewer.employeeId || reviewer.adminId), appliedRecordId, source:'firebase-clock-flow'});
      return {ok:true, message:isSpecialClock ? '特殊打卡已核准，並已轉入正式打卡紀錄。' : '補打卡已核准，並已補進正式打卡紀錄。', appliedRecordId};
    }

    const original = await findClockById(c.originalRecordId);
    if(!original) return {ok:false, message:'找不到原始打卡紀錄，無法核准。'};
    const norm = normalizeClock(original);
    const state = statusBySchedule(c.correctAction || norm.actionName, c.correctionType || norm.clockType, c.correctTime, c.scheduleStartTime || norm.scheduleStartTime, c.scheduleEndTime || norm.scheduleEndTime, false);
    const targetId = clean(original.__id || norm.recordId || c.originalRecordId);
    await docUpdate('clockRecords', targetId, {
      originalClockDate:norm.date,
      originalClockTime:norm.time,
      originalActionName:norm.actionName,
      originalClockType:norm.clockType,
      clockDate:c.correctDate,
      '打卡日期':c.correctDate,
      clockTime:c.correctTime,
      '打卡時間':c.correctTime,
      actionName:c.correctAction || norm.actionName,
      '打卡動作':c.correctAction || norm.actionName,
      clockType:c.correctionType || norm.clockType,
      '打卡方式':c.correctionType || norm.clockType,
      status:state.status,
      '狀態':state.status,
      lateMinutes:state.lateMinutes,
      '遲到分鐘':state.lateMinutes,
      earlyLeaveMinutes:state.earlyLeaveMinutes,
      '早退分鐘':state.earlyLeaveMinutes,
      correctionApplied:true,
      correctionRequestId:requestId,
      correctedAt:serverTs(),
      note: clean((original.note || original['備註'] || '') + (c.reason ? ('｜修正核准：' + c.reason) : '')),
      '備註': clean((original.note || original['備註'] || '') + (c.reason ? ('｜修正核准：' + c.reason) : '')),
      source:'firebase-clock-flow-corrected'
    });
    await docUpdate('clockCorrections', requestId, {status:'已核准','狀態':'已核准', reviewedAt:serverTs(), reviewedBy:clean(reviewer.id || reviewer.employeeId || reviewer.adminId), appliedRecordId:targetId, source:'firebase-clock-flow'});
    return {ok:true, message:'打卡修正已核准，原始打卡紀錄已更新。', appliedRecordId:targetId};
  }
  async function rejectClockCorrection(payload){
    const requestId = clean(payload && payload.requestId);
    if(!requestId) return {ok:false, message:'缺少修正申請ID'};
    await docUpdate('clockCorrections', requestId, {status:'已駁回','狀態':'已駁回', rejectReason:clean(payload && payload.rejectReason), reviewedAt:serverTs(), source:'firebase-clock-flow'});
    return {ok:true, message:'已駁回。'};
  }
  async function getPendingClockCorrections(){
    const rows = (await all('clockCorrections')).map(normalizeCorrection).filter(c => c.status === '待審核' || !c.status);
    for(const r of rows){
      if(r.originalRecordId && !r.originalTime){
        const original = await findClockById(r.originalRecordId).catch(()=>null);
        if(original){
          const n = normalizeClock(original);
          r.originalDate = r.originalDate || n.date;
          r.originalTime = r.originalTime || n.time;
          r.originalAction = r.originalAction || n.actionName;
          r.originalClockType = r.originalClockType || n.clockType;
        }
      }
      if(r.requestKind === 'missingClock'){
        r.originalTime = '';
        r.originalAction = '缺少' + (r.correctAction || '打卡');
        r.originalClockType = r.correctionType;
      }
      if(r.requestKind === 'specialClock'){
        r.originalTime = '';
        r.originalAction = r.correctAction || '特殊打卡';
        r.originalClockType = '特殊打卡待審核';
      }
    }
    rows.sort((a,b) => clean(b.correctDate + ' ' + b.correctTime).localeCompare(clean(a.correctDate + ' ' + a.correctTime)));
    return {ok:true, rows, list:rows};
  }

  fb.handleApi = async function(action, payload){
    const a = clean(action);
    if(a === 'getEditableClockHistory') return await getEditableClockHistory(payload || {});
    if(a === 'getClockHistoryRange') return await getClockHistoryRange(payload || {});
    if(a === 'getClockCompletionIssues') return await getClockCompletionIssues(payload || {});
    if(a === 'submitClockCorrection') return await submitClockCorrection(payload || {});
    if(a === 'approveClockCorrectionApi') return await approveClockCorrection(payload || {});
    if(a === 'rejectClockCorrectionApi') return await rejectClockCorrection(payload || {});
    if(a === 'getPendingClockCorrections') return await getPendingClockCorrections(payload || {});
    if(typeof oldHandle === 'function') return await oldHandle(action, payload || {});
    return null;
  };
  fb.__clockCorrectionFlowFixV20260528 = true;
  global.YZFirebase = fb;
})(window);

/* 我的資料整合頁：個人資料完整欄位補強 20260528 */
(function(global){
  const fb = global.YZFirebase || {};
  if(!fb || fb.__myDataProfilePatchV20260528) return;
  const oldHandle = fb.handleApi;
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ const s = lower(v); return v === true || ['是','yes','true','1','啟用','enabled','active','工讀生'].indexOf(s) >= 0; }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function fmtDate(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') return ymd(v.toDate());
    if(v instanceof Date && !isNaN(v.getTime())) return ymd(v);
    const s = clean(v);
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : ymd(d);
  }
  function maskId(v){ const s = clean(v).toUpperCase(); if(!s) return ''; return s.length <= 4 ? s : s.slice(0,1) + '*****' + s.slice(-4); }
  function localUser(){ try{return JSON.parse(localStorage.getItem('employeeUser') || '{}') || {}}catch(e){return {}} }
  function database(){
    try{
      if(fb && typeof fb.init === 'function') return fb.init();
      if(global.firebase && global.firebase.apps && global.firebase.apps.length) return global.firebase.firestore();
    }catch(e){ console.warn('[my data profile db]', e); }
    return null;
  }
  async function findEmployee(payload){
    const db = database();
    if(!db) return null;
    const u = localUser();
    const userId = clean((payload && (payload.userId || payload.employeeId || payload.id)) || u.id || u.employeeId);
    const email = clean((payload && payload.email) || u.email);
    let doc = null;
    if(userId){
      const direct = await db.collection('employees').doc(userId).get();
      if(direct.exists) doc = direct;
      if(!doc){
        const byEmployeeId = await db.collection('employees').where('employeeId','==',userId).limit(1).get();
        if(!byEmployeeId.empty) doc = byEmployeeId.docs[0];
      }
      if(!doc){
        const byId = await db.collection('employees').where('id','==',userId).limit(1).get();
        if(!byId.empty) doc = byId.docs[0];
      }
    }
    if(!doc && email){
      const byEmail = await db.collection('employees').where('email','==',email).limit(1).get();
      if(!byEmail.empty) doc = byEmail.docs[0];
    }
    if(!doc) return null;
    return Object.assign({__id:doc.id}, doc.data() || {});
  }
  function normalizeProfile(raw){
    raw = raw || {};
    const identityRaw = lower(raw.identityType || raw.employeeType || raw.type || raw['身分類型']);
    const roleText = clean(raw.role || raw.identityLabel || raw['職務類型'] || raw['聘用類型']);
    const isParttime = identityRaw === 'parttime' || roleText.indexOf('工讀') >= 0 || truthy(raw.isPartTime || raw['是否工讀生']);
    const identityType = identityRaw === 'external' ? 'external' : (isParttime ? 'parttime' : 'staff');
    const identityLabel = identityType === 'parttime' ? '工讀生' : (identityType === 'external' ? '外聘老師' : '專職員工');
    return {
      employeeId: clean(raw.employeeId || raw.id || raw['員工ID'] || raw.__id),
      id: clean(raw.employeeId || raw.id || raw['員工ID'] || raw.__id),
      name: clean(raw.name || raw.displayName || raw['姓名']),
      identityType: identityType,
      identityLabel: identityLabel,
      isPartTime: identityType === 'parttime',
      birthDate: fmtDate(raw.birthDate || raw['出生年月日']),
      idNumberMasked: clean(raw.idNumberMasked) || maskId(raw.idNumber || raw['身分證字號']),
      hireDate: fmtDate(raw.hireDate || raw.startDate || raw['到職日'] || raw['任職日期']),
      emergencyContact: clean(raw.emergencyContact || raw['緊急聯絡人']),
      emergencyPhone: clean(raw.emergencyPhone || raw['緊急聯絡人電話']),
      mobilePhone: clean(raw.mobilePhone || raw.phone || raw['行動電話']),
      address: clean(raw.address || raw.contactAddress || raw['聯絡地址']),
      email: lower(raw.email || raw.Email),
      accountStatus: clean(raw.accountStatus || raw['帳號狀態']),
      annualLeaveTotal: Number(raw.annualLeaveTotal || raw['年度可用特休天數'] || 0) || 0,
      annualLeaveUsed: Number(raw.annualLeaveUsed || raw['已使用特休'] || 0) || 0,
      annualLeaveRemaining: Number(raw.annualLeaveRemaining || raw['剩餘特休'] || 0) || 0
    };
  }
  async function getMyProfilePatched(payload){
    const row = await findEmployee(payload || {});
    if(!row){
      if(typeof oldHandle === 'function') return await oldHandle('getMyProfile', payload || {});
      return {ok:false, message:'Firebase 找不到員工資料'};
    }
    return {ok:true, source:'firebase-my-data-profile', profile:normalizeProfile(row)};
  }
  fb.handleApi = async function(action, payload){
    if(clean(action) === 'getMyProfile') return await getMyProfilePatched(payload || {});
    if(typeof oldHandle === 'function') return await oldHandle(action, payload || {});
    return null;
  };
  fb.__myDataProfilePatchV20260528 = true;
  global.YZFirebase = fb;
})(window);

/* 我的資料／薪資投保資料來源修正 20260528b
 * - 個人頁讀薪資時，優先讀 Firebase 的 employees / employeeSalaryConfigs。
 * - 若 Firebase 沒有薪資設定，回傳 null 讓 app.js 自動 fallback 到原本 GS，避免舊資料看不到。
 * - 薪資管理儲存時，同步寫 employees 與 employeeSalaryConfigs，避免之後讀不到。
 */
(function(global){
  const fb = global.YZFirebase || {};
  if(!fb || fb.__myDataSalaryBridgeV20260528b) return;
  const previousHandle = fb.handleApi;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function num(v){ const n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g,'')); return Number.isFinite(n) ? n : 0; }
  function truthy(v){ const s = lower(v); return v === true || ['是','yes','true','1','啟用','enabled','active','在保','已投保','投保'].includes(s); }
  function uniq(list){ const out=[]; (list||[]).forEach(x=>{ const s=clean(x); if(s && !out.includes(s)) out.push(s); }); return out; }
  function money(v){ const n = num(v); return n ? '$' + Math.round(n).toLocaleString('zh-TW') : ''; }
  function percent(v){ const n = num(v); return n ? n + '%' : ''; }
  function ymd(d){ return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
  function fmtDate(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') return ymd(v.toDate());
    if(v instanceof Date && !isNaN(v.getTime())) return ymd(v);
    const s = clean(v);
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : ymd(d);
  }
  function db(){
    try{
      if(fb && typeof fb.init === 'function') return fb.init();
      if(global.firebase && global.firebase.apps && global.firebase.apps.length) return global.firebase.firestore();
    }catch(e){ console.warn('[mydata salary db]', e); }
    return null;
  }
  function serverTs(){
    try{ return global.firebase.firestore.FieldValue.serverTimestamp(); }
    catch(e){ return new Date().toISOString(); }
  }
  function localUser(){ try{return JSON.parse(localStorage.getItem('employeeUser') || '{}') || {}}catch(e){return {}} }
  function hasApiUrl(){
    try{
      if(typeof global.getApiUrl === 'function' && clean(global.getApiUrl())) return true;
      if(global.APP_CONFIG && clean(global.APP_CONFIG.API_URL)) return true;
      if(clean(global.API_URL)) return true;
      if(clean(localStorage.getItem('EMPLOYEE_SYSTEM_API_BASE'))) return true;
    }catch(e){}
    return false;
  }
  function idCandidates(payload){
    const u = localUser();
    return uniq([
      payload && payload.employeeId,
      payload && payload.userId,
      payload && payload.id,
      u.employeeId,
      u.id
    ]);
  }
  function emailCandidates(payload){
    const u = localUser();
    return uniq([payload && payload.email, u.email]).map(lower).filter(Boolean);
  }
  function pick(o, keys, fallback){
    o = o || {};
    for(const k of keys){
      if(o[k] !== undefined && o[k] !== null && clean(o[k]) !== '') return o[k];
    }
    return fallback == null ? '' : fallback;
  }
  function hasLineItems(v){ return Array.isArray(v) && v.some(x => x && (clean(x.name || x.title || x.label || x['名稱']) || num(x.amount || x.value || x['金額']))); }
  function meaningful(v){
    const s = clean(v);
    if(!s) return false;
    if(['-','未設定','無','undefined','null'].includes(s)) return false;
    return true;
  }
  function hasSalaryRaw(raw){
    raw = raw || {};
    const keys = [
      'baseSalary','staffBaseSalary','monthlySalary','salary','本薪','月薪',
      'hourlyRate','parttimeHourlyRate','hourRate','時薪',
      'averageSalary','parttimeAverageSalary','目前申報月平均薪資總額',
      'laborStatus','laborInsuranceStatus','laborInsurance','勞保狀態',
      'healthStatus','healthInsuranceStatus','healthInsurance','健保狀態',
      'laborPlan','laborPlanCode','laborInsuranceLevel','laborLevel','勞保級距',
      'healthPlan','healthPlanCode','healthInsuranceLevel','healthLevel','健保級距',
      'laborSelfPayText','laborInsuranceSelfPay','laborSelfPay','勞保自付額',
      'healthSelfPayText','healthInsuranceSelfPay','healthSelfPay','健保自付額',
      'effectiveDate','salaryEffectiveDate','生效日期',
      'selfRetirementEnabled','selfRetirementRate','laborRetirementSelfEnabled','laborRetirementSelfRate',
      'jobAllowanceText','allowanceText','jobAllowance','allowance','note','salaryNote','備註'
    ];
    if(keys.some(k => meaningful(raw[k]) && !(k.match(/Salary|薪|Rate|時薪|本薪|月薪|amount/i) && num(raw[k]) === 0))) return true;
    if(hasLineItems(raw.jobAllowances || raw.jobAllowanceItems)) return true;
    if(hasLineItems(raw.allowances || raw.allowanceItems)) return true;
    return false;
  }
  function parsePlanSalary(code){
    const m = clean(code).match(/(\d{4,6})/);
    return m ? Number(m[1]) : 0;
  }
  function formatPlan(code, label, type){
    const explicit = clean(label);
    if(explicit) return explicit;
    const c = clean(code);
    if(!c) return '';
    const salary = parsePlanSalary(c);
    if(salary){
      const prefix = type === 'health' ? '健保' : '勞保';
      return prefix + '｜' + salary.toLocaleString('zh-TW') + ' 元';
    }
    return c;
  }
  function formatItems(items){
    if(!Array.isArray(items)) return '';
    return items.filter(Boolean).map(function(x){
      if(typeof x === 'string') return clean(x);
      const name = clean(x.name || x.title || x.label || x['名稱']);
      const amount = money(x.amount || x.value || x['金額']);
      return name && amount ? (name + '：' + amount) : (name || amount);
    }).filter(Boolean).join('\n');
  }
  function insuranceActive(status){ return ['在保','已投保','投保','加保','有效','是'].includes(clean(status)); }
  function visibleStatus(v){ const s = clean(v); return meaningful(s) ? s : ''; }
  function identityTypeOf(raw){
    const identityRaw = lower(pick(raw, ['identityType','employeeType','type','身分類型'], ''));
    const roleText = clean(pick(raw, ['role','identityLabel','職務類型','聘用類型'], ''));
    const isParttime = identityRaw === 'parttime' || roleText.includes('工讀') || truthy(pick(raw, ['isPartTime','是否工讀生'], ''));
    if(identityRaw === 'external') return 'external';
    return isParttime ? 'parttime' : 'staff';
  }
  function normalizeSalary(raw, docId){
    raw = raw || {};
    const identityType = identityTypeOf(raw);
    const isParttime = identityType === 'parttime';
    const baseSalary = pick(raw, ['baseSalary','staffBaseSalary','monthlySalary','salary','本薪','月薪'], '');
    const hourlyRate = pick(raw, ['hourlyRate','parttimeHourlyRate','hourRate','時薪'], '');
    const averageSalary = pick(raw, ['averageSalary','parttimeAverageSalary','averageSalaryText','目前申報月平均薪資總額'], '');
    const isPartialHours = pick(raw, ['isPartialHours','isPartialWorkingTime','partialWorkingTime','是否部分工時'], '');
    const laborStatus = visibleStatus(pick(raw, ['laborStatus','laborInsuranceStatus','laborInsurance','勞保狀態'], ''));
    const healthStatus = visibleStatus(pick(raw, ['healthStatus','healthInsuranceStatus','healthInsurance','健保狀態'], ''));
    const laborPlanCode = pick(raw, ['laborPlan','laborPlanCode','laborInsuranceLevel','laborLevel','勞保級距'], '');
    const healthPlanCode = pick(raw, ['healthPlan','healthPlanCode','healthInsuranceLevel','healthLevel','健保級距'], '');
    const laborPlanText = formatPlan(laborPlanCode, pick(raw, ['laborPlanText','laborLevelText','laborPlanName'], ''), 'labor');
    const healthPlanText = formatPlan(healthPlanCode, pick(raw, ['healthPlanText','healthLevelText','healthPlanName'], ''), 'health');
    const laborSelfRaw = pick(raw, ['laborSelfPayText','laborInsuranceSelfPay','laborSelfPay','勞保自付額'], '');
    const healthSelfRaw = pick(raw, ['healthSelfPayText','healthInsuranceSelfPay','healthSelfPay','健保自付額'], '');
    const laborActive = insuranceActive(laborStatus);
    const healthActive = insuranceActive(healthStatus);
    const selfRetirementEnabled = pick(raw, ['selfRetirementEnabled','laborRetirementSelfEnabled','勞退自提'], '');
    const selfRetirementRate = pick(raw, ['selfRetirementRate','laborRetirementSelfRate','勞退自提比率'], '');
    const selfRetirementText = truthy(selfRetirementEnabled) ? (percent(selfRetirementRate) || '已開啟') : '';
    const laborSalary = pick(raw, ['laborSalaryText','laborInsuranceSalary','laborSalary','勞保投保薪資'], '') || parsePlanSalary(laborPlanCode);
    const healthSalary = pick(raw, ['healthSalaryText','healthInsuranceSalary','healthSalary','健保投保薪資'], '') || parsePlanSalary(healthPlanCode);
    const staffBaseSalaryText = baseSalary ? money(baseSalary) : '';
    const parttimeHourlyRateText = hourlyRate ? money(hourlyRate) + ' / 小時' : '';
    return {
      employeeId: clean(pick(raw, ['employeeId','id','員工ID'], docId)),
      name: clean(pick(raw, ['name','姓名','displayName'], '')),
      email: clean(pick(raw, ['email','Email'], '')),
      identityType,
      mainAmountLabel: isParttime ? '時薪' : '本薪',
      mainAmountText: isParttime ? parttimeHourlyRateText : staffBaseSalaryText,
      staffBaseSalaryText,
      parttimeHourlyRateText,
      parttimePartialHoursText: isParttime ? (clean(isPartialHours) || '') : '',
      parttimeAverageSalaryText: averageSalary ? money(averageSalary) : '',
      jobAllowanceText: pick(raw, ['jobAllowanceText','jobAllowance','職務加給'], '') || formatItems(raw.jobAllowances || raw.jobAllowanceItems || []),
      allowanceText: pick(raw, ['allowanceText','allowance','津貼'], '') || formatItems(raw.allowances || raw.allowanceItems || []),
      laborStatus,
      healthStatus,
      laborActive,
      healthActive,
      laborPlanText: laborActive ? laborPlanText : '',
      healthPlanText: healthActive ? healthPlanText : '',
      laborLevelText: laborActive ? laborPlanText : '',
      healthLevelText: healthActive ? healthPlanText : '',
      laborSalaryText: laborActive && laborSalary ? (money(laborSalary) || clean(laborSalary)) : '',
      healthSalaryText: healthActive && healthSalary ? (money(healthSalary) || clean(healthSalary)) : '',
      laborSelfPayText: laborActive && laborSelfRaw ? (money(laborSelfRaw) || clean(laborSelfRaw)) : '',
      healthSelfPayText: healthActive && healthSelfRaw ? (money(healthSelfRaw) || clean(healthSelfRaw)) : '',
      retirementEmployerText: laborActive ? (pick(raw, ['retirementEmployerText','laborRetirementEmployerText','雇主提撥勞退'], '') || '6%') : '',
      selfRetirementText,
      effectiveDate: fmtDate(pick(raw, ['effectiveDate','salaryEffectiveDate','生效日期'], '')),
      note: clean(pick(raw, ['note','salaryNote','備註'], '')),
      raw
    };
  }
  async function getDocById(collection, id){
    const database = db();
    if(!database || !id) return null;
    try{ const snap = await database.collection(collection).doc(id).get(); return snap.exists ? Object.assign({__id:snap.id}, snap.data() || {}) : null; }
    catch(e){ return null; }
  }
  async function queryOne(collection, field, value){
    const database = db();
    if(!database || !field || !value) return null;
    try{
      const snap = await database.collection(collection).where(field, '==', value).limit(1).get();
      return snap.empty ? null : Object.assign({__id:snap.docs[0].id}, snap.docs[0].data() || {});
    }catch(e){ return null; }
  }
  async function allDocs(collection){
    const database = db();
    if(!database) return [];
    try{
      const snap = await database.collection(collection).get();
      const rows=[]; snap.forEach(doc => rows.push(Object.assign({__id:doc.id}, doc.data() || {})));
      return rows;
    }catch(e){ return []; }
  }
  async function findEmployee(payload){
    const ids = idCandidates(payload);
    const emails = emailCandidates(payload);
    for(const id of ids){
      const direct = await getDocById('employees', id); if(direct) return direct;
      const byEmployeeId = await queryOne('employees', 'employeeId', id); if(byEmployeeId) return byEmployeeId;
      const byId = await queryOne('employees', 'id', id); if(byId) return byId;
    }
    for(const email of emails){
      const byEmail = await queryOne('employees', 'email', email); if(byEmail) return byEmail;
      const byEmail2 = await queryOne('employees', 'Email', email); if(byEmail2) return byEmail2;
    }
    return null;
  }
  const salaryCollections = ['employeeSalaryConfigs','salaryConfigs','employeeSalarySettings','salaryProfiles'];
  async function findSalaryConfig(payload){
    const ids = idCandidates(payload);
    const emails = emailCandidates(payload);
    for(const col of salaryCollections){
      for(const id of ids){
        const direct = await getDocById(col, id); if(direct) return direct;
        const byEmployeeId = await queryOne(col, 'employeeId', id); if(byEmployeeId) return byEmployeeId;
        const byUserId = await queryOne(col, 'userId', id); if(byUserId) return byUserId;
        const byId = await queryOne(col, 'id', id); if(byId) return byId;
      }
      for(const email of emails){
        const byEmail = await queryOne(col, 'email', email); if(byEmail) return byEmail;
      }
    }
    const mapRows = (await allDocs('salarySetup')).concat(await allDocs('salarySettings'));
    for(const row of mapRows){
      const map = row.employeeConfigMap || row.salaryConfigMap || row.configMap || {};
      for(const id of ids){ if(map && map[id]) return Object.assign({employeeId:id}, map[id]); }
    }
    return null;
  }
  function salaryPayloadFromRaw(payload, employee){
    const p = payload || {};
    const id = clean(p.employeeId || p.userId || p.id || employee && (employee.employeeId || employee.id || employee.__id));
    const isParttime = identityTypeOf(Object.assign({}, employee || {}, p)) === 'parttime';
    const raw = Object.assign({}, p, {
      employeeId:id,
      salaryDisplayType: isParttime ? 'PARTTIME_DIRECT' : 'STAFF_DIRECT',
      baseSalary: isParttime ? 0 : (num(p.baseSalary) || 0),
      hourlyRate: isParttime ? (num(p.hourlyRate) || 0) : 0,
      averageSalary: isParttime ? (num(p.averageSalary) || 0) : 0,
      isPartialHours: isParttime ? clean(p.isPartialHours || '否') : '否',
      laborStatus: clean(p.laborStatus),
      healthStatus: clean(p.healthStatus),
      laborPlan: clean(p.laborPlan),
      healthPlan: clean(p.healthPlan),
      selfRetirementEnabled: clean(p.selfRetirementEnabled || '否'),
      selfRetirementRate: num(p.selfRetirementRate) || 0,
      effectiveDate: clean(p.effectiveDate),
      note: clean(p.note),
      jobAllowances: Array.isArray(p.jobAllowances) ? p.jobAllowances : [],
      allowances: Array.isArray(p.allowances) ? p.allowances : [],
      salaryConfigured:true,
      updatedAt:serverTs(),
      source:'firebase-salary-bridge'
    });
    const n = normalizeSalary(Object.assign({}, employee || {}, raw), id);
    return Object.assign({}, raw, {
      identityType: n.identityType,
      mainAmountText:n.mainAmountText,
      staffBaseSalaryText:n.staffBaseSalaryText,
      parttimeHourlyRateText:n.parttimeHourlyRateText,
      parttimeAverageSalaryText:n.parttimeAverageSalaryText,
      parttimePartialHoursText:n.parttimePartialHoursText,
      laborPlanText:n.laborPlanText,
      healthPlanText:n.healthPlanText,
      laborSalaryText:n.laborSalaryText,
      healthSalaryText:n.healthSalaryText,
      retirementEmployerText:n.retirementEmployerText,
      selfRetirementText:n.selfRetirementText,
      jobAllowanceText:n.jobAllowanceText,
      allowanceText:n.allowanceText
    });
  }
  async function saveEmployeeSalaryConfig(payload){
    const database = db();
    if(!database) return null;
    const employee = await findEmployee(payload || {});
    const id = clean((payload && (payload.employeeId || payload.userId || payload.id)) || (employee && (employee.employeeId || employee.id || employee.__id)));
    if(!id) return {ok:false, message:'缺少員工ID，無法儲存薪資設定。'};
    const data = salaryPayloadFromRaw(payload || {}, employee || {});
    const employeeDocId = clean(employee && employee.__id) || id;
    await database.collection('employees').doc(employeeDocId).set(data, {merge:true});
    await database.collection('employeeSalaryConfigs').doc(id).set(data, {merge:true});
    return {ok:true, message:'薪資設定已儲存。', employeeId:id};
  }
  async function getMySalaryInfo(payload){
    const employee = await findEmployee(payload || {});
    const config = await findSalaryConfig(payload || {});
    const raw = Object.assign({}, employee || {}, config || {});
    if(!hasSalaryRaw(raw)) return null;
    const docId = clean(raw.employeeId || raw.id || raw.__id || (employee && employee.__id) || idCandidates(payload)[0]);
    const info = normalizeSalary(raw, docId);
    return {ok:true, source:'firebase-mydata-salary-bridge', info, salary:info};
  }
  function normalizeEmployeeOption(raw){
    raw = raw || {};
    const id = clean(raw.employeeId || raw.id || raw.__id || raw['員工ID']);
    const identity = identityTypeOf(raw);
    return {
      id,
      employeeId:id,
      name:clean(raw.name || raw.displayName || raw['姓名'] || '未命名'),
      email:lower(raw.email || raw.Email),
      identityType:identity,
      identityLabel:identity === 'parttime' ? '工讀生' : (identity === 'external' ? '外聘老師' : '專職員工'),
      salaryConfigured:false,
      salaryPendingReasons:[]
    };
  }
  function rawConfigForMap(raw){
    raw = raw || {};
    return {
      salaryDisplayType: clean(raw.salaryDisplayType),
      baseSalary: num(pick(raw, ['baseSalary','staffBaseSalary','monthlySalary','salary','本薪','月薪'], 0)) || 0,
      hourlyRate: num(pick(raw, ['hourlyRate','parttimeHourlyRate','hourRate','時薪'], 0)) || 0,
      isPartialHours: clean(pick(raw, ['isPartialHours','isPartialWorkingTime','partialWorkingTime','是否部分工時'], '')),
      averageSalary: num(pick(raw, ['averageSalary','parttimeAverageSalary','目前申報月平均薪資總額'], 0)) || 0,
      laborPlan: clean(pick(raw, ['laborPlan','laborPlanCode','laborInsuranceLevel','laborLevel','勞保級距'], '')),
      healthPlan: clean(pick(raw, ['healthPlan','healthPlanCode','healthInsuranceLevel','healthLevel','健保級距'], '')),
      laborStatus: clean(pick(raw, ['laborStatus','laborInsuranceStatus','勞保狀態'], '')),
      healthStatus: clean(pick(raw, ['healthStatus','healthInsuranceStatus','健保狀態'], '')),
      selfRetirementEnabled: clean(pick(raw, ['selfRetirementEnabled','laborRetirementSelfEnabled','勞退自提'], '否')),
      selfRetirementRate: num(pick(raw, ['selfRetirementRate','laborRetirementSelfRate','勞退自提比率'], 0)) || 0,
      effectiveDate: fmtDate(pick(raw, ['effectiveDate','salaryEffectiveDate','生效日期'], '')),
      note: clean(pick(raw, ['note','salaryNote','備註'], '')),
      jobAllowances: Array.isArray(raw.jobAllowances) ? raw.jobAllowances : (Array.isArray(raw.jobAllowanceItems) ? raw.jobAllowanceItems : []),
      allowances: Array.isArray(raw.allowances) ? raw.allowances : (Array.isArray(raw.allowanceItems) ? raw.allowanceItems : [])
    };
  }
  function pendingReasons(identity, cfg){
    const reasons=[];
    if(identity === 'parttime'){
      if(!(num(cfg.hourlyRate) > 0)) reasons.push('未設定時薪');
      if(!(num(cfg.averageSalary) > 0)) reasons.push('未設定目前申報月平均薪資總額');
    }else{
      if(!(num(cfg.baseSalary) > 0)) reasons.push('未設定本薪');
    }
    if(!clean(cfg.laborStatus)) reasons.push('未設定勞保狀態');
    if(!clean(cfg.healthStatus)) reasons.push('未設定健保狀態');
    if(clean(cfg.laborStatus) === '在保' && !clean(cfg.laborPlan)) reasons.push('勞保在保但未設定勞保級距');
    if(clean(cfg.healthStatus) === '在保' && !clean(cfg.healthPlan)) reasons.push('健保在保但未設定健保級距');
    return reasons;
  }
  async function getSalarySetupOptions(payload){
    const database = db();
    if(!database) return null;
    const employeeRows = await allDocs('employees');
    const employees = employeeRows.map(normalizeEmployeeOption).filter(x => x.id && ['staff','parttime'].includes(x.identityType));
    const byId = {};
    employeeRows.forEach(r => {
      const id = clean(r.employeeId || r.id || r.__id || r['員工ID']);
      if(id) byId[id] = r;
    });
    for(const col of salaryCollections){
      const rows = await allDocs(col);
      rows.forEach(r => {
        const id = clean(r.employeeId || r.userId || r.id || r.__id || r['員工ID']);
        if(id) byId[id] = Object.assign({}, byId[id] || {}, r);
      });
    }
    const mapRows = (await allDocs('salarySetup')).concat(await allDocs('salarySettings'));
    mapRows.forEach(row => {
      const map = row.employeeConfigMap || row.salaryConfigMap || row.configMap || {};
      Object.keys(map || {}).forEach(id => { byId[id] = Object.assign({}, byId[id] || {}, {employeeId:id}, map[id] || {}); });
    });
    const employeeConfigMap = {};
    employees.forEach(emp => {
      const raw = byId[emp.id] || {};
      if(hasSalaryRaw(raw)){
        const cfg = rawConfigForMap(raw);
        employeeConfigMap[emp.id] = cfg;
        const reasons = pendingReasons(emp.identityType, cfg);
        emp.salaryConfigured = reasons.length === 0;
        emp.salaryPendingReasons = reasons;
      }
    });
    if(!Object.keys(employeeConfigMap).length && hasApiUrl()) return null;
    return {ok:true, source:'firebase-mydata-salary-setup-bridge', employees, employeeConfigMap, laborPlans:[], healthPlans:[]};
  }

  fb.handleApi = async function(action, payload){
    const a = clean(action);
    if(a === 'saveEmployeeSalaryConfig') return await saveEmployeeSalaryConfig(payload || {});
    if(a === 'getMySalaryInfo') return await getMySalaryInfo(payload || {});
    if(a === 'getSalarySetupOptions') return await getSalarySetupOptions(payload || {});
    if(typeof previousHandle === 'function') return await previousHandle(action, payload || {});
    return null;
  };
  fb.__myDataSalaryBridgeV20260528b = true;
  global.YZFirebase = fb;
})(window);

/* 我的資料 Firebase-only 快速讀取 20260528profilefast1
 * - 員工端「我的資料」只讀 Firebase，不回退 GS。
 * - 只查本人 employees 與 employeeSalaryConfigs，不掃全公司薪資設定。
 */
(function(global){
  const fb = global.YZFirebase || {};
  if(!fb || fb.__myProfileFullFastV20260528) return;
  const previousHandle = fb.handleApi;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function num(v){ const n = Number(String(v == null ? '' : v).replace(/[^\d.-]/g,'')); return Number.isFinite(n) ? n : 0; }
  function truthy(v){ const s = lower(v); return v === true || ['是','yes','true','1','啟用','enabled','active','在保','已投保','投保'].includes(s); }
  function meaningful(v){ const s = clean(v); return !!s && !['-','未設定','無','undefined','null','nan'].includes(lower(s)); }
  function uniq(list){ const out=[]; (list||[]).forEach(x=>{ const s=clean(x); if(s && !out.includes(s)) out.push(s); }); return out; }
  function currentUser(){ try{return JSON.parse(localStorage.getItem('employeeUser') || '{}') || {}}catch(e){return {}} }
  function db(){ try{return fb.init && fb.init()}catch(e){ return null; } }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function fmtDate(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') return ymd(v.toDate());
    if(v instanceof Date && !isNaN(v.getTime())) return ymd(v);
    const s = clean(v);
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : ymd(d);
  }
  function money(v){
    const raw = clean(v);
    if(!raw) return '';
    if(/[元$]/.test(raw) || /小時/.test(raw) || /%/.test(raw)) return raw;
    const n = num(raw);
    if(!n) return '';
    return '$' + Math.round(n).toLocaleString('zh-TW');
  }
  function percent(v){
    const raw = clean(v);
    if(!raw) return '';
    if(raw.includes('%')) return raw;
    const n = num(raw);
    return n ? n + '%' : '';
  }
  function maskId(v){ const s=clean(v).toUpperCase(); if(!s) return ''; return s.length<=4 ? s : s.slice(0,1)+'*****'+s.slice(-4); }
  function pick(o, keys, fallback){
    o = o || {};
    for(const k of keys){
      if(o[k] !== undefined && o[k] !== null && clean(o[k]) !== '') return o[k];
    }
    return fallback == null ? '' : fallback;
  }
  function ids(payload, employee){
    const u = currentUser();
    return uniq([
      payload && payload.employeeId,
      payload && payload.userId,
      payload && payload.id,
      employee && employee.employeeId,
      employee && employee.id,
      employee && employee.__id,
      u.employeeId,
      u.id
    ]);
  }
  function emails(payload, employee){
    const u = currentUser();
    return uniq([payload && payload.email, employee && employee.email, employee && employee.Email, u.email]).map(lower).filter(Boolean);
  }
  async function getDoc(collection, id){
    const d = db(); if(!d || !id) return null;
    try{
      const snap = await d.collection(collection).doc(id).get();
      return snap.exists ? Object.assign({__id:snap.id}, snap.data() || {}) : null;
    }catch(e){ return null; }
  }
  async function queryOne(collection, field, value){
    const d = db(); if(!d || !field || !value) return null;
    try{
      const snap = await d.collection(collection).where(field,'==',value).limit(1).get();
      return snap.empty ? null : Object.assign({__id:snap.docs[0].id}, snap.docs[0].data() || {});
    }catch(e){ return null; }
  }
  async function findEmployeeFast(payload){
    const idList = ids(payload || {});
    for(const id of idList){
      const direct = await getDoc('employees', id); if(direct) return direct;
    }
    for(const id of idList){
      const byEmployeeId = await queryOne('employees','employeeId',id); if(byEmployeeId) return byEmployeeId;
      const byId = await queryOne('employees','id',id); if(byId) return byId;
    }
    for(const email of emails(payload || {})){
      const byEmail = await queryOne('employees','email',email); if(byEmail) return byEmail;
      const byEmail2 = await queryOne('employees','Email',email); if(byEmail2) return byEmail2;
    }
    return null;
  }
  async function findSalaryFast(payload, employee){
    const idList = ids(payload || {}, employee || {});
    for(const id of idList){
      const direct = await getDoc('employeeSalaryConfigs', id); if(direct) return direct;
    }
    for(const id of idList){
      const byEmployeeId = await queryOne('employeeSalaryConfigs','employeeId',id); if(byEmployeeId) return byEmployeeId;
      const byUserId = await queryOne('employeeSalaryConfigs','userId',id); if(byUserId) return byUserId;
      const byId = await queryOne('employeeSalaryConfigs','id',id); if(byId) return byId;
    }
    for(const email of emails(payload || {}, employee || {})){
      const byEmail = await queryOne('employeeSalaryConfigs','email',email); if(byEmail) return byEmail;
    }
    return null;
  }
  function identityTypeOf(raw){
    const identityRaw = lower(pick(raw, ['identityType','employeeType','type','身分類型'], ''));
    const roleText = clean(pick(raw, ['identityLabel','role','職務類型','聘用類型'], ''));
    const isParttime = identityRaw === 'parttime' || roleText.includes('工讀') || truthy(pick(raw, ['isPartTime','是否工讀生'], ''));
    if(identityRaw === 'external') return 'external';
    if(identityRaw === 'admin') return 'admin';
    return isParttime ? 'parttime' : 'staff';
  }
  function normalizeProfile(raw){
    raw = raw || {};
    const identityType = identityTypeOf(raw);
    return {
      employeeId: clean(pick(raw, ['employeeId','id','員工ID'], raw.__id)),
      name: clean(pick(raw, ['name','displayName','姓名'], '')),
      identityType,
      identityLabel: identityType === 'parttime' ? '工讀生' : (identityType === 'external' ? '外聘老師' : (identityType === 'admin' ? '管理者' : '專職員工')),
      isPartTime: identityType === 'parttime',
      email: lower(pick(raw, ['email','Email'], '')),
      birthDate: fmtDate(pick(raw, ['birthDate','birthday','出生年月日'], '')),
      idNumberMasked: clean(raw.idNumberMasked) || maskId(pick(raw, ['idNumber','身分證字號'], '')),
      hireDate: fmtDate(pick(raw, ['hireDate','startDate','到職日','任職日期'], '')),
      mobilePhone: clean(pick(raw, ['mobilePhone','phone','行動電話'], '')),
      address: clean(pick(raw, ['address','contactAddress','聯絡地址'], '')),
      emergencyContact: clean(pick(raw, ['emergencyContact','緊急聯絡人'], '')),
      emergencyPhone: clean(pick(raw, ['emergencyPhone','緊急聯絡人電話'], ''))
    };
  }
  function formatItems(items){
    if(!Array.isArray(items)) return '';
    return items.filter(Boolean).map(function(x){
      if(typeof x === 'string') return clean(x);
      const name = clean(x.name || x.title || x.label || x['名稱']);
      const amount = money(x.amount || x.value || x['金額']);
      return name && amount ? (name + '：' + amount) : (name || amount);
    }).filter(Boolean).join('\n');
  }
  function parsePlanSalary(code){
    const m = clean(code).match(/(\d{4,6})/);
    return m ? Number(m[1]) : 0;
  }
  function formatPlan(code, label, type){
    const explicit = clean(label);
    if(meaningful(explicit)) return explicit;
    const c = clean(code);
    if(!c) return '';
    const salary = parsePlanSalary(c);
    if(salary) return (type === 'health' ? '健保' : '勞保') + '｜' + salary.toLocaleString('zh-TW') + ' 元';
    return c;
  }
  function activeInsurance(status){ return ['在保','已投保','投保','加保','有效','是'].includes(clean(status)); }
  function normalizeSalary(raw){
    raw = raw || {};
    const identityType = identityTypeOf(raw);
    const isParttime = identityType === 'parttime';
    const baseSalary = pick(raw, ['baseSalary','staffBaseSalary','monthlySalary','salary','本薪','月薪'], '');
    const hourlyRate = pick(raw, ['hourlyRate','parttimeHourlyRate','hourRate','時薪'], '');
    const averageSalary = pick(raw, ['averageSalary','parttimeAverageSalary','averageSalaryText','目前申報月平均薪資總額'], '');
    const partialHours = pick(raw, ['isPartialHours','isPartialWorkingTime','partialWorkingTime','是否部分工時'], '');
    const laborStatus = meaningful(pick(raw, ['laborStatus','laborInsuranceStatus','laborInsurance','勞保狀態'], '')) ? clean(pick(raw, ['laborStatus','laborInsuranceStatus','laborInsurance','勞保狀態'], '')) : '';
    const healthStatus = meaningful(pick(raw, ['healthStatus','healthInsuranceStatus','healthInsurance','健保狀態'], '')) ? clean(pick(raw, ['healthStatus','healthInsuranceStatus','healthInsurance','健保狀態'], '')) : '';
    const laborActive = activeInsurance(laborStatus);
    const healthActive = activeInsurance(healthStatus);
    const laborPlanCode = pick(raw, ['laborPlan','laborPlanCode','laborInsuranceLevel','laborLevel','勞保級距'], '');
    const healthPlanCode = pick(raw, ['healthPlan','healthPlanCode','healthInsuranceLevel','healthLevel','健保級距'], '');
    const laborSalary = pick(raw, ['laborSalaryText','laborInsuranceSalary','laborSalary','勞保投保薪資'], '') || parsePlanSalary(laborPlanCode);
    const healthSalary = pick(raw, ['healthSalaryText','healthInsuranceSalary','healthSalary','健保投保薪資'], '') || parsePlanSalary(healthPlanCode);
    const laborSelfPay = pick(raw, ['laborSelfPayText','laborInsuranceSelfPay','laborSelfPay','勞保自付額'], '');
    const healthSelfPay = pick(raw, ['healthSelfPayText','healthInsuranceSelfPay','healthSelfPay','健保自付額'], '');
    const employerRetirement = pick(raw, ['retirementEmployerText','laborRetirementEmployerText','laborRetirementEmployer','雇主提撥勞退'], '');
    const selfRetirementEnabled = pick(raw, ['selfRetirementEnabled','laborRetirementSelfEnabled','勞退自提'], '');
    const selfRetirementRate = pick(raw, ['selfRetirementRate','laborRetirementSelfRate','勞退自提比率'], '');
    const selfRetirementText = truthy(selfRetirementEnabled) ? (percent(selfRetirementRate) || '已開啟') : '';
    const jobAllowance = pick(raw, ['jobAllowanceText','jobAllowance','職務加給'], '') || formatItems(raw.jobAllowances || raw.jobAllowanceItems || []);
    const allowance = pick(raw, ['allowanceText','allowance','津貼'], '') || formatItems(raw.allowances || raw.allowanceItems || []);
    return {
      employeeId: clean(pick(raw, ['employeeId','id','員工ID'], raw.__id)),
      name: clean(pick(raw, ['name','displayName','姓名'], '')),
      email: lower(pick(raw, ['email','Email'], '')),
      identityType,
      identityLabel: isParttime ? '工讀生' : '專職員工',
      staffBaseSalaryText: !isParttime ? money(baseSalary) : '',
      parttimeHourlyRateText: isParttime ? (money(hourlyRate) ? money(hourlyRate) + ' / 小時' : '') : '',
      mainAmountText: isParttime ? (money(hourlyRate) ? money(hourlyRate) + ' / 小時' : '') : money(baseSalary),
      parttimePartialHoursText: isParttime && meaningful(partialHours) ? clean(partialHours) : '',
      parttimeAverageSalaryText: isParttime ? money(averageSalary) : '',
      jobAllowanceText: meaningful(jobAllowance) ? clean(jobAllowance) : '',
      allowanceText: meaningful(allowance) ? clean(allowance) : '',
      effectiveDate: fmtDate(pick(raw, ['effectiveDate','salaryEffectiveDate','生效日期'], '')),
      note: meaningful(pick(raw, ['note','salaryNote','備註'], '')) ? clean(pick(raw, ['note','salaryNote','備註'], '')) : '',
      laborStatus,
      laborPlanText: laborActive ? formatPlan(laborPlanCode, pick(raw, ['laborPlanText','laborLevelText','laborPlanName'], ''), 'labor') : '',
      laborLevelText: laborActive ? formatPlan(laborPlanCode, pick(raw, ['laborPlanText','laborLevelText','laborPlanName'], ''), 'labor') : '',
      laborSalaryText: laborActive && laborSalary ? (money(laborSalary) || clean(laborSalary)) : '',
      laborSelfPayText: laborActive && laborSelfPay ? (money(laborSelfPay) || clean(laborSelfPay)) : '',
      retirementEmployerText: laborActive ? (money(employerRetirement) || clean(employerRetirement) || '6%') : '',
      selfRetirementText,
      healthStatus,
      healthPlanText: healthActive ? formatPlan(healthPlanCode, pick(raw, ['healthPlanText','healthLevelText','healthPlanName'], ''), 'health') : '',
      healthLevelText: healthActive ? formatPlan(healthPlanCode, pick(raw, ['healthPlanText','healthLevelText','healthPlanName'], ''), 'health') : '',
      healthSalaryText: healthActive && healthSalary ? (money(healthSalary) || clean(healthSalary)) : '',
      healthSelfPayText: healthActive && healthSelfPay ? (money(healthSelfPay) || clean(healthSelfPay)) : ''
    };
  }
  async function getMyProfileFull(payload){
    const employee = await findEmployeeFast(payload || {});
    if(!employee) return {ok:false, message:'Firebase 找不到員工資料'};
    const salaryConfig = await findSalaryFast(payload || {}, employee).catch(()=>null);
    const merged = Object.assign({}, employee || {}, salaryConfig || {});
    const profile = normalizeProfile(merged);
    const salary = normalizeSalary(merged);
    return {ok:true, source:'firebase-only-profile-fast', profile, salary, info:salary};
  }
  async function getMySalaryInfoFast(payload){
    const employee = await findEmployeeFast(payload || {});
    const salaryConfig = employee ? await findSalaryFast(payload || {}, employee).catch(()=>null) : await findSalaryFast(payload || {}, {}).catch(()=>null);
    const merged = Object.assign({}, employee || {}, salaryConfig || {});
    if(!employee && !salaryConfig) return {ok:true, source:'firebase-only-profile-fast', info:{}, salary:{}};
    const salary = normalizeSalary(merged);
    return {ok:true, source:'firebase-only-profile-fast', info:salary, salary};
  }
  fb.handleApi = async function(action, payload){
    const a = clean(action);
    if(a === 'getMyProfileFull') return await getMyProfileFull(payload || {});
    if(a === 'getMySalaryInfo') return await getMySalaryInfoFast(payload || {});
    if(a === 'getMyProfile'){
      const full = await getMyProfileFull(payload || {});
      return full.ok === false ? full : {ok:true, source:full.source, profile:full.profile || {}};
    }
    if(typeof previousHandle === 'function') return await previousHandle(action, payload || {});
    return null;
  };
  fb.__myProfileFullFastV20260528 = true;
  global.YZFirebase = fb;
})(window);

/* 我的資料：Firebase-only 薪資設定對應修正版 20260528-map2
 * - 不走 GS。
 * - 員工端先讀 employees；若薪資欄位不在 employees，改讀 employeeSalaryConfigs 與 salarySetup/salarySettings 內的 employeeConfigMap。
 * - 管理端儲存薪資時，同步寫 employees、employeeSalaryConfigs、salarySetup/default.employeeConfigMap，之後員工端可快速讀到。
 */
(function(global){
  const fb = global.YZFirebase || {};
  if(!fb || fb.__myDataFirebaseOnlySalaryMap2V20260528) return;
  const previousHandle = fb.handleApi;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function num(v){
    if(v === true) return 1;
    const n = Number(String(v == null ? '' : v).replace(/[^0-9.-]/g,''));
    return Number.isFinite(n) ? n : 0;
  }
  function meaningful(v){
    const s = clean(v);
    return !!s && !['-','未設定','無','undefined','null','nan'].includes(lower(s));
  }
  function truthy(v){
    const s = lower(v);
    return v === true || ['是','yes','true','1','啟用','enabled','active','在保','已投保','投保','加保','有效'].includes(s);
  }
  function uniq(list){
    const out = [];
    (list || []).forEach(function(x){ const s = clean(x); if(s && !out.includes(s)) out.push(s); });
    return out;
  }
  function localUser(){ try{ return JSON.parse(localStorage.getItem('employeeUser') || '{}') || {}; }catch(e){ return {}; } }
  function db(){
    try{
      if(fb && typeof fb.init === 'function') return fb.init();
      if(global.firebase && global.firebase.apps && global.firebase.apps.length) return global.firebase.firestore();
    }catch(e){ console.warn('[profile salary map db]', e); }
    return null;
  }
  function serverTs(){ try{ return global.firebase.firestore.FieldValue.serverTimestamp(); }catch(e){ return new Date().toISOString(); } }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function fmtDate(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') return ymd(v.toDate());
    if(v instanceof Date && !isNaN(v.getTime())) return ymd(v);
    const s = clean(v);
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : ymd(d);
  }
  function money(v){
    const raw = clean(v);
    if(!raw) return '';
    if(raw.includes('元') || raw.includes('$') || raw.includes('小時') || raw.includes('%')) return raw;
    const n = num(raw);
    return n ? Math.round(n).toLocaleString('zh-TW') + ' 元' : '';
  }
  function percent(v){
    const raw = clean(v);
    if(!raw) return '';
    if(raw.includes('%')) return raw;
    const n = num(raw);
    return n ? n + '%' : '';
  }
  function maskId(v){
    const s = clean(v).toUpperCase();
    if(!s) return '';
    return s.length <= 4 ? s : s.slice(0,1) + '*****' + s.slice(-4);
  }
  function pick(o, keys, fallback){
    o = o || {};
    for(const k of keys){
      if(o[k] !== undefined && o[k] !== null && clean(o[k]) !== '') return o[k];
    }
    return fallback == null ? '' : fallback;
  }
  function objectKeys(o){ try{ return Object.keys(o || {}); }catch(e){ return []; } }

  const DEFAULT_LABOR_PLANS = [
    { code:'LAB_PART_11100', name:'第 1 級｜11,100 元', salary:11100, salaryText:'11,100 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_PART_12540', name:'第 2 級｜12,540 元', salary:12540, salaryText:'12,540 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_13500', name:'13,500 元', salary:13500, salaryText:'13,500 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_15840', name:'15,840 元', salary:15840, salaryText:'15,840 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_16500', name:'16,500 元', salary:16500, salaryText:'16,500 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_17280', name:'17,280 元', salary:17280, salaryText:'17,280 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_17880', name:'17,880 元', salary:17880, salaryText:'17,880 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_19047', name:'19,047 元', salary:19047, salaryText:'19,047 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_20008', name:'20,008 元', salary:20008, salaryText:'20,008 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_21009', name:'21,009 元', salary:21009, salaryText:'21,009 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_22000', name:'22,000 元', salary:22000, salaryText:'22,000 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_23100', name:'23,100 元', salary:23100, salaryText:'23,100 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_24000', name:'24,000 元', salary:24000, salaryText:'24,000 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_25250', name:'25,250 元', salary:25250, salaryText:'25,250 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_26400', name:'26,400 元', salary:26400, salaryText:'26,400 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_27600', name:'27,600 元', salary:27600, salaryText:'27,600 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_LOW_28590', name:'28,590 元', salary:28590, salaryText:'28,590 元', selfPayText:'依勞保局級距計算', group:'partial' },
    { code:'LAB_REG_29500', name:'第 1 級｜29,500 元', salary:29500, salaryText:'29,500 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_30300', name:'第 2 級｜30,300 元', salary:30300, salaryText:'30,300 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_31800', name:'第 3 級｜31,800 元', salary:31800, salaryText:'31,800 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_33300', name:'第 4 級｜33,300 元', salary:33300, salaryText:'33,300 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_34800', name:'第 5 級｜34,800 元', salary:34800, salaryText:'34,800 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_36300', name:'第 6 級｜36,300 元', salary:36300, salaryText:'36,300 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_38200', name:'第 7 級｜38,200 元', salary:38200, salaryText:'38,200 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_40100', name:'第 8 級｜40,100 元', salary:40100, salaryText:'40,100 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_42000', name:'第 9 級｜42,000 元', salary:42000, salaryText:'42,000 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_43900', name:'第 10 級｜43,900 元', salary:43900, salaryText:'43,900 元', selfPayText:'依勞保局級距計算', group:'regular' },
    { code:'LAB_REG_45800', name:'第 11 級｜45,800 元', salary:45800, salaryText:'45,800 元', selfPayText:'依勞保局級距計算', group:'regular' }
  ];
  const DEFAULT_HEALTH_PLANS = [28590,28800,30300,31800,33300,34800,36300,38200,40100,42000,43900,45800,48200,50600,53000,55400,57800,60800,63800,66800,69800,72800,76500,80200,83900,87600,92100,96600,101100,105600,110100,115500,120900,126300,131700,137100,142500,147900,150000]
    .map(function(v, i){ return { code:'NHI_' + v, name:'健保｜第 ' + (i + 1) + ' 級｜' + v.toLocaleString('zh-TW') + ' 元', salary:v, salaryText:v.toLocaleString('zh-TW') + ' 元', selfPayText:'依健保署級距計算' }; });

  function identityTypeOf(raw){
    raw = raw || {};
    const t = lower(pick(raw, ['identityType','employeeType','type','身分類型'], ''));
    const label = clean(pick(raw, ['identityLabel','role','職務類型','聘用類型'], ''));
    if(t === 'parttime' || label.includes('工讀') || truthy(pick(raw, ['isPartTime','是否工讀生'], ''))) return 'parttime';
    if(t === 'external' || label.includes('外聘') || label.includes('老師')) return 'external';
    if(t === 'admin') return 'admin';
    return 'staff';
  }
  function identityLabel(type){
    return type === 'parttime' ? '工讀生' : (type === 'external' ? '外聘老師' : (type === 'admin' ? '管理者' : '專職員工'));
  }
  function idList(payload, employee){
    const u = localUser();
    return uniq([
      payload && payload.employeeId, payload && payload.userId, payload && payload.id, payload && payload.adminId,
      employee && employee.employeeId, employee && employee.id, employee && employee.userId, employee && employee.__id,
      u.employeeId, u.id, u.userId
    ]);
  }
  function emailList(payload, employee){
    const u = localUser();
    return uniq([payload && payload.email, payload && payload.Email, employee && employee.email, employee && employee.Email, u.email, u.Email]).map(lower).filter(Boolean);
  }
  async function getDoc(col, id){
    const d = db(); if(!d || !id) return null;
    try{ const snap = await d.collection(col).doc(id).get(); return snap.exists ? Object.assign({__id:snap.id}, snap.data() || {}) : null; }catch(e){ return null; }
  }
  async function queryOne(col, field, value){
    const d = db(); if(!d || !field || !value) return null;
    try{ const snap = await d.collection(col).where(field,'==',value).limit(1).get(); return snap.empty ? null : Object.assign({__id:snap.docs[0].id}, snap.docs[0].data() || {}); }catch(e){ return null; }
  }
  async function allLimited(col, limit){
    const d = db(); if(!d) return [];
    try{
      const snap = await d.collection(col).limit(limit || 10).get();
      const rows = [];
      snap.forEach(function(doc){ rows.push(Object.assign({__id:doc.id}, doc.data() || {})); });
      return rows;
    }catch(e){ return []; }
  }
  async function allDocs(col){
    const d = db(); if(!d) return [];
    try{
      const snap = await d.collection(col).get();
      const rows = [];
      snap.forEach(function(doc){ rows.push(Object.assign({__id:doc.id}, doc.data() || {})); });
      return rows;
    }catch(e){ return []; }
  }
  async function findEmployee(payload){
    const ids = idList(payload || {}, {});
    for(const id of ids){ const x = await getDoc('employees', id); if(x) return x; }
    for(const id of ids){
      const a = await queryOne('employees','employeeId',id); if(a) return a;
      const b = await queryOne('employees','id',id); if(b) return b;
      const c = await queryOne('employees','userId',id); if(c) return c;
    }
    for(const email of emailList(payload || {}, {})){
      const a = await queryOne('employees','email',email); if(a) return a;
      const b = await queryOne('employees','Email',email); if(b) return b;
    }
    return null;
  }
  function hasSalaryFields(raw){
    raw = raw || {};
    const keys = ['baseSalary','staffBaseSalary','monthlySalary','salary','hourlyRate','parttimeHourlyRate','averageSalary','laborStatus','healthStatus','laborPlan','healthPlan','selfRetirementEnabled','selfRetirementRate','effectiveDate','note','jobAllowances','allowances','職務加給','津貼','本薪','時薪','勞保狀態','健保狀態'];
    return keys.some(function(k){
      const v = raw[k];
      if(Array.isArray(v)) return v.length > 0;
      return meaningful(v);
    });
  }
  function configFromMapContainer(container, ids, emails){
    const maps = [container && container.employeeConfigMap, container && container.salaryConfigMap, container && container.configMap, container && container.configs, container && container.employeeConfigs].filter(Boolean);
    for(const m of maps){
      for(const id of ids){ if(m && m[id] && typeof m[id] === 'object') return Object.assign({employeeId:id}, m[id]); }
      for(const email of emails){ if(m && m[email] && typeof m[email] === 'object') return Object.assign({email:email}, m[email]); }
      for(const k of objectKeys(m)){
        const row = m[k] || {};
        const rowIds = [row.employeeId,row.id,row.userId,row.__id,k].map(clean).filter(Boolean);
        const rowEmails = [row.email,row.Email].map(lower).filter(Boolean);
        if(rowIds.some(function(x){ return ids.includes(x); }) || rowEmails.some(function(x){ return emails.includes(x); })) return Object.assign({employeeId:k}, row);
      }
    }
    const arrs = [container && container.employees, container && container.rows, container && container.list, container && container.employeeConfigsList].filter(Array.isArray);
    for(const arr of arrs){
      for(const row of arr){
        const rowIds = [row && row.employeeId,row && row.id,row && row.userId,row && row.__id].map(clean).filter(Boolean);
        const rowEmails = [row && row.email,row && row.Email].map(lower).filter(Boolean);
        if(rowIds.some(function(x){ return ids.includes(x); }) || rowEmails.some(function(x){ return emails.includes(x); })) return row;
      }
    }
    return null;
  }
  async function findSalaryConfig(payload, employee){
    const ids = idList(payload || {}, employee || {});
    const emails = emailList(payload || {}, employee || {});
    const cols = ['employeeSalaryConfigs','salaryConfigs','employeeSalarySettings','salaryProfiles'];
    for(const col of cols){
      for(const id of ids){ const x = await getDoc(col, id); if(x && hasSalaryFields(x)) return x; }
    }
    for(const col of cols){
      for(const id of ids){
        const a = await queryOne(col,'employeeId',id); if(a && hasSalaryFields(a)) return a;
        const b = await queryOne(col,'userId',id); if(b && hasSalaryFields(b)) return b;
        const c = await queryOne(col,'id',id); if(c && hasSalaryFields(c)) return c;
      }
      for(const email of emails){
        const a = await queryOne(col,'email',email); if(a && hasSalaryFields(a)) return a;
        const b = await queryOne(col,'Email',email); if(b && hasSalaryFields(b)) return b;
      }
    }
    const setupDocs = [];
    for(const id of ['default','current','main','setup','settings','salarySetup','salarySettings','global']){
      const a = await getDoc('salarySetup', id); if(a) setupDocs.push(a);
      const b = await getDoc('salarySettings', id); if(b) setupDocs.push(b);
    }
    if(!setupDocs.length){
      const more = (await allLimited('salarySetup', 8)).concat(await allLimited('salarySettings', 8));
      more.forEach(function(x){ setupDocs.push(x); });
    }
    for(const doc of setupDocs){
      const cfg = configFromMapContainer(doc, ids, emails);
      if(cfg && hasSalaryFields(cfg)) return cfg;
      if(hasSalaryFields(doc)){
        const rowIds = [doc.employeeId,doc.id,doc.userId,doc.__id].map(clean).filter(Boolean);
        const rowEmails = [doc.email,doc.Email].map(lower).filter(Boolean);
        if(rowIds.some(function(x){ return ids.includes(x); }) || rowEmails.some(function(x){ return emails.includes(x); })) return doc;
      }
    }
    return null;
  }
  function normalizeProfile(raw){
    raw = raw || {};
    const type = identityTypeOf(raw);
    return {
      employeeId: clean(pick(raw, ['employeeId','id','userId','員工ID'], raw.__id)),
      id: clean(pick(raw, ['employeeId','id','userId','員工ID'], raw.__id)),
      name: clean(pick(raw, ['name','displayName','姓名'], '')),
      identityType:type,
      identityLabel: identityLabel(type),
      isPartTime:type === 'parttime',
      email: lower(pick(raw, ['email','Email'], '')),
      birthDate: fmtDate(pick(raw, ['birthDate','birthday','出生年月日'], '')),
      idNumberMasked: clean(raw.idNumberMasked) || maskId(pick(raw, ['idNumber','身分證字號'], '')),
      hireDate: fmtDate(pick(raw, ['hireDate','startDate','joinDate','到職日','任職日期'], '')),
      mobilePhone: clean(pick(raw, ['mobilePhone','phone','mobile','行動電話'], '')),
      address: clean(pick(raw, ['address','contactAddress','聯絡地址'], '')),
      emergencyContact: clean(pick(raw, ['emergencyContact','緊急聯絡人'], '')),
      emergencyPhone: clean(pick(raw, ['emergencyPhone','emergencyContactPhone','緊急聯絡人電話'], ''))
    };
  }
  function lineItemsText(rows){
    if(!Array.isArray(rows) || !rows.length) return '';
    return rows.map(function(x){
      if(typeof x === 'string') return clean(x);
      const name = clean(x && (x.name || x.title || x.label || x.itemName || x['名稱']));
      const amount = money(x && (x.amount || x.value || x.money || x['金額']));
      if(!name && !amount) return '';
      return (name || '項目') + (amount ? '：' + amount : '');
    }).filter(Boolean).join('\n');
  }
  function parsePlanSalary(code){ const m = clean(code).match(/(\d{4,6})/); return m ? Number(m[1]) : 0; }
  function findPlan(list, code){
    const c = clean(code);
    if(!c) return null;
    return (list || []).find(function(x){ return [x.code,x.planCode,x.id,x.salary,x.salaryText,x.name,x.label].map(clean).includes(c); }) || null;
  }
  function planText(plan, fallback, type){
    if(plan) return clean(plan.name || plan.label || plan.salaryText || (plan.salary ? money(plan.salary) : ''));
    const f = clean(fallback);
    if(!f) return '';
    const s = parsePlanSalary(f);
    return s ? ((type === 'health' ? '健保' : '勞保') + '｜' + s.toLocaleString('zh-TW') + ' 元') : f;
  }
  function planSalaryText(plan, fallback){
    if(plan) return clean(plan.salaryText || (plan.salary ? money(plan.salary) : ''));
    const s = parsePlanSalary(fallback);
    return s ? money(s) : '';
  }
  function insuranceActive(status){ return ['在保','已投保','投保','加保','有效','是'].includes(clean(status)); }
  function boolText(v){
    if(v === true) return '是';
    if(v === false) return '否';
    const s = clean(v);
    return s;
  }
  function normalizeSalary(raw){
    raw = raw || {};
    const type = identityTypeOf(raw);
    const isParttime = type === 'parttime';
    const baseSalary = pick(raw, ['baseSalary','staffBaseSalary','monthlySalary','salary','本薪','月薪'], '');
    const hourlyRate = pick(raw, ['hourlyRate','parttimeHourlyRate','hourRate','時薪'], '');
    const averageSalary = pick(raw, ['averageSalary','parttimeAverageSalary','averageSalaryText','目前申報月平均薪資總額'], '');
    const partialHours = pick(raw, ['isPartialHours','isPartialWorkingTime','partialWorkingTime','是否部分工時'], '');
    const laborStatus = meaningful(pick(raw, ['laborStatus','laborInsuranceStatus','laborInsurance','勞保狀態'], '')) ? clean(pick(raw, ['laborStatus','laborInsuranceStatus','laborInsurance','勞保狀態'], '')) : '';
    const healthStatus = meaningful(pick(raw, ['healthStatus','healthInsuranceStatus','healthInsurance','健保狀態'], '')) ? clean(pick(raw, ['healthStatus','healthInsuranceStatus','healthInsurance','健保狀態'], '')) : '';
    const laborActive = insuranceActive(laborStatus);
    const healthActive = insuranceActive(healthStatus);
    const laborPlanCode = pick(raw, ['laborPlan','laborPlanCode','laborInsuranceLevel','laborLevel','勞保級距'], '');
    const healthPlanCode = pick(raw, ['healthPlan','healthPlanCode','healthInsuranceLevel','healthLevel','健保級距'], '');
    const laborPlan = findPlan(DEFAULT_LABOR_PLANS, laborPlanCode);
    const healthPlan = findPlan(DEFAULT_HEALTH_PLANS, healthPlanCode);
    const laborSelfPay = pick(raw, ['laborSelfPayText','laborInsuranceSelfPay','laborSelfPay','勞保自付額'], '');
    const healthSelfPay = pick(raw, ['healthSelfPayText','healthInsuranceSelfPay','healthSelfPay','健保自付額'], '');
    const retirementBase = num((laborPlan && laborPlan.salary) || averageSalary || baseSalary || 0);
    const employerRetirementAmount = laborActive && retirementBase ? Math.round(retirementBase * 0.06) : 0;
    const selfRetirementEnabled = pick(raw, ['selfRetirementEnabled','laborRetirementSelfEnabled','勞退自提'], '');
    const selfRetirementRate = pick(raw, ['selfRetirementRate','laborRetirementSelfRate','勞退自提比率'], '');
    const selfEnabled = truthy(selfRetirementEnabled);
    const selfAmount = laborActive && selfEnabled && num(selfRetirementRate) && retirementBase ? Math.round(retirementBase * num(selfRetirementRate) / 100) : 0;
    const jobAllowance = pick(raw, ['jobAllowanceText','jobAllowance','職務加給'], '') || lineItemsText(raw.jobAllowances || raw.jobAllowanceItems || []);
    const allowance = pick(raw, ['allowanceText','allowance','津貼'], '') || lineItemsText(raw.allowances || raw.allowanceItems || []);
    return {
      employeeId: clean(pick(raw, ['employeeId','id','userId','員工ID'], raw.__id)),
      name: clean(pick(raw, ['name','displayName','姓名'], '')),
      email: lower(pick(raw, ['email','Email'], '')),
      identityType:type,
      identityLabel: identityLabel(type),
      staffBaseSalaryText: !isParttime && meaningful(baseSalary) ? money(baseSalary) : '',
      parttimeHourlyRateText: isParttime && meaningful(hourlyRate) ? money(hourlyRate) + ' / 小時' : '',
      mainAmountText: isParttime ? (meaningful(hourlyRate) ? money(hourlyRate) + ' / 小時' : '') : (meaningful(baseSalary) ? money(baseSalary) : ''),
      parttimePartialHoursText: isParttime && meaningful(partialHours) ? boolText(partialHours) : '',
      parttimeAverageSalaryText: isParttime && meaningful(averageSalary) ? money(averageSalary) : '',
      jobAllowanceText: meaningful(jobAllowance) ? clean(jobAllowance) : '',
      allowanceText: meaningful(allowance) ? clean(allowance) : '',
      effectiveDate: fmtDate(pick(raw, ['effectiveDate','salaryEffectiveDate','生效日期'], '')),
      note: meaningful(pick(raw, ['note','salaryNote','備註'], '')) ? clean(pick(raw, ['note','salaryNote','備註'], '')) : '',
      laborStatus: laborStatus,
      laborPlanText: laborActive ? planText(laborPlan, laborPlanCode, 'labor') : '',
      laborLevelText: laborActive ? planText(laborPlan, laborPlanCode, 'labor') : '',
      laborSalaryText: laborActive ? planSalaryText(laborPlan, laborPlanCode) : '',
      laborSelfPayText: laborActive && meaningful(laborSelfPay) ? (money(laborSelfPay) || clean(laborSelfPay)) : '',
      retirementEmployerText: laborActive ? ('6%' + (employerRetirementAmount ? '｜' + money(employerRetirementAmount) : '')) : '',
      selfRetirementText: laborActive && selfEnabled ? ((percent(selfRetirementRate) || '已開啟') + (selfAmount ? '｜' + money(selfAmount) : '')) : '',
      healthStatus: healthStatus,
      healthPlanText: healthActive ? planText(healthPlan, healthPlanCode, 'health') : '',
      healthLevelText: healthActive ? planText(healthPlan, healthPlanCode, 'health') : '',
      healthSalaryText: healthActive ? planSalaryText(healthPlan, healthPlanCode) : '',
      healthSelfPayText: healthActive && meaningful(healthSelfPay) ? (money(healthSelfPay) || clean(healthSelfPay)) : '',
      baseSalary: meaningful(baseSalary) ? money(baseSalary) : '',
      hourlyRate: meaningful(hourlyRate) ? money(hourlyRate) + ' / 小時' : '',
      averageSalary: meaningful(averageSalary) ? money(averageSalary) : '',
      isPartialHours: meaningful(partialHours) ? boolText(partialHours) : '',
      rawConfig: raw
    };
  }
  function employeeOption(row){
    row = row || {};
    const profile = normalizeProfile(row);
    return {
      id: profile.employeeId || clean(row.__id),
      employeeId: profile.employeeId || clean(row.__id),
      name: profile.name,
      email: profile.email,
      identityType: profile.identityType,
      identityLabel: profile.identityLabel,
      isPartTime: profile.isPartTime,
      accountStatus: clean(pick(row, ['accountStatus','帳號狀態'], 'active')) || 'active'
    };
  }
  function configFromPayload(payload, employee){
    payload = payload || {};
    const type = identityTypeOf(Object.assign({}, employee || {}, payload));
    const isParttime = type === 'parttime';
    return {
      salaryDisplayType: isParttime ? 'PARTTIME_DIRECT' : 'STAFF_DIRECT',
      employeeId: clean(payload.employeeId || payload.id || payload.userId || employee && (employee.employeeId || employee.id || employee.__id)),
      name: clean(employee && employee.name),
      email: lower(payload.email || employee && (employee.email || employee.Email)),
      identityType:type,
      baseSalary: isParttime ? 0 : num(payload.baseSalary),
      hourlyRate: isParttime ? num(payload.hourlyRate) : 0,
      isPartialHours: isParttime ? (clean(payload.isPartialHours) || '否') : '否',
      averageSalary: isParttime ? num(payload.averageSalary) : 0,
      laborPlan: clean(payload.laborPlan),
      healthPlan: clean(payload.healthPlan),
      laborStatus: clean(payload.laborStatus),
      healthStatus: clean(payload.healthStatus),
      selfRetirementEnabled: clean(payload.selfRetirementEnabled || '否') || '否',
      selfRetirementRate: num(payload.selfRetirementRate),
      effectiveDate: fmtDate(payload.effectiveDate) || clean(payload.effectiveDate),
      note: clean(payload.note),
      jobAllowances: Array.isArray(payload.jobAllowances) ? payload.jobAllowances : [],
      allowances: Array.isArray(payload.allowances) ? payload.allowances : [],
      salaryUpdatedAt: serverTs(),
      updatedAt: serverTs(),
      source:'firebase-mydata-map2'
    };
  }
  async function getMyProfileFull(payload){
    const employee = await findEmployee(payload || {});
    if(!employee) return {ok:false, message:'Firebase 找不到員工資料'};
    const cfg = await findSalaryConfig(payload || {}, employee).catch(function(){ return null; });
    const merged = Object.assign({}, employee || {}, cfg || {});
    const profile = normalizeProfile(merged);
    const salary = normalizeSalary(merged);
    return {ok:true, source:cfg ? 'firebase-profile-employeeConfigMap' : 'firebase-profile-employees', profile:profile, salary:salary, info:salary};
  }
  async function getMySalaryInfo(payload){
    const employee = await findEmployee(payload || {});
    const cfg = await findSalaryConfig(payload || {}, employee || {}).catch(function(){ return null; });
    const merged = Object.assign({}, employee || {}, cfg || {});
    if(!employee && !cfg) return {ok:false, message:'Firebase 找不到薪資投保資料'};
    const salary = normalizeSalary(merged);
    return {ok:true, source:cfg ? 'firebase-salary-employeeConfigMap' : 'firebase-salary-employees', info:salary, salary:salary};
  }
  async function saveEmployeeSalaryConfig(payload){
    const d = db();
    if(!d) return {ok:false, message:'Firebase 尚未啟用'};
    payload = payload || {};
    const employeeId = clean(payload.employeeId || payload.id || payload['員工ID']);
    if(!employeeId) return {ok:false, message:'缺少員工ID'};
    const employee = await findEmployee({employeeId:employeeId, userId:employeeId, email:payload.email}).catch(function(){ return null; });
    const docId = clean(employee && employee.__id) || employeeId;
    const data = configFromPayload(payload, employee || {employeeId:employeeId});
    await d.collection('employees').doc(docId).set(data, {merge:true});
    await d.collection('employeeSalaryConfigs').doc(employeeId).set(data, {merge:true});
    await d.collection('salarySetup').doc('default').set({employeeConfigMap:{[employeeId]:data}, updatedAt:serverTs(), source:'firebase-mydata-map2'}, {merge:true});
    return {ok:true, message:'薪資設定已儲存。', employeeId:employeeId, employeeConfig:data};
  }
  async function getSalarySetupOptions(){
    const employeesRaw = await allDocs('employees');
    const cfgRows = await allDocs('employeeSalaryConfigs');
    const setupRows = (await allLimited('salarySetup', 10)).concat(await allLimited('salarySettings', 10));
    const employees = employeesRaw.map(employeeOption).filter(function(x){ return x.id && ['staff','parttime'].includes(x.identityType) && lower(x.accountStatus) !== 'rejected'; });
    const employeeConfigMap = {};
    employees.forEach(function(emp){
      const base = employeesRaw.find(function(r){ return clean(r.__id) === emp.id || clean(r.employeeId) === emp.id || clean(r.id) === emp.id || lower(r.email || r.Email) === lower(emp.email); }) || {};
      const direct = cfgRows.find(function(r){ return clean(r.__id) === emp.id || clean(r.employeeId) === emp.id || clean(r.id) === emp.id || lower(r.email || r.Email) === lower(emp.email); }) || {};
      let mapped = {};
      const ids = idList({employeeId:emp.id, id:emp.id, email:emp.email}, emp);
      const emails = emailList({email:emp.email}, emp);
      for(const row of setupRows){
        const x = configFromMapContainer(row, ids, emails);
        if(x && hasSalaryFields(x)){ mapped = x; break; }
      }
      employeeConfigMap[emp.id] = Object.assign({}, hasSalaryFields(base) ? base : {}, hasSalaryFields(direct) ? direct : {}, hasSalaryFields(mapped) ? mapped : {});
    });
    return {ok:true, source:'firebase-salary-setup-map2', employees:employees, employeeConfigMap:employeeConfigMap, laborPlans:DEFAULT_LABOR_PLANS, healthPlans:DEFAULT_HEALTH_PLANS};
  }

  fb.handleApi = async function(action, payload){
    const a = clean(action);
    if(a === 'getMyProfileFull' || a === 'getMyDataFull') return await getMyProfileFull(payload || {});
    if(a === 'getMySalaryInfo') return await getMySalaryInfo(payload || {});
    if(a === 'getSalarySetupOptions') return await getSalarySetupOptions(payload || {});
    if(a === 'saveEmployeeSalaryConfig') return await saveEmployeeSalaryConfig(payload || {});
    if(a === 'getMyProfile'){
      const res = await getMyProfileFull(payload || {});
      return res.ok === false ? res : {ok:true, source:res.source, profile:res.profile || {}};
    }
    if(typeof previousHandle === 'function') return await previousHandle(action, payload || {});
    return null;
  };
  fb.__myDataFirebaseOnlySalaryMap2V20260528 = true;
  global.YZFirebase = fb;
})(window);

/* 工讀生時數：Firebase 直讀、班表時數勾稽、超出排班送審 */
(function(global){
  const fb = global.YZFirebase;
  if(!fb || fb.__parttimeFastScheduleFixV20260529) return;
  const oldHandle = fb.handleApi;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function num(v){ const n = Number(clean(v).replace(/[^\d.\-]/g,'')); return Number.isFinite(n) ? n : 0; }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function today(){ return ymd(new Date()); }
  function serverTs(){ return global.firebase && global.firebase.firestore ? global.firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString(); }
  function db(){ try{return fb.init && fb.init();}catch(e){return null;} }
  function currentUser(){ try{return JSON.parse(localStorage.getItem('employeeUser') || 'null') || {};}catch(e){return {};} }
  function dateText(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') return ymd(v.toDate());
    if(v instanceof Date && !isNaN(v.getTime())) return ymd(v);
    const s = clean(v);
    if(/^\d{4}[-/]\d{2}[-/]\d{2}/.test(s)) return s.slice(0,10).replace(/\//g,'-');
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : ymd(d);
  }
  function shortTime(v){
    const s = clean(v);
    const m = s.match(/(\d{1,2}):(\d{2})/);
    if(!m) return '';
    return pad(Math.max(0, Math.min(23, Number(m[1]) || 0))) + ':' + pad(Math.max(0, Math.min(59, Number(m[2]) || 0)));
  }
  function minutes(v){
    const t = shortTime(v);
    if(!t) return NaN;
    const parts = t.split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }
  function hhmmFromMinutes(m){
    let n = Math.round(Number(m) || 0);
    if(n < 0) n = 0;
    if(n > 24 * 60) n = 24 * 60;
    const h = Math.floor(n / 60);
    const mm = n % 60;
    return pad(h) + ':' + pad(mm);
  }
  function addHoursToTime(time, hours){
    const base = minutes(time);
    if(!Number.isFinite(base)) return '';
    return hhmmFromMinutes(base + Math.round((Number(hours) || 0) * 60));
  }
  function hoursBetween(start, end){
    const a = minutes(start), b = minutes(end);
    if(!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
    return Math.round(((b - a) / 60) * 100) / 100;
  }
  function formatHours(v){
    const n = Math.round((Number(v) || 0) * 100) / 100;
    return (Math.abs(n - Math.round(n)) < 0.001 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/,'')) + ' 小時';
  }
  async function all(col){
    const d = db(); if(!d) throw new Error('Firebase 尚未啟用');
    const snap = await d.collection(col).get();
    const rows = [];
    snap.forEach(doc => rows.push(Object.assign({__id:doc.id}, doc.data() || {})));
    return rows;
  }
  async function where(col, field, val){
    const d = db(); if(!d) throw new Error('Firebase 尚未啟用');
    const snap = await d.collection(col).where(field, '==', val).get();
    const rows = [];
    snap.forEach(doc => rows.push(Object.assign({__id:doc.id}, doc.data() || {})));
    return rows;
  }
  async function setDoc(col, id, data, merge){
    const d = db(); if(!d) throw new Error('Firebase 尚未啟用');
    await d.collection(col).doc(id).set(data, {merge: merge !== false});
    return {ok:true,id};
  }
  function employeeIdFrom(payload){
    const user = currentUser();
    return clean(payload && (payload.userId || payload.employeeId || payload.id)) || clean(user.id || user.employeeId || user.userId);
  }
  function emailFrom(payload){
    const user = currentUser();
    return lower(payload && (payload.email || payload.Email)) || lower(user.email || user.Email);
  }
  function uniqueById(rows){
    const seen = new Set();
    const out = [];
    (rows || []).forEach(r => {
      const id = clean(r.__id || r.recordId || r.requestId || r.id) || JSON.stringify(r);
      if(seen.has(id)) return;
      seen.add(id);
      out.push(r);
    });
    return out;
  }
  async function employeeRows(col, employeeId, email){
    const jobs = [];
    if(employeeId){
      jobs.push(where(col, 'employeeId', employeeId).catch(()=>[]));
      jobs.push(where(col, '員工ID', employeeId).catch(()=>[]));
      jobs.push(where(col, 'userId', employeeId).catch(()=>[]));
    }
    if(email){
      jobs.push(where(col, 'email', email).catch(()=>[]));
      jobs.push(where(col, 'Email', email).catch(()=>[]));
    }
    const chunks = jobs.length ? await Promise.all(jobs) : [];
    return uniqueById([].concat.apply([], chunks));
  }
  function normalizeParttime(o){
    o = o || {};
    const total = num(o.totalHours || o['總時數'] || o.hours || o['時數']);
    return {
      id: clean(o.recordId || o['紀錄ID'] || o.__id),
      recordId: clean(o.recordId || o['紀錄ID'] || o.__id),
      employeeId: clean(o.employeeId || o['員工ID']),
      name: clean(o.name || o['姓名']),
      email: lower(o.email || o['Email']),
      date: dateText(o.date || o.workDate || o['日期']),
      hours: num(o.hours || o['時數'] || total),
      totalHours: total,
      hourlyRate: num(o.hourlyRate || o['時薪']),
      grossPay: num(o.grossPay || o['當日工資'] || o['當筆毛額']),
      status: clean(o.status || o['狀態'] || '正常') || '正常',
      note: clean(o.note || o['備註']),
      sourceType: clean(o.sourceType || o.requestType || o['申請類型'])
    };
  }
  async function getParttimeRows(employeeId, email){
    return (await employeeRows('parttimeRecords', employeeId, email)).map(normalizeParttime).filter(r => r.date && clean(r.status) !== '已刪除' && clean(r.status) !== '已駁回');
  }
  function scheduleHours(schedule){
    if(!schedule) return 0;
    const h = hoursBetween(schedule.startTime || schedule.scheduleStartTime, schedule.endTime || schedule.scheduleEndTime);
    return Math.max(0, h);
  }
  function scheduleLabel(schedule){
    const start = shortTime(schedule.startTime || schedule.scheduleStartTime);
    const end = shortTime(schedule.endTime || schedule.scheduleEndTime);
    return start && end ? start + '-' + end : clean(schedule.summary || schedule.scheduleText || '班表');
  }
  async function todayScheduleInfo(employeeId, dateKey){
    if(typeof oldHandle === 'function'){
      try{
        const res = await oldHandle('getTodaySchedule', {userId:employeeId, employeeId, date:dateKey, clockDate:dateKey});
        if(res && (res.ok || Array.isArray(res.schedules))){
          const schedules = (res.schedules || (res.schedule ? [res.schedule] : [])).filter(Boolean);
          const usable = schedules.filter(s => (s.hasSchedule !== false) && (s.startTime || s.scheduleStartTime) && (s.endTime || s.scheduleEndTime));
          const total = Math.round(usable.reduce((sum, s) => sum + scheduleHours(s), 0) * 100) / 100;
          const firstStart = usable.map(s => shortTime(s.startTime || s.scheduleStartTime)).filter(Boolean).sort()[0] || '';
          const lastEnd = usable.map(s => shortTime(s.endTime || s.scheduleEndTime)).filter(Boolean).sort().slice(-1)[0] || '';
          return {
            hasSchedule: !!usable.length,
            schedules: usable,
            scheduledHours: total,
            scheduleLabel: usable.map(scheduleLabel).join('、'),
            scheduleStart: firstStart,
            scheduleEnd: lastEnd,
            raw: res
          };
        }
      }catch(e){}
    }
    return {hasSchedule:false, schedules:[], scheduledHours:0, scheduleLabel:'', scheduleStart:'', scheduleEnd:'', raw:null};
  }
  function normalizeTemp(o){
    o = o || {};
    const date = dateText(o.date || o['日期'] || o.workDate);
    const start = shortTime(o.startTime || o['申請上班時間'] || o.approvedStartTime || o['核准上班時間']);
    const end = shortTime(o.endTime || o['申請下班時間'] || o.approvedEndTime || o['核准下班時間']);
    const h = num(o.requestedHours || o['申請時數'] || o.approvedHours || o['核准時數']) || hoursBetween(start, end);
    const kind = clean(o.requestType || o['申請類型'] || '臨時出勤申請');
    return {
      id: clean(o.requestId || o['申請ID'] || o.__id),
      requestId: clean(o.requestId || o['申請ID'] || o.__id),
      employeeId: clean(o.employeeId || o['員工ID']),
      date,
      startTime:start,
      endTime:end,
      requestedHours:h,
      status: clean(o.status || o['狀態'] || '待審核') || '待審核',
      requestType: kind,
      reason: clean(o.reason || o['原因']),
      title: kind.indexOf('超出') >= 0 ? '超出排班時數申請' : kind,
      timeText: start && end ? start + '-' + end : '',
      hoursText: h ? formatHours(h) : ''
    };
  }
  async function pendingTempRows(employeeId, email){
    return (await employeeRows('temporaryAttendanceRequests', employeeId, email)).map(normalizeTemp).filter(r => r.status === '待審核');
  }
  async function getDefaultHourlyRate(){
    const user = currentUser();
    const v = num(user.hourlyRate || user.parttimeHourlyRate || user['時薪']);
    if(v) return v;
    try{
      const empId = clean(user.id || user.employeeId);
      if(empId){
        const rows = await employeeRows('employees', empId, lower(user.email));
        const emp = rows[0] || {};
        const rate = num(emp.hourlyRate || emp.parttimeHourlyRate || emp.hourRate || emp['時薪']);
        if(rate) return rate;
      }
    }catch(e){}
    return 0;
  }
  async function getParttimeDateContextFast(payload){
    const employeeId = employeeIdFrom(payload || {});
    const email = emailFrom(payload || {});
    const workDate = dateText((payload || {}).workDate || (payload || {}).date) || today();
    if(!employeeId) return {ok:false, message:'缺少員工資料', context:null};
    const [sch, partRows, pendings] = await Promise.all([
      todayScheduleInfo(employeeId, workDate),
      getParttimeRows(employeeId, email).catch(()=>[]),
      pendingTempRows(employeeId, email).catch(()=>[])
    ]);
    const dayParts = partRows.filter(r => r.date === workDate);
    const registered = Math.round(dayParts.reduce((sum, r) => sum + (Number(r.totalHours) || 0), 0) * 100) / 100;
    const dayPendings = pendings.filter(r => r.date === workDate);
    const pendingHours = Math.round(dayPendings.reduce((sum, r) => sum + (Number(r.requestedHours) || 0), 0) * 100) / 100;
    const scheduled = Math.round((Number(sch.scheduledHours) || 0) * 100) / 100;
    const remaining = Math.max(0, Math.round((scheduled - registered) * 100) / 100);
    const canRegister = !!(sch.hasSchedule && scheduled > 0);
    const helperText = canRegister
      ? '可直接登記排班內時數；超過排班的時數會轉為申請，待主管審核。'
      : '今天沒有排班，不能直接登記工讀時數。如為臨時出勤，請提出臨時出勤申請。';
    return {ok:true, context:{
      workDate,
      canRegister,
      statusLabel: canRegister ? '有排班' : '無排班',
      scheduleLabel: sch.scheduleLabel,
      helperText,
      scheduledHours: scheduled,
      registeredHours: registered,
      pendingHours,
      remainingRegularHours: remaining,
      maxDirectHours: remaining,
      scheduleStart: sch.scheduleStart,
      scheduleEnd: sch.scheduleEnd,
      schedules: sch.schedules,
      pendingItems: dayPendings
    }};
  }
  async function getParttimeHistoryFast(payload){
    const p = payload || {};
    const employeeId = employeeIdFrom(p);
    const email = emailFrom(p);
    const month = clean(p.monthText) || today().slice(0,7);
    const rows = (await getParttimeRows(employeeId, email)).filter(r => r.date.slice(0,7) === month).sort((a,b) => clean(b.date).localeCompare(clean(a.date)) || clean(b.recordId).localeCompare(clean(a.recordId)));
    const total = Math.round(rows.reduce((sum, r) => sum + (Number(r.totalHours) || 0), 0) * 100) / 100;
    const pay = Math.round(rows.reduce((sum, r) => sum + (Number(r.grossPay) || 0), 0));
    return {ok:true, source:'firebase-parttimeRecords', monthText:month, monthTotalHours:total, monthGrossPay:pay, rows, list:rows};
  }
  async function getParttimeHistoryRangeFast(payload){
    const p = payload || {};
    const employeeId = employeeIdFrom(p);
    const email = emailFrom(p);
    const start = dateText(p.startDate);
    const end = dateText(p.endDate);
    const rows = (await getParttimeRows(employeeId, email)).filter(r => (!start || r.date >= start) && (!end || r.date <= end)).sort((a,b) => clean(b.date).localeCompare(clean(a.date)) || clean(b.recordId).localeCompare(clean(a.recordId)));
    const total = Math.round(rows.reduce((sum, r) => sum + (Number(r.totalHours) || 0), 0) * 100) / 100;
    const pay = Math.round(rows.reduce((sum, r) => sum + (Number(r.grossPay) || 0), 0));
    return {ok:true, source:'firebase-parttimeRecords', startDate:start, endDate:end, totalHours:total, totalPay:pay, rows, list:rows};
  }
  async function getParttimePendingItemsFast(payload){
    const employeeId = employeeIdFrom(payload || {});
    const email = emailFrom(payload || {});
    const rows = (await pendingTempRows(employeeId, email)).sort((a,b) => clean(b.date).localeCompare(clean(a.date)) || clean(b.requestId).localeCompare(clean(a.requestId)));
    return {ok:true, source:'firebase-temporaryAttendanceRequests', rows};
  }
  async function createParttimeRecord(payload, totalHours, extra){
    const user = currentUser();
    const employeeId = employeeIdFrom(payload || {});
    const workDate = dateText(payload.workDate || payload.date) || today();
    const rate = num(payload.hourlyRate) || await getDefaultHourlyRate();
    const gross = Math.round((Number(totalHours) || 0) * rate);
    const recordId = clean(extra && extra.recordId) || ('PT_' + employeeId + '_' + workDate.replace(/-/g,'') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,6));
    const row = {
      recordId, '紀錄ID':recordId,
      employeeId, '員工ID':employeeId,
      name: clean(user.name), '姓名':clean(user.name),
      email: lower(user.email), Email:lower(user.email),
      date: workDate, workDate, '日期':workDate,
      hours: Number(totalHours) || 0, '時數':Number(totalHours) || 0,
      halfHour:false,
      totalHours:Number(totalHours) || 0, '總時數':Number(totalHours) || 0,
      hourlyRate:rate, '時薪':rate,
      grossPay:gross, '當日工資':gross,
      status:clean(extra && extra.status) || '正常', '狀態':clean(extra && extra.status) || '正常',
      note:clean(payload.note || (extra && extra.note) || ''), '備註':clean(payload.note || (extra && extra.note) || ''),
      source:'firebase-parttime-fast',
      createdAt:serverTs(), updatedAt:serverTs()
    };
    await setDoc('parttimeRecords', recordId, row);
    return row;
  }
  async function createOverScheduleRequest(payload, extraHours, ctx){
    const user = currentUser();
    const employeeId = employeeIdFrom(payload || {});
    const workDate = dateText(payload.workDate || payload.date) || today();
    let start = shortTime(payload.extraStartTime);
    let end = shortTime(payload.extraEndTime);
    const mode = clean(payload.extraMode || payload.excessMode || 'late');
    if(!start && !end){
      if(mode === 'early' && shortTime(ctx.scheduleStart)){
        end = shortTime(ctx.scheduleStart);
        start = hhmmFromMinutes(minutes(end) - Math.round((Number(extraHours) || 0) * 60));
      }else if(shortTime(ctx.scheduleEnd)){
        start = shortTime(ctx.scheduleEnd);
        end = addHoursToTime(start, extraHours);
      }else{
        start = shortTime(ctx.scheduleStart);
        end = start ? addHoursToTime(start, extraHours) : '';
      }
    }
    const requestId = 'PT_EXTRA_' + employeeId + '_' + workDate.replace(/-/g,'') + '_' + Date.now();
    const rate = num(payload.hourlyRate) || await getDefaultHourlyRate();
    const row = {
      requestId, '申請ID':requestId,
      employeeId, '員工ID':employeeId,
      name:clean(user.name), '姓名':clean(user.name),
      email:lower(user.email), Email:lower(user.email),
      employeeType:'工讀生', '員工身分':'工讀生',
      date:workDate, '日期':workDate,
      dayType:'超出排班時數', '出勤日別':'超出排班時數',
      existingHours:num(ctx.scheduledHours), '當天原本時數':num(ctx.scheduledHours),
      scheduleStart:clean(ctx.scheduleStart), '原班表上班時間':clean(ctx.scheduleStart),
      scheduleEnd:clean(ctx.scheduleEnd), '原班表下班時間':clean(ctx.scheduleEnd),
      startTime:start, '申請上班時間':start,
      endTime:end, '申請下班時間':end,
      requestedHours:Number(extraHours) || 0, '申請時數':Number(extraHours) || 0,
      requestType:'超出排班時數申請', '申請類型':'超出排班時數申請',
      payable:'待主管審核', '是否計薪':'待主管審核',
      hourlyRate:rate, '時薪':rate,
      reason:clean(payload.overScheduledReason || payload.excessReason || payload.reason || '超出排班時數'), '原因':clean(payload.overScheduledReason || payload.excessReason || payload.reason || '超出排班時數'),
      scheduleCheckNote:'今日排班 ' + formatHours(ctx.scheduledHours) + '，已登記 ' + formatHours(ctx.registeredHours) + '，本次超出 ' + formatHours(extraHours) + '。',
      '班表判斷':'今日排班 ' + formatHours(ctx.scheduledHours) + '，已登記 ' + formatHours(ctx.registeredHours) + '，本次超出 ' + formatHours(extraHours) + '。',
      status:'待審核', '狀態':'待審核',
      source:'firebase-parttime-over-schedule',
      createdAt:serverTs(), updatedAt:serverTs()
    };
    await setDoc('temporaryAttendanceRequests', requestId, row);
    return row;
  }
  async function submitParttimeFast(payload){
    const p = payload || {};
    const employeeId = employeeIdFrom(p);
    if(!employeeId) return {ok:false, message:'缺少員工資料，請重新登入。'};
    const workDate = dateText(p.workDate || p.date) || today();
    const selected = Math.round((num(p.hours || p.workHours) + (String(p.halfHour || p.addHalfHour).toLowerCase() === 'true' ? 0.5 : 0)) * 100) / 100;
    if(!selected) return {ok:false, message:'請先選擇時數。'};
    const contextRes = await getParttimeDateContextFast(Object.assign({}, p, {workDate}));
    const ctx = contextRes.context || {};
    if(!ctx.canRegister) return {ok:false, message:'今天沒有排班，不能直接登記工讀時數。如為臨時出勤，請使用臨時出勤申請。'};

    const remaining = Math.max(0, Number(ctx.remainingRegularHours) || 0);
    const pendingSameDay = (ctx.pendingItems || []).filter(x => clean(x.status) === '待審核');
    if(selected > remaining + 0.001 && pendingSameDay.length){
      return {ok:false, message:'這一天已有待主管審核的臨時出勤 / 超出排班時數申請，請等待主管審核。主管審核會更新，並自動歸位。'};
    }

    if(selected <= remaining + 0.001){
      const row = await createParttimeRecord(p, selected, {status:'正常'});
      return {ok:true, message:'工讀時數已送出。', recordId:row.recordId, totalHours:selected, monthText:workDate.slice(0,7), row};
    }

    const extraHours = Math.round((selected - remaining) * 100) / 100;
    if(!(p.overScheduledConfirmed || p.excessReason)){
      return {ok:false, requiresExtraApproval:true, scheduledHours:ctx.scheduledHours, remainingRegularHours:remaining, extraHours, message:'你登記的時數已超過今日排班可登記時數。超出的 ' + formatHours(extraHours) + ' 需送主管審核。'};
    }

    let normalRow = null;
    if(remaining > 0.001){
      normalRow = await createParttimeRecord(p, remaining, {status:'正常', note:'排班內時數'});
    }
    const req = await createOverScheduleRequest(p, extraHours, ctx);
    const msg = (remaining > 0.001 ? ('排班內 ' + formatHours(remaining) + ' 已登記；') : '') + '超出排班 ' + formatHours(extraHours) + ' 已送出申請，待主管審核。主管審核會更新，並自動歸位。';
    return {ok:true, message:msg, recordId:normalRow && normalRow.recordId, requestId:req.requestId, monthText:workDate.slice(0,7), pending:true, extraHours, totalHours:remaining};
  }

  fb.handleApi = async function(action, payload){
    const a = clean(action);
    if(a === 'getParttimeDateContext') return await getParttimeDateContextFast(payload || {});
    if(a === 'getParttimeHistory') return await getParttimeHistoryFast(payload || {});
    if(a === 'getParttimeHistoryRange') return await getParttimeHistoryRangeFast(payload || {});
    if(a === 'getParttimePendingItems') return await getParttimePendingItemsFast(payload || {});
    if(a === 'parttime') return await submitParttimeFast(payload || {});
    if(typeof oldHandle === 'function') return await oldHandle(action, payload || {});
    return null;
  };
  fb.__parttimeFastScheduleFixV20260529 = true;
  global.YZFirebase = fb;
})(window);

/* 工讀時數 Firebase 快速版：月份/搜尋直讀 Firebase，並勾稽班表與超出排班時數 */
(function(global){
  const fb = global.YZFirebase || {};
  const previousHandle = fb.handleApi;
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function num(v){ const n = Number(clean(v).replace(/[^0-9.\-]/g,'')); return Number.isFinite(n) ? n : 0; }
  function truthy(v){ const s = lower(v); return v === true || s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === '是' || s === '啟用'; }
  function db(){
    try{ if(fb && typeof fb.init === 'function') return fb.init(); }catch(e){}
    try{
      if(global.firebase && global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG){
        if(!global.firebase.apps.length) global.firebase.initializeApp(global.APP_CONFIG.FIREBASE_CONFIG);
        return global.firebase.firestore();
      }
    }catch(e){}
    return null;
  }
  function serverTs(){ try{ return global.firebase.firestore.FieldValue.serverTimestamp(); }catch(e){ return new Date().toISOString(); } }
  function currentUser(){ try{ return JSON.parse(localStorage.getItem('employeeUser') || 'null') || {}; }catch(e){ return {}; } }
  function employeeIdFrom(payload){ const u = currentUser(); return clean((payload && (payload.userId || payload.employeeId || payload.id)) || u.employeeId || u.id || u.userId || localStorage.getItem('employeeUserId')); }
  function ymd(d){ const x = d instanceof Date ? d : new Date(); const off = x.getTimezoneOffset() * 60000; return new Date(x.getTime() - off).toISOString().slice(0,10); }
  function dateText(v){ const s = clean(v); if(!s) return ''; const m = s.match(/^(\d{4})[\/\-.年]?(\d{1,2})[\/\-.月]?(\d{1,2})/); if(!m) return s.slice(0,10); return m[1] + '-' + String(m[2]).padStart(2,'0') + '-' + String(m[3]).padStart(2,'0'); }
  function shortTime(v){ const s = clean(v); const m = s.match(/(\d{1,2}):(\d{2})/); if(!m) return ''; return String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2,'0') + ':' + String(Math.min(59, Math.max(0, Number(m[2])))).padStart(2,'0'); }
  function minutes(v){ const t = shortTime(v); const m = t.match(/^(\d{2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; }
  function timeFromMinutes(v){ let n = Math.round(Number(v)||0); while(n < 0) n += 1440; while(n >= 1440) n -= 1440; return String(Math.floor(n/60)).padStart(2,'0') + ':' + String(n%60).padStart(2,'0'); }
  function hoursBetween(date, start, end){ const a = minutes(start), b = minutes(end); if(!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0; return Math.round(((b-a)/60)*100)/100; }
  function money(v){ const n = Math.round(Number(v)||0); return n ? n.toLocaleString('zh-TW') + ' 元' : ''; }
  async function all(col){ const d = db(); if(!d) throw new Error('Firebase 尚未啟用'); const snap = await d.collection(col).get(); const rows = []; snap.forEach(doc => rows.push(Object.assign({__id:doc.id}, doc.data() || {}))); return rows; }
  async function queryEq(col, field, value){ const d = db(); if(!d) throw new Error('Firebase 尚未啟用'); const snap = await d.collection(col).where(field, '==', value).get(); const rows = []; snap.forEach(doc => rows.push(Object.assign({__id:doc.id}, doc.data() || {}))); return rows; }
  async function setDoc(col, id, data){ const d = db(); if(!d) throw new Error('Firebase 尚未啟用'); await d.collection(col).doc(clean(id)).set(Object.assign({}, data, {updatedAt:serverTs()}), {merge:true}); }
  async function employeeRows(col, employeeId){
    const id = clean(employeeId);
    if(!id) return [];
    let rows = [];
    try{ rows = await queryEq(col, 'employeeId', id); }catch(e){ rows = []; }
    if(rows.length) return rows;
    const allRows = await all(col).catch(()=>[]);
    return allRows.filter(r => clean(r.employeeId || r['員工ID'] || r.userId || r.id) === id || clean(r.__id) === id);
  }
  async function findEmployee(employeeId){
    const id = clean(employeeId);
    if(!id) return null;
    const d = db();
    if(d){ try{ const doc = await d.collection('employees').doc(id).get(); if(doc.exists) return Object.assign({__id:doc.id}, doc.data() || {}); }catch(e){} }
    const rows = await employeeRows('employees', id).catch(()=>[]);
    return rows[0] || null;
  }
  function isEnabledRow(o){ const s = lower(o && (o.status || o['狀態'] || o.enabled || o['啟用'])); if(s === 'false' || s === '0' || s === '停用' || s === '停用中' || s === '已刪除' || s === '刪除') return false; return true; }
  const DAYS = [
    {idx:0,key:'sunday',label:'星期日',zh:'星期日'}, {idx:1,key:'monday',label:'星期一',zh:'星期一'},
    {idx:2,key:'tuesday',label:'星期二',zh:'星期二'}, {idx:3,key:'wednesday',label:'星期三',zh:'星期三'},
    {idx:4,key:'thursday',label:'星期四',zh:'星期四'}, {idx:5,key:'friday',label:'星期五',zh:'星期五'},
    {idx:6,key:'saturday',label:'星期六',zh:'星期六'}
  ];
  function dayInfo(dateKey){ const d = new Date(dateKey + 'T00:00:00'); return DAYS[isNaN(d.getTime()) ? 0 : d.getDay()] || DAYS[0]; }
  function pick(o, keys, fallback){ o = o || {}; for(const k of keys){ if(o[k] !== undefined && o[k] !== null && clean(o[k]) !== '') return o[k]; } return fallback == null ? '' : fallback; }
  function normalizeTemplate(o){ return Object.assign({}, o || {}, { id:clean(o && (o.templateId || o['模板ID'] || o.__id)), templateName:clean(o && (o.templateName || o['模板名稱'] || o.name || '班表模板')), enabled:isEnabledRow(o || {}) }); }
  function dayFromTemplate(template, dateKey){
    const info = dayInfo(dateKey);
    const days = Array.isArray(template.days) ? template.days : [];
    const dayRow = days.find(d => clean(d.dayKey || d.key) === info.key || clean(d.dayLabel || d.label) === info.label || clean(d.dayLabel || d.label) === info.zh) || {};
    const type = clean(pick(template, [info.key+'Type', info.zh+'類型'], pick(dayRow, ['type','clockType','打卡類型'], '無班'))) || '無班';
    const start = shortTime(pick(template, [info.key+'StartTime', info.key+'Time', info.zh+'上班時間'], pick(dayRow, ['startTime','time','上班時間'], '')));
    const end = shortTime(pick(template, [info.key+'EndTime', info.zh+'下班時間'], pick(dayRow, ['endTime','下班時間'], '')));
    return {dayKey:info.key, dayLabel:info.label, clockType:type, startTime:start, endTime:end};
  }
  function scheduleKey(s){ return [clean(s.source), clean(s.id || s.assignmentId || s.recordId), clean(s.date), shortTime(s.startTime), shortTime(s.endTime)].join('|'); }
  function normalizeSingle(o, dateKey){
    return {
      id:clean(o.recordId || o['單日ID'] || o.__id), source:'singleDaySchedules', sourceLabel:'單日班表',
      employeeId:clean(o.employeeId || o['員工ID']), date:dateText(o.date || o['日期']) || dateKey,
      startTime:shortTime(o.startTime || o['上班時間'] || o.time || o['開始時間']), endTime:shortTime(o.endTime || o['下班時間'] || o['結束時間']),
      templateName:clean(o.templateName || o['模板名稱'] || o.name || o['班別名稱']), enabled:isEnabledRow(o)
    };
  }
  function normalizeAssignment(o){
    return { id:clean(o.assignmentId || o['套用ID'] || o.__id), source:'employeeSchedules', sourceLabel:'固定班表', employeeId:clean(o.employeeId || o['員工ID']), templateId:clean(o.templateId || o['模板ID']), templateName:clean(o.templateName || o['模板名稱']), startDate:dateText(o.startDate || o['開始日期']), endDate:dateText(o.endDate || o['結束日期']), indefinite:truthy(o.indefinite || o['無期限']), enabled:isEnabledRow(o) };
  }
  async function schedulesForDate(employeeId, dateKey){
    const [singleRows, assignmentRows, templateRows] = await Promise.all([
      employeeRows('singleDaySchedules', employeeId).catch(()=>[]),
      employeeRows('employeeSchedules', employeeId).catch(()=>[]),
      all('scheduleTemplates').catch(()=>[])
    ]);
    const templates = templateRows.map(normalizeTemplate).filter(t => t.enabled);
    const schedules = [];
    singleRows.map(r => normalizeSingle(r, dateKey)).filter(s => s.enabled && s.date === dateKey && s.startTime && s.endTime).forEach(s => { s.hours = hoursBetween(dateKey, s.startTime, s.endTime); s.key = scheduleKey(s); schedules.push(s); });
    assignmentRows.map(normalizeAssignment).filter(a => a.enabled && a.startDate && dateKey >= a.startDate && (a.indefinite || !a.endDate || dateKey <= a.endDate)).forEach(a => {
      const t = templates.find(x => clean(x.id) === clean(a.templateId) || clean(x.templateId) === clean(a.templateId));
      if(!t) return;
      const d = dayFromTemplate(t, dateKey);
      if(!d.startTime || !d.endTime) return;
      const s = { id:a.id, assignmentId:a.id, source:'employeeSchedules', sourceLabel:'固定班表', employeeId, date:dateKey, templateId:t.id, templateName:t.templateName || a.templateName, dayKey:d.dayKey, dayLabel:d.dayLabel, clockType:d.clockType, startTime:d.startTime, endTime:d.endTime };
      s.hours = hoursBetween(dateKey, s.startTime, s.endTime); s.key = scheduleKey(s); schedules.push(s);
    });
    schedules.sort((a,b) => (minutes(a.startTime)||9999) - (minutes(b.startTime)||9999));
    return schedules.filter(s => s.hours > 0);
  }
  function fmtHours(v){ const n = Math.round((Number(v)||0)*100)/100; return Math.abs(n - Math.round(n)) < .001 ? String(Math.round(n)) + ' 小時' : String(n).replace(/\.0$/,'') + ' 小時'; }
  function scheduleLabel(schedules){ return (schedules || []).map(s => `${s.startTime}-${s.endTime}`).join('、'); }
  async function getParttimeDateContext(payload){
    const employeeId = employeeIdFrom(payload || {});
    const workDate = dateText(payload && (payload.workDate || payload.date)) || ymd(new Date());
    if(!employeeId) return {ok:false, message:'缺少員工資料', context:{workDate, canRegister:false}};
    const schedules = await schedulesForDate(employeeId, workDate);
    const scheduledHours = Math.round(schedules.reduce((sum,s)=>sum+(Number(s.hours)||0),0)*100)/100;
    const canRegister = scheduledHours > 0;
    return {ok:true, context:{
      workDate, date:workDate, employeeId, canRegister, hasSchedule:canRegister, statusLabel:canRegister?'今日有排班':'今日沒有排班',
      scheduleLabel:scheduleLabel(schedules), scheduledHours, maxDirectHours:scheduledHours, schedules,
      helperText:canRegister?`今日排班 ${scheduleLabel(schedules)}，可直接登記 ${fmtHours(scheduledHours)}。`:'今天沒有排班，不能直接登記工讀時數。'
    }};
  }
  async function getHourlyRate(employeeId){
    const emp = await findEmployee(employeeId).catch(()=>null);
    const rate = num(pick(emp || {}, ['hourlyRate','parttimeHourlyRate','hourRate','時薪'], 0));
    if(rate) return rate;
    const cfg = await employeeRows('employeeSalaryConfigs', employeeId).catch(()=>[]);
    const r2 = cfg.map(x => num(pick(x, ['hourlyRate','parttimeHourlyRate','hourRate','時薪'], 0))).find(Boolean);
    return r2 || 0;
  }
  function normParttime(o){
    o = o || {};
    const total = num(o.totalHours || o['總時數'] || o.hours || o['時數']);
    return { id:clean(o.recordId || o['紀錄ID'] || o.__id), employeeId:clean(o.employeeId || o['員工ID']), date:dateText(o.date || o.workDate || o['日期']), totalHours:total, hours:num(o.hours || o['時數']) || total, status:clean(o.status || o['狀態'] || '正常') || '正常', note:clean(o.note || o['備註']), hourlyRate:num(o.hourlyRate || o['時薪']), grossPay:num(o.grossPay || o['當日工資'] || o['當筆毛額']) };
  }
  async function parttimeRows(employeeId){ return (await employeeRows('parttimeRecords', employeeId).catch(()=>[])).map(normParttime).filter(r => r.employeeId === clean(employeeId) && r.date && clean(r.status) !== '已駁回' && clean(r.status) !== '已刪除'); }
  function groupParttime(rows){
    const map = {};
    (rows || []).forEach(r => {
      const k = r.date;
      if(!k) return;
      if(!map[k]) map[k] = {date:k, totalHours:0, grossPay:0, notes:[], rows:[]};
      map[k].totalHours += Number(r.totalHours)||0;
      map[k].grossPay += Number(r.grossPay)||0;
      if(r.note) map[k].notes.push(r.note);
      map[k].rows.push(r);
    });
    return Object.values(map).map(x => { x.totalHours = Math.round(x.totalHours*100)/100; x.grossPay = Math.round(x.grossPay); x.note = Array.from(new Set(x.notes)).join('；'); return x; }).sort((a,b)=>clean(b.date).localeCompare(clean(a.date)));
  }
  async function getParttimeHistory(payload){
    const employeeId = employeeIdFrom(payload || {});
    const monthText = clean(payload && payload.monthText) || ymd(new Date()).slice(0,7);
    const rows = groupParttime((await parttimeRows(employeeId)).filter(r => clean(r.date).slice(0,7) === monthText));
    const monthTotalHours = Math.round(rows.reduce((s,r)=>s+(Number(r.totalHours)||0),0)*100)/100;
    const monthGrossPay = Math.round(rows.reduce((s,r)=>s+(Number(r.grossPay)||0),0));
    return {ok:true, source:'firebase-parttime-fast', monthText, monthTotalHours, monthGrossPay, rows, list:rows};
  }
  async function getParttimeHistoryRange(payload){
    const employeeId = employeeIdFrom(payload || {});
    const startDate = dateText(payload && payload.startDate);
    const endDate = dateText(payload && payload.endDate);
    const rows = groupParttime((await parttimeRows(employeeId)).filter(r => (!startDate || r.date >= startDate) && (!endDate || r.date <= endDate)));
    const totalHours = Math.round(rows.reduce((s,r)=>s+(Number(r.totalHours)||0),0)*100)/100;
    const grossPay = Math.round(rows.reduce((s,r)=>s+(Number(r.grossPay)||0),0));
    return {ok:true, source:'firebase-parttime-fast', startDate, endDate, totalHours, grossPay, rows, list:rows};
  }
  function pendingStatus(o){ return clean(o.status || o['狀態']); }
  async function getParttimePendingItems(payload){
    const employeeId = employeeIdFrom(payload || {});
    const temps = await employeeRows('temporaryAttendanceRequests', employeeId).catch(()=>[]);
    const rows = temps.filter(r => pendingStatus(r) === '待審核').map(r => ({
      id:clean(r.requestId || r.__id), title:clean(r.requestType || r['申請類型']) === 'parttimeExcess' ? '超出排班時數申請' : '臨時出勤申請',
      date:dateText(r.date || r['日期']), startTime:shortTime(r.startTime || r['申請上班時間']), endTime:shortTime(r.endTime || r['申請下班時間']),
      hours:num(r.requestedHours || r['申請時數'] || r.hours), reason:clean(r.reason || r['原因']), statusText:'待主管審核'
    })).sort((a,b)=>clean(b.date).localeCompare(clean(a.date)));
    return {ok:true, source:'firebase-parttime-fast', rows};
  }
  function makeTempRange(schedules, excessHours, mode){
    const starts = schedules.map(s => minutes(s.startTime)).filter(Number.isFinite);
    const ends = schedules.map(s => minutes(s.endTime)).filter(Number.isFinite);
    const excessMin = Math.round((Number(excessHours)||0)*60);
    if(!starts.length || !ends.length || !excessMin) return {startTime:'', endTime:''};
    const firstStart = Math.min.apply(null, starts);
    const lastEnd = Math.max.apply(null, ends);
    if(mode === 'early') return {startTime:timeFromMinutes(firstStart - excessMin), endTime:timeFromMinutes(firstStart)};
    return {startTime:timeFromMinutes(lastEnd), endTime:timeFromMinutes(lastEnd + excessMin)};
  }
  async function submitParttime(payload){
    const p = payload || {};
    const user = currentUser();
    const employeeId = employeeIdFrom(p);
    const date = dateText(p.workDate || p.date) || ymd(new Date());
    const selectedHours = Math.round((num(p.hours || p.workHours) + (truthy(p.halfHour || p.addHalfHour) ? 0.5 : 0))*100)/100;
    if(!employeeId || !selectedHours) return {ok:false, message:'請選擇工讀時數。'};
    const ctx = (await getParttimeDateContext({userId:employeeId, workDate:date})).context || {};
    if(!ctx.canRegister || !ctx.scheduledHours) return {ok:false, message:'今天沒有排班，不能直接登記工讀時數；如為臨時出勤，請使用臨時出勤申請。'};
    const scheduledHours = Math.round((Number(ctx.scheduledHours)||0)*100)/100;
    const hourlyRate = await getHourlyRate(employeeId);
    const normalHours = Math.min(selectedHours, scheduledHours);
    const dateKey = date.replace(/-/g,'');
    const baseId = 'PT_' + employeeId + '_' + dateKey;
    const baseStatus = selectedHours < scheduledHours ? '少於排班' : '正常';
    const baseNote = selectedHours < scheduledHours ? '登記時數少於當日排班；如為提早離開，請確認是否已完成請假或補假。' : '排班內時數';
    const gross = Math.round(normalHours * hourlyRate);
    await setDoc('parttimeRecords', baseId, {
      recordId:baseId, '紀錄ID':baseId, employeeId, '員工ID':employeeId, name:clean(user.name), '姓名':clean(user.name), email:lower(user.email),
      date, workDate:date, '日期':date, hours:normalHours, totalHours:normalHours, '時數':normalHours, '總時數':normalHours,
      scheduledHours, '排班時數':scheduledHours, hourlyRate, '時薪':hourlyRate, grossPay:gross, '當日工資':gross,
      status:baseStatus, '狀態':baseStatus, note:baseNote, '備註':baseNote, sourceType:'parttimeScheduleHours', source:'firebase-parttime-fast', createdAt:serverTs()
    });
    if(selectedHours <= scheduledHours + 0.0001){
      const msg = selectedHours < scheduledHours ? '工讀時數已送出；本次登記少於當日排班，如有請假或提早離開請確認補假流程。' : '工讀時數已送出。';
      return {ok:true, source:'firebase-parttime-fast', message:msg, recordId:baseId, monthText:date.slice(0,7), totalHours:normalHours};
    }
    const excessHours = Math.round((selectedHours - scheduledHours)*100)/100;
    const reason = clean(p.excessReason || p.reason || p.note);
    if(!reason){
      return {ok:false, needsExcessReview:true, message:`你今日排班可直接登記 ${fmtHours(scheduledHours)}，目前選擇 ${fmtHours(selectedHours)}，超出 ${fmtHours(excessHours)} 需填寫原因並送主管審核。`, context:ctx, scheduledHours, excessHours};
    }
    const pending = (await getParttimePendingItems({userId:employeeId})).rows.find(r => r.date === date && r.title === '超出排班時數申請');
    if(pending) return {ok:false, message:'這一天已經有超出排班時數申請，待主管審核。主管審核會更新，並自動歸位。'};
    const range = makeTempRange(ctx.schedules || [], excessHours, clean(p.excessMode || 'late'));
    const reqId = 'PTX_' + employeeId + '_' + dateKey + '_' + Date.now();
    await setDoc('temporaryAttendanceRequests', reqId, {
      requestId:reqId, employeeId, '員工ID':employeeId, name:clean(user.name), '姓名':clean(user.name), email:lower(user.email),
      employeeType:'工讀生', '員工身分':'工讀生', requestType:'parttimeExcess', '申請類型':'超出排班時數',
      date, '日期':date, startTime:range.startTime, '申請上班時間':range.startTime, endTime:range.endTime, '申請下班時間':range.endTime,
      requestedHours:excessHours, '申請時數':excessHours, scheduledHours, '排班時數':scheduledHours, selectedHours, '登記時數':selectedHours,
      hourlyRate, '時薪':hourlyRate, payable:'是', '是否計薪':'是', reason, '原因':reason,
      status:'待審核', '狀態':'待審核', sourceType:'parttimeExcessHours', source:'firebase-parttime-fast', createdAt:serverTs()
    });
    return {ok:true, source:'firebase-parttime-fast', message:`排班內 ${fmtHours(normalHours)} 已登記；超出 ${fmtHours(excessHours)} 已送主管審核。主管審核會更新，並自動歸位。`, recordId:baseId, excessRequestId:reqId, monthText:date.slice(0,7), totalHours:normalHours, pendingExcessHours:excessHours};
  }
  fb.handleApi = async function(action, payload){
    const a = clean(action);
    if(a === 'getParttimeDateContext') return await getParttimeDateContext(payload || {});
    if(a === 'getParttimeHistory') return await getParttimeHistory(payload || {});
    if(a === 'getParttimeHistoryRange') return await getParttimeHistoryRange(payload || {});
    if(a === 'getParttimePendingItems') return await getParttimePendingItems(payload || {});
    if(a === 'parttime') return await submitParttime(payload || {});
    if(typeof previousHandle === 'function') return await previousHandle(action, payload || {});
    return null;
  };
  fb.__parttimeFirebaseFastV20260529 = true;
  global.YZFirebase = fb;
})(window);

/* 2026-05-29 badge + notification queue unification */
(function(global){
  const fb = global.YZFirebase || {};
  if(fb.__badgeNotifyV20260529) return;
  const previousHandle = fb.handleApi;
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ const s=lower(v); return v===true || s==='true' || s==='1' || s==='yes' || s==='y' || s==='是' || s==='啟用'; }
  function nowId(prefix){ return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }
  function today(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function readUser(){ try{ return JSON.parse(global.localStorage.getItem('employeeUser') || 'null') || {}; }catch(e){ return {}; } }
  function db(){
    const cfg = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if(!cfg || !global.firebase) throw new Error('Firebase 尚未啟用');
    if(!global.firebase.apps.length) global.firebase.initializeApp(cfg);
    return global.firebase.firestore();
  }
  async function all(collection){ const snap = await db().collection(collection).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  async function setDoc(collection, id, data, merge=true){ await db().collection(collection).doc(clean(id) || nowId('DOC')).set(data || {}, {merge}); }
  async function updateDoc(collection, id, data){ await db().collection(collection).doc(clean(id)).set(data || {}, {merge:true}); }
  function serverTs(){ try{ return global.firebase.firestore.FieldValue.serverTimestamp(); }catch(e){ return new Date().toISOString(); } }
  function statusOf(o){ return clean((o||{}).status || (o||{})['狀態'] || (o||{}).approvalStatus || (o||{})['審核狀態']); }
  function isPending(o){ const s=statusOf(o); return !s || s==='待審核' || s==='待主管審核' || lower(s)==='pending'; }
  function isRejected(o){ const s=statusOf(o); return s==='已駁回' || lower(s)==='rejected'; }
  function isApproved(o){ const s=statusOf(o); return s==='已核准' || s==='已同意' || lower(s)==='approved'; }
  function empIdOf(o){ o=o||{}; return clean(o.employeeId || o.userId || o.id || o.adminId || o['員工ID'] || o['申請人ID'] || o.__id); }
  function emailOf(o){ o=o||{}; return lower(o.email || o.Email || o['Email'] || o['電子郵件']); }
  function nameOf(o){ o=o||{}; return clean(o.name || o['姓名'] || o.employeeName || o['員工姓名']); }
  function identityOf(o){
    const raw = lower((o||{}).identityType || (o||{})['身份類型'] || (o||{}).identityLabel || (o||{})['身分類型'] || (o||{}).employeeType || (o||{})['員工身分']);
    if(raw.indexOf('工讀')>=0 || raw==='parttime') return 'parttime';
    if(raw.indexOf('外聘')>=0 || raw==='external') return 'external';
    return 'staff';
  }
  function normEmp(o){ return {id:empIdOf(o), employeeId:empIdOf(o), name:nameOf(o), email:emailOf(o), identityType:identityOf(o), identityLabel:identityOf(o)==='parttime'?'工讀生':(identityOf(o)==='external'?'外聘老師':'專職員工'), role:lower((o||{}).role || (o||{})['角色']), showSettingsZone:truthy((o||{}).showSettingsZone || (o||{})['管理區權限']), lineUserId:clean((o||{}).lineUserId || (o||{})['LINE User ID']), lineNotifyEnabled:truthy((o||{}).lineNotifyEnabled || (o||{})['LINE 通知啟用']), accountStatus:clean((o||{}).accountStatus || (o||{})['帳號狀態'])}; }
  function identFromPayload(payload){
    const user = readUser();
    const p = payload || {};
    const ids = [p.userId,p.employeeId,p.id,user.id,user.employeeId,user.userId].map(clean).filter(Boolean);
    const emails = [p.email,user.email].map(lower).filter(Boolean);
    return {ids:Array.from(new Set(ids)), emails:Array.from(new Set(emails)), user};
  }
  function rowBelongsTo(row, ident){ const id=empIdOf(row), email=emailOf(row); return (!!id && ident.ids.indexOf(id)>=0) || (!!email && ident.emails.indexOf(email)>=0); }
  function pendingRows(rows){ return (rows||[]).filter(isPending); }
  function pendingOwn(rows, ident){ return pendingRows(rows).filter(r=>rowBelongsTo(r, ident)); }
  function pendingTempType(r){ const t=clean(r.requestType || r['申請類型'] || r.sourceType || r.type); return t; }
  function isParttimeExcess(r){ const t=pendingTempType(r); return t==='parttimeExcess' || t.indexOf('超出')>=0 || t.indexOf('工讀')>=0; }
  async function countClockCompletionIssues(ident){
    if(typeof previousHandle !== 'function') return 0;
    try{
      const r = await previousHandle('getClockCompletionIssues', {userId:ident.ids[0]||'', employeeId:ident.ids[0]||'', email:ident.emails[0]||''});
      return Array.isArray(r && r.rows) ? r.rows.length : 0;
    }catch(e){ return 0; }
  }
  async function countParttimePending(ident){
    if(typeof previousHandle !== 'function') return 0;
    try{
      const r = await previousHandle('getParttimePendingItems', {userId:ident.ids[0]||'', employeeId:ident.ids[0]||'', email:ident.emails[0]||''});
      return Array.isArray(r && r.rows) ? r.rows.length : 0;
    }catch(e){ return 0; }
  }
  async function getDashboardSummaryUnified(payload){
    const p=payload||{};
    const user=readUser();
    const role=lower(p.role || user.role);
    const isAdmin = role==='admin' || truthy(user.showSettingsZone) || truthy(p.showSettingsZone);
    const [employees, leaves, corrections, temps, profileChanges, tasks, routines, announcements, applications] = await Promise.all([
      all('employees').catch(()=>[]), all('leaveRequests').catch(()=>[]), all('clockCorrections').catch(()=>[]), all('temporaryAttendanceRequests').catch(()=>[]), all('profileChangeRequests').catch(()=>[]), all('tasks').catch(()=>[]), all('routines').catch(()=>[]), all('announcements').catch(()=>[]), all('applications').catch(()=>all('teacherApplications').catch(()=>[]))
    ]);
    if(isAdmin){
      const registrationCount = employees.filter(e => lower(e.accountStatus || e['帳號狀態']) === 'pending' || clean(e.accountStatus || e['帳號狀態']) === '待審核').length;
      const leaveCount = pendingRows(leaves).length;
      const clockCorrectionCount = pendingRows(corrections).length;
      const tempAttendanceCount = pendingRows(temps).length;
      const parttimePendingCount = pendingRows(temps).filter(isParttimeExcess).length;
      const profileChangeCount = pendingRows(profileChanges).length;
      const taskCount = tasks.filter(t => !isApproved(t) && clean(t.status || t['狀態']) !== '已完成').length;
      const routineCount = routines.filter(t => !isApproved(t) && clean(t.status || t['狀態']) !== '已完成').length;
      const applicationCount = pendingRows(applications).length;
      const announcementCount = announcements.length;
      const approvalCount = registrationCount + leaveCount + clockCorrectionCount + tempAttendanceCount + profileChangeCount;
      return {ok:true, source:'firebase-unified-counts', counts:{
        registrationCount, registrations:registrationCount,
        leaveCount, leaves:leaveCount,
        clockCorrectionCount, clockCorrections:clockCorrectionCount, clocks:clockCorrectionCount,
        tempAttendanceCount, temporaryAttendanceCount:tempAttendanceCount,
        parttimePendingCount, parttime:parttimePendingCount,
        profileChangeCount, profile:profileChangeCount,
        taskCount, tasks:taskCount,
        routineCount, routines:routineCount,
        applicationCount, applications:applicationCount,
        announcementCount, announcements:announcementCount,
        salaryCount:0, approvalCount
      }};
    }
    const ident = identFromPayload(p);
    const leaveCount = pendingOwn(leaves, ident).length + leaves.filter(r => rowBelongsTo(r, ident) && isRejected(r)).length;
    const clockCorrectionOwn = pendingOwn(corrections, ident).length;
    const tempOwn = pendingOwn(temps, ident).length;
    const profileChangeCount = pendingOwn(profileChanges, ident).length + profileChanges.filter(r=>rowBelongsTo(r, ident) && isRejected(r)).length;
    const incompleteClockCount = await countClockCompletionIssues(ident);
    const parttimePendingCount = await countParttimePending(ident) || tempOwn;
    const taskCount = tasks.filter(t => rowBelongsTo(t, ident) && !isApproved(t) && clean(t.status || t['狀態']) !== '已完成').length;
    const routineCount = routines.filter(t => rowBelongsTo(t, ident) && !isApproved(t) && clean(t.status || t['狀態']) !== '已完成').length;
    const announcementCount = announcements.filter(a => !a.readBy || !Array.isArray(a.readBy) || ident.ids.every(id => a.readBy.indexOf(id)<0)).length;
    const clockCount = clockCorrectionOwn + incompleteClockCount;
    return {ok:true, source:'firebase-unified-counts', counts:{
      leaveCount, leaves:leaveCount,
      clockCount, clocks:clockCount, clockCorrectionCount:clockCorrectionOwn, incompleteClockCount,
      tempAttendanceCount:tempOwn, temporaryAttendanceCount:tempOwn,
      parttimePendingCount, parttime:parttimePendingCount,
      profileChangeCount, profile:profileChangeCount,
      taskCount, tasks:taskCount,
      routineCount, routines:routineCount,
      announcementCount, announcements:announcementCount
    }};
  }
  function defaultModuleEvents(moduleKey){
    const defs = {
      clock:[
        ['clock.specialClockSubmitted','特殊打卡送出','員工送出特殊打卡原因後，通知主管審核。'],
        ['clock.clockCorrectionSubmitted','打卡修正送出','員工修正已打卡紀錄時，通知主管審核。'],
        ['clock.missingClockSubmitted','補上班 / 補下班打卡送出','員工補上班卡或補下班卡時，通知主管審核。'],
        ['clock.reviewResult','打卡審核結果','主管核准或駁回後，通知員工。']
      ],
      temporaryAttendance:[
        ['temporaryAttendance.submitted','臨時出勤送出','員工送出臨時出勤時，通知主管審核。'],
        ['parttime.excessHoursSubmitted','工讀超出排班時數送出','工讀生登記時數超過排班時數時，通知主管審核。'],
        ['temporaryAttendance.reviewResult','臨時出勤審核結果','主管核准或駁回後，通知員工。']
      ],
      leave:[
        ['leave.submitted','請假 / 事後補假送出','員工送出請假或事後補假時，通知主管審核。'],
        ['leave.reviewResult','請假審核結果','主管核准或駁回後，通知員工。']
      ],
      profile:[
        ['profile.changeSubmitted','個人資料修改送出','員工送出聯絡資料修改時，通知主管審核。'],
        ['profile.changeResult','個人資料修改審核結果','主管核准或駁回後，通知員工。']
      ],
      profileChange:[
        ['profile.changeSubmitted','個人資料修改送出','員工送出聯絡資料修改時，通知主管審核。'],
        ['profile.changeResult','個人資料修改審核結果','主管核准或駁回後，通知員工。']
      ],
      registration:[
        ['registration.submitted','新帳號註冊送出','新帳號送出註冊後，通知主管審核。'],
        ['registration.reviewResult','註冊審核結果','主管核准或駁回後，通知員工。']
      ],
      parttimePayroll:[
        ['parttime.excessHoursSubmitted','工讀超出排班時數送出','工讀生登記時數超過排班時數時，通知主管審核。'],
        ['parttime.payrollNotice','工讀時數 / 薪資提醒','工讀時數異常或薪資處理事項通知主管。'],
        ['parttime.reviewResult','工讀時數處理結果','主管處理後，通知員工。']
      ]
    };
    return (defs[moduleKey]||[]).map(([eventKey,eventName,description])=>({moduleKey,eventKey,eventName,description,enabled:true,managerLineEnabled:false,managerEmailEnabled:false,employeeLineEnabled:true,employeeEmailEnabled:false}));
  }
  async function getModuleNotificationSettings(payload){
    const moduleKey = clean(payload && payload.moduleKey);
    let rows = (await all('moduleNotificationSettings').catch(()=>[])).filter(r => clean(r.moduleKey) === moduleKey);
    const defaults = defaultModuleEvents(moduleKey);
    const map = {};
    defaults.forEach(d => { map[d.eventKey] = Object.assign({}, d); });
    rows.forEach(r => { const key=clean(r.eventKey || r.__id); if(key) map[key] = Object.assign({}, map[key] || {}, r, {eventKey:key}); });
    return {ok:true, rows:Object.values(map)};
  }
  async function saveModuleNotificationSettings(payload){
    const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
    for(const r of rows){
      const moduleKey=clean(r.moduleKey), eventKey=clean(r.eventKey);
      if(!moduleKey || !eventKey) continue;
      await setDoc('moduleNotificationSettings', eventKey, Object.assign({}, r, {moduleKey,eventKey,updatedAt:serverTs()}), true);
    }
    return {ok:true, message:'提醒設定已儲存。'};
  }
  async function getNotificationRecipients(payload){
    const emps = (await all('employees').catch(()=>[])).map(normEmp).filter(e => e.id || e.email);
    const keyword = lower(payload && payload.keyword);
    const rows = emps.filter(e => !keyword || [e.name,e.id,e.email,e.identityLabel].join(' ').toLowerCase().indexOf(keyword) >= 0).sort((a,b)=>clean(a.name).localeCompare(clean(b.name),'zh-Hant'));
    return {ok:true, rows};
  }
  async function sendManualNotification(payload){
    const user = readUser();
    const p = payload || {};
    const message = clean(p.message);
    const targets = Array.isArray(p.targets) ? p.targets : [];
    const channels = Array.isArray(p.channels) ? p.channels.map(clean).filter(Boolean) : [];
    if(!message) return {ok:false, message:'請輸入要發送的內容。'};
    if(!targets.length) return {ok:false, message:'請選擇收件人。'};
    if(!channels.length) return {ok:false, message:'請至少選擇 LINE 或 Email。'};
    const messageId = nowId('MSG');
    await setDoc('manualMessages', messageId, {messageId, senderId:clean(user.id || user.employeeId), senderName:clean(user.name), message, channels, targetCount:targets.length, status:'pending', createdAt:serverTs(), source:'manual-manager-message'}, true);
    for(const t of targets){
      for(const channel of channels){
        const queueId = nowId('NQ');
        await setDoc('notificationQueue', queueId, {queueId, messageId, eventKey:'manual.managerMessage', channel, targetEmployeeId:clean(t.employeeId || t.id), targetName:clean(t.name), targetEmail:lower(t.email), targetLineUserId:clean(t.lineUserId), title:'主管訊息', body:message, status:'pending', createdAt:serverTs(), source:'manual-manager-message'}, true);
      }
    }
    return {ok:true, message:'已送出通知；LINE 會由後端自動推送。'};
  }
  async function getPendingProfileChangeRequests(){
    const rows = pendingRows(await all('profileChangeRequests').catch(()=>[])).map(r => Object.assign({}, r, {requestId:clean(r.requestId || r['申請ID'] || r.__id), employeeId:empIdOf(r), name:nameOf(r), email:emailOf(r), status:statusOf(r)||'待審核'}));
    rows.sort((a,b)=>clean(b.createdAt || b['建立時間'] || '').localeCompare(clean(a.createdAt || a['建立時間'] || '')));
    return {ok:true, rows};
  }
  async function approveProfileChangeRequest(payload){
    const id=clean(payload && payload.requestId);
    if(!id) return {ok:false, message:'缺少申請ID'};
    const req = (await all('profileChangeRequests').catch(()=>[])).find(r => clean(r.requestId || r['申請ID'] || r.__id) === id);
    if(!req) return {ok:false, message:'找不到申請資料'};
    const empId=empIdOf(req);
    const updates={};
    [['mobilePhone','行動電話'],['address','聯絡地址'],['email','Email'],['emergencyContact','緊急聯絡人'],['emergencyPhone','緊急聯絡人電話']].forEach(([k,zh])=>{ const v=clean(req[k] || req[zh]); if(v) updates[k]=v; });
    if(empId && Object.keys(updates).length) await updateDoc('employees', empId, Object.assign({}, updates, {updatedAt:serverTs()}));
    await updateDoc('profileChangeRequests', id, {status:'已核准','狀態':'已核准', reviewedAt:serverTs(), reviewedBy:clean((readUser()||{}).id)});
    return {ok:true, message:'已核准，個人資料已更新。'};
  }
  async function rejectProfileChangeRequest(payload){
    const id=clean(payload && payload.requestId);
    if(!id) return {ok:false, message:'缺少申請ID'};
    await updateDoc('profileChangeRequests', id, {status:'已駁回','狀態':'已駁回', rejectReason:clean(payload && payload.rejectReason), reviewedAt:serverTs(), reviewedBy:clean((readUser()||{}).id)});
    return {ok:true, message:'已駁回。'};
  }
  fb.handleApi = async function(action, payload){
    const a=clean(action);
    if(a==='getDashboardSummary' || a==='getPendingCounts') return await getDashboardSummaryUnified(payload || {});
    if(a==='getModuleNotificationSettings') return await getModuleNotificationSettings(payload || {});
    if(a==='saveModuleNotificationSettings') return await saveModuleNotificationSettings(payload || {});
    if(a==='getNotificationRecipients') return await getNotificationRecipients(payload || {});
    if(a==='sendManualNotification') return await sendManualNotification(payload || {});
    if(a==='getPendingProfileChangeRequests') return await getPendingProfileChangeRequests(payload || {});
    if(a==='approveProfileChangeRequest') return await approveProfileChangeRequest(payload || {});
    if(a==='rejectProfileChangeRequest') return await rejectProfileChangeRequest(payload || {});
    if(typeof previousHandle === 'function') return await previousHandle(action, payload || {});
    return null;
  };
  fb.__badgeNotifyV20260529 = true;
  global.YZFirebase = fb;
})(window);

/* 待處理數字 + 通知佇列 + 個資簽核：Firebase 統一版 20260529 */
(function(global){
  const fb = global.YZFirebase || {};
  if(!fb || fb.__notifyBadgeUnifiedV20260529) return;
  const previousHandle = fb.handleApi;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ const s = lower(v); return v === true || ['是','yes','true','1','啟用','enabled','active','on'].indexOf(s) >= 0; }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function today(){ return ymd(new Date()); }
  function serverTs(){ return global.firebase && global.firebase.firestore ? global.firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString(); }
  function db(){ try{return fb.init && fb.init();}catch(e){return null;} }
  function currentUser(){ try{return JSON.parse(localStorage.getItem('employeeUser') || 'null') || {};}catch(e){return {};} }
  function statusOf(o){ return clean(o && (o.status || o['狀態'])); }
  function pendingStatus(o){ const s = lower(statusOf(o)); return s === '待審核' || s === 'pending' || s === '待主管審核' || s === '審核中'; }
  function rejectedStatus(o){ const s = lower(statusOf(o)); return s === '已駁回' || s === '駁回' || s === 'rejected'; }
  function completedStatus(o){ const s = lower(statusOf(o)); return ['已完成','完成','已核准','核准','已處理','已結案','已刪除','刪除','已取消','取消'].indexOf(s) >= 0; }
  function dateText(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') return ymd(v.toDate());
    if(v instanceof Date && !isNaN(v.getTime())) return ymd(v);
    const s = clean(v).replace(/\//g,'-');
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : ymd(d);
  }
  async function all(col){
    const d = db(); if(!d) throw new Error('Firebase 尚未啟用');
    const snap = await d.collection(col).get();
    const rows = [];
    snap.forEach(doc => rows.push(Object.assign({__id:doc.id}, doc.data() || {})));
    return rows;
  }
  async function docSet(col, id, data){
    const d = db(); if(!d) throw new Error('Firebase 尚未啟用');
    await d.collection(col).doc(id).set(data, {merge:true});
    return {ok:true, id};
  }
  async function docGet(col, id){
    const d = db(); if(!d) throw new Error('Firebase 尚未啟用');
    if(!clean(id)) return null;
    const snap = await d.collection(col).doc(clean(id)).get();
    return snap.exists ? Object.assign({__id:snap.id}, snap.data() || {}) : null;
  }
  function userKeys(payload){
    const u = currentUser(); payload = payload || {};
    const employeeId = clean(payload.userId || payload.employeeId || payload.id || u.id || u.employeeId || u.userId);
    const email = lower(payload.email || payload.Email || u.email || u.Email);
    return {employeeId, email};
  }
  function belongsTo(row, keys){
    const id = clean(row.employeeId || row['員工ID'] || row.userId || row.id);
    const mail = lower(row.email || row.Email || row['Email']);
    return (!!keys.employeeId && id === keys.employeeId) || (!!keys.email && mail === keys.email);
  }
  function identityTypeOf(row){
    const raw = lower(row.identityType || row['身分類型']);
    if(raw === 'parttime' || raw === 'staff' || raw === 'external') return raw;
    if(truthy(row.isPartTime || row['是否工讀生'])) return 'parttime';
    return 'staff';
  }
  function identityLabel(type){ return type === 'parttime' ? '工讀生' : (type === 'external' ? '外聘老師' : '專職員工'); }
  function requestTypeOf(row){ return clean(row.requestType || row['申請類型'] || row.type || row.sourceType); }
  function isParttimeExcess(row){ const s = lower(requestTypeOf(row)); return s.indexOf('parttimeexcess') >= 0 || s.indexOf('超出排班') >= 0 || s.indexOf('工讀超') >= 0; }

  async function getEmployeeRecipients(){
    const rows = await all('employees').catch(()=>[]);
    const out = rows.map(r => {
      const type = identityTypeOf(r);
      const role = lower(r.role || r['角色']);
      const isManager = truthy(r.showSettingsZone || r['管理權限']) || role === 'admin' || role === 'manager';
      return {
        employeeId: clean(r.employeeId || r['員工ID'] || r.__id),
        name: clean(r.name || r['姓名']),
        email: lower(r.email || r.Email || r['Email']),
        identityType: type,
        identityLabel: identityLabel(type),
        lineUserId: clean(r.lineUserId || r['LINE User ID']),
        lineNotifyEnabled: truthy(r.lineNotifyEnabled || r['LINE 通知啟用']),
        isManager
      };
    }).filter(r => r.employeeId && lower(r.employeeId) !== 'undefined' && lower(r.name) !== '測試');
    return {ok:true, rows:out, list:out};
  }
  async function managerRecipients(){
    const rows = (await getEmployeeRecipients()).rows || [];
    return rows.filter(r => r.isManager);
  }
  async function targetEmployee(payload){
    const rows = (await getEmployeeRecipients()).rows || [];
    const keys = userKeys(payload || {});
    return rows.find(r => clean(r.employeeId) === keys.employeeId || lower(r.email) === keys.email) || null;
  }
  async function getFeatureNotificationSetting(payload){
    const code = clean(payload && (payload.featureCode || payload.code));
    if(!code) return {ok:false, message:'缺少提醒項目'};
    const row = await docGet('notificationFeatureSettings', code).catch(()=>null);
    const defaults = {featureCode:code, notifyManagerLine:true, notifyManagerEmail:false, notifyEmployeeLine:true, notifyEmployeeEmail:false};
    return {ok:true, setting:Object.assign({}, defaults, row || {})};
  }
  async function saveFeatureNotificationSetting(payload){
    payload = payload || {};
    const code = clean(payload.featureCode || payload.code);
    if(!code) return {ok:false, message:'缺少提醒項目'};
    const row = {
      featureCode:code,
      featureName:clean(payload.featureName || payload.name),
      notifyManagerLine:payload.notifyManagerLine !== false,
      notifyManagerEmail:payload.notifyManagerEmail === true,
      notifyEmployeeLine:payload.notifyEmployeeLine !== false,
      notifyEmployeeEmail:payload.notifyEmployeeEmail === true,
      updatedAt:serverTs(),
      source:'firebase-notify-feature-setting'
    };
    await docSet('notificationFeatureSettings', code, row);
    return {ok:true, message:'提醒設定已儲存。', setting:row};
  }
  async function queueManualNotification(payload){
    payload = payload || {};
    const sender = currentUser();
    const message = clean(payload.message);
    const channels = Array.isArray(payload.channels) ? payload.channels.map(clean).filter(Boolean) : [];
    const targets = Array.isArray(payload.targets) ? payload.targets : [];
    if(!message) return {ok:false, message:'請輸入訊息內容。'};
    if(!targets.length) return {ok:false, message:'請選擇收件人。'};
    if(!channels.length) return {ok:false, message:'請選擇發送方式。'};
    const batchId = 'MSG_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
    const base = {
      batchId,
      senderId:clean(sender.id || sender.employeeId || sender.userId),
      senderName:clean(sender.name || sender.email),
      message,
      channels,
      targetCount:targets.length,
      page:clean(payload.page),
      status:'待發送',
      createdAt:serverTs(),
      source:'firebase-manual-notification'
    };
    await docSet('manualMessages', batchId, Object.assign({}, base, {targets:targets.map(t => ({employeeId:clean(t.employeeId), name:clean(t.name), email:lower(t.email), lineUserId:clean(t.lineUserId)}))}));
    let count = 0;
    for(const t of targets){
      for(const ch of channels){
        const id = batchId + '_' + clean(t.employeeId) + '_' + ch;
        await docSet('notificationQueue', id, Object.assign({}, base, {
          queueId:id,
          channel:ch,
          targetEmployeeId:clean(t.employeeId),
          targetName:clean(t.name),
          targetEmail:lower(t.email),
          targetLineUserId:clean(t.lineUserId),
          status:'待發送'
        }));
        count++;
      }
    }
    return {ok:true, message:'已送出通知，共 ' + count + ' 筆；LINE 會由後端自動推送。', batchId, count};
  }
  async function enqueueFeatureNotification(featureCode, direction, payload, result){
    try{
      const setting = (await getFeatureNotificationSetting({featureCode})).setting || {};
      const channels = [];
      let targets = [];
      if(direction === 'manager'){
        if(setting.notifyManagerLine !== false) channels.push('line');
        if(setting.notifyManagerEmail === true) channels.push('email');
        targets = await managerRecipients();
      }else{
        if(setting.notifyEmployeeLine !== false) channels.push('line');
        if(setting.notifyEmployeeEmail === true) channels.push('email');
        const t = await targetEmployee(payload || {});
        targets = t ? [t] : [];
      }
      if(!targets.length || !channels.length) return null;
      const user = currentUser();
      const featureNameMap = {clock:'打卡簽核', leave:'請假簽核', temporaryAttendance:'臨時出勤', parttimePayroll:'工讀時數', profileChange:'個資修改', registration:'註冊簽核'};
      const msg = clean(payload && payload.notificationMessage) || ('【' + (featureNameMap[featureCode] || featureCode) + '】' + (direction === 'manager' ? '有新的待審核事項。' : '主管已處理你的申請。') + ' ' + clean(result && result.message));
      return await queueManualNotification({targets, channels, message:msg, page:'auto:' + featureCode, senderId:clean(user.id || user.employeeId)});
    }catch(e){ console.warn('[notify queue skipped]', featureCode, direction, e); return null; }
  }
  async function maybeQueueAfterAction(action, payload, result){
    if(!result || result.ok === false) return;
    const a = clean(action);
    if(a === 'submitClockCorrection') await enqueueFeatureNotification('clock','manager',payload,result);
    if(a === 'approveClockCorrectionApi' || a === 'rejectClockCorrectionApi') await enqueueFeatureNotification('clock','employee',payload,result);
    if(a === 'leaveRequest' || a === 'modifyLeaveRequest') await enqueueFeatureNotification('leave','manager',payload,result);
    if(a === 'reviewLeaveRequest') await enqueueFeatureNotification('leave','employee',payload,result);
    if(a === 'parttime' && (result.pending || result.pendingExcessHours || result.excessRequestId)) await enqueueFeatureNotification('parttimePayroll','manager',payload,result);
    if(a === 'submitProfileChangeRequest') await enqueueFeatureNotification('profileChange','manager',payload,result);
    if(a === 'approveProfileChangeRequest' || a === 'rejectProfileChangeRequest') await enqueueFeatureNotification('profileChange','employee',payload,result);
    if(a === 'approveRegistrationApi' || a === 'rejectRegistrationApi') await enqueueFeatureNotification('registration','employee',payload,result);
  }

  async function getDashboardSummaryUnified(payload){
    payload = payload || {};
    const role = lower(payload.role || (currentUser().role));
    const isAdmin = role === 'admin' || role === 'manager' || payload.admin === true || payload.isAdmin === true;
    const [employees, leaves, corrections, temps, profileChanges, tasks, routines, announcements, applications] = await Promise.all([
      all('employees').catch(()=>[]),
      all('leaveRequests').catch(()=>[]),
      all('clockCorrections').catch(()=>[]),
      all('temporaryAttendanceRequests').catch(()=>[]),
      all('profileChangeRequests').catch(()=>[]),
      all('tasks').catch(()=>[]),
      all('routineTemplates').catch(()=>all('routines').catch(()=>[])),
      all('announcements').catch(()=>[]),
      all('teacherApplications').catch(()=>all('applications').catch(()=>[]))
    ]);
    if(isAdmin){
      const leaveCount = leaves.filter(pendingStatus).length;
      const clockCorrectionCount = corrections.filter(pendingStatus).length;
      const tempAttendanceCount = temps.filter(pendingStatus).length;
      const parttimeApprovalCount = temps.filter(r => pendingStatus(r) && isParttimeExcess(r)).length;
      const profileChangeCount = profileChanges.filter(pendingStatus).length;
      const registrationCount = employees.filter(e => lower(e.accountStatus || e['帳號狀態']) === 'pending').length;
      const taskCount = tasks.filter(r => !completedStatus(r)).length;
      const routineCount = routines.filter(r => !completedStatus(r)).length;
      const applicationCount = applications.filter(r => pendingStatus(r) || !completedStatus(r)).length;
      return {ok:true, source:'firebase-notify-badge-unified', counts:{
        registrationCount, registrations:registrationCount,
        leaveCount, leaves:leaveCount,
        clockCorrectionCount, clocks:clockCorrectionCount,
        tempAttendanceCount, temporaryAttendanceCount:tempAttendanceCount,
        parttimeApprovalCount, parttimePending:parttimeApprovalCount,
        profileChangeCount, profileChanges:profileChangeCount,
        approvalCount:registrationCount + leaveCount + clockCorrectionCount + tempAttendanceCount + profileChangeCount,
        taskCount, tasks:taskCount,
        routineCount, routines:routineCount,
        announcements:announcements.filter(r => truthy(r.published || r.enabled || r['已發布'])).length,
        applicationCount,
        salaryCount:0,
        contracts:0,
        goodsInquiries:0
      }};
    }
    const keys = userKeys(payload);
    const ownLeaves = leaves.filter(r => belongsTo(r, keys));
    const ownCorrections = corrections.filter(r => belongsTo(r, keys));
    const ownTemps = temps.filter(r => belongsTo(r, keys));
    const ownProfileChanges = profileChanges.filter(r => belongsTo(r, keys));
    let completionIssues = 0;
    try{
      if(typeof previousHandle === 'function'){
        const res = await previousHandle('getClockCompletionIssues', Object.assign({}, payload, {userId:keys.employeeId, employeeId:keys.employeeId}));
        completionIssues = Number(res && (res.count || ((res.rows || []).length))) || 0;
      }
    }catch(e){}
    const clockPending = ownCorrections.filter(pendingStatus).length + completionIssues;
    const parttimePending = ownTemps.filter(r => pendingStatus(r) && (isParttimeExcess(r) || lower(requestTypeOf(r)).indexOf('temporary') >= 0 || requestTypeOf(r).indexOf('臨時') >= 0)).length;
    const leavePending = ownLeaves.filter(r => pendingStatus(r) || rejectedStatus(r)).length;
    const profilePending = ownProfileChanges.filter(r => pendingStatus(r) || rejectedStatus(r)).length;
    const ownTasks = tasks.filter(r => {
      const assignee = clean(r.assigneeId || r.employeeId || r['員工ID']);
      const mail = lower(r.assigneeEmail || r.email || r.Email);
      return (keys.employeeId && assignee === keys.employeeId) || (keys.email && mail === keys.email);
    }).filter(r => !completedStatus(r)).length;
    return {ok:true, source:'firebase-notify-badge-unified', counts:{
      clocks:clockPending,
      clockCount:clockPending,
      parttime:parttimePending,
      parttimePending,
      leaves:leavePending,
      leaveCount:leavePending,
      profile:profilePending,
      profileChangeCount:profilePending,
      tasks:ownTasks,
      routines:0,
      announcements:announcements.filter(r => truthy(r.published || r.enabled || r['已發布'])).length
    }};
  }

  async function getProfileChangeRequests(payload){
    const rows = (await all('profileChangeRequests').catch(()=>[])).map(r => ({
      requestId:clean(r.requestId || r['申請ID'] || r.__id),
      __id:clean(r.__id),
      employeeId:clean(r.employeeId || r.userId || r['員工ID']),
      name:clean(r.name || r['姓名']),
      email:lower(r.email || r.Email || r['Email']),
      mobilePhone:clean(r.mobilePhone || r['行動電話']),
      address:clean(r.address || r.contactAddress || r['聯絡地址']),
      emergencyContact:clean(r.emergencyContact || r['緊急聯絡人']),
      emergencyPhone:clean(r.emergencyPhone || r['緊急聯絡人電話']),
      status:statusOf(r) || '待審核',
      rejectReason:clean(r.rejectReason || r['駁回原因']),
      createdAt:clean(r.createdAtText || r.createdAt || r['建立時間']),
      raw:r
    })).sort((a,b) => clean(b.createdAt || b.requestId).localeCompare(clean(a.createdAt || a.requestId)));
    return {ok:true, rows, list:rows};
  }
  async function findEmployeeDocId(employeeId, email){
    const employees = await all('employees').catch(()=>[]);
    const row = employees.find(e => clean(e.employeeId || e['員工ID'] || e.__id) === clean(employeeId) || (!!email && lower(e.email || e.Email || e['Email']) === lower(email)));
    return row ? clean(row.__id || row.employeeId || row['員工ID']) : clean(employeeId);
  }
  async function approveProfileChangeRequest(payload){
    const requestId = clean(payload && payload.requestId);
    if(!requestId) return {ok:false, message:'缺少申請ID'};
    const req = await docGet('profileChangeRequests', requestId);
    if(!req) return {ok:false, message:'找不到個資修改申請'};
    if(!pendingStatus(req)) return {ok:false, message:'這筆申請已處理過。'};
    const employeeId = clean(req.employeeId || req.userId || req['員工ID']);
    const empDocId = await findEmployeeDocId(employeeId, req.email || req.Email);
    const data = {updatedAt:serverTs(), source:'profile-change-approved'};
    ['mobilePhone','address','email','emergencyContact','emergencyPhone'].forEach(k => { if(clean(req[k])) data[k] = clean(req[k]); });
    if(clean(req.mobilePhone)) data['行動電話'] = clean(req.mobilePhone);
    if(clean(req.address)) data['聯絡地址'] = clean(req.address);
    if(clean(req.email)) data['Email'] = lower(req.email);
    if(clean(req.emergencyContact)) data['緊急聯絡人'] = clean(req.emergencyContact);
    if(clean(req.emergencyPhone)) data['緊急聯絡人電話'] = clean(req.emergencyPhone);
    await docSet('employees', empDocId, data);
    await docSet('profileChangeRequests', requestId, {status:'已核准','狀態':'已核准', reviewedAt:serverTs(), source:'profile-change-approved'});
    return {ok:true, message:'個資修改已核准，員工資料已更新。', employeeId};
  }
  async function rejectProfileChangeRequest(payload){
    const requestId = clean(payload && payload.requestId);
    if(!requestId) return {ok:false, message:'缺少申請ID'};
    await docSet('profileChangeRequests', requestId, {status:'已駁回','狀態':'已駁回', rejectReason:clean(payload && payload.rejectReason), reviewedAt:serverTs(), source:'profile-change-rejected'});
    return {ok:true, message:'個資修改申請已駁回。'};
  }


  function defaultLeavePolicyBundleV2(){
    return {
      version:'firebase-v2',
      leaveTypes:{
        name:'假別規則設定',
        headers:['假別代碼','假別名稱','啟用','適用身分','可半天','可小時','需附件','天數額度','支薪方式','扣抵類型','全勤影響方式','可跨日','需證明文件','需主管審核','說明'],
        rows:[
          ['personal_leave','事假','是','全部','是','是','否','','無薪','獨立額度','影響','否','否','是','可申請整天、部分請假或事後補假。'],
          ['sick_leave','病假','是','全部','是','是','否','','半薪','獨立額度','依比例','否','必要時補證明','是','臨時身體不適可知悉後儘速通知。'],
          ['annual_leave','特休','是','專職','是','是','否','','全薪','扣特休','不影響','否','否','是','專職員工依特休週年級距使用。'],
          ['bereavement_leave','喪假','是','全部','是','是','是','','全薪','獨立額度','不影響','是','是','是','依親屬關係給假，必要時補證明。'],
          ['marriage_leave','婚假','是','專職','是','是','是','8','全薪','獨立額度','不影響','是','是','是','婚假法定最低 8 日。'],
          ['official_leave','公假','是','全部','是','是','否','','全薪','獨立額度','不影響','是','必要時補證明','是','因公派訓、支援或主管指派事項。'],
          ['retro_leave','事後補假','是','全部','是','是','否','','依原假別規則','依原假別規則','依原假別規則','否','必要時補證明','是','由打卡異常、提早離開或事後補假流程帶入。']
        ]
      },
      annualLeave:{
        name:'特休週年級距設定',
        headers:['年資起月數','年資迄月數','特休天數','說明'],
        rows:[
          ['0','5','0','未滿 6 個月。'],['6','11','3','6 個月以上未滿 1 年。'],['12','23','7','1 年以上未滿 2 年。'],['24','35','10','2 年以上未滿 3 年。'],['36','59','14','3 年以上未滿 5 年。'],['60','119','15','5 年以上未滿 10 年。'],['120','131','16','10 年以上。'],['132','143','17','11 年以上。'],['144','155','18','12 年以上。'],['156','167','19','13 年以上。'],['168','179','20','14 年以上。'],['180','191','21','15 年以上。'],['192','203','22','16 年以上。'],['204','215','23','17 年以上。'],['216','227','24','18 年以上。'],['228','239','25','19 年以上。'],['240','251','26','20 年以上。'],['252','263','27','21 年以上。'],['264','275','28','22 年以上。'],['276','287','29','23 年以上。'],['288','9999','30','24 年以上，最高 30 日。']
        ]
      },
      bereavement:{
        name:'喪假關係設定',
        headers:['親屬別','天數','說明'],
        rows:[
          ['父母','8','法定最低 8 日'],['養父母','8','法定最低 8 日'],['繼父母','8','法定最低 8 日'],['配偶','8','法定最低 8 日'],['祖父母','6','法定最低 6 日'],['子女','6','法定最低 6 日'],['配偶之父母','6','法定最低 6 日'],['配偶之養父母','6','法定最低 6 日'],['配偶之繼父母','6','法定最低 6 日'],['曾祖父母','3','法定最低 3 日'],['兄弟姊妹','3','法定最低 3 日'],['配偶之祖父母','3','法定最低 3 日']
        ]
      },
      holidaySummary:{
        name:'請假申請規則',
        headers:['假別代碼','假別名稱','適用身分','啟用','申請期限類型','最少提前天數','是否允許臨時申請','請畢期限說明','證明文件規則','備註'],
        rows:[
          ['personal_leave','事假','全部','是','固定提前','7','是','可預期事假原則提前 7 天；臨時狀況知悉後儘速通知。','免附',''],
          ['sick_leave','病假','全部','是','知悉後儘速','','是','身體不適知悉後儘速通知主管。','必要時補證明',''],
          ['annual_leave','特休','專職','是','固定提前','7','否','原則提前 7 天申請。','免附',''],
          ['bereavement_leave','喪假','全部','是','知悉後儘速','','是','知悉後儘速通知主管，證明可後補。','建議附訃聞或證明',''],
          ['marriage_leave','婚假','專職','是','固定提前','7','是','原則提前 7 天申請，特殊狀況由主管個案核准。','建議附結婚證明',''],
          ['official_leave','公假','全部','是','主管個案核准','','是','依主管指派或實際需要辦理。','依實際需要附通知','']
        ]
      },
      globalRules:{
        name:'制度備註與全域設定',
        headers:['設定項目','設定值','說明'],
        rows:[
          ['請假年度制度','週年制','特休以到職週年計算。'],
          ['最小請假單位','0.5 小時','可依公司需要調整。'],
          ['事後補假審核','需主管審核','從打卡異常或未完成出勤帶入時，仍需主管審核。'],
          ['附件補件','必要時補證明','主管可依假別要求補件。']
        ]
      },
      updatedAtText:'',
      source:'firebase-default-v2'
    };
  }
  function normalizeLeavePolicyBundleV2(bundle){
    const fallback = defaultLeavePolicyBundleV2();
    const out = Object.assign({}, fallback, bundle || {});
    ['leaveTypes','annualLeave','bereavement','holidaySummary','globalRules'].forEach(k => {
      const base = fallback[k] || {headers:[],rows:[],name:k};
      const part = (bundle && bundle[k]) || {};
      out[k] = {
        name: clean(part.name || base.name || k),
        headers: Array.isArray(part.headers) && part.headers.length ? part.headers : base.headers,
        rows: Array.isArray(part.rows) ? part.rows : base.rows
      };
    });
    return out;
  }
  async function getLeavePolicySettingsFirebase(payload){
    const raw = await docGet('leavePolicySettings', 'default').catch(()=>null);
    const bundle = raw && raw.bundle ? normalizeLeavePolicyBundleV2(raw.bundle) : defaultLeavePolicyBundleV2();
    return {ok:true, bundle, source: raw ? 'firebase-leave-policy' : 'firebase-leave-policy-default'};
  }
  async function initLeavePolicySettingsFirebase(payload){
    const raw = await docGet('leavePolicySettings', 'default').catch(()=>null);
    if(raw && raw.bundle) return {ok:true, bundle:normalizeLeavePolicyBundleV2(raw.bundle), message:'已讀取 Firebase 假勤制度設定。', source:'firebase-leave-policy'};
    const bundle = defaultLeavePolicyBundleV2();
    await docSet('leavePolicySettings', 'default', {bundle, updatedAt:serverTs(), updatedBy:clean((payload||{}).userId || currentUser().id || currentUser().employeeId), source:'firebase-leave-policy-seed'});
    return {ok:true, bundle, message:'已建立 Firebase 假勤制度預設設定。', source:'firebase-leave-policy-seed'};
  }
  async function saveLeavePolicySettingsFirebase(payload){
    const bundle = normalizeLeavePolicyBundleV2((payload||{}).bundle || {});
    bundle.updatedAtText = new Date().toISOString();
    await docSet('leavePolicySettings', 'default', {bundle, updatedAt:serverTs(), updatedBy:clean((payload||{}).userId || currentUser().id || currentUser().employeeId), source:'firebase-leave-policy-save'});
    return {ok:true, bundle, message:'假勤制度設定已儲存到 Firebase。', source:'firebase-leave-policy-save'};
  }

  fb.handleApi = async function(action, payload){
    const a = clean(action);
    if(a === 'getLeavePolicySettingsAdmin' || a === 'getLeavePolicyPublicBundle') return await getLeavePolicySettingsFirebase(payload || {});
    if(a === 'initLeavePolicySettings') return await initLeavePolicySettingsFirebase(payload || {});
    if(a === 'saveLeavePolicySettings') return await saveLeavePolicySettingsFirebase(payload || {});
    if(a === 'getDashboardSummary' || a === 'getPendingCounts') return await getDashboardSummaryUnified(payload || {});
    if(a === 'getEmployeeRecipients') return await getEmployeeRecipients(payload || {});
    if(a === 'queueFeatureNotification'){ const q = await enqueueFeatureNotification(clean((payload||{}).featureCode), clean((payload||{}).direction || 'manager'), payload || {}, {ok:true, message:clean((payload||{}).message || (payload||{}).notificationMessage)}); return q || {ok:true, message:'通知設定未啟用或沒有符合收件人，未建立通知。'}; }
    if(a === 'queueManualNotification') return await queueManualNotification(payload || {});
    if(a === 'getFeatureNotificationSetting') return await getFeatureNotificationSetting(payload || {});
    if(a === 'saveFeatureNotificationSetting') return await saveFeatureNotificationSetting(payload || {});
    if(a === 'getProfileChangeRequests') return await getProfileChangeRequests(payload || {});
    if(a === 'approveProfileChangeRequest'){
      const res = await approveProfileChangeRequest(payload || {});
      await maybeQueueAfterAction(a, payload || {}, res);
      return res;
    }
    if(a === 'rejectProfileChangeRequest'){
      const res = await rejectProfileChangeRequest(payload || {});
      await maybeQueueAfterAction(a, payload || {}, res);
      return res;
    }
    let res = null;
    if(typeof previousHandle === 'function') res = await previousHandle(action, payload || {});
    try{ await maybeQueueAfterAction(a, payload || {}, res); }catch(e){}
    return res;
  };
  fb.__notifyBadgeUnifiedV20260529 = true;
  global.YZFirebase = fb;
})(window);

/* 2026-05-30 certificate applications + template + notification settings */
(function(global){
  const fb = global.YZFirebase || {};
  if(fb.__certificateFlowV20260530) return;
  const previousHandle = fb.handleApi;
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function upperId(v){ return clean(v).toUpperCase().replace(/\s+/g,''); }
  function truthy(v){ const s=lower(v); return v===true || s==='true' || s==='1' || s==='yes' || s==='是' || s==='啟用'; }
  function pad(n){ return String(n).padStart(2,'0'); }
  function nowText(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
  function today(){ const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
  function dateTime(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') v = v.toDate();
    if(v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}`;
    return clean(v);
  }
  function readUser(){ try{ return JSON.parse(global.localStorage.getItem('employeeUser') || 'null') || {}; }catch(e){ return {}; } }
  function db(){
    const cfg = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if(!cfg || !global.firebase) throw new Error('Firebase 尚未啟用');
    if(!global.firebase.apps.length) global.firebase.initializeApp(cfg);
    return global.firebase.firestore();
  }
  function serverTs(){ try{ return global.firebase.firestore.FieldValue.serverTimestamp(); }catch(e){ return new Date().toISOString(); } }
  async function all(col){ const snap=await db().collection(col).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  async function docGet(col,id){ if(!clean(id)) return null; const snap=await db().collection(col).doc(clean(id)).get(); return snap.exists ? Object.assign({__id:snap.id}, snap.data()||{}) : null; }
  async function docSet(col,id,data,merge=true){ await db().collection(col).doc(clean(id)).set(data||{}, {merge}); return {ok:true,id}; }
  function userIdOf(o){ o=o||{}; return clean(o.employeeId || o.userId || o.id || o['員工ID'] || o.__id); }
  function emailOf(o){ o=o||{}; return lower(o.email || o.Email || o['Email']); }
  function nameOf(o){ o=o||{}; return clean(o.name || o['姓名'] || o.applicantName); }
  function statusOf(o){ return clean((o||{}).status || (o||{})['狀態']); }
  function isPending(o){ const s=statusOf(o); return s==='待主管審核' || s==='待審核' || lower(s)==='pending' || !s; }
  function isApproved(o){ const s=statusOf(o); return s==='已核准' || s==='已同意' || lower(s)==='approved'; }
  function isRejected(o){ const s=statusOf(o); return s==='已退回' || s==='已駁回' || lower(s)==='rejected'; }
  function identityTypeOf(u){ const raw=lower((u||{}).identityType || (u||{})['身分類型']); if(raw==='external'||raw.indexOf('外聘')>=0) return 'external'; if(raw==='parttime'||raw.indexOf('工讀')>=0 || (u||{}).isPartTime===true) return 'parttime'; return 'staff'; }
  function identityLabelOf(u){ const t=identityTypeOf(u); return t==='external'?'外聘老師':(t==='parttime'?'工讀生':'專職老師'); }
  function certType(v){ return clean(v)==='teaching' ? 'teaching' : 'employment'; }
  function certLabel(t){ return certType(t)==='teaching'?'教學證明':'在職證明'; }
  function templateDocId(t){ return certType(t)==='teaching'?'teachingCertificate':'employmentCertificate'; }
  function defaultTemplate(t){
    t=certType(t);
    return {certificateType:t,title:t==='teaching'?'教學證明書':'在職證明書',defaultUnitKey:t==='teaching'?'kaili':'shangpin',showBrandLogo:true,introText:t==='teaching'?'茲證明下列教師於本單位擔任教學工作，教學資料如下，特此證明。':'茲證明下列人員現任職於本單位，任職資料如下，特此證明。',footerText:'本證明書僅供申請人告知之用途使用。若有擅自變造、轉借、冒用，或未依原申請用途及雙方約定使用，致生爭議者，應由申請人或實際使用人自行負相關法律責任。',closingText:'特此證明',watermarkPending:'主管尚未核准\n僅供預覽',watermarkRejected:'申請已退回\n僅供預覽'};
  }
  function normalizeApplication(r){
    r=r||{}; const f=r.formData || r.data || {}; const t=certType(r.certificateType || f.certificateType || r.type);
    const status = isApproved(r)?'已核准':(isRejected(r)?'已退回':'待主管審核');
    return Object.assign({}, r, {
      requestId:clean(r.requestId || r.__id || r.id), certificateType:t, certificateTypeLabel:certLabel(t),
      employeeId:clean(r.employeeId || r.userId || f.employeeId || r['員工ID']), name:clean(r.name || r.applicantName || f.name || f.teacherName || r['姓名']), email:emailOf(r),
      idNumber:upperId(r.idNumber || f.idNumber || r['身分證字號']), status,
      formData:Object.assign({}, f, {idNumber:upperId(f.idNumber || r.idNumber || r['身分證字號'])}),
      submittedAtText:clean(r.submittedAtText) || dateTime(r.submittedAt || r.createdAt || r['建立時間']), reviewedAtText:clean(r.reviewedAtText) || dateTime(r.reviewedAt),
      hiddenBy:Array.isArray(r.hiddenBy)?r.hiddenBy:[]
    });
  }
  function belongs(row, payload){
    const user=readUser(); payload=payload||{};
    const ids=[payload.userId,payload.employeeId,payload.id,user.id,user.employeeId,user.userId].map(clean).filter(Boolean);
    const emails=[payload.email,user.email].map(lower).filter(Boolean);
    const id=clean(row.employeeId || row.userId || row['員工ID']); const email=emailOf(row);
    return (!!id && ids.indexOf(id)>=0) || (!!email && emails.indexOf(email)>=0);
  }
  async function managerRecipients(){
    const emps=await all('employees').catch(()=>[]);
    return emps.map(e=>({employeeId:userIdOf(e),name:nameOf(e),email:emailOf(e),lineUserId:clean(e.lineUserId || e['LINE User ID']),isManager:truthy(e.showSettingsZone || e['管理權限']) || lower(e.role || e['角色'])==='admin' || lower(e.role || e['角色'])==='manager'})).filter(e=>e.employeeId && e.isManager);
  }
  async function targetRecipient(app){
    const emps=await all('employees').catch(()=>[]);
    const id=clean(app.employeeId); const email=emailOf(app);
    const e=emps.find(x=>userIdOf(x)===id || (!!email && emailOf(x)===email));
    if(!e) return id || email ? {employeeId:id,name:nameOf(app),email} : null;
    return {employeeId:userIdOf(e),name:nameOf(e),email:emailOf(e),lineUserId:clean(e.lineUserId || e['LINE User ID'])};
  }
  async function getCertNotifySetting(code){
    const row=await docGet('notificationFeatureSettings', code).catch(()=>null);
    return Object.assign({featureCode:code,enabled:true,notifyManagerLine:true,notifyManagerEmail:false,notifyEmployeeLine:true,notifyEmployeeEmail:false}, row||{});
  }
  async function saveCertNotifySetting(payload){
    const code=clean(payload.featureCode || payload.code);
    if(code.indexOf('certificate')!==0) return null;
    const row={
      featureCode:code, featureName:clean(payload.featureName || payload.name), enabled:payload.enabled !== false,
      notifyManagerLine:payload.notifyManagerLine !== false, notifyManagerEmail:payload.notifyManagerEmail === true,
      notifyEmployeeLine:payload.notifyEmployeeLine !== false, notifyEmployeeEmail:payload.notifyEmployeeEmail === true,
      updatedAt:serverTs(), source:'certificate-notification-setting'
    };
    await docSet('notificationFeatureSettings', code, row);
    return {ok:true,message:'提醒設定已儲存。',setting:row};
  }
  async function queueCertNotification(code, direction, app, message){
    try{
      const setting=await getCertNotifySetting(code);
      if(setting.enabled === false) return {ok:true,skipped:true,message:'提醒設定未啟用'};
      const channels=[];
      if(direction==='manager'){
        if(setting.notifyManagerLine !== false) channels.push('line');
        if(setting.notifyManagerEmail === true) channels.push('email');
      }else{
        if(setting.notifyEmployeeLine !== false) channels.push('line');
        if(setting.notifyEmployeeEmail === true) channels.push('email');
      }
      if(!channels.length) return {ok:true,skipped:true,message:'沒有啟用發送管道'};
      let targets=[];
      if(direction==='manager') targets=await managerRecipients(); else { const t=await targetRecipient(app); if(t) targets=[t]; }
      if(!targets.length) return {ok:true,skipped:true,message:'沒有符合的收件人'};
      if(typeof previousHandle==='function'){
        const res=await previousHandle('queueManualNotification',{targets,channels,message,page:'auto:'+code});
        if(res) return res;
      }
      const batchId='CERTMSG_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
      for(const t of targets){
        for(const ch of channels){
          const id=batchId+'_'+clean(t.employeeId||t.email)+'_'+ch;
          await docSet('notificationQueue', id, {queueId:id,batchId,channel:ch,targetEmployeeId:clean(t.employeeId),targetName:clean(t.name),targetEmail:emailOf(t),targetLineUserId:clean(t.lineUserId),message,body:message,title:'證明申請提醒',status:'待發送',createdAt:serverTs(),source:'certificate-notification'});
        }
      }
      return {ok:true,batchId,count:targets.length*channels.length};
    }catch(e){ console.warn('[certificate notification skipped]', code, e); return {ok:true,skipped:true,message:e.message}; }
  }
  async function getCertificateTemplate(payload){ const t=certType(payload && payload.certificateType); const row=await docGet('printTemplates', templateDocId(t)).catch(()=>null); return {ok:true,template:Object.assign({},defaultTemplate(t),row||{}),row:Object.assign({},defaultTemplate(t),row||{})}; }
  async function saveCertificateTemplate(payload){
    payload=payload||{}; const t=certType(payload.certificateType); const user=readUser(); const template=Object.assign({},defaultTemplate(t),payload.template||{}, {certificateType:t,updatedAt:serverTs(),updatedAtText:nowText(),updatedBy:clean(payload.userId || user.id || user.employeeId),source:'certificate-template'});
    await docSet('printTemplates', templateDocId(t), template);
    const historyId=templateDocId(t)+'_'+Date.now();
    await docSet('certificateTemplateHistory', historyId, {historyId,certificateType:t,title:clean(template.title),template,createdAt:serverTs(),createdAtText:nowText(),createdBy:clean(payload.userId || user.id || user.employeeId),source:'certificate-template-history'});
    return {ok:true,message:'範本已儲存。',template,historyId};
  }
  async function getCertificateTemplateHistory(payload){ const t=certType(payload && payload.certificateType); const rows=(await all('certificateTemplateHistory').catch(()=>[])).filter(r=>certType(r.certificateType)===t && statusOf(r)!=='已刪除').sort((a,b)=>clean(b.createdAtText||b.historyId).localeCompare(clean(a.createdAtText||a.historyId))); return {ok:true,rows}; }
  async function deleteCertificateTemplateHistory(payload){ const id=clean(payload && payload.historyId); if(!id) return {ok:false,message:'缺少歷史ID'}; await docSet('certificateTemplateHistory', id, {status:'已刪除',deletedAt:serverTs(),deletedAtText:nowText(),source:'certificate-template-history-delete'}); return {ok:true,message:'歷史範本已刪除。'}; }
  async function submitCertificateApplication(payload){
    payload=payload||{}; const user=readUser(); const t=certType(payload.certificateType); const f=Object.assign({}, payload.formData||{}); f.idNumber=upperId(f.idNumber || payload.idNumber); f.certificateType=t;
    if(!f.idNumber) return {ok:false,message:'請填寫身分證字號。'};
    const employeeId=clean(payload.userId || payload.employeeId || user.id || user.employeeId); const email=lower(payload.email || user.email);
    const requestId='CERT_'+t+'_'+(employeeId||email||'USER')+'_'+Date.now();
    const row={requestId,certificateType:t,certificateTypeLabel:certLabel(t),employeeId,name:clean(payload.name || user.name || f.name || f.teacherName),email,identityType:clean(payload.identityType || user.identityType),identityLabel:clean(payload.identityLabel || identityLabelOf(user)),idNumber:f.idNumber,formData:f,templateSnapshot:payload.templateSnapshot || defaultTemplate(t),status:'待主管審核',submittedAt:serverTs(),submittedAtText:nowText(),createdAt:serverTs(),createdAtText:nowText(),hiddenBy:[],source:'certificate-application'};
    await docSet('certificateApplications', requestId, row);
    await queueCertNotification('certificateSubmitted','manager',row,`有新的證明申請待審核\n申請人：${row.name}\n類型：${row.certificateTypeLabel}\n請至管理端「證明申請審核」處理。`);
    return {ok:true,message:'已送出申請，待主管審核。',requestId,row};
  }
  async function getCertificateApplications(payload){
    payload=payload||{}; const rows=(await all('certificateApplications').catch(()=>[])).map(normalizeApplication);
    const admin=payload.admin===true || lower(payload.role)==='admin' || lower(payload.role)==='manager';
    const visible = admin ? rows : rows.filter(r=>belongs(r,payload) && r.hiddenBy.indexOf(clean(payload.userId || readUser().id || readUser().employeeId))<0);
    visible.sort((a,b)=>clean(b.submittedAtText||b.requestId).localeCompare(clean(a.submittedAtText||a.requestId)));
    return {ok:true,rows:visible};
  }
  async function reviewCertificateApplication(payload){
    payload=payload||{}; const id=clean(payload.requestId); if(!id) return {ok:false,message:'缺少申請ID'};
    const old=await docGet('certificateApplications', id); if(!old) return {ok:false,message:'找不到申請資料'};
    if(!isPending(old)) return {ok:false,message:'這筆申請已處理過。'};
    const approve=clean(payload.decision || payload.action)==='approve' || /approve|核准|同意/i.test(clean(payload.decision || payload.action));
    const status=approve?'已核准':'已退回';
    const update={status,reviewerId:clean(payload.reviewerId),reviewerName:clean(payload.reviewerName),reviewedAt:serverTs(),reviewedAtText:nowText(),source:approve?'certificate-approved':'certificate-rejected'};
    if(approve){ update.approvedDate=today(); }
    else{ update.rejectReason=clean(payload.rejectReason || payload.reason); }
    await docSet('certificateApplications', id, update);
    const app=Object.assign({}, old, update);
    if(approve) await queueCertNotification('certificateApproved','employee',app,`您的${certLabel(app.certificateType)}申請已核准。請至「表格 → 歷史申請」查看、列印或下載加密 PDF。`);
    else await queueCertNotification('certificateRejected','employee',app,`您的${certLabel(app.certificateType)}申請已退回。${update.rejectReason ? '退回原因：'+update.rejectReason : '請至「表格 → 歷史申請」查看。'}`);
    return {ok:true,message:approve?'證明申請已核准。':'證明申請已退回。',row:app};
  }
  async function hideCertificateApplication(payload){
    payload=payload||{}; const id=clean(payload.requestId); const uid=clean(payload.userId || readUser().id || readUser().employeeId || payload.email || readUser().email); if(!id || !uid) return {ok:false,message:'缺少資料'};
    const row=await docGet('certificateApplications', id); if(!row) return {ok:false,message:'找不到申請資料'};
    const arr=Array.isArray(row.hiddenBy)?row.hiddenBy:[]; if(arr.indexOf(uid)<0) arr.push(uid);
    await docSet('certificateApplications', id, {hiddenBy:arr,updatedAt:serverTs(),source:'certificate-user-hidden'});
    return {ok:true,message:'已從你的歷史紀錄隱藏。'};
  }
  async function summaryWithCertificates(payload){
    let base=null; if(typeof previousHandle==='function') base=await previousHandle('getDashboardSummary', payload||{});
    base=base||{ok:true,counts:{}}; base.counts=base.counts||{};
    const rows=(await all('certificateApplications').catch(()=>[])).map(normalizeApplication);
    const role=lower((payload||{}).role || readUser().role); const isAdmin=role==='admin' || role==='manager' || (payload||{}).admin===true;
    if(isAdmin){ const n=rows.filter(isPending).length; base.counts.certificateReviewCount=n; base.counts.certificatePendingCount=n; base.counts.certificates=n; }
    else{ const uid=clean((payload||{}).userId || readUser().id || readUser().employeeId || (payload||{}).email || readUser().email); const own=rows.filter(r=>belongs(r,payload||{}) && (!uid || (Array.isArray(r.hiddenBy)?r.hiddenBy:[]).indexOf(uid)<0)); const n=own.filter(r=>isPending(r)||isApproved(r)||isRejected(r)).length; base.counts.certificateCount=n; base.counts.formsCount=n; }
    return base;
  }

  fb.handleApi = async function(action, payload){
    const a=clean(action);
    if(a==='getCertificateTemplate') return await getCertificateTemplate(payload||{});
    if(a==='saveCertificateTemplate') return await saveCertificateTemplate(payload||{});
    if(a==='getCertificateTemplateHistory') return await getCertificateTemplateHistory(payload||{});
    if(a==='deleteCertificateTemplateHistory') return await deleteCertificateTemplateHistory(payload||{});
    if(a==='submitCertificateApplication') return await submitCertificateApplication(payload||{});
    if(a==='getCertificateApplications') return await getCertificateApplications(payload||{});
    if(a==='reviewCertificateApplication') return await reviewCertificateApplication(payload||{});
    if(a==='hideCertificateApplication') return await hideCertificateApplication(payload||{});
    if((a==='getDashboardSummary'||a==='getPendingCounts')) return await summaryWithCertificates(payload||{});
    if(a==='saveFeatureNotificationSetting'){
      const cert = await saveCertNotifySetting(payload||{}); if(cert) return cert;
    }
    if(a==='getFeatureNotificationSetting' && clean((payload||{}).featureCode || (payload||{}).code).indexOf('certificate')===0){
      const setting=await getCertNotifySetting(clean((payload||{}).featureCode || (payload||{}).code)); return {ok:true,setting};
    }
    if(typeof previousHandle==='function') return await previousHandle(action,payload||{});
    return null;
  };
  fb.__certificateFlowV20260530 = true;
  global.YZFirebase = fb;
})(window);

/* Notification V2 backend bridge 20260530
 * 只保留新版提醒設定使用：
 * - app.js 新版設定頁呼叫 get/saveNotificationV2Settings。
 * - 右下角 LINE / Email 手動通知呼叫 getNotificationRecipientsV2 / sendManualNotificationV2。
 * - 儲存時同步寫入 notificationFeatureSettings，讓既有自動通知佇列讀得到新版勾選結果。
 */
(function(global){
  const fb = global.YZFirebase || {};
  if(!fb || fb.__notificationV2BackendBridge20260530) return;
  const previousHandle = fb.handleApi;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ return v === true || v === 1 || v === '1' || v === '是' || lower(v) === 'true' || lower(v) === 'yes' || lower(v) === 'on'; }
  function nowId(prefix){ return String(prefix || 'ID') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }
  function readUser(){ try{return JSON.parse(localStorage.getItem('employeeUser') || 'null') || {};}catch(e){return {};} }
  function db(){
    const cfg = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if(!cfg || !global.firebase) throw new Error('Firebase 尚未啟用');
    if(!global.firebase.apps.length) global.firebase.initializeApp(cfg);
    return global.firebase.firestore();
  }
  function serverTs(){ try{return global.firebase.firestore.FieldValue.serverTimestamp();}catch(e){return new Date().toISOString();} }
  async function all(col){ const snap = await db().collection(col).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  async function setDoc(col,id,data,merge=true){ await db().collection(col).doc(clean(id)).set(data||{}, {merge}); }
  function empIdOf(o){ o=o||{}; return clean(o.employeeId || o.userId || o.id || o.adminId || o['員工ID'] || o.__id); }
  function emailOf(o){ o=o||{}; return lower(o.email || o.Email || o['Email'] || o['電子郵件']); }
  function nameOf(o){ o=o||{}; return clean(o.name || o['姓名'] || o.employeeName || o.applicantName); }
  function identityTypeOf(o){
    const raw = lower((o||{}).identityType || (o||{})['身分類型'] || (o||{})['身份類型'] || (o||{})['員工身分'] || (o||{}).employeeType);
    if(raw === 'external' || raw.indexOf('外聘') >= 0) return 'external';
    if(raw === 'parttime' || raw.indexOf('工讀') >= 0 || truthy((o||{}).isPartTime || (o||{})['是否工讀生'])) return 'parttime';
    return 'staff';
  }
  function identityLabelOf(o){ const t=identityTypeOf(o); return t === 'external' ? '外聘老師' : (t === 'parttime' ? '工讀生' : '專職老師'); }
  function isManager(o){ const role=lower((o||{}).role || (o||{})['角色']); return role === 'admin' || role === 'manager' || truthy((o||{}).showSettingsZone || (o||{})['管理區權限'] || (o||{})['管理權限']); }
  function normEmp(o){
    return {
      employeeId:empIdOf(o),
      id:empIdOf(o),
      name:nameOf(o),
      email:emailOf(o),
      identityType:identityTypeOf(o),
      identityLabel:identityLabelOf(o),
      role:lower((o||{}).role || (o||{})['角色']),
      isManager:isManager(o),
      lineUserId:clean((o||{}).lineUserId || (o||{})['LINE User ID']),
      lineNotifyEnabled:truthy((o||{}).lineNotifyEnabled || (o||{})['LINE 通知啟用']),
      accountStatus:clean((o||{}).accountStatus || (o||{})['帳號狀態']),
      employmentStatus:clean((o||{}).employmentStatus || (o||{})['任職狀態'] || (o||{})['在職狀態']),
      hiddenFromActiveLists:truthy((o||{}).hiddenFromActiveLists || (o||{})['隱藏於日常清單'] || (o||{})['是否隱藏'])
    };
  }
  function defaultEvents(moduleKey){
    const defs={
      registration:[
        ['registration.submitted','新帳號註冊送出','新帳號送出註冊後，通知主管審核。'],
        ['registration.reviewResult','註冊審核結果','主管核准或駁回後，通知員工。']
      ],
      clock:[
        ['clock.specialClockSubmitted','特殊打卡送出','員工送出特殊打卡原因後，通知主管審核。'],
        ['clock.clockCorrectionSubmitted','打卡修正送出','員工修正已打卡紀錄時，通知主管審核。'],
        ['clock.missingClockSubmitted','補上班 / 補下班打卡送出','員工補上班卡或補下班卡時，通知主管審核。'],
        ['clock.reviewResult','打卡審核結果','主管核准或駁回後，通知員工。']
      ],
      temporaryAttendance:[
        ['temporaryAttendance.submitted','臨時出勤送出','員工送出臨時出勤時，通知主管審核。'],
        ['parttime.excessHoursSubmitted','工讀超出排班時數送出','工讀生登記時數超過排班時數時，通知主管審核。'],
        ['temporaryAttendance.reviewResult','臨時出勤審核結果','主管核准或駁回後，通知員工。']
      ],
      leave:[
        ['leave.submitted','請假 / 事後補假送出','員工送出請假或事後補假時，通知主管審核。'],
        ['leave.reviewResult','請假審核結果','主管核准或駁回後，通知員工。']
      ],
      profileChange:[
        ['profile.changeSubmitted','個人資料修改送出','員工送出聯絡資料修改時，通知主管審核。'],
        ['profile.changeResult','個人資料修改審核結果','主管核准或駁回後，通知員工。']
      ],
      contractor:[
        ['contractor.contractSubmitted','外聘老師合約送出','外聘老師合約或資料送出後，通知主管處理。'],
        ['contractor.goodsRecord','外聘老師拿貨紀錄','外聘老師拿貨紀錄新增或異動時，通知相關人員。']
      ],
      recruitment:[
        ['recruitment.applicationSubmitted','應聘老師履歷送出','應聘老師送出履歷資料後，通知主管查看。'],
        ['recruitment.reviewResult','應聘履歷處理結果','主管處理應聘履歷後，通知應聘者。']
      ]
    };
    return (defs[moduleKey] || []).map(function(x){return {moduleKey,eventKey:x[0],eventName:x[1],description:x[2],enabled:true,managerLineEnabled:false,managerEmailEnabled:false,employeeLineEnabled:true,employeeEmailEnabled:false};});
  }
  function settingDocId(moduleKey,eventKey){ return clean(moduleKey) + '__' + clean(eventKey).replace(/[\/#?\[\]]/g,'_'); }
  async function getNotificationV2Settings(payload){
    const moduleKey=clean(payload && payload.moduleKey);
    if(!moduleKey) return {ok:false,message:'缺少提醒分類',rows:[]};
    const defaults=defaultEvents(moduleKey);
    const rows=(await all('notificationV2Settings').catch(()=>[])).filter(r=>clean(r.moduleKey)===moduleKey);
    const map={};
    defaults.forEach(d=>{ map[d.eventKey]=Object.assign({},d); });
    rows.forEach(r=>{ const k=clean(r.eventKey || r.__id); if(k) map[k]=Object.assign({}, map[k]||{}, r, {moduleKey,eventKey:k}); });
    return {ok:true,title:'',rows:Object.values(map)};
  }
  async function saveNotificationV2Settings(payload){
    const moduleKey=clean(payload && payload.moduleKey);
    const rows=Array.isArray(payload && payload.rows) ? payload.rows : [];
    if(!moduleKey) return {ok:false,message:'缺少提醒分類'};
    for(const raw of rows){
      const eventKey=clean(raw && raw.eventKey);
      if(!eventKey) continue;
      const row=Object.assign({}, raw, {moduleKey,eventKey,updatedAt:serverTs(),source:'notification-v2-settings'});
      await setDoc('notificationV2Settings', settingDocId(moduleKey,eventKey), row, true);
    }
    const enabledRows=rows.filter(r=>r && r.enabled !== false);
    const legacyBridge={
      featureCode:moduleKey,
      featureName:moduleKey,
      enabled:enabledRows.length > 0,
      notifyManagerLine:enabledRows.some(r=>r.managerLineEnabled === true),
      notifyManagerEmail:enabledRows.some(r=>r.managerEmailEnabled === true),
      notifyEmployeeLine:enabledRows.some(r=>r.employeeLineEnabled === true),
      notifyEmployeeEmail:enabledRows.some(r=>r.employeeEmailEnabled === true),
      updatedAt:serverTs(),
      source:'notification-v2-bridge'
    };
    await setDoc('notificationFeatureSettings', moduleKey, legacyBridge, true);
    return {ok:true,message:'新版提醒設定已儲存，LINE / Email 佇列設定已同步。'};
  }
  async function getNotificationRecipientsV2(payload){
    const keyword=lower(payload && payload.keyword);
    const rows=(await all('employees').catch(()=>[])).map(normEmp).filter(e=>e.employeeId || e.email).filter(e=>{
      if(!keyword) return true;
      return [e.name,e.employeeId,e.email,e.identityLabel,e.role].join(' ').toLowerCase().indexOf(keyword) >= 0;
    }).sort((a,b)=>clean(a.name).localeCompare(clean(b.name),'zh-Hant'));
    return {ok:true,rows};
  }
  async function sendManualNotificationV2(payload){
    payload=payload || {};
    const user=readUser();
    const message=clean(payload.message);
    const targets=Array.isArray(payload.targets) ? payload.targets : [];
    const channels=Array.isArray(payload.channels) ? payload.channels.map(clean).filter(Boolean) : [];
    if(!message) return {ok:false,message:'請輸入訊息內容。'};
    if(!targets.length) return {ok:false,message:'請選擇收件人。'};
    if(!channels.length) return {ok:false,message:'請至少選擇 LINE 或 Email。'};
    const batchId=nowId('N2MSG');
    const base={batchId,senderId:clean(user.id || user.employeeId || user.userId),senderName:clean(user.name || user.email),message,channels,targetCount:targets.length,page:clean(payload.page),status:'待發送',createdAt:serverTs(),source:'notification-v2-manual'};
    await setDoc('manualMessages', batchId, Object.assign({}, base, {targets:targets.map(t=>({employeeId:clean(t.employeeId || t.id),name:clean(t.name),email:emailOf(t),lineUserId:clean(t.lineUserId),lineNotifyEnabled:truthy(t.lineNotifyEnabled)}))}), true);
    let count=0, skippedLine=0, skippedEmail=0;
    for(const t of targets){
      const employeeId=clean(t.employeeId || t.id);
      const email=emailOf(t);
      const lineUserId=clean(t.lineUserId);
      const lineOk=!!lineUserId; // 主管右下角手動通知：只要已綁定 LINE User ID 就可送出，不再因 lineNotifyEnabled 未寫入而誤略過。
      for(const ch of channels){
        if(ch === 'line' && !lineOk){ skippedLine++; continue; }
        if(ch === 'email' && !email){ skippedEmail++; continue; }
        const id=batchId + '_' + (employeeId || email || Math.random().toString(36).slice(2,8)) + '_' + ch;
        await setDoc('notificationQueue', id, Object.assign({}, base, {queueId:id,channel:ch,targetEmployeeId:employeeId,targetName:clean(t.name),targetEmail:email,targetLineUserId:lineUserId,title:'主管訊息',body:message,status:'待發送'}), true);
        count++;
      }
    }
    let msg='已送出通知，共 ' + count + ' 筆；LINE 會由後端自動推送。';
    if(skippedLine || skippedEmail) msg += '（略過：LINE ' + skippedLine + ' 筆、Email ' + skippedEmail + ' 筆）';
    return {ok:true,message:msg,batchId,count,skippedLine,skippedEmail};
  }

  fb.handleApi = async function(action,payload){
    const a=clean(action);
    if(a === 'getNotificationV2Settings') return await getNotificationV2Settings(payload || {});
    if(a === 'saveNotificationV2Settings') return await saveNotificationV2Settings(payload || {});
    if(a === 'getNotificationRecipientsV2') return await getNotificationRecipientsV2(payload || {});
    if(a === 'sendManualNotificationV2') return await sendManualNotificationV2(payload || {});
    if(typeof previousHandle === 'function') return await previousHandle(action,payload || {});
    return null;
  };
  fb.__notificationV2BackendBridge20260530 = true;
  global.YZFirebase = fb;
})(window);

/* 員工主檔 / 離職隱藏控管 - Firebase only final bridge 2026-05-30
 * 目的：
 * 1. 新增員工管理中心資料 API。
 * 2. 所有新操作用員工清單預設只回傳「在職、帳號啟用、未隱藏」的人。
 * 3. 離職/隱藏員工資料不刪除，員工管理與歷史查詢可用 includeHidden / includeInactive 顯示。
 */
(function(global){
  const fb = global.YZFirebase || (global.YZFirebase = {});
  if(fb.__employeeMasterControl20260530) return;
  const previousHandle = fb.handleApi;
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ const s=lower(v); return v===true || s==='true' || s==='1' || s==='yes' || s==='y' || s==='是' || s==='啟用' || s==='顯示' || s==='checked'; }
  function falsey(v){ const s=lower(v); return v===false || s==='false' || s==='0' || s==='no' || s==='n' || s==='否' || s==='停用'; }
  function nowId(prefix){ return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); }
  function today(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function nowText(){ const d=new Date(); return d.toLocaleString('zh-TW',{hour12:false}); }
  function readUser(){ try{ return JSON.parse(global.localStorage.getItem('employeeUser') || 'null') || {}; }catch(e){ return {}; } }
  function database(){
    const cfg = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if(!cfg || !global.firebase || !global.firebase.firestore) throw new Error('Firebase 尚未啟用');
    if(!global.firebase.apps || !global.firebase.apps.length) global.firebase.initializeApp(cfg);
    return global.firebase.firestore();
  }
  function serverTs(){ try{ return global.firebase.firestore.FieldValue.serverTimestamp(); }catch(e){ return new Date().toISOString(); } }
  async function all(collection){ const snap=await database().collection(collection).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  async function getDoc(collection,id){ const key=clean(id); if(!key) return null; const doc=await database().collection(collection).doc(key).get(); return doc.exists ? Object.assign({__id:doc.id}, doc.data()||{}) : null; }
  async function setDoc(collection,id,data,merge){ await database().collection(collection).doc(clean(id) || nowId('DOC')).set(data || {}, {merge:merge !== false}); }
  function empIdOf(o){ o=o||{}; return clean(o.employeeId || o.userId || o.id || o.adminId || o['員工ID'] || o['申請人ID'] || o.__id); }
  function emailOf(o){ o=o||{}; return lower(o.email || o.Email || o['Email'] || o.loginAccount || o['登入帳號'] || o['電子郵件']); }
  function nameOf(o){ o=o||{}; return clean(o.name || o['姓名'] || o.employeeName || o['員工姓名'] || o.applicantName || o['申請人']); }
  function identityTypeOf(o){
    const raw=lower((o||{}).identityType || (o||{})['身分類型'] || (o||{})['身份類型'] || (o||{}).identityLabel || (o||{})['員工身分'] || (o||{}).employeeType);
    if(raw==='external' || raw.indexOf('外聘')>=0) return 'external';
    if(raw==='parttime' || raw.indexOf('工讀')>=0 || truthy((o||{}).isPartTime || (o||{})['是否工讀生'])) return 'parttime';
    return 'staff';
  }
  function identityLabelOf(type){ return type==='external'?'外聘老師':(type==='parttime'?'工讀生':'專職員工'); }
  function normalizeAccountStatus(o){
    const raw=clean((o||{}).accountStatus || (o||{})['帳號狀態'] || (o||{}).status || (o||{})['狀態']);
    const s=lower(raw);
    if(!s) return 'active';
    if(['pending','待審核','待主管審核'].indexOf(s)>=0) return 'pending';
    if(['rejected','已駁回','駁回'].indexOf(s)>=0) return 'rejected';
    if(['inactive','disabled','停用','停用登入','不可登入'].indexOf(s)>=0) return 'inactive';
    if(['archived','封存'].indexOf(s)>=0) return 'archived';
    if(['resigned','離職'].indexOf(s)>=0) return 'inactive';
    if(['active','enabled','啟用','是','正常'].indexOf(s)>=0) return 'active';
    return s;
  }
  function normalizeEmploymentStatus(o){
    const raw=clean((o||{}).employmentStatus || (o||{})['任職狀態'] || (o||{}).workStatus || (o||{})['在職狀態']);
    const s=lower(raw);
    if(!s) return 'active';
    if(['resigned','離職','已離職'].indexOf(s)>=0) return 'resigned';
    if(['suspended','暫停','暫停任用','暫停合作'].indexOf(s)>=0) return 'suspended';
    if(['contractorended','contract_ended','合作結束','外聘合作結束'].indexOf(s)>=0) return 'contractorEnded';
    if(['archived','封存'].indexOf(s)>=0) return 'archived';
    if(['active','在職','正常'].indexOf(s)>=0) return 'active';
    return s;
  }
  function hiddenFromLists(o){ return truthy((o||{}).hiddenFromActiveLists || (o||{})['隱藏於日常清單'] || (o||{}).hidden || (o||{})['隱藏']); }
  function isManager(o){ const role=lower((o||{}).role || (o||{})['角色']); return role==='admin' || role==='manager' || truthy((o||{}).showSettingsZone || (o||{})['管理區權限'] || (o||{})['管理權限']); }
  function statusLabel(accountStatus, employmentStatus, hidden){
    if(accountStatus==='pending') return '待審核';
    if(accountStatus==='rejected') return '註冊駁回';
    if(accountStatus==='archived' || employmentStatus==='archived') return '封存';
    if(employmentStatus==='resigned') return '離職';
    if(employmentStatus==='suspended') return '暫停任用';
    if(employmentStatus==='contractorEnded') return '合作結束';
    if(accountStatus==='inactive') return hidden ? '停用 / 隱藏' : '停用登入';
    if(hidden) return '隱藏';
    return '在職';
  }
  function statusReason(row){
    const reasons=[];
    if(row.accountStatus==='pending') reasons.push('註冊尚未審核');
    if(row.accountStatus==='rejected') reasons.push('註冊已駁回');
    if(row.accountStatus==='inactive') reasons.push('帳號不可登入');
    if(row.accountStatus==='archived') reasons.push('帳號已封存');
    if(row.employmentStatus==='resigned') reasons.push('任職狀態為離職');
    if(row.employmentStatus==='suspended') reasons.push('任職狀態為暫停任用');
    if(row.employmentStatus==='contractorEnded') reasons.push('外聘合作已結束');
    if(row.employmentStatus==='archived') reasons.push('任職資料已封存');
    if(row.hiddenFromActiveLists) reasons.push('已隱藏於日常操作清單');
    return reasons;
  }
  function normEmployee(o){
    o=o||{};
    const id=empIdOf(o);
    const type=identityTypeOf(o);
    const accountStatus=normalizeAccountStatus(o);
    const employmentStatus=normalizeEmploymentStatus(o);
    const hidden=hiddenFromLists(o);
    const row={
      __id:clean(o.__id || id), id, employeeId:id,
      name:nameOf(o), email:emailOf(o),
      mobilePhone:clean(o.mobilePhone || o.phone || o['行動電話'] || o['手機']),
      identityType:type, identityLabel:identityLabelOf(type),
      role:lower(o.role || o['角色'] || 'staff') || 'staff', isManager:isManager(o),
      accountStatus, employmentStatus, hiddenFromActiveLists:hidden,
      statusLabel:statusLabel(accountStatus, employmentStatus, hidden),
      lineUserId:clean(o.lineUserId || o['LINE User ID']),
      lineNotifyEnabled:truthy(o.lineNotifyEnabled || o['LINE 通知啟用']),
      hireDate:clean(o.hireDate || o.joinDate || o['到職日']),
      resignedDate:clean(o.resignedDate || o.leaveDate || o['離職日']),
      statusNote:clean(o.statusNote || o['狀態備註'] || o.note || o['備註']),
      createdAtText:clean(o.createdAtText || o.createdAt || o['建立時間']),
      updatedAtText:clean(o.updatedAtText || o.updatedAt || o['更新時間']),
      raw:o
    };
    row.statusReasons=statusReason(row);
    row.isActiveForDailyUse = isActiveEmployee(row);
    return row;
  }
  function isActiveEmployee(row){
    row = row && row.accountStatus ? row : normEmployee(row || {});
    if(!row.id && !row.email) return false;
    if(row.hiddenFromActiveLists) return false;
    if(row.accountStatus !== 'active') return false;
    if(['active',''].indexOf(row.employmentStatus) < 0) return false;
    return true;
  }
  function matchesKeyword(row, keyword){
    if(!keyword) return true;
    const hay=[row.name,row.employeeId,row.email,row.identityLabel,row.statusLabel,row.mobilePhone,row.role].join(' ').toLowerCase();
    return hay.indexOf(keyword)>=0;
  }
  function canInclude(row,payload){
    const mode=clean(payload && payload.statusMode) || clean(payload && payload.filter) || 'active';
    if(payload && (payload.includeHidden === true || payload.includeInactive === true || payload.includeAll === true)) return true;
    if(mode==='all') return true;
    if(mode==='pending') return row.accountStatus==='pending';
    if(mode==='hidden') return row.hiddenFromActiveLists || row.employmentStatus!=='active' || row.accountStatus!=='active';
    if(mode==='inactive') return row.accountStatus!=='active' || row.employmentStatus!=='active' || row.hiddenFromActiveLists;
    return row.isActiveForDailyUse;
  }
  async function employeeRows(payload){
    const keyword=lower(payload && payload.keyword);
    const rows=(await all('employees')).map(normEmployee).filter(r=>(r.id||r.email) && canInclude(r,payload) && matchesKeyword(r,keyword));
    rows.sort((a,b)=>{
      const rank=x=>x.accountStatus==='pending'?0:(x.isActiveForDailyUse?1:2);
      return rank(a)-rank(b) || clean(a.name).localeCompare(clean(b.name),'zh-Hant') || clean(a.employeeId).localeCompare(clean(b.employeeId));
    });
    return rows;
  }
  async function getEmployeeOptions(payload){
    const rows=(await employeeRows(payload||{})).filter(r=>r.id || r.email).map(r=>({
      id:r.id, employeeId:r.employeeId, name:r.name, employeeName:r.name, email:r.email,
      identityType:r.identityType, identityLabel:r.identityLabel, role:r.role,
      accountStatus:r.accountStatus, employmentStatus:r.employmentStatus, hiddenFromActiveLists:r.hiddenFromActiveLists,
      statusLabel:r.statusLabel, lineUserId:r.lineUserId, lineNotifyEnabled:r.lineNotifyEnabled, isManager:r.isManager
    }));
    return {ok:true,rows,employees:rows,list:rows,source:'firebase-employee-master-active-filter'};
  }
  async function getEmployeeManagementData(payload){
    const allRows=(await employeeRows(Object.assign({}, payload||{}, {includeAll:true}))).filter(r=>r.id || r.email);
    const keyword=lower(payload && payload.keyword);
    const mode=clean(payload && payload.statusMode) || 'active';
    let rows=allRows.filter(r=>matchesKeyword(r,keyword));
    if(mode==='active') rows=rows.filter(r=>r.isActiveForDailyUse);
    else if(mode==='pending') rows=rows.filter(r=>r.accountStatus==='pending');
    else if(mode==='hidden') rows=rows.filter(r=>!r.isActiveForDailyUse && r.accountStatus!=='pending' && r.accountStatus!=='rejected');
    else if(mode==='rejected') rows=rows.filter(r=>r.accountStatus==='rejected');
    else if(mode==='all') rows=rows;
    const counts={
      total:allRows.length,
      active:allRows.filter(r=>r.isActiveForDailyUse).length,
      pending:allRows.filter(r=>r.accountStatus==='pending').length,
      hidden:allRows.filter(r=>!r.isActiveForDailyUse && r.accountStatus!=='pending' && r.accountStatus!=='rejected').length,
      rejected:allRows.filter(r=>r.accountStatus==='rejected').length
    };
    return {ok:true,rows,counts,source:'firebase-employee-master'};
  }
  async function updateEmployeeAdminStatus(payload){
    payload=payload||{};
    const key=clean(payload.employeeId || payload.id || payload.__id);
    const email=emailOf(payload);
    if(!key && !email) return {ok:false,message:'缺少員工ID或 Email'};
    let target = key ? await getDoc('employees', key).catch(()=>null) : null;
    if(!target && key){
      const rows=await all('employees');
      target=rows.find(r=>empIdOf(r)===key || clean(r.__id)===key) || null;
    }
    if(!target && email){
      const rows=await all('employees');
      target=rows.find(r=>emailOf(r)===email) || null;
    }
    if(!target) return {ok:false,message:'找不到員工資料'};
    const docId=clean(target.__id || target.employeeId || key);
    const employmentStatus=clean(payload.employmentStatus || normalizeEmploymentStatus(target)) || 'active';
    let accountStatus=clean(payload.accountStatus || normalizeAccountStatus(target)) || 'active';
    let hidden = payload.hiddenFromActiveLists;
    if(hidden === undefined || hidden === null || hidden === '') hidden = hiddenFromLists(target);
    hidden = truthy(hidden);
    if(employmentStatus==='resigned' || employmentStatus==='suspended' || employmentStatus==='contractorEnded'){
      if(accountStatus==='active') accountStatus='inactive';
      hidden = true;
    }
    if(employmentStatus==='archived'){
      accountStatus='archived';
      hidden = true;
    }
    if(employmentStatus==='active' && accountStatus==='active' && falsey(payload.forceHidden)){
      // keep explicit checkbox value; do not force visible if manager intentionally hides an active employee.
    }
    const user=readUser();
    const data={
      accountStatus, employmentStatus, hiddenFromActiveLists:hidden,
      resignedDate:clean(payload.resignedDate), statusNote:clean(payload.statusNote),
      updatedAt:serverTs(), updatedAtText:nowText(), updatedBy:clean(user.id || user.employeeId || user.email),
      source:'employee-admin-status'
    };
    if(!data.resignedDate && employmentStatus==='resigned') data.resignedDate=today();
    await setDoc('employees', docId, data, true);
    return {ok:true,message:'員工狀態已儲存。',employeeId:empIdOf(target),docId,updates:data};
  }
  function sameEmployee(row, emp){
    const id=emp.employeeId || emp.id;
    const email=emp.email;
    const rid=empIdOf(row), remail=emailOf(row);
    return (!!id && rid===id) || (!!email && remail===email) || (!!id && clean(row.targetEmployeeId)===id) || (!!id && clean(row.userId)===id);
  }
  async function getEmployeeHistorySnapshot(payload){
    const employees=(await employeeRows({includeAll:true}));
    const key=clean(payload && (payload.employeeId || payload.id));
    const email=lower(payload && payload.email);
    const emp=employees.find(e=>(key && (e.employeeId===key || e.id===key || e.__id===key)) || (email && e.email===email));
    if(!emp) return {ok:false,message:'找不到員工資料'};
    const collections=[
      ['clockRecords','打卡紀錄'],['clockCorrections','補打卡/打卡修正'],['leaveRequests','請假申請'],['leaveRecords','請假紀錄'],
      ['parttimeRecords','工讀時數'],['temporaryAttendanceRequests','臨時出勤/補登'],['employeeSchedules','班表套用'],['singleDaySchedules','單日班表'],
      ['profileChangeRequests','個資修改'],['certificateApplications','證明申請'],['notificationQueue','通知佇列']
    ];
    const items=[];
    for(const pair of collections){
      const col=pair[0], label=pair[1];
      let rows=[]; try{ rows=await all(col); }catch(e){ rows=[]; }
      const matched=rows.filter(r=>sameEmployee(r,emp));
      items.push({collection:col,label,count:matched.length,latestId:clean((matched[matched.length-1]||{}).__id)});
    }
    return {ok:true,employee:emp,items,source:'firebase-employee-history-snapshot'};
  }
  async function getScheduleSetupData(payload){
    if(typeof previousHandle === 'function'){
      const res=await previousHandle('getScheduleSetupData', payload||{}).catch(()=>null);
      if(res){ const e=await getEmployeeOptions(payload||{}); res.employees=e.rows; res.source=(res.source||'')+' + employee-master-filter'; return res; }
    }
    return null;
  }
  async function getSalarySetupOptions(payload){
    if(typeof previousHandle === 'function'){
      const res=await previousHandle('getSalarySetupOptions', payload||{}).catch(()=>null);
      if(res){
        const active=await getEmployeeOptions(payload||{});
        const keep={}; active.rows.forEach(e=>{ keep[e.id]=true; keep[e.employeeId]=true; });
        res.employees=(res.employees||[]).filter(e=>keep[clean(e.id||e.employeeId)]).map(e=>Object.assign({}, e, active.rows.find(a=>a.id===clean(e.id||e.employeeId))||{}));
        res.source=(res.source||'')+' + employee-master-filter';
        return res;
      }
    }
    return await getEmployeeOptions(payload||{});
  }
  async function filteredPrevious(action,payload){
    if(typeof previousHandle !== 'function') return null;
    const res=await previousHandle(action,payload||{}).catch(()=>null);
    if(!res) return null;
    const active=await getEmployeeOptions(payload||{});
    const keep={}; active.rows.forEach(e=>{ keep[e.id]=true; keep[e.employeeId]=true; if(e.email) keep[e.email]=true; });
    ['employees','rows','list'].forEach(k=>{
      if(Array.isArray(res[k])) res[k]=res[k].filter(e=>{
        const id=clean(e.id||e.employeeId||e.userId||e['員工ID']); const email=emailOf(e);
        return keep[id] || keep[email];
      });
    });
    return res;
  }
  async function getNotificationRecipients(payload){ return await getEmployeeOptions(payload||{}); }
  async function getNotificationRecipientsV2(payload){ return await getEmployeeOptions(payload||{}); }

  fb.handleApi = async function(action,payload){
    const a=clean(action);
    if(a==='getEmployeeManagementData') return await getEmployeeManagementData(payload||{});
    if(a==='updateEmployeeAdminStatus') return await updateEmployeeAdminStatus(payload||{});
    if(a==='getEmployeeHistorySnapshot') return await getEmployeeHistorySnapshot(payload||{});
    if(a==='getEmployeeOptions') return await getEmployeeOptions(payload||{});
    if(a==='getScheduleSetupData') return await getScheduleSetupData(payload||{});
    if(a==='getSalarySetupOptions') return await getSalarySetupOptions(payload||{});
    if(a==='getNotificationRecipients' || a==='getNotificationRecipientsV2') return await getNotificationRecipientsV2(payload||{});
    if(a==='getParttimePayrollAdminData' || a==='getParttimePayrollSummary') return await filteredPrevious(a,payload||{});
    if(typeof previousHandle === 'function') return await previousHandle(action,payload||{});
    return null;
  };
  fb.__employeeMasterControl20260530 = true;
  global.YZFirebase = fb;
})(window);

/* =========================================================
 * 2026-05-30：外聘老師拿貨 / 官網商品搜尋正式改 Firebase-only
 * - 不再回退 GS / Apps Script。
 * - 官網商品搜尋優先走 Firebase Callable Function；沒有 Functions 時改查 Firestore 快取集合。
 * - 詢價、管理回覆、公司優惠商品全部寫入 Firestore。
 * ========================================================= */
(function(global){
  const fb = global.YZFirebase || (global.YZFirebase = {});
  const previousHandle = fb.handleApi;
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ const s=lower(v); return v===true || ['是','yes','true','1','啟用','enabled','active','上架'].indexOf(s)>=0; }
  function falsey(v){ const s=lower(v); return v===false || ['否','no','false','0','停用','disabled','inactive','下架'].indexOf(s)>=0; }
  function pad(n){ return String(n).padStart(2,'0'); }
  function nowText(){ const d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds()); }
  function dateText(){ const d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function money(v){ const n=Number(String(v==null?'':v).replace(/[^0-9.\-]/g,'')); return isFinite(n)?n:0; }
  function priceText(v){ const n=money(v); return n>0 ? ('$'+Math.round(n).toLocaleString('zh-TW')) : ''; }
  function db(){ try{return fb.init && fb.init()}catch(e){ console.warn('[teacher goods firebase init]',e); return null; } }
  function serverTs(){ try{return global.firebase.firestore.FieldValue.serverTimestamp()}catch(e){ return new Date(); } }
  function docId(prefix){ return prefix+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,8); }
  async function all(col){ const d=db(); if(!d) return []; const snap=await d.collection(col).get(); const rows=[]; snap.forEach(x=>rows.push(Object.assign({__id:x.id},x.data()||{}))); return rows; }
  async function setDoc(col,id,data,merge){ const d=db(); if(!d) throw new Error('Firebase 尚未初始化'); await d.collection(col).doc(id).set(data,{merge:merge!==false}); return id; }
  function readUser(){ try{return JSON.parse(localStorage.getItem('employeeUser')||'{}')}catch(e){return {}} }
  function containsKeyword(row, keyword){
    if(!keyword) return true;
    const hay=[row.name,row.itemName,row.category,row.keywords,row.brand,row.description,row.note,row.teacherName,row.sourceType,row.replySummary,row.url,row.productId,row.sku,row.variantSummary].join(' ').toLowerCase();
    return hay.indexOf(keyword)>=0;
  }
  function normalizeGoodsItem(o){
    o=o||{};
    const id=clean(o.itemId || o.goodsId || o.__id || o.id || docId('goods'));
    const teacherPrice=money(o.teacherPrice || o.price || o['老師價']);
    const marketPrice=money(o.marketPrice || o.websiteOriginalPrice || o['市售價'] || o['官網價']);
    let enabled = o.enabled;
    if(enabled===undefined || enabled===null || enabled==='') enabled = !falsey(o['是否上架']);
    enabled = truthy(enabled);
    return Object.assign({}, o, {
      __id:clean(o.__id||id), itemId:id, id,
      name:clean(o.name || o.itemName || o['商品名稱'] || '未命名商品'),
      category:clean(o.category || o['分類']), keywords:clean(o.keywords || o['關鍵字']),
      teacherPrice:teacherPrice || clean(o.teacherPrice || o.price || ''),
      teacherPriceText:priceText(teacherPrice) || clean(o.teacherPriceText || o.priceText || ''),
      price:teacherPrice, priceText:priceText(teacherPrice) || clean(o.priceText || ''),
      marketPrice:marketPrice || clean(o.marketPrice || ''), marketPriceText:priceText(marketPrice) || clean(o.marketPriceText || ''),
      stockStatus:clean(o.stockStatus || o['庫存狀態'] || '需確認'), arrivalDate:clean(o.arrivalDate || o['預計到貨日']), pickupDate:clean(o.pickupDate || o['可取貨日期']),
      offerTerms:clean(o.offerTerms || o['優惠條件']), note:clean(o.note || o.description || o['商品說明']), description:clean(o.description || o.note || o['商品說明']),
      imageUrl:clean(o.imageUrl || o.inquiryImageUrl || o.picture || o.image || o['圖片']),
      sortOrder:money(o.sortOrder || o['排序']), enabled
    });
  }
  function normalizeWebsiteProduct(o){
    o=o||{};
    const id=clean(o.productId || o.websiteProductId || o.itemId || o.sku || o.__id || o.id);
    const rawPrice=o.marketPrice || o.price || o.websiteOriginalPrice || o.salePrice || o['官網價格'] || o['價格'];
    const m=money(rawPrice);
    const variants=Array.isArray(o.variants) ? o.variants.map(v=>({
      id:clean(v.id || v.variantId || v.sku || v.name), name:clean(v.name || v.title || v.optionName || v.sku), sku:clean(v.sku), price:money(v.price || v.marketPrice) || clean(v.price||''), priceText:priceText(v.price || v.marketPrice) || clean(v.priceText||''), imageUrl:clean(v.imageUrl || v.image || o.imageUrl), stockStatus:clean(v.stockStatus || v.inventoryStatus || o.stockStatus)
    })) : [];
    return Object.assign({}, o, {
      __id:clean(o.__id||id), id, productId:id,
      name:clean(o.name || o.title || o.itemName || o['商品名稱'] || '未命名商品'),
      brand:clean(o.brand || o.vendor || o['品牌']), category:clean(o.category || o.productType || o['分類']),
      keywords:clean(o.keywords || o.tags || o['關鍵字']),
      sku:clean(o.sku), url:clean(o.url || o.productUrl || o.websiteProductUrl || o.permalink || o['連結']),
      imageUrl:clean(o.imageUrl || o.image || o.picture || o.cover || o['圖片']),
      marketPrice:m || clean(rawPrice || ''), price:m || clean(rawPrice || ''),
      marketPriceText:priceText(m) || clean(o.marketPriceText || o.priceText || ''),
      priceText:priceText(m) || clean(o.priceText || o.marketPriceText || ''),
      stockStatus:clean(o.stockStatus || o.inventoryStatus || o['庫存狀態'] || '庫存未提供'),
      variantSummary:clean(o.variantSummary || o.optionsText || o['規格']), variants,
      source:'Firebase 官網商品快取'
    });
  }
  function normalizeInquiry(o){
    o=o||{};
    const id=clean(o.inquiryId || o.__id || o.id || docId('inq'));
    const status=clean(o.status || o.replyStatus || o['狀態'] || '待處理') || '待處理';
    const price=money(o.websiteOriginalPrice || o.replyMarketPrice || o.marketPrice);
    const replyParts=[];
    if(clean(o.replyTeacherPrice || o.replyPrice)) replyParts.push('老師價：'+clean(o.replyTeacherPrice || o.replyPrice));
    if(clean(o.replyStock)) replyParts.push('庫存：'+clean(o.replyStock));
    if(clean(o.replyArrivalDate)) replyParts.push('預計到貨：'+clean(o.replyArrivalDate));
    if(clean(o.replyPickupDate)) replyParts.push('可取貨：'+clean(o.replyPickupDate));
    if(clean(o.replyNote)) replyParts.push(clean(o.replyNote));
    const replySummary=clean(o.replySummary) || replyParts.join('\n');
    const isDone = ['已完成','已取消','已結案','取消','完成'].some(x=>status.indexOf(x)>=0);
    const isActive = !isDone;
    return Object.assign({}, o, {
      __id:clean(o.__id||id), id, inquiryId:id,
      teacherId:clean(o.teacherId || o.userId || o.employeeId || o['老師ID']),
      userId:clean(o.userId || o.teacherId || o.employeeId || o['老師ID']),
      teacherName:clean(o.teacherName || o.employeeName || o.name || o['老師姓名'] || '外聘老師'),
      itemId:clean(o.itemId || o.goodsId), itemName:clean(o.itemName || o.name || o.title || o['商品名稱'] || '商品詢價'),
      sourceType:clean(o.sourceType || o.requestType || o['來源'] || '老師主動詢價'),
      imageUrl:clean(o.imageUrl || o.inquiryImageUrl || o.picture || o['圖片']),
      quantity:clean(o.quantity || o.qty || o['數量']), needBy:clean(o.needBy || o.needDate || o['希望拿貨日期']),
      note:clean(o.note || o['備註']), status,
      websiteProductId:clean(o.websiteProductId || o.productId), websiteProductUrl:clean(o.websiteProductUrl || o.url),
      websiteOriginalPrice:price || clean(o.websiteOriginalPrice || ''), websiteOriginalPriceText:priceText(price) || clean(o.websiteOriginalPriceText || ''),
      websiteVariantSummary:clean(o.websiteVariantSummary || o.variantSummary), websiteSource:clean(o.websiteSource || ''),
      replyItemName:clean(o.replyItemName || ''), replyTeacherPrice:clean(o.replyTeacherPrice || o.replyPrice || ''), replyPrice:clean(o.replyPrice || o.replyTeacherPrice || ''), replyMarketPrice:clean(o.replyMarketPrice || ''), replyStock:clean(o.replyStock || ''), replyArrivalDate:clean(o.replyArrivalDate || ''), replyPickupDate:clean(o.replyPickupDate || ''), replyNote:clean(o.replyNote || ''), replySummary,
      createdAt:clean(o.createdAtText || o.createdAt || o['建立時間']), updatedAt:clean(o.updatedAtText || o.updatedAt || ''),
      isActiveForTeacher:isActive && status!=='待處理', displayStatus: status==='待處理'?'等公司回覆':status
    });
  }
  function firebaseProjectId_(){
    const appCfg = (global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG) || cfg || {};
    let projectId = clean(appCfg.projectId || '');
    if(!projectId && global.firebase && global.firebase.app){
      try{ projectId = clean((global.firebase.app().options||{}).projectId || ''); }catch(e){}
    }
    return projectId || 'youzi-c1b74';
  }
  function websiteSearchHttpUrl_(){
    return 'https://us-central1-' + firebaseProjectId_() + '.cloudfunctions.net/searchTeacherWebsiteGoodsHttp';
  }
  function callableRestUrlForWebsiteSearch(){
    return 'https://us-central1-' + firebaseProjectId_() + '.cloudfunctions.net/searchTeacherWebsiteGoods';
  }
  function normalizeWebsiteSearchResponse_(data, source){
    if(data && (Array.isArray(data.rows) || Array.isArray(data.items) || Array.isArray(data.list) || data.ok===true)){
      const rows=(data.rows || data.items || data.list || []).map(normalizeWebsiteProduct);
      return Object.assign({}, data, {ok:data.ok!==false, rows, items:rows, source:source || data.source || 'Firebase Function'});
    }
    return null;
  }
  async function tryWebsiteSearchHttp(payload, previousError){
    const url = websiteSearchHttpUrl_();
    try{
      const resp = await fetch(url, {
        method:'POST',
        mode:'cors',
        cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload||{})
      });
      const raw = await resp.text();
      let parsed = null;
      try{ parsed = JSON.parse(raw || '{}'); }catch(parseErr){ parsed = {raw}; }
      if(!resp.ok){
        const msg = (parsed && (parsed.message || (parsed.error && (parsed.error.message || parsed.error.status)))) || raw || ('HTTP '+resp.status);
        return {ok:false,rows:[],items:[],source:'Firebase Function HTTP searchTeacherWebsiteGoodsHttp',message:'官網商品 HTTP API 呼叫失敗：'+msg,debug:{url,status:resp.status,previousError:previousError||''}};
      }
      const normalized = normalizeWebsiteSearchResponse_(parsed, 'Firebase Function HTTP searchTeacherWebsiteGoodsHttp');
      if(normalized) return normalized;
      return {ok:false,rows:[],items:[],source:'Firebase Function HTTP searchTeacherWebsiteGoodsHttp',message:'官網商品 HTTP API 回傳格式不正確。',debug:{url,status:resp.status,raw:raw.slice(0,500),previousError:previousError||''}};
    }catch(e){
      return {ok:false,rows:[],items:[],source:'Firebase Function HTTP searchTeacherWebsiteGoodsHttp',message:'官網商品 HTTP API 無法呼叫：'+(e.message||String(e)),debug:{url,previousError:previousError||''}};
    }
  }
  async function tryCallableWebsiteSearchByRest(payload, previousError){
    const url = callableRestUrlForWebsiteSearch();
    try{
      const resp = await fetch(url, {
        method:'POST',
        mode:'cors',
        cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({data:payload||{}})
      });
      const raw = await resp.text();
      let parsed = null;
      try{ parsed = JSON.parse(raw || '{}'); }catch(parseErr){ parsed = {raw}; }
      if(!resp.ok){
        const msg = (parsed && parsed.error && (parsed.error.message || parsed.error.status)) || raw || ('HTTP '+resp.status);
        return {ok:false,rows:[],items:[],source:'Firebase Function REST searchTeacherWebsiteGoods',message:'官網商品 Callable REST 呼叫失敗：'+msg,debug:{url,status:resp.status,previousError:previousError||''}};
      }
      const data = parsed && (parsed.result || parsed.data || parsed) || null;
      const normalized = normalizeWebsiteSearchResponse_(data, 'Firebase Function REST searchTeacherWebsiteGoods');
      if(normalized) return normalized;
      return {ok:false,rows:[],items:[],source:'Firebase Function REST searchTeacherWebsiteGoods',message:'官網商品 Callable REST 回傳格式不正確。',debug:{url,status:resp.status,raw:raw.slice(0,500),previousError:previousError||''}};
    }catch(e){
      return {ok:false,rows:[],items:[],source:'Firebase Function REST searchTeacherWebsiteGoods',message:'官網商品 Callable REST 無法呼叫：'+(e.message||String(e)),debug:{url,previousError:previousError||''}};
    }
  }
  async function tryCallableWebsiteSearch(payload){
    let sdkError = '';
    try{
      const app = firebaseApp_();
      if(app && global.firebase && global.firebase.functions){
        let functionsInstance = null;
        try{
          functionsInstance = (global.firebase.app && global.firebase.app().functions) ? global.firebase.app().functions('us-central1') : null;
        }catch(regionErr){ functionsInstance = null; }
        if(!functionsInstance) functionsInstance = global.firebase.functions();
        const fn=functionsInstance.httpsCallable('searchTeacherWebsiteGoods');
        const res=await fn(payload||{});
        const data=res && res.data || null;
        const normalized = normalizeWebsiteSearchResponse_(data, 'Firebase Function searchTeacherWebsiteGoods');
        if(normalized) return normalized;
      }else{
        sdkError = 'firebase-functions SDK 尚未載入或 Firebase 尚未初始化';
      }
    }catch(e){ sdkError = e.message || String(e); console.warn('[teacher goods callable unavailable]', e); }

    // 第二層：專用 HTTP endpoint。這層是為了修正 GitHub Pages 上的 Failed to fetch / CORS 問題。
    const http = await tryWebsiteSearchHttp(payload||{}, sdkError);
    if(http && (http.ok || (http.rows && http.rows.length))) return http;

    // 第三層：保留舊 callable REST 備援，方便還沒部署 HTTP endpoint 的舊環境。
    const rest = await tryCallableWebsiteSearchByRest(payload||{}, (http && http.message) || sdkError);
    if(rest && (rest.ok || (rest.rows && rest.rows.length))) return rest;

    // 都失敗時，回傳較有用的錯誤，讓畫面知道目前是 API 呼叫問題，不是商品不存在。
    return http || rest;
  }
  async function searchFirestoreWebsiteProducts(payload){
    const kw=lower(payload && payload.keyword);
    const limit=Math.max(1, Math.min(50, Number(payload&&payload.limit)||12));
    const collections=['websiteProducts','officialWebsiteProducts','easystoreProducts','websiteGoods','products'];
    let rows=[];
    for(const col of collections){
      try{
        const got=(await all(col)).map(normalizeWebsiteProduct).filter(r=>r.name && containsKeyword(r, kw));
        got.forEach(r=>{ if(!rows.some(x=>(x.productId&&x.productId===r.productId) || (x.url&&x.url===r.url))) rows.push(Object.assign({},r,{cacheCollection:col})); });
      }catch(e){ /* ignore missing collections */ }
    }
    rows.sort((a,b)=>clean(a.name).localeCompare(clean(b.name),'zh-Hant'));
    rows=rows.slice(0,limit);
    return {ok:true,rows,items:rows,source:'Firebase / Firestore 官網商品快取',message:rows.length?'':'目前 Firebase 尚未有官網商品快取；請先同步官網商品到 websiteProducts，或部署 Firebase Function searchTeacherWebsiteGoods。'};
  }
  async function searchTeacherWebsiteGoods(payload){
    const callable=await tryCallableWebsiteSearch(payload||{});
    if(callable) return callable;
    return await searchFirestoreWebsiteProducts(payload||{});
  }
  async function getTeacherGoodsList(payload){
    const kw=lower(payload&&payload.keyword);
    let rows=(await all('teacherGoods')).map(normalizeGoodsItem).filter(r=>r.enabled && containsKeyword(r,kw));
    rows.sort((a,b)=>(a.sortOrder||9999)-(b.sortOrder||9999) || clean(a.name).localeCompare(clean(b.name),'zh-Hant'));
    return {ok:true,rows,items:rows,source:'firebase-teacher-goods'};
  }
  async function getTeacherGoodsAdminData(payload){
    const kw=lower(payload&&payload.keyword);
    let rows=(await all('teacherGoods')).map(normalizeGoodsItem).filter(r=>containsKeyword(r,kw));
    rows.sort((a,b)=>(a.sortOrder||9999)-(b.sortOrder||9999) || clean(a.name).localeCompare(clean(b.name),'zh-Hant'));
    const inquiries=(await all('teacherGoodsInquiry')).map(normalizeInquiry);
    rows=rows.map(r=>Object.assign({},r,{inquiryCount:inquiries.filter(x=>x.itemId===r.itemId || x.itemName===r.name).length}));
    return {ok:true,rows,items:rows,source:'firebase-teacher-goods-admin'};
  }
  async function saveTeacherGoodsItem(payload){
    payload=payload||{};
    const id=clean(payload.itemId) || docId('goods');
    const enabledRaw=payload.enabled;
    const enabled = enabledRaw===undefined || enabledRaw==='' ? true : truthy(enabledRaw);
    const data={
      itemId:id, name:clean(payload.name || payload.itemName), category:clean(payload.category), keywords:clean(payload.keywords),
      teacherPrice:clean(payload.teacherPrice || payload.price), marketPrice:clean(payload.marketPrice), stockStatus:clean(payload.stockStatus || '需確認'),
      arrivalDate:clean(payload.arrivalDate), pickupDate:clean(payload.pickupDate), offerTerms:clean(payload.offerTerms), description:clean(payload.description || payload.note), note:clean(payload.note || payload.description),
      sortOrder:money(payload.sortOrder), enabled, imageUrl:clean(payload.imageUrl), updatedAt:serverTs(), updatedAtText:nowText(), updatedBy:clean((readUser()||{}).id || payload.userId), source:'firebase-teacher-goods-admin'
    };
    if(!data.name) return {ok:false,message:'請輸入商品名稱'};
    if(!payload.itemId){ data.createdAt=serverTs(); data.createdAtText=nowText(); }
    await setDoc('teacherGoods', id, data, true);
    return {ok:true,itemId:id,row:normalizeGoodsItem(data),message:'公司優惠商品已儲存'};
  }
  async function deleteTeacherGoodsItem(payload){
    const id=clean(payload&&payload.itemId); if(!id) return {ok:false,message:'缺少商品ID'};
    await setDoc('teacherGoods', id, {enabled:false, deleted:true, deletedAt:serverTs(), deletedAtText:nowText(), updatedAt:serverTs(), updatedAtText:nowText()}, true);
    return {ok:true,message:'商品已下架 / 刪除'};
  }
  async function submitTeacherGoodsInquiry(payload){
    payload=payload||{};
    const user=readUser();
    const id=docId('inq');
    const sourceType=clean(payload.sourceType || '老師主動詢價');
    const itemName=clean(payload.itemName || payload.name);
    if(!itemName && !clean(payload.note) && !clean(payload.inquiryImageUrl)) return {ok:false,message:'請至少輸入商品名稱、備註或圖片'};
    const data={
      inquiryId:id, userId:clean(payload.userId || user.id || user.employeeId || user.email), teacherId:clean(payload.teacherId || payload.userId || user.id || user.employeeId || user.email), teacherName:clean(payload.teacherName || user.name || user.employeeName || user.email || '管理者代查'),
      sourceType, itemId:clean(payload.itemId), itemName:itemName || '官網商品詢價', imageUrl:clean(payload.inquiryImageUrl || payload.imageUrl), quantity:clean(payload.quantity), needBy:clean(payload.needBy), note:clean(payload.note), status:'待處理',
      websiteProductId:clean(payload.websiteProductId || payload.productId), websiteProductUrl:clean(payload.websiteProductUrl || payload.url), websiteOriginalPrice:clean(payload.websiteOriginalPrice || payload.marketPrice || payload.price), websiteVariantSummary:clean(payload.websiteVariantSummary || payload.variantSummary), websiteSource:clean(payload.websiteSource || (sourceType==='公司官網詢價'?'EasyStore 官網':'')),
      createdAt:serverTs(), createdAtText:nowText(), updatedAt:serverTs(), updatedAtText:nowText(), source:'firebase-teacher-goods-inquiry'
    };
    await setDoc('teacherGoodsInquiry', id, data, true);
    return {ok:true,inquiryId:id,row:normalizeInquiry(data),message:'詢價已送出'};
  }
  async function getTeacherGoodsInquiries(payload){
    const userId=clean(payload&&payload.userId);
    const history=truthy(payload&&payload.historyMode);
    let rows=(await all('teacherGoodsInquiry')).map(normalizeInquiry);
    if(userId) rows=rows.filter(r=>r.userId===userId || r.teacherId===userId);
    if(payload&&payload.startDate) rows=rows.filter(r=>!r.createdAt || r.createdAt.slice(0,10)>=clean(payload.startDate));
    if(payload&&payload.endDate) rows=rows.filter(r=>!r.createdAt || r.createdAt.slice(0,10)<=clean(payload.endDate));
    if(!history) rows=rows.sort((a,b)=>clean(b.createdAt).localeCompare(clean(a.createdAt))).slice(0,80);
    return {ok:true,rows,list:rows,source:'firebase-teacher-goods-inquiries'};
  }
  async function getTeacherGoodsInquiryAdminList(payload){
    payload=payload||{};
    const kw=lower(payload.keyword), src=clean(payload.sourceType), status=clean(payload.status), group=clean(payload.group || '');
    let rows=(await all('teacherGoodsInquiry')).map(normalizeInquiry).filter(r=>containsKeyword(r,kw));
    if(src) rows=rows.filter(r=>r.sourceType===src);
    if(status) rows=rows.filter(r=>r.status===status);
    if(group==='active') rows=rows.filter(r=>!['已完成','已取消','取消','已結案'].includes(r.status));
    if(group==='past') rows=rows.filter(r=>['已完成','已取消','取消','已結案'].includes(r.status));
    rows.sort((a,b)=>clean(b.createdAt).localeCompare(clean(a.createdAt)));
    return {ok:true,rows,list:rows,source:'firebase-teacher-goods-admin-inquiries'};
  }
  async function replyTeacherGoodsInquiry(payload){
    payload=payload||{};
    const id=clean(payload.inquiryId || payload.id); if(!id) return {ok:false,message:'缺少詢價ID'};
    const status=clean(payload.status || '已回覆') || '已回覆';
    const data={
      status, replyItemName:clean(payload.replyItemName), replyTeacherPrice:clean(payload.replyTeacherPrice || payload.replyPrice), replyPrice:clean(payload.replyPrice || payload.replyTeacherPrice), replyMarketPrice:clean(payload.replyMarketPrice), replyStock:clean(payload.replyStock), replyArrivalDate:clean(payload.replyArrivalDate), replyPickupDate:clean(payload.replyPickupDate), replyNote:clean(payload.replyNote), repliedAt:serverTs(), repliedAtText:nowText(), repliedBy:clean((readUser()||{}).id || payload.userId), updatedAt:serverTs(), updatedAtText:nowText()
    };
    const parts=[];
    if(data.replyTeacherPrice) parts.push('老師價：'+data.replyTeacherPrice);
    if(data.replyMarketPrice) parts.push('官網 / 市售價：'+data.replyMarketPrice);
    if(data.replyStock) parts.push('庫存：'+data.replyStock);
    if(data.replyArrivalDate) parts.push('預計到貨：'+data.replyArrivalDate);
    if(data.replyPickupDate) parts.push('可取貨：'+data.replyPickupDate);
    if(data.replyNote) parts.push(data.replyNote);
    data.replySummary=parts.join('\n');
    await setDoc('teacherGoodsInquiry', id, data, true);
    return {ok:true,message:'詢價已回覆',inquiryId:id};
  }
  async function getTeacherGoodsBadgeCounts(payload){
    const userId=clean(payload&&payload.userId);
    const admin=truthy(payload&&payload.admin);
    const inquiries=(await all('teacherGoodsInquiry')).map(normalizeInquiry);
    const goods=(await all('teacherGoods')).map(normalizeGoodsItem).filter(x=>x.enabled);
    const pending=inquiries.filter(r=>!['已完成','已取消','取消','已結案'].includes(r.status));
    const mine=userId?inquiries.filter(r=>r.userId===userId || r.teacherId===userId):[];
    return {ok:true,adminPendingCount:pending.length,teacherActionCount:mine.filter(r=>r.status!=='待處理' && !['已完成','已取消','取消','已結案'].includes(r.status)).length,offerAvailableCount:goods.length};
  }
  fb.handleApi = async function(action,payload){
    const a=clean(action);
    if(a==='searchTeacherWebsiteGoods') return await searchTeacherWebsiteGoods(payload||{});
    if(a==='getTeacherGoodsList') return await getTeacherGoodsList(payload||{});
    if(a==='getTeacherGoodsAdminData') return await getTeacherGoodsAdminData(payload||{});
    if(a==='saveTeacherGoodsItem') return await saveTeacherGoodsItem(payload||{});
    if(a==='deleteTeacherGoodsItem') return await deleteTeacherGoodsItem(payload||{});
    if(a==='submitTeacherGoodsInquiry') return await submitTeacherGoodsInquiry(payload||{});
    if(a==='getTeacherGoodsInquiries') return await getTeacherGoodsInquiries(payload||{});
    if(a==='getTeacherGoodsInquiryAdminList') return await getTeacherGoodsInquiryAdminList(payload||{});
    if(a==='replyTeacherGoodsInquiry') return await replyTeacherGoodsInquiry(payload||{});
    if(a==='getTeacherGoodsBadgeCounts') return await getTeacherGoodsBadgeCounts(payload||{});
    if(typeof previousHandle === 'function') return await previousHandle(action,payload||{});
    return null;
  };
  fb.__teacherGoodsFirebaseOnly20260530 = true;
  global.YZFirebase = fb;
})(window);


/* Notification V3 complete matrix backend 20260531
 * Owner-selected reminder list. Keeps manual LINE / Email as fixed tool, not a setting item.
 */
(function(global){
  const fb = global.YZFirebase || {};
  if(!fb || fb.__notificationV3CompleteBackend20260531) return;
  fb.__notificationV3CompleteBackend20260531 = true;
  const previousHandle = fb.handleApi;
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ return v === true || v === 1 || v === '1' || v === '是' || lower(v) === 'true' || lower(v) === 'yes' || lower(v) === 'on'; }
  function db(){
    const cfg = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if(!cfg || !global.firebase) throw new Error('Firebase 尚未啟用');
    if(!global.firebase.apps.length) global.firebase.initializeApp(cfg);
    return global.firebase.firestore();
  }
  function serverTs(){ try{return global.firebase.firestore.FieldValue.serverTimestamp();}catch(e){return new Date().toISOString();} }
  async function all(col){ const snap = await db().collection(col).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  async function setDoc(col,id,data,merge=true){ await db().collection(col).doc(clean(id)).set(data||{}, {merge}); }
  function settingDocId(moduleKey,eventKey){ return clean(moduleKey) + '__' + clean(eventKey).replace(/[\/#?\[\]]/g,'_'); }
  function mgr(no,key,name,desc,extra){ return Object.assign({no,moduleKey:'',eventKey:key,eventName:name,description:desc,enabled:true,managerLineEnabled:true,managerEmailEnabled:true,employeeLineEnabled:false,employeeEmailEnabled:false}, extra||{}); }
  function emp(no,key,name,desc,extra){ return Object.assign({no,moduleKey:'',eventKey:key,eventName:name,description:desc,enabled:true,managerLineEnabled:false,managerEmailEnabled:false,employeeLineEnabled:true,employeeEmailEnabled:true}, extra||{}); }
  function both(no,key,name,desc,extra){ return Object.assign({no,moduleKey:'',eventKey:key,eventName:name,description:desc,enabled:true,managerLineEnabled:true,managerEmailEnabled:true,employeeLineEnabled:true,employeeEmailEnabled:true}, extra||{}); }
  function overdue(no,key,name,desc){ return mgr(no,key,name,desc,{reviewDeadlineDays:1,settingFields:['reviewDeadlineDays']}); }
  function defaultEvents(moduleKey){
    const defs={
      account:[
        mgr(1,'account.register.submitted','註冊申請送出','員工送出註冊申請後，通知主管審核。'),
        emp(2,'account.register.approved','註冊審核通過','主管通過註冊後，通知員工。'),
        emp(3,'account.register.rejected','註冊審核駁回','主管駁回註冊後，通知申請人。'),
        emp(4,'account.forgotPassword','忘記密碼','使用者申請重設密碼時，通知本人。'),
        emp(5,'account.passwordChanged','密碼修改成功','使用者成功修改密碼後，通知本人。'),
        emp(6,'account.lineBindSuccess','LINE 綁定成功','LINE 綁定成功時，通知本人。',{employeeEmailEnabled:false}),
        emp(7,'account.lineBindFailed','LINE 綁定失敗','LINE 綁定失敗時，通知本人。',{employeeEmailEnabled:false})
      ],
      registration:[
        mgr(1,'account.register.submitted','註冊申請送出','員工送出註冊申請後，通知主管審核。'),
        emp(2,'account.register.approved','註冊審核通過','主管通過註冊後，通知員工。'),
        emp(3,'account.register.rejected','註冊審核駁回','主管駁回註冊後，通知申請人。')
      ],
      profileChange:[
        mgr(9,'profile.change.submitted','個人資料修改申請送出','員工送出個人資料修改申請後，通知主管。'),
        emp(10,'profile.change.approved','個人資料修改核准','主管核准後，通知員工。'),
        emp(11,'profile.change.rejected','個人資料修改駁回','主管駁回後，通知員工。'),
        overdue(12,'profile.change.overdue','個人資料修改逾期未審','待審超過設定天數後，提醒主管。')
      ],
      clock:[
        mgr(13,'clock.correction.submitted','打卡修正申請送出','員工送出打卡修正後，通知主管。'),
        emp(14,'clock.correction.approved','打卡修正核准','主管核准打卡修正後，通知員工。'),
        emp(15,'clock.correction.rejected','打卡修正駁回','主管駁回打卡修正後，通知員工。'),
        overdue(16,'clock.correction.overdue','打卡修正逾期未審','打卡修正超過設定天數未審，提醒主管。'),
        mgr(17,'clock.missing.submitted','補打卡申請送出','員工送出補上班卡或補下班卡後，通知主管。'),
        emp(18,'clock.missing.approved','補打卡核准','主管核准補打卡後，通知員工。'),
        emp(19,'clock.missing.rejected','補打卡駁回','主管駁回補打卡後，通知員工。'),
        overdue(20,'clock.missing.overdue','補打卡逾期未審','補打卡超過設定天數未審，提醒主管。')
      ],
      clockAuto:[
        emp(20,'clock.late.created','遲到紀錄產生','上班打卡被判定遲到時，通知員工本人。',{employeeEmailEnabled:false}),
        emp(21,'clock.workBefore','上班前提醒','依排班時間，在上班前指定分鐘提醒員工打上班卡。',{beforeMinutes:10,settingFields:['beforeMinutes']}),
        emp(23,'clock.workMissingAfter','上班後未打卡提醒','上班後超過指定分鐘仍未打卡，提醒員工。',{afterMinutes:30,settingFields:['afterMinutes']}),
        emp(25,'clock.offTime','表定下班時間提醒','到表定下班時間時，提醒員工打下班卡。'),
        emp(26,'clock.offMissingAfter','下班後未打卡提醒','下班後超過指定分鐘仍未打下班卡，提醒員工。',{afterMinutes:30,settingFields:['afterMinutes']}),
        emp(27,'clock.lateAfterClockIn','遲到後修正提醒','員工上班打卡產生遲到紀錄後，超過設定分鐘仍未送出打卡修正時，提醒員工。',{afterMinutes:30,settingFields:['afterMinutes'],employeeEmailEnabled:false}),
        emp(28,'parttime.hoursMissingAfter','工讀下班後未填時數提醒','工讀生下班後未填工讀時數時，提醒工讀生。',{afterMinutes:30,settingFields:['afterMinutes']}),
        emp(29,'clock.lateAfterOffTime','下班後遲到未修正提醒','員工當日有遲到紀錄，表定下班後超過設定分鐘仍未送出打卡修正時，再提醒員工一次。',{afterMinutes:30,settingFields:['afterMinutes'],employeeEmailEnabled:false})
      ],
      leave:[
        mgr(30,'leave.submitted','請假申請送出','員工送出請假申請後，通知主管。'),
        emp(31,'leave.approved','請假核准','主管核准請假後，通知員工。'),
        emp(32,'leave.rejected','請假駁回','主管駁回請假後，通知員工。'),
        overdue(33,'leave.overdue','請假逾期未審','請假超過設定天數未審，提醒主管。')
      ],
      temporaryAttendance:[
        mgr(36,'temporaryAttendance.submitted','臨時出勤申請送出','員工送出臨時出勤申請後，通知主管。'),
        emp(37,'temporaryAttendance.approved','臨時出勤核准','主管核准臨時出勤後，通知員工。'),
        emp(38,'temporaryAttendance.rejected','臨時出勤駁回','主管駁回臨時出勤後，通知員工。'),
        overdue(39,'temporaryAttendance.overdue','臨時出勤逾期未審','臨時出勤超過設定天數未審，提醒主管。'),
        mgr(40,'parttimeHours.abnormal.submitted','工讀時數異常送出','工讀時數異常或超出排班時數時，通知主管。'),
        emp(41,'parttimeHours.abnormal.approved','工讀時數異常核准','主管核准工讀時數異常後，通知員工。'),
        emp(42,'parttimeHours.abnormal.rejected','工讀時數異常駁回','主管駁回工讀時數異常後，通知員工。'),
        overdue(43,'parttimeHours.abnormal.overdue','工讀時數異常逾期未審','工讀時數異常超過設定天數未審，提醒主管。')
      ],
      task:[
        emp(44,'task.published','交辦事項發布','主管發布交辦事項後，通知被交辦人。'),
        emp(45,'task.midReminder','交辦事項中段提醒','交辦事項進行到中段時，提醒被交辦人。'),
        emp(46,'task.deadlineReminder','交辦事項截止提醒','交辦事項到截止時間時，提醒被交辦人。'),
        mgr(47,'task.overdue','交辦事項逾期未完成','交辦事項逾期未完成時，通知主管。'),
        mgr(48,'task.completed','交辦事項完成','被交辦人完成事項後，通知主管。'),
        emp(49,'task.returned','交辦事項退回 / 要求重做','主管退回或要求重做時，通知被交辦人。')
      ],
      announcement:[
        emp(50,'announcement.published','公告發布','公告發布後，通知指定對象。'),
        emp(51,'announcement.unreadReminder','公告未讀提醒','公告發布後仍未讀，依設定天數提醒未讀者。',{unreadReminderDays:1,settingFields:['unreadReminderDays']})
      ],
      contractor:[
        emp(57,'contractor.contract.open','外聘合約開放簽署','外聘合約開放簽署時，通知老師。'),
        emp(58,'contractor.contract.dueSoon','外聘合約即將到期未簽','合約即將到期仍未簽署時，提醒老師。'),
        overdue(59,'contractor.contract.overdue','外聘合約逾期未簽','合約逾期未簽時，通知主管。'),
        mgr(60,'contractor.contract.signed','外聘老師完成簽署','外聘老師完成合約簽署後，通知主管。'),
        mgr(61,'contractor.goodsInquiry.submitted','老師送出拿貨詢價','老師送出拿貨或官網商品詢價後，通知主管。'),
        emp(61,'contractor.goodsInquiry.replied','主管回覆拿貨詢價','主管回覆拿貨詢價後，通知老師。')
      ],
      certificate:[
        mgr(65,'certificate.submitted','證明申請送出','在職證明或教學證明送出後，通知主管。'),
        emp(66,'certificate.approved','證明申請核准','在職證明或教學證明核准後，通知申請人。'),
        emp(67,'certificate.rejected','證明申請退回 / 駁回','在職證明或教學證明退回或駁回後，通知申請人。'),
        overdue(68,'certificate.overdue','證明申請逾期未審','證明申請超過設定天數未審，提醒主管。')
      ],
      recruitment:[
        mgr(72,'recruitment.submitted','應聘資料送出','應聘老師送出資料後，通知主管。'),
        emp(73,'recruitment.preliminaryApproved','應聘資料初審通過','應聘資料初審通過後，通知應聘者。'),
        emp(74,'recruitment.rejected','應聘資料退回 / 不通過','應聘資料退回或不通過後，通知應聘者。'),
        overdue(75,'recruitment.overdue','應聘資料逾期未審','應聘資料超過設定天數未審，提醒主管。'),
        emp(76,'recruitment.supplementRequired','應聘資料補件提醒','需要應聘者補件時，通知應聘者。')
      ],
      salary:[
        emp(78,'salary.statementChanged','薪資明細異動','薪資明細被調整後，通知員工。'),
        emp(79,'salary.insuranceChanged','投保薪資設定異動','勞保 / 健保 / 投保薪資設定異動後，通知員工。')
      ],
      dailySummary:[
        mgr(86,'summary.dailyPending','每日待審核摘要','每天固定整理待審核事項給主管。',{reviewDeadlineDays:1,settingFields:['reviewDeadlineDays']})
      ]
    };
    return (defs[moduleKey]||[]).map(function(r){ return Object.assign({}, r, {moduleKey:moduleKey, source:'notification-v3-default'}); });
  }
  async function getNotificationV2SettingsV3(payload){
    const moduleKey=clean(payload && payload.moduleKey);
    if(!moduleKey) return {ok:false,message:'缺少提醒分類',rows:[]};
    const defaults=defaultEvents(moduleKey);
    const rows=(await all('notificationV2Settings').catch(()=>[])).filter(r=>clean(r.moduleKey)===moduleKey);
    const map={};
    defaults.forEach(d=>{ map[d.eventKey]=Object.assign({},d); });
    rows.forEach(r=>{ const k=clean(r.eventKey || r.__id); if(k) map[k]=Object.assign({}, map[k]||{}, r, {moduleKey,eventKey:k}); });
    const ordered=defaults.map(d=>map[d.eventKey]).filter(Boolean);
    Object.keys(map).forEach(k=>{ if(!ordered.some(x=>x.eventKey===k)) ordered.push(map[k]); });
    return {ok:true,title:'',rows:ordered};
  }
  async function saveNotificationV2SettingsV3(payload){
    const moduleKey=clean(payload && payload.moduleKey);
    const rows=Array.isArray(payload && payload.rows) ? payload.rows : [];
    if(!moduleKey) return {ok:false,message:'缺少提醒分類'};
    for(const raw of rows){
      const eventKey=clean(raw && raw.eventKey); if(!eventKey) continue;
      const row=Object.assign({}, raw, {moduleKey,eventKey,updatedAt:serverTs(),source:'notification-v3-settings'});
      await setDoc('notificationV2Settings', settingDocId(moduleKey,eventKey), row, true);
    }
    const enabledRows=rows.filter(r=>r && r.enabled !== false);
    await setDoc('notificationFeatureSettings', moduleKey, {
      featureCode:moduleKey, featureName:moduleKey, enabled:enabledRows.length>0,
      notifyManagerLine:enabledRows.some(r=>r.managerLineEnabled===true),
      notifyManagerEmail:enabledRows.some(r=>r.managerEmailEnabled===true),
      notifyEmployeeLine:enabledRows.some(r=>r.employeeLineEnabled===true),
      notifyEmployeeEmail:enabledRows.some(r=>r.employeeEmailEnabled===true),
      reviewDeadlineDays:Number((enabledRows.find(r=>r.reviewDeadlineDays!=null)||{}).reviewDeadlineDays || 1) || 1,
      beforeMinutes:Number((enabledRows.find(r=>r.beforeMinutes!=null)||{}).beforeMinutes || 10) || 10,
      afterMinutes:Number((enabledRows.find(r=>r.afterMinutes!=null)||{}).afterMinutes || 30) || 30,
      updatedAt:serverTs(), source:'notification-v3-bridge'
    }, true);
    return {ok:true,message:'提醒設定已儲存。逾期天數與打卡提醒分鐘數也已同步。'};
  }
  fb.handleApi = async function(action,payload){
    if(action === 'getNotificationV2Settings') return await getNotificationV2SettingsV3(payload||{});
    if(action === 'saveNotificationV2Settings') return await saveNotificationV2SettingsV3(payload||{});
    if(previousHandle) return previousHandle(action,payload);
    throw new Error('Firebase API 尚未支援：'+action);
  };
  global.YZFirebase = fb;
})(window);


/* =========================================================
 * 外聘老師合約：Firebase / Firestore 專用讀寫補強
 * - 合約設定：teacherContractSettings/{year or default}
 * - 簽署紀錄：teacherContractLogs/{recordId}
 * - 不再依賴 GS 儲存合約設定與簽署紀錄
 * ========================================================= */
(function(global){
  const fb = global.YZFirebase || {};
  if(!fb.enabled || fb.__teacherContractFirestorePatched) return;
  fb.__teacherContractFirestorePatched = true;
  const oldHandle = fb.handleApi;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function nowText(){ const d=new Date(); const p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds()); }
  function today(){ return nowText().slice(0,10); }
  function rocParts(dateText){ const d=new Date((dateText || today())+'T00:00:00'); if(isNaN(d.getTime())) return {year:'',month:'',day:''}; return {year:String(d.getFullYear()-1911),month:String(d.getMonth()+1),day:String(d.getDate())}; }
  function db(){ return fb.init && fb.init(); }
  async function getDoc(col,id){ const d=db(); if(!d) throw new Error('Firebase 尚未啟用'); const doc=await d.collection(col).doc(clean(id)).get(); return doc.exists ? Object.assign({__id:doc.id}, doc.data()||{}) : null; }
  async function setDoc(col,id,data,merge=true){ const d=db(); if(!d) throw new Error('Firebase 尚未啟用'); await d.collection(col).doc(clean(id)).set(Object.assign({}, data, {updatedAt:firebase.firestore.FieldValue.serverTimestamp()}), {merge}); }
  async function all(col){ const d=db(); if(!d) throw new Error('Firebase 尚未啟用'); const snap=await d.collection(col).get(); const rows=[]; snap.forEach(x=>rows.push(Object.assign({__id:x.id}, x.data()||{}))); return rows; }

  const defaultContractText = `一、委任關係\n甲方委任乙方擔任外聘授課老師，乙方同意依甲方課程安排、教學規範及學生需求提供教學服務。\n\n二、契約期間\n本契約期間自【合約開始日期】起至【合約結束日期】止。契約期滿如雙方同意，得另行續約。\n\n三、授課項目\n乙方授課項目為【授課項目】。實際授課時間、地點、學生名單及課程安排，由甲方依營運需求與乙方協調。\n\n四、教學與管理配合\n乙方應依甲方教學品質要求、課程進度、學生安全與場地管理規範執行教學。乙方不得擅自更改課程、私自收費或以甲方學生資料作其他用途。\n\n五、費用與結算\n授課鐘點、報酬、請款或結算方式，依雙方另行約定或甲方公告之規則辦理。\n\n六、保密與個資\n乙方因教學或合作所知悉之學生資料、家長資料、營運資訊、教材內容及其他未公開資料，均應負保密義務。\n\n七、終止與其他\n任一方如需提前終止合作，應提前通知對方並完成既有課程、交接與費用確認。未盡事宜，雙方得另以書面或電子紀錄補充之。`;

  function normalizeSetting(o){
    o=o||{};
    const y=clean(o.year || o.contractYear || o.__id || new Date().getFullYear());
    const text=clean(o.contractText || o.contractTemplateHtml || o.contractHtml || '') || defaultContractText;
    return {
      settingId:clean(o.settingId || o.__id || y || 'default'),
      year:y,
      contractName:clean(o.contractName || o.title || '外聘老師年度委任契約'),
      partyAName:clean(o.partyAName || '台中市私立凱立音樂短期補習班'),
      partyATaxId:clean(o.partyATaxId || o.taxId || ''),
      partyAOwner:clean(o.partyAOwner || '黃銘廷'),
      partyAAddress:clean(o.partyAAddress || '台中市豐原區圓環東路347號1至2樓'),
      startDate:clean(o.startDate || ''),
      endDate:clean(o.endDate || ''),
      schoolStampUrl:clean(o.schoolStampUrl || 'blue_stamp_transparent.png'),
      ownerStampUrl:clean(o.ownerStampUrl || 'red_stamp_transparent.png'),
      seamStampUrl:clean(o.seamStampUrl || ''),
      contractText:text,
      contractTemplateHtml:text,
      contractHtml:text,
      enabled:o.enabled !== false
    };
  }
  async function latestSetting(year){
    const y=clean(year || new Date().getFullYear());
    let s=await getDoc('teacherContractSettings', y).catch(()=>null);
    if(!s) s=await getDoc('teacherContractSettings', 'default').catch(()=>null);
    if(!s){
      s=normalizeSetting({year:y});
      await setDoc('teacherContractSettings', y, Object.assign({}, s, {source:'firebase-teacher-contract-default', createdAt:firebase.firestore.FieldValue.serverTimestamp()}));
    }
    return normalizeSetting(Object.assign({}, s, {year:clean(s.year||y)}));
  }
  async function getTeacherContractAdminConfig(payload){
    const setting=await latestSetting(payload && payload.year);
    return {ok:true,setting,message:'合約設定已讀取'};
  }
  async function saveTeacherContractSetting(payload){
    const y=clean(payload && payload.year) || String(new Date().getFullYear());
    const id=clean(payload && payload.settingId) || y;
    const setting=normalizeSetting(Object.assign({}, payload, {settingId:id, year:y}));
    await setDoc('teacherContractSettings', id, Object.assign({}, setting, {source:'firebase-teacher-contract-setting', updatedBy:clean(payload && payload.userId)}));
    if(id!==y) await setDoc('teacherContractSettings', y, Object.assign({}, setting, {settingId:y, source:'firebase-teacher-contract-setting'}));
    return {ok:true,message:'外聘老師合約設定已儲存到 Firebase。',settingId:id,setting};
  }
  function normalizeLog(o){
    o=o||{};
    return {
      recordId:clean(o.recordId || o.__id),
      year:clean(o.year || ''),
      teacherId:clean(o.teacherId || o.employeeId || o.userId),
      teacherName:clean(o.teacherName || o.name || o['姓名']),
      email:lower(o.email || o.teacherEmail || o['Email']),
      idNumber:clean(o.idNumber || o.teacherIdNumber || o['身分證字號']),
      address:clean(o.address || o.teacherAddress || o['地址']),
      course:clean(o.course || o.teacherCourse || o['授課項目']),
      status:clean(o.status || o.signStatus || '已簽署'),
      signDate:clean(o.signDate || (clean(o.signedAtText || o.createdAtText).slice(0,10))),
      signTime:clean(o.signTime || (clean(o.signedAtText || o.createdAtText).slice(11,19))),
      signatureUrl:clean(o.signatureUrl || o.signatureDataUrl),
      pdfUrl:clean(o.pdfUrl || ''),
      contractName:clean(o.contractName || o.title || '')
    };
  }
  async function getTeacherContractAdminList(payload){
    const y=clean(payload && payload.year);
    let rows=(await all('teacherContractLogs')).map(normalizeLog);
    if(y) rows=rows.filter(r=>!r.year || r.year===y);
    rows.sort((a,b)=>((b.signDate+' '+b.signTime).localeCompare(a.signDate+' '+a.signTime)));
    return {ok:true,rows,list:rows};
  }
  async function getTeacherContracts(payload){
    const uid=clean(payload && payload.userId); const email=lower(payload && payload.email);
    let rows=(await all('teacherContractLogs')).map(normalizeLog);
    if(uid || email) rows=rows.filter(r=>(uid && (r.teacherId===uid || r.recordId.indexOf(uid)>=0)) || (email && r.email===email));
    rows.sort((a,b)=>((b.signDate+' '+b.signTime).localeCompare(a.signDate+' '+a.signTime)));
    return {ok:true,rows,contracts:rows};
  }
  async function getTeacherContractStatus(payload){
    const setting=await latestSetting((payload && payload.year) || new Date().getFullYear());
    const uid=clean(payload && payload.userId); const email=lower(payload && payload.email);
    const rows=(await all('teacherContractLogs')).map(normalizeLog).filter(r=>r.year===setting.year && ((uid && r.teacherId===uid) || (email && r.email===email)));
    rows.sort((a,b)=>((b.signDate+' '+b.signTime).localeCompare(a.signDate+' '+a.signTime)));
    return {ok:true,contract:setting,signed:rows.length>0,record:rows[0]||null};
  }
  async function submitTeacherContractSignature(payload){
    const userId=clean(payload && payload.userId); const signDate=clean(payload && payload.signDate) || today();
    const y=clean(payload && payload.year) || signDate.slice(0,4) || String(new Date().getFullYear());
    const setting=await latestSetting(y);
    const id='TC_'+(userId||'TEACHER')+'_'+Date.now();
    const roc=rocParts(signDate);
    const row={
      recordId:id, year:setting.year, settingId:setting.settingId, teacherId:userId, employeeId:userId,
      teacherName:clean(payload && payload.teacherName), email:lower(payload && payload.teacherEmail),
      idNumber:clean(payload && payload.teacherIdNumber), address:clean(payload && payload.teacherAddress), course:clean(payload && payload.teacherCourse),
      signDate, signTime:nowText().slice(11,19), signedAtText:nowText(), signedAt:firebase.firestore.FieldValue.serverTimestamp(),
      status:'已簽署', signatureDataUrl:clean(payload && payload.signatureDataUrl), signatureUrl:clean(payload && payload.signatureDataUrl),
      contractName:setting.contractName, contractSnapshot:setting, signRocYear:roc.year, signMonth:roc.month, signDay:roc.day,
      source:'firebase-teacher-contract-signature'
    };
    await setDoc('teacherContractLogs', id, row);
    return {ok:true,message:'合約已簽署並儲存到 Firebase。',recordId:id,record:normalizeLog(row)};
  }
  async function resendTeacherContractPdf(payload){
    return {ok:true,message:'Firebase 已保留簽署紀錄；PDF 重寄功能需另接 Email / 檔案服務。'};
  }

  fb.handleApi = async function(action,payload){
    const a=clean(action);
    try{
      if(a==='getTeacherContractAdminConfig') return await getTeacherContractAdminConfig(payload||{});
      if(a==='saveTeacherContractSetting') return await saveTeacherContractSetting(payload||{});
      if(a==='getTeacherContractAdminList') return await getTeacherContractAdminList(payload||{});
      if(a==='getTeacherContracts') return await getTeacherContracts(payload||{});
      if(a==='getTeacherContractStatus') return await getTeacherContractStatus(payload||{});
      if(a==='submitTeacherContractSignature') return await submitTeacherContractSignature(payload||{});
      if(a==='resendTeacherContractPdf') return await resendTeacherContractPdf(payload||{});
    }catch(e){ return {ok:false,message:e.message||String(e)}; }
    if(typeof oldHandle==='function') return await oldHandle(action,payload||{});
    return null;
  };
  global.YZFirebase = fb;
})(window);


/* =========================================================
 * 外聘老師合約年度版本管理 V2
 * - 年度合約草稿 / 發布 / 封存
 * - 發布給全部或指定外聘老師
 * - 老師待簽署 / 已簽署歷史
 * - 簽署時保存合約快照，不受未來修改影響
 * - 主要集合：teacherContractTemplates / teacherContractAssignments / teacherContractLogs
 * ========================================================= */
(function(global){
  const fb = global.YZFirebase || {};
  if(!fb.enabled || fb.__teacherContractVersionManagerV2) return;
  fb.__teacherContractVersionManagerV2 = true;
  const oldHandle = fb.handleApi;
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ const s=lower(v); return v===true || ['是','yes','true','1','啟用','enabled','active'].indexOf(s)>=0; }
  function pad(n){ return String(n).padStart(2,'0'); }
  function nowDate(){ const d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function nowText(){ const d=new Date(); return nowDate()+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds()); }
  function db(){ return fb.init && fb.init(); }
  function fs(){ return global.firebase && global.firebase.firestore; }
  function serverTime(){ return fs() ? fs().FieldValue.serverTimestamp() : new Date(); }
  async function all(col){ const d=db(); if(!d) throw new Error('Firebase 尚未啟用'); const snap=await d.collection(col).get(); const rows=[]; snap.forEach(x=>rows.push(Object.assign({__id:x.id}, x.data()||{}))); return rows; }
  async function get(col,id){ const d=db(); if(!d) throw new Error('Firebase 尚未啟用'); const doc=await d.collection(col).doc(clean(id)).get(); return doc.exists ? Object.assign({__id:doc.id}, doc.data()||{}) : null; }
  async function set(col,id,data,merge=true){ const d=db(); if(!d) throw new Error('Firebase 尚未啟用'); await d.collection(col).doc(clean(id)).set(Object.assign({}, data, {updatedAt:serverTime()}), {merge}); }
  async function update(col,id,data){ const d=db(); if(!d) throw new Error('Firebase 尚未啟用'); await d.collection(col).doc(clean(id)).set(Object.assign({}, data, {updatedAt:serverTime()}), {merge:true}); }
  function fmtDate(v){ if(!v) return ''; if(v && typeof v.toDate==='function') v=v.toDate(); if(v instanceof Date && !isNaN(v.getTime())) return v.getFullYear()+'-'+pad(v.getMonth()+1)+'-'+pad(v.getDate()); const s=clean(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0,10) : s; }
  function fmtDateTime(v){ if(!v) return ''; if(v && typeof v.toDate==='function') v=v.toDate(); if(v instanceof Date && !isNaN(v.getTime())) return v.getFullYear()+'-'+pad(v.getMonth()+1)+'-'+pad(v.getDate())+' '+pad(v.getHours())+':'+pad(v.getMinutes())+':'+pad(v.getSeconds()); return clean(v); }
  function isHiddenEmployee(o){
    const account=lower(o.accountStatus || o['帳號狀態'] || 'active');
    const employment=lower(o.employmentStatus || o['任職狀態'] || 'active');
    const hidden=truthy(o.hiddenFromActiveLists || o['隱藏於日常清單'] || o.isHidden || o['隱藏']);
    if(hidden) return true;
    if(['pending','rejected','inactive','disabled','archived','停用','封存','待審核','駁回','註冊駁回'].indexOf(account)>=0) return true;
    if(['resigned','inactive','suspended','archived','contractorended','離職','停用','暫停任用','封存','外聘合作結束'].indexOf(employment)>=0) return true;
    return false;
  }
  function identityOf(o){
    const raw=lower(o.identityType || o['身分類型'] || o.type || o['身份類型']);
    if(['external','teacher','contractor','外聘老師','外聘'].indexOf(raw)>=0) return 'external';
    if(['parttime','工讀生','工讀'].indexOf(raw)>=0) return 'parttime';
    return 'staff';
  }
  function teacherRow(o){
    o=o||{};
    const id=clean(o.employeeId || o['員工ID'] || o.id || o.__id);
    return { id, teacherId:id, employeeId:id, name:clean(o.name || o['姓名'] || '未命名老師'), email:lower(o.email || o['Email']), lineUserId:clean(o.lineUserId || o['LINE User ID']), lineNotifyEnabled:truthy(o.lineNotifyEnabled || o['LINE 通知啟用']), accountStatus:clean(o.accountStatus || o['帳號狀態'] || 'active'), employmentStatus:clean(o.employmentStatus || o['任職狀態'] || 'active') };
  }
  async function activeExternalTeachers(){
    const rows=(await all('employees')).filter(o=>identityOf(o)==='external' && !isHiddenEmployee(o)).map(teacherRow);
    rows.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hant'));
    return rows;
  }
  const defaultContractText = `一、委任關係\n甲方委任乙方擔任外聘授課老師，乙方同意依甲方課程安排、教學規範及學生需求提供教學服務。\n\n二、契約期間\n本契約期間自【合約開始日期】起至【合約結束日期】止。契約期滿如雙方同意，得另行續約。\n\n三、授課項目\n乙方授課項目為【授課項目】。實際授課時間、地點、學生名單及課程安排，由甲方依營運需求與乙方協調。\n\n四、教學與管理配合\n乙方應依甲方教學品質要求、課程進度、學生安全與場地管理規範執行教學。乙方不得擅自更改課程、私自收費或以甲方學生資料作其他用途。\n\n五、費用與結算\n授課鐘點、報酬、請款或結算方式，依雙方另行約定或甲方公告之規則辦理。\n\n六、保密與個資\n乙方因教學或合作所知悉之學生資料、家長資料、營運資訊、教材內容及其他未公開資料，均應負保密義務。\n\n七、終止與其他\n任一方如需提前終止合作，應提前通知對方並完成既有課程、交接與費用確認。未盡事宜，雙方得另以書面或電子紀錄補充之。`;
  function normalizeTemplate(o){
    o=o||{};
    const year=clean(o.year || o.contractYear || new Date().getFullYear());
    const id=clean(o.contractId || o.templateId || o.settingId || o.__id || ('TCY_'+year));
    const status=clean(o.status || o.publishStatus || 'draft') || 'draft';
    const text=clean(o.contractText || o.contractTemplateHtml || o.contractHtml || '') || defaultContractText;
    return { contractId:id, templateId:id, settingId:id, year, version:clean(o.version || 'v1'), contractName:clean(o.contractName || o.title || `${year} 年度外聘老師合作契約`), title:clean(o.title || o.contractName || `${year} 年度外聘老師合作契約`), status, statusLabel:status==='published'?'已發布':(status==='archived'?'已封存':'草稿'), partyAName:clean(o.partyAName || '台中市私立凱立音樂短期補習班'), partyATaxId:clean(o.partyATaxId || o.taxId || ''), partyAOwner:clean(o.partyAOwner || '黃銘廷'), partyAAddress:clean(o.partyAAddress || '台中市豐原區圓環東路347號1至2樓'), startDate:fmtDate(o.startDate || ''), endDate:fmtDate(o.endDate || ''), schoolStampUrl:clean(o.schoolStampUrl || 'kaili-school-seal.png'), ownerStampUrl:clean(o.ownerStampUrl || 'personal-seal.png'), seamStampUrl:clean(o.seamStampUrl || o.schoolStampUrl || 'kaili-school-seal.png'), contractText:text, contractTemplateHtml:text, contractHtml:text, publishedAtText:fmtDateTime(o.publishedAtText || o.publishedAt || ''), createdAtText:fmtDateTime(o.createdAtText || o.createdAt || '') };
  }
  async function getTemplateByYear(year){
    const y=clean(year || new Date().getFullYear());
    let t=await get('teacherContractTemplates', 'TCY_'+y).catch(()=>null);
    if(!t) t=await get('teacherContractSettings', y).catch(()=>null);
    if(!t) t=await get('teacherContractSettings', 'default').catch(()=>null);
    if(!t){
      t=normalizeTemplate({year:y, contractId:'TCY_'+y});
      await set('teacherContractTemplates', t.contractId, Object.assign({}, t, {createdAt:serverTime(), createdAtText:nowText(), source:'firebase-contract-default'}));
    }
    return normalizeTemplate(Object.assign({}, t, {year:y, contractId:clean(t.contractId||t.__id||'TCY_'+y)}));
  }
  async function getTeacherContractAdminConfig(payload){
    const setting=await getTemplateByYear(payload && payload.year);
    const teachers=await activeExternalTeachers();
    const templates=(await all('teacherContractTemplates')).map(normalizeTemplate).sort((a,b)=>String(b.year).localeCompare(String(a.year)) || String(b.version).localeCompare(String(a.version)));
    return {ok:true,setting,teachers,templates,message:'年度合約設定已讀取'};
  }
  async function saveTeacherContractSetting(payload){
    const year=clean(payload && payload.year) || String(new Date().getFullYear());
    const id=clean(payload && (payload.contractId || payload.templateId || payload.settingId)) || ('TCY_'+year);
    const t=normalizeTemplate(Object.assign({}, payload, {contractId:id, year, status:clean(payload.status || 'draft') || 'draft'}));
    const row=Object.assign({}, t, {updatedBy:clean(payload.userId), updatedAtText:nowText(), source:'firebase-contract-template'});
    await set('teacherContractTemplates', id, row);
    // 相容舊頁面 / 舊 API
    await set('teacherContractSettings', year, Object.assign({}, row, {settingId:id}));
    return {ok:true,message:'年度合約草稿已儲存到 Firebase。',settingId:id,contractId:id,setting:t};
  }
  function assignmentId(contractId, teacherId){ return clean(contractId)+'_'+clean(teacherId); }
  async function publishTeacherContract(payload){
    const contractId=clean(payload.contractId || payload.settingId || ('TCY_'+clean(payload.year || new Date().getFullYear())));
    const t=normalizeTemplate(await get('teacherContractTemplates', contractId));
    if(!t.contractId) throw new Error('找不到要發布的合約草稿');
    let teachers=await activeExternalTeachers();
    const selected=(payload.teacherIds||[]).map(clean).filter(Boolean);
    if(selected.length) teachers=teachers.filter(x=>selected.indexOf(x.teacherId)>=0 || selected.indexOf(x.email)>=0);
    if(!teachers.length) throw new Error('沒有可發布的外聘老師。');
    const publishedAtText=nowText();
    await set('teacherContractTemplates', contractId, {status:'published', publishedAt:serverTime(), publishedAtText, publishedBy:clean(payload.userId)});
    await set('teacherContractSettings', t.year, Object.assign({}, t, {status:'published', publishedAtText, settingId:contractId}));
    let count=0;
    for(const teacher of teachers){
      const id=assignmentId(contractId, teacher.teacherId);
      const old=await get('teacherContractAssignments', id).catch(()=>null);
      if(old && clean(old.status)==='signed') continue;
      await set('teacherContractAssignments', id, {assignmentId:id, contractId, templateId:contractId, year:t.year, version:t.version, contractName:t.contractName, teacherId:teacher.teacherId, employeeId:teacher.teacherId, teacherName:teacher.name, email:teacher.email, status:'pending', statusLabel:'待簽署', publishedAt:serverTime(), publishedAtText, contractSnapshot:t, source:'firebase-contract-assignment'});
      count++;
    }
    return {ok:true,message:`已發布 ${t.year} 年度合約，建立 ${count} 筆待簽署任務。`,count};
  }
  function normalizeAssignment(o){
    o=o||{};
    const snap=normalizeTemplate(o.contractSnapshot || {});
    return { assignmentId:clean(o.assignmentId || o.__id), recordId:clean(o.recordId || o.assignmentId || o.__id), contractId:clean(o.contractId || o.templateId || snap.contractId), year:clean(o.year || snap.year), version:clean(o.version || snap.version), contractName:clean(o.contractName || snap.contractName), teacherId:clean(o.teacherId || o.employeeId), employeeId:clean(o.teacherId || o.employeeId), teacherName:clean(o.teacherName || o.name || '未命名老師'), email:lower(o.email || o.teacherEmail), status:clean(o.status || 'pending'), statusLabel:clean(o.statusLabel || (clean(o.status)==='signed'?'已簽署':'待簽署')), publishedAtText:fmtDateTime(o.publishedAtText || o.publishedAt || ''), signedAtText:fmtDateTime(o.signedAtText || o.signedAt || ''), signDate:fmtDate(o.signDate || ''), signTime:clean(o.signTime || ''), signatureUrl:clean(o.signatureUrl || o.signatureDataUrl || ''), idNumber:clean(o.idNumber || o.teacherIdNumber || ''), address:clean(o.address || o.teacherAddress || ''), course:clean(o.course || o.teacherCourse || ''), contractSnapshot:o.contractSnapshot || snap };
  }
  async function getTeacherContractAdminList(payload){
    const year=clean(payload && payload.year);
    let rows=(await all('teacherContractAssignments')).map(normalizeAssignment);
    if(year) rows=rows.filter(r=>r.year===year);
    rows.sort((a,b)=>String(a.teacherName).localeCompare(String(b.teacherName),'zh-Hant'));
    return {ok:true,rows,list:rows};
  }
  async function getTeacherContracts(payload){
    const uid=clean(payload && payload.userId); const email=lower(payload && payload.email);
    let assigns=(await all('teacherContractAssignments')).map(normalizeAssignment).filter(r=>(uid && r.teacherId===uid) || (email && r.email===email));
    assigns.sort((a,b)=>String(b.year).localeCompare(String(a.year)) || String(b.publishedAtText).localeCompare(String(a.publishedAtText)));
    return {ok:true,rows:assigns,contracts:assigns};
  }
  async function getTeacherContractStatus(payload){
    const uid=clean(payload && payload.userId); const email=lower(payload && payload.email);
    let rows=(await all('teacherContractAssignments')).map(normalizeAssignment).filter(r=>(uid && r.teacherId===uid) || (email && r.email===email));
    rows.sort((a,b)=>String(b.year).localeCompare(String(a.year)) || String(b.publishedAtText).localeCompare(String(a.publishedAtText)));
    const pending=rows.filter(r=>r.status!=='signed' && r.status!=='archived');
    const signed=rows.filter(r=>r.status==='signed');
    const active=pending[0] || null;
    const contract=active ? normalizeTemplate(active.contractSnapshot) : (rows[0] ? normalizeTemplate(rows[0].contractSnapshot) : await getTemplateByYear(new Date().getFullYear()));
    return {ok:true,contract,assignment:active,pendingAssignments:pending,signedRecords:signed,history:rows,signed:!active && signed.length>0,record:signed[0]||null};
  }
  async function submitTeacherContractSignature(payload){
    const assignmentIdValue=clean(payload.assignmentId || payload.recordId);
    const assignment=assignmentIdValue ? normalizeAssignment(await get('teacherContractAssignments', assignmentIdValue)) : null;
    if(!assignment || !assignment.assignmentId) throw new Error('找不到待簽署合約任務，請重新整理頁面。');
    const snapshot=normalizeTemplate(assignment.contractSnapshot);
    const signDate=clean(payload.signDate) || nowDate();
    const d=new Date(signDate+'T00:00:00');
    const rocYear=!isNaN(d.getTime()) ? String(d.getFullYear()-1911) : '';
    const signMonth=!isNaN(d.getTime()) ? String(d.getMonth()+1) : '';
    const signDay=!isNaN(d.getTime()) ? String(d.getDate()) : '';
    const row={status:'signed', statusLabel:'已簽署', signDate, signTime:nowText().slice(11,19), signedAt:serverTime(), signedAtText:nowText(), teacherName:clean(payload.teacherName || assignment.teacherName), email:lower(payload.teacherEmail || assignment.email), idNumber:clean(payload.teacherIdNumber), address:clean(payload.teacherAddress), course:clean(payload.teacherCourse), signatureDataUrl:clean(payload.signatureDataUrl), signatureUrl:clean(payload.signatureDataUrl), contractSnapshot:snapshot, signedSnapshot:snapshot, signRocYear:rocYear, signMonth, signDay, source:'firebase-contract-signature'};
    await update('teacherContractAssignments', assignment.assignmentId, row);
    await set('teacherContractLogs', assignment.assignmentId, Object.assign({}, assignment, row, {recordId:assignment.assignmentId}));
    return {ok:true,message:'合約已簽署並儲存到 Firebase。',recordId:assignment.assignmentId,record:Object.assign({}, assignment,row)};
  }
  async function archiveTeacherContract(payload){
    const contractId=clean(payload.contractId || payload.settingId);
    if(!contractId) throw new Error('缺少合約ID');
    await update('teacherContractTemplates', contractId, {status:'archived', archivedAt:serverTime(), archivedAtText:nowText(), archivedBy:clean(payload.userId)});
    return {ok:true,message:'合約已封存。'};
  }
  async function resendTeacherContractPdf(){ return {ok:true,message:'簽署紀錄已保存在 Firebase；若要寄送 PDF，可從簽署紀錄列印或另接 Email 服務。'}; }

  fb.handleApi = async function(action,payload){
    const a=clean(action);
    try{
      if(a==='getTeacherContractAdminConfig') return await getTeacherContractAdminConfig(payload||{});
      if(a==='saveTeacherContractSetting') return await saveTeacherContractSetting(payload||{});
      if(a==='publishTeacherContract') return await publishTeacherContract(payload||{});
      if(a==='archiveTeacherContract') return await archiveTeacherContract(payload||{});
      if(a==='getTeacherContractAdminList') return await getTeacherContractAdminList(payload||{});
      if(a==='getTeacherContracts') return await getTeacherContracts(payload||{});
      if(a==='getTeacherContractStatus') return await getTeacherContractStatus(payload||{});
      if(a==='submitTeacherContractSignature') return await submitTeacherContractSignature(payload||{});
      if(a==='resendTeacherContractPdf') return await resendTeacherContractPdf(payload||{});
    }catch(e){ return {ok:false,message:e.message||String(e)}; }
    if(typeof oldHandle==='function') return await oldHandle(action,payload||{});
    return null;
  };
  global.YZFirebase = fb;
})(window);

/* 請假簽核：待簽核與歷史紀錄 Firebase 同步修正 */
(function(global){
  const fb = global.YZFirebase;
  if(!fb || fb.__leaveApprovalHistoryPatch) return;
  fb.__leaveApprovalHistoryPatch = true;
  const oldHandle = fb.handleApi;
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function db(){
    const cfg = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if(!cfg || !global.firebase) throw new Error('Firebase 尚未啟用');
    if(!global.firebase.apps.length) global.firebase.initializeApp(cfg);
    return global.firebase.firestore();
  }
  async function all(col){ const snap = await db().collection(col).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  function dateText(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') v = v.toDate();
    if(v instanceof Date && !isNaN(v.getTime())){
      const y=v.getFullYear(), m=String(v.getMonth()+1).padStart(2,'0'), d=String(v.getDate()).padStart(2,'0');
      return `${y}-${m}-${d}`;
    }
    const s=clean(v);
    const m=s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if(m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    return s;
  }
  function dateTimeText(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') v = v.toDate();
    if(v instanceof Date && !isNaN(v.getTime())){
      const y=v.getFullYear(), m=String(v.getMonth()+1).padStart(2,'0'), d=String(v.getDate()).padStart(2,'0');
      const hh=String(v.getHours()).padStart(2,'0'), mm=String(v.getMinutes()).padStart(2,'0');
      return `${y}-${m}-${d} ${hh}:${mm}`;
    }
    return clean(v);
  }
  function statusOf(o){
    const s=clean(o.status || o['狀態'] || o.reviewStatus || o.approvalStatus);
    if(!s) return '待審核';
    if(['pending','待主管審核','審核中','待簽核'].includes(lower(s))) return '待審核';
    if(['approved','approve','核准','同意'].includes(lower(s))) return '已核准';
    if(['rejected','reject','駁回','退回'].includes(lower(s))) return '已駁回';
    return s;
  }
  function normalizeLeave(o){
    o=o||{};
    const start = dateText(o.startDate || o.leaveDate || o.date || o['開始日期'] || o['請假日期']);
    const end = dateText(o.endDate || o['結束日期']) || start;
    const reason = clean(o.reason || o.leaveName || o['請假原因'] || o.leaveType || '請假');
    const hours = Number(o.hours || o.leaveHours || o['請假時數'] || 0) || 0;
    const startTime = clean(o.startTime || o['請假開始時間']);
    const endTime = clean(o.endTime || o['請假結束時間']);
    const simpleText = clean(o.simpleText) || `${reason}${hours ? '｜' + hours + '小時' : ''}${startTime || endTime ? '｜' + startTime + '-' + endTime : ''}`;
    return {
      requestId: clean(o.requestId || o.leaveId || o['請假ID'] || o.__id),
      employeeId: clean(o.employeeId || o.userId || o['員工ID']),
      name: clean(o.name || o.employeeName || o['姓名'] || o.applicantName || '未命名'),
      email: lower(o.email || o.Email || o['Email']),
      reason,
      leaveCode: clean(o.leaveCode || o['假別代碼']),
      leaveDate: start,
      startDate: start,
      endDate: end,
      startTime,
      endTime,
      session: clean(o.session || o['請假時段']),
      hours,
      note: clean(o.note || o['備註']),
      attachmentUrl: clean(o.attachmentUrl || o['附件連結']),
      status: statusOf(o),
      rejectReason: clean(o.rejectReason || o['駁回理由'] || o.reasonText),
      requestedAt: dateTimeText(o.requestedAt || o.createdAt || o['建立時間']),
      createdAt: dateTimeText(o.createdAt || o['建立時間']),
      reviewedAt: dateTimeText(o.reviewedAt || o.approvedAt || o.rejectedAt || o.updatedAt || o['審核時間']),
      updatedAt: dateTimeText(o.updatedAt || o['更新時間']),
      simpleText
    };
  }
  function isPending(o){ return statusOf(o) === '待審核'; }
  async function getPendingLeaveApprovals(){
    const rows = (await all('leaveRequests').catch(()=>[])).map(normalizeLeave).filter(isPending);
    rows.sort((a,b)=>String(a.leaveDate||'').localeCompare(String(b.leaveDate||'')) || String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
    return {ok:true, rows, source:'firebase-leave-approval-unified'};
  }
  async function getAdminLeaveRecords(){
    const rows = (await all('leaveRequests').catch(()=>[])).map(normalizeLeave).filter(r=>r.requestId || r.employeeId || r.name);
    rows.sort((a,b)=>String(b.leaveDate||'').localeCompare(String(a.leaveDate||'')) || String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    return {ok:true, rows, source:'firebase-leave-history-unified'};
  }
  fb.handleApi = async function(action,payload){
    const a = clean(action);
    if(a === 'getPendingLeaveApprovals') return await getPendingLeaveApprovals(payload||{});
    if(a === 'getAdminLeaveRecords') return await getAdminLeaveRecords(payload||{});
    if(typeof oldHandle === 'function') return await oldHandle(action,payload||{});
    return null;
  };
})(window);

/* =========================================================
 * LINE 自動通知總修正版：主管檢查工具 2026-06-06
 * ---------------------------------------------------------
 * 提供主管區檢查：管理者收件人、LINE 綁定狀態、近期通知佇列與測試通知。
 * 實際自動通知由 Firebase Functions 觸發器建立 notificationQueue。
 * ========================================================= */
(function(global){
  const fb = global.YZFirebase || {};
  if(!fb || fb.__lineAutoNotifyHealth20260606) return;
  fb.__lineAutoNotifyHealth20260606 = true;
  const previousHandle = fb.handleApi;

  function cfg(){ return (global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG) || {}; }
  function enabled(){ return !!(global.APP_CONFIG && global.APP_CONFIG.FIREBASE_ENABLED && cfg().projectId && global.firebase && global.firebase.firestore); }
  function db(){ if(!enabled()) throw new Error('Firebase 尚未啟用'); const apps=global.firebase.apps||[]; const app=apps.length?apps[0]:global.firebase.initializeApp(cfg()); return global.firebase.firestore(app); }
  function clean(v){ return String(v==null?'':v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ const s=lower(v); return v===true || v===1 || ['1','true','yes','on','是','啟用','enabled','active'].indexOf(s)>=0; }
  function no(v){ const s=lower(v); return v===false || v===0 || ['0','false','no','off','否','停用','disabled'].indexOf(s)>=0; }
  function serverTs(){ return global.firebase.firestore.FieldValue.serverTimestamp(); }
  function nowId(prefix){ return (prefix||'ID')+'_'+Date.now()+'_'+Math.random().toString(36).slice(2,8); }
  async function all(col, limit){ const snap=await db().collection(col).limit(limit||800).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id},doc.data()||{}))); return rows; }
  function pick(o,keys,fb){ o=o||{}; for(const k of keys){ if(o[k]!==undefined && o[k]!==null && clean(o[k])!=='') return o[k]; } return fb==null?'':fb; }
  function lineOf(o){ return clean(pick(o,['lineUserId','LINE User ID','LINE使用者ID','lineId','targetLineUserId','LINEUserId'],'')); }
  function emailOf(o){ return lower(pick(o,['email','Email','登入帳號','targetEmail'],'')); }
  function nameOf(o){ return clean(pick(o,['name','姓名','employeeName','displayName','targetName'],'')); }
  function empIdOf(o){ return clean(pick(o,['employeeId','員工ID','id','userId','teacherId'],o&&o.__id)); }
  function lineEnabled(o){ const v=pick(o,['lineNotifyEnabled','LINE 通知啟用','notifyLine','lineEnabled'],''); if(v===''||v==null) return !!lineOf(o); return truthy(v); }
  function identity(o){ const raw=lower(pick(o,['identityType','身分類型','identityLabel','employeeType','role','角色'],'')); if(raw.indexOf('工讀')>=0||raw==='parttime'||truthy(o.isPartTime||o['是否工讀生'])) return 'parttime'; if(raw.indexOf('外聘')>=0||raw==='external'||raw==='teacher'||raw==='contractor') return 'external'; if(raw.indexOf('管理')>=0||raw.indexOf('主管')>=0||raw==='admin'||raw==='manager') return 'manager'; return 'staff'; }
  function isActive(o){ const a=lower(pick(o,['accountStatus','帳號狀態'],'active')); const e=lower(pick(o,['employmentStatus','任職狀態','在職狀態'],'active')); return ['rejected','inactive','disabled','archived','pending','停用','駁回','封存'].indexOf(a)<0 && ['resigned','inactive','suspended','archived','contractorended','離職','暫停任用','封存','外聘合作結束'].indexOf(e)<0; }
  function isManager(o){ const role=lower(pick(o,['role','角色','identityType','身分類型'],'')); if(['admin','manager','owner','supervisor','管理者','主管','負責人'].indexOf(role)>=0) return true; if(role.indexOf('admin')>=0||role.indexOf('manager')>=0||role.indexOf('管理')>=0||role.indexOf('主管')>=0) return true; return ['showSettingsZone','isManager','isAdmin','canApprove','canReview','canSeeApproval','canManage','可看設定區','可看審核區','可操作假勤制度','是否顯示設定區','管理權限'].some(k=>truthy(o[k])); }
  function norm(o){ return {employeeId:empIdOf(o), name:nameOf(o)||emailOf(o)||empIdOf(o), email:emailOf(o), lineUserId:lineOf(o), lineNotifyEnabled:lineEnabled(o), identityType:identity(o), isManager:isManager(o), active:isActive(o)}; }
  function uniq(rows){ const out=[], seen={}; (rows||[]).forEach(r=>{ const k=clean(r.employeeId||r.email||r.lineUserId||r.name); if(!k||seen[k]) return; seen[k]=1; out.push(r); }); return out; }
  async function managerRows(){ const rows=[]; try{ (await all('employees',1000)).map(norm).filter(x=>x.active&&x.isManager).forEach(x=>rows.push(x)); }catch(e){} for(const col of ['managerAccounts','adminAccounts','managers','managerUsers','adminUsers']){ try{ (await all(col,300)).map(norm).filter(x=>x.active).forEach(x=>rows.push(Object.assign(x,{identityType:'manager',isManager:true,sourceCollection:col}))); }catch(e){} } return uniq(rows); }
  async function employeeRows(){ try{ return (await all('employees',1200)).map(norm).filter(x=>x.active); }catch(e){ return []; } }
  async function recentQueue(){ try{ return (await all('notificationQueue',120)).map(r=>({queueId:clean(r.queueId||r.__id), eventKey:clean(r.eventKey), channel:clean(r.channel), targetName:clean(r.targetName), status:clean(r.status), lastError:clean(r.lastError), createdAt:String(r.createdAtText||'')})); }catch(e){ return []; } }
  async function getLineAutoNotificationStatus(){ const [mgrs, emps, queue]=await Promise.all([managerRows(),employeeRows(),recentQueue()]); const byType={staff:0,parttime:0,external:0,manager:0}; const byTypeLine={staff:0,parttime:0,external:0,manager:0}; emps.forEach(e=>{ byType[e.identityType]=(byType[e.identityType]||0)+1; if(e.lineUserId&&e.lineNotifyEnabled) byTypeLine[e.identityType]=(byTypeLine[e.identityType]||0)+1; }); return {ok:true, managers:mgrs, employees:emps, queue, counts:{managers:mgrs.length, managersWithLine:mgrs.filter(x=>x.lineUserId&&x.lineNotifyEnabled).length, activeEmployees:emps.length, activeEmployeesWithLine:emps.filter(x=>x.lineUserId&&x.lineNotifyEnabled).length, byType, byTypeLine, recentQueue:queue.length}}; }
  async function sendLineAutoNotificationTest(payload){ payload=payload||{}; const targets = payload.target==='managers' ? await managerRows() : [norm((function(){try{return JSON.parse(localStorage.getItem('employeeUser')||'{}')}catch(e){return {}}})())]; const channels=['line']; let count=0, skipped=0; const batchId=nowId('LINE_AUTO_TEST'); for(const t of targets){ if(!t.lineUserId){ skipped++; continue; } const id=batchId+'_'+(t.employeeId||t.email||t.lineUserId).replace(/[^a-zA-Z0-9_-]/g,'_')+'_line'; await db().collection('notificationQueue').doc(id).set({queueId:id,batchId,eventKey:'manual.lineAutoHealthTest',eventName:'LINE自動通知測試',moduleKey:'healthCheck',channel:'line',targetEmployeeId:t.employeeId,targetName:t.name,targetEmail:t.email,targetLineUserId:t.lineUserId,title:'LINE自動通知測試',body:clean(payload.message)||'這是 LINE 自動通知總修正版的測試訊息。',status:'待發送',createdAt:serverTs(),source:'line-auto-health-check'}, {merge:true}); count++; } return {ok:true,message:'已建立測試通知 '+count+' 筆，略過 '+skipped+' 筆。',count,skipped}; }

  fb.handleApi = async function(action,payload){
    const a=clean(action);
    if(a==='getLineAutoNotificationStatus') return await getLineAutoNotificationStatus(payload||{});
    if(a==='sendLineAutoNotificationTest') return await sendLineAutoNotificationTest(payload||{});
    if(typeof previousHandle==='function') return await previousHandle(action,payload||{});
    return null;
  };
  global.YZFirebase = fb;
})(window);
