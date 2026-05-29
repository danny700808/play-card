
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
    if(schedule.clockType === '標準打卡') return !!(schedule.startTime && schedule.endTime);
    if(schedule.clockType === '特殊打卡') return true;
    return false;
  }
  function allowedClockTypes(schedule){
    if(!schedule || !schedule.hasSchedule) return [];
    const type = clean(schedule.clockType);
    if(type === '標準打卡'){
      const out = schedule.startTime && schedule.endTime ? ['標準打卡'] : [];
      if(schedule.allowSpecial) out.push('特殊打卡');
      return out;
    }
    if(type === '特殊打卡') return ['特殊打卡'];
    return [];
  }
  function scheduleKey(schedule){
    if(!schedule) return '';
    return [clean(schedule.source), clean(schedule.id || schedule.assignmentId || schedule.recordId), clean(schedule.date), clean(schedule.startTime), clean(schedule.endTime), clean(schedule.clockType)].join('|');
  }
  function scheduleSummary(schedule){
    if(!schedule || !schedule.hasSchedule) return '今日沒有排班';
    const parts = [schedule.clockType || '班表'];
    if(schedule.startTime && schedule.endTime) parts.push(schedule.startTime + '-' + schedule.endTime);
    if(schedule.sourceLabel) parts.push(schedule.sourceLabel);
    if(schedule.allowSpecial && schedule.clockType === '標準打卡') parts.push('可特殊打卡');
    return parts.join('｜');
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
    }else if(out.clockType === '標準打卡' && Number.isFinite(startM)){
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
      out.statusText = '可使用特殊打卡';
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
      message: message || '今天沒有排班，請改用「補登 / 臨時出勤」提出申請。'
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
    if((schedule.allowedClockTypes || []).indexOf(mode) < 0){
      return {ok:false, message:'選定班表不開放「' + mode + '」。'};
    }
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
    const candidates = schedules.filter(s => (s.allowedClockTypes || []).indexOf(mode) >= 0);
    if(!candidates.length) return {ok:false, message:'今日班表不開放「' + mode + '」。'};
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

/* 打卡紀錄讀取修正：讓今日／昨日與歷史查詢直接讀 Firebase clockRecords */
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
    const parts = [clean(s.sourceLabel || s.scheduleSourceLabel || '班表')];
    if(s.startTime || s.endTime) parts.push((shortTime(s.startTime) || '--:--') + ' - ' + (shortTime(s.endTime) || '--:--'));
    if(s.clockType) parts.push(clean(s.clockType));
    return parts.join('｜');
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
  function pendingMissingCorrection(corrections, issue, action){
    return (corrections || []).find(c => isPending(c) && c.requestKind === 'missingClock' && c.scheduleDate === issue.date && clean(c.scheduleKey) === clean(issue.scheduleKey) && clean(c.correctAction) === clean(action)) || null;
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
  async function getEditableClockHistory(payload){
    const employeeId = employeeIdFrom(payload);
    const rows = sortClockRows((await readClockRows(payload)).map(normalizeClock).filter(r => r.date === today() || r.date === addDays(today(), -1)));
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
        const actions = [];
        if(shortTime(s.startTime)) actions.push('上班打卡');
        if(shortTime(s.endTime)) actions.push('下班打卡');
        if(!actions.length) continue;
        const missing = actions.filter(action => actionIsDue(s, action, dateKey) && !existingRecordFor(s, action, clockRows));
        if(!missing.length) continue;
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
          missingActions:missing,
          pendingCorrection:false,
          pendingCorrectionId:'',
          pendingLeave:false,
          pendingLeaveId:''
        };
        const pm = missing.map(action => pendingMissingCorrection(corrections, issue, action)).find(Boolean);
        const pl = pendingLeaveForDate(leaves, dateKey);
        if(pm){ issue.pendingCorrection = true; issue.pendingCorrectionId = pm.requestId; }
        if(pl){ issue.pendingLeave = true; issue.pendingLeaveId = clean(pl.requestId || pl.leaveId || pl.__id); }
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
      if(pending) return {ok:false, message:'這一段班表已經送出補打卡申請，請等待主管審核。', requestId:pending.requestId};
      const clockRows = await readClockRows({employeeId, userId:employeeId}).catch(()=>[]);
      const snap = Object.assign({}, p.scheduleSnapshot || {}, {date:correctDate, scheduleKey});
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
      return {ok:true, message:'補打卡申請已送出，請等待主管審核。', requestId, row};
    }

    const originalRecordId = clean(p.originalRecordId);
    if(!originalRecordId) return {ok:false, message:'缺少原始打卡紀錄，無法修正。'};
    const original = await findClockById(originalRecordId);
    if(!original) return {ok:false, message:'找不到原始打卡紀錄，請重新整理後再試。'};
    const norm = normalizeClock(original);
    const pending = pendingRecordCorrection(corrections, norm.recordId || originalRecordId);
    if(pending) return {ok:false, message:'這筆打卡紀錄已送出修正申請，請等待主管審核。', requestId:pending.requestId};
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
    return {ok:true, message:'打卡修正申請已送出，請等待主管審核。', requestId, row};
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

    if(c.requestKind === 'missingClock' || !c.originalRecordId){
      const existing = await readClockRows({employeeId:c.employeeId, userId:c.employeeId}).then(rows => existingRecordFor({date:c.correctDate, scheduleKey:c.scheduleKey, startTime:c.scheduleStartTime, endTime:c.scheduleEndTime, clockType:c.correctionType}, c.correctAction, rows)).catch(()=>null);
      let appliedRecordId = existing ? clean(existing.recordId || existing.id) : '';
      if(!existing){
        const state = statusBySchedule(c.correctAction, c.correctionType, c.correctTime, c.scheduleStartTime, c.scheduleEndTime, true);
        appliedRecordId = 'CLK_SUP_' + c.employeeId + '_' + c.correctDate.replace(/-/g,'') + '_' + (c.correctAction.indexOf('下班') >= 0 ? 'OUT' : 'IN') + '_' + Date.now();
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
          note:'補打卡核准：' + c.reason,
          '備註':'補打卡核准：' + c.reason,
          sourceIp:'補打卡核准',
          '來源IP':'補打卡核准',
          isSupplement:true,
          scheduleLinked:true,
          scheduleKey:c.scheduleKey,
          scheduleDate:c.scheduleDate || c.correctDate,
          scheduleStartTime:c.scheduleStartTime,
          scheduleEndTime:c.scheduleEndTime,
          scheduleSource:c.scheduleSource,
          scheduleSourceLabel:c.scheduleSourceLabel,
          scheduleTemplateName:c.scheduleTemplateName,
          correctionRequestId:requestId,
          source:'firebase-clock-flow-approved-missing',
          createdAt:serverTs()
        });
      }
      await docUpdate('clockCorrections', requestId, {status:'已核准','狀態':'已核准', reviewedAt:serverTs(), reviewedBy:clean(reviewer.id || reviewer.employeeId || reviewer.adminId), appliedRecordId, source:'firebase-clock-flow'});
      return {ok:true, message:'補打卡已核准，並已補進正式打卡紀錄。', appliedRecordId};
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

/* 2026-05-29：我的資料 / 薪資投保單一 Firebase 主資料版
 * 規則：
 * 1. 員工端只讀 Firebase employees，不再讀 GS、不掃舊薪資集合、不查 salarySetup / employeeConfigMap。
 * 2. 管理端薪資投保設定直接寫回 employees/{employeeId}。
 * 3. 如果舊資料沒有寫進 employees，就由管理端重新儲存一次建立新資料。
 */
(function(global){
  const fb = global.YZFirebase;
  if(!fb || fb.__canonicalEmployeeProfileSalaryV1) return;
  fb.__canonicalEmployeeProfileSalaryV1 = true;
  const previousHandle = fb.handleApi;

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ const s=lower(v); return v===true || ['是','yes','true','1','啟用','enabled','active','在保'].indexOf(s)>=0; }
  function number(v){
    if(typeof v === 'number') return isFinite(v) ? v : 0;
    const s = clean(v).replace(/[,，元$\s]/g, '');
    const n = Number(s);
    return isFinite(n) ? n : 0;
  }
  function money(v){ const n=number(v); return n ? Math.round(n).toLocaleString('zh-TW') + ' 元' : ''; }
  function dateText(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') return dateText(v.toDate());
    if(v instanceof Date && !isNaN(v.getTime())) return v.getFullYear() + '-' + String(v.getMonth()+1).padStart(2,'0') + '-' + String(v.getDate()).padStart(2,'0');
    const s=clean(v);
    if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    return s;
  }
  function serverTs(){ return global.firebase && global.firebase.firestore ? global.firebase.firestore.FieldValue.serverTimestamp() : new Date(); }
  function database(){
    const d = fb.init ? fb.init() : null;
    if(!d) throw new Error('Firebase 尚未啟用');
    return d;
  }
  async function getDoc(collection, id){
    const key = clean(id);
    if(!key) return null;
    const snap = await database().collection(collection).doc(key).get();
    return snap.exists ? Object.assign({__id:snap.id}, snap.data() || {}) : null;
  }
  async function queryFirst(collection, field, value){
    const val = clean(value);
    if(!val) return null;
    const snap = await database().collection(collection).where(field, '==', val).limit(1).get();
    let row = null;
    snap.forEach(doc => { if(!row) row = Object.assign({__id:doc.id}, doc.data() || {}); });
    return row;
  }
  async function allEmployees(){
    const snap = await database().collection('employees').get();
    const rows=[];
    snap.forEach(doc => rows.push(Object.assign({__id:doc.id}, doc.data() || {})));
    return rows;
  }
  function candidateIds(payload){
    const p = payload || {};
    const user = (function(){ try{return JSON.parse(localStorage.getItem('employeeUser') || 'null') || {};}catch(e){return {};} })();
    const ids = [
      p.employeeId, p.userId, p.id,
      user.employeeId, user.id,
      p['員工ID'], user['員工ID']
    ].map(clean).filter(Boolean);
    return Array.from(new Set(ids));
  }
  function candidateEmail(payload){
    const p = payload || {};
    const user = (function(){ try{return JSON.parse(localStorage.getItem('employeeUser') || 'null') || {};}catch(e){return {};} })();
    return lower(p.email || p.Email || user.email || user.Email || '');
  }
  async function findEmployee(payload){
    const ids = candidateIds(payload);
    for(const id of ids){ const row = await getDoc('employees', id); if(row) return row; }
    for(const id of ids){ const row = await queryFirst('employees', 'employeeId', id); if(row) return row; }
    for(const id of ids){ const row = await queryFirst('employees', 'id', id); if(row) return row; }
    const email = candidateEmail(payload);
    if(email){
      const byEmail = await queryFirst('employees', 'email', email); if(byEmail) return byEmail;
      const byEmail2 = await queryFirst('employees', 'Email', email); if(byEmail2) return byEmail2;
    }
    return null;
  }
  function maskId(v){
    const s=clean(v).toUpperCase();
    if(!s) return '';
    return s.length <= 4 ? s : s.slice(0,1) + '*****' + s.slice(-4);
  }
  function identityTypeOf(o){
    const raw = lower(o.identityType || o['身分類型']);
    if(raw === 'parttime' || raw === 'staff' || raw === 'external' || raw === 'admin') return raw;
    if(/工讀/.test(clean(o.identityLabel || o['身分']))) return 'parttime';
    if(truthy(o.isPartTime || o['是否工讀生'])) return 'parttime';
    return 'staff';
  }
  function identityLabelOf(type){
    if(type === 'parttime') return '工讀生';
    if(type === 'external') return '外聘老師';
    if(type === 'admin') return '管理者';
    return '專職員工';
  }
  function normalizeProfile(o){
    o = o || {};
    const type = identityTypeOf(o);
    const employeeId = clean(o.employeeId || o.id || o['員工ID'] || o.__id);
    return {
      employeeId,
      id: employeeId,
      name: clean(o.name || o['姓名']),
      email: lower(o.email || o.Email || o['Email']),
      identityType: type,
      identityLabel: identityLabelOf(type),
      isPartTime: type === 'parttime',
      birthDate: dateText(o.birthDate || o['出生年月日']),
      idNumberMasked: clean(o.idNumberMasked) || maskId(o.idNumber || o['身分證字號']),
      hireDate: dateText(o.hireDate || o.joinDate || o['到職日']),
      mobilePhone: clean(o.mobilePhone || o.phone || o['行動電話']),
      address: clean(o.address || o.contactAddress || o['聯絡地址']),
      emergencyContact: clean(o.emergencyContact || o['緊急聯絡人']),
      emergencyPhone: clean(o.emergencyPhone || o['緊急聯絡人電話']),
      accountStatus: clean(o.accountStatus || o.status || o['帳號狀態'] || 'active')
    };
  }
  function sumItems(items){
    if(!Array.isArray(items)) return 0;
    return items.reduce((sum, item) => sum + number(item && (item.amount || item.value || item.price)), 0);
  }
  function lineItemsText(items){
    if(!Array.isArray(items)) return '';
    return items.map(item => {
      const name = clean(item && (item.name || item.title || item.label));
      const amount = money(item && (item.amount || item.value || item.price));
      if(name && amount) return name + '：' + amount;
      return name || amount;
    }).filter(Boolean).join('\n');
  }
  function planSalaryFromCode(code){
    const s=clean(code);
    const nums = s.match(/(\d{4,6})/g);
    if(!nums || !nums.length) return 0;
    return number(nums[nums.length - 1]);
  }
  function planText(code, prefix){
    const c = clean(code);
    if(!c) return '';
    const salary = planSalaryFromCode(c);
    if(salary) return money(salary);
    if(/^LAB_/i.test(c)) return c.replace(/^LAB_/i, '');
    if(/^NHI_/i.test(c)) return c.replace(/^NHI_/i, '');
    return c;
  }
  function isActiveInsurance(status){
    const s=clean(status);
    return s === '在保' || s === '加保' || truthy(s);
  }
  function configuredSalaryFields(o){
    const fields = ['baseSalary','hourlyRate','averageSalary','laborStatus','healthStatus','laborPlan','healthPlan','selfRetirementEnabled','effectiveDate','jobAllowances','allowances'];
    return fields.some(k => {
      const v = o && o[k];
      if(Array.isArray(v)) return v.length > 0;
      return clean(v) !== '' && clean(v) !== '未設定';
    });
  }
  function normalizeSalaryFromEmployee(o){
    o = o || {};
    const type = identityTypeOf(o);
    const isParttime = type === 'parttime';
    const baseSalary = number(o.baseSalary || o['本薪']);
    const hourlyRate = number(o.hourlyRate || o['時薪']);
    const averageSalary = number(o.averageSalary || o['目前申報月平均薪資總額']);
    const jobAllowances = Array.isArray(o.jobAllowances) ? o.jobAllowances : [];
    const allowances = Array.isArray(o.allowances) ? o.allowances : [];
    const jobTotal = sumItems(jobAllowances);
    const allowanceTotal = sumItems(allowances);
    const laborStatus = clean(o.laborStatus || o['勞保狀態']);
    const healthStatus = clean(o.healthStatus || o['健保狀態']);
    const laborPlan = clean(o.laborPlan || o.laborLevel || o['勞保級距']);
    const healthPlan = clean(o.healthPlan || o.healthLevel || o['健保級距']);
    const laborSalary = planSalaryFromCode(laborPlan);
    const healthSalary = planSalaryFromCode(healthPlan);
    const retirementBase = laborSalary || averageSalary || baseSalary + jobTotal + allowanceTotal;
    const employerRetirement = retirementBase ? Math.round(retirementBase * 0.06) : 0;
    const selfEnabled = clean(o.selfRetirementEnabled || o['勞退自提'] || '');
    const selfRate = number(o.selfRetirementRate || o['勞退自提比率']);
    const selfAmount = selfEnabled === '是' && selfRate && retirementBase ? Math.round(retirementBase * selfRate / 100) : 0;
    const partial = clean(o.isPartialHours || o['是否部分工時']);
    const hasSalary = configuredSalaryFields(o);
    return {
      employeeId: clean(o.employeeId || o.id || o['員工ID'] || o.__id),
      name: clean(o.name || o['姓名']),
      email: lower(o.email || o.Email || o['Email']),
      identityType: type,
      identityLabel: identityLabelOf(type),
      salaryConfigured: hasSalary,
      salaryDisplayType: clean(o.salaryDisplayType) || (isParttime ? 'PARTTIME_DIRECT' : 'STAFF_DIRECT'),
      baseSalary: baseSalary || '',
      hourlyRate: hourlyRate || '',
      isPartialHours: partial || (isParttime ? '否' : ''),
      averageSalary: averageSalary || '',
      laborPlan,
      healthPlan,
      laborStatus,
      healthStatus,
      selfRetirementEnabled: selfEnabled,
      selfRetirementRate: selfRate || '',
      effectiveDate: dateText(o.effectiveDate || o.salaryEffectiveDate || o['薪資生效日']),
      note: clean(o.note || o.salaryNote || o['薪資備註']),
      jobAllowances,
      allowances,
      staffBaseSalaryText: baseSalary ? money(baseSalary) : '',
      parttimeHourlyRateText: hourlyRate ? money(hourlyRate) : '',
      parttimePartialHoursText: isParttime ? (partial || '否') : '',
      parttimeAverageSalaryText: averageSalary ? money(averageSalary) : '',
      mainAmountText: isParttime ? (hourlyRate ? money(hourlyRate) : '') : (baseSalary ? money(baseSalary) : ''),
      jobAllowanceText: lineItemsText(jobAllowances) || (jobTotal ? money(jobTotal) : ''),
      allowanceText: lineItemsText(allowances) || (allowanceTotal ? money(allowanceTotal) : ''),
      laborPlanText: isActiveInsurance(laborStatus) ? planText(laborPlan, 'LAB') : '',
      laborSalaryText: isActiveInsurance(laborStatus) && laborSalary ? money(laborSalary) : '',
      laborSelfPayText: clean(o.laborSelfPayText || o.laborSelfPay || o['勞保自付額']),
      healthPlanText: isActiveInsurance(healthStatus) ? planText(healthPlan, 'NHI') : '',
      healthSalaryText: isActiveInsurance(healthStatus) && healthSalary ? money(healthSalary) : '',
      healthSelfPayText: clean(o.healthSelfPayText || o.healthSelfPay || o['健保自付額']),
      retirementEmployerText: employerRetirement ? ('6%｜' + money(employerRetirement)) : '',
      selfRetirementText: selfEnabled === '是' ? (selfRate ? (selfRate + '%｜' + (selfAmount ? money(selfAmount) : '')) : '是') : (selfEnabled === '否' ? '否' : ''),
      _raw: o
    };
  }
  function employeeForAdmin(o){
    const p = normalizeProfile(o);
    const s = normalizeSalaryFromEmployee(o);
    const isParttime = p.identityType === 'parttime';
    const reasons = [];
    if(isParttime){
      if(!s.hourlyRate) reasons.push('未設定時薪');
      if(!s.averageSalary) reasons.push('未設定目前申報月平均薪資總額');
    }else{
      if(!s.baseSalary) reasons.push('未設定本薪');
    }
    if(!s.laborStatus) reasons.push('未設定勞保狀態');
    if(!s.healthStatus) reasons.push('未設定健保狀態');
    if(isActiveInsurance(s.laborStatus) && !s.laborPlan) reasons.push('勞保在保但未設定勞保級距');
    if(isActiveInsurance(s.healthStatus) && !s.healthPlan) reasons.push('健保在保但未設定健保級距');
    return Object.assign({}, p, {
      id: p.employeeId,
      salaryConfigured: reasons.length === 0,
      salaryPendingReasons: reasons
    });
  }
  function salaryConfigForAdmin(o){
    o = o || {};
    return {
      salaryDisplayType: clean(o.salaryDisplayType) || (identityTypeOf(o)==='parttime' ? 'PARTTIME_DIRECT' : 'STAFF_DIRECT'),
      baseSalary: number(o.baseSalary) || '',
      hourlyRate: number(o.hourlyRate) || '',
      isPartialHours: clean(o.isPartialHours) || '否',
      averageSalary: number(o.averageSalary) || '',
      laborPlan: clean(o.laborPlan),
      healthPlan: clean(o.healthPlan),
      laborStatus: clean(o.laborStatus),
      healthStatus: clean(o.healthStatus),
      selfRetirementEnabled: clean(o.selfRetirementEnabled) || '否',
      selfRetirementRate: number(o.selfRetirementRate) || '',
      effectiveDate: dateText(o.effectiveDate),
      note: clean(o.note),
      jobAllowances: Array.isArray(o.jobAllowances) ? o.jobAllowances : [],
      allowances: Array.isArray(o.allowances) ? o.allowances : []
    };
  }
  async function getMyProfileFull(payload){
    const emp = await findEmployee(payload || {});
    if(!emp) return {ok:false, message:'Firebase employees 尚未建立此帳號資料，請由管理端確認員工資料。'};
    return {
      ok:true,
      source:'firebase-employees-canonical',
      profile: normalizeProfile(emp),
      salary: normalizeSalaryFromEmployee(emp),
      info: normalizeSalaryFromEmployee(emp)
    };
  }
  async function getMyProfile(payload){
    const res = await getMyProfileFull(payload || {});
    if(!res.ok) return res;
    return {ok:true, profile:res.profile, source:res.source};
  }
  async function getMySalaryInfo(payload){
    const res = await getMyProfileFull(payload || {});
    if(!res.ok) return res;
    return {ok:true, info:res.salary, salary:res.salary, source:res.source};
  }
  async function getSalarySetupOptions(){
    const rows = await allEmployees();
    const employees = rows.map(employeeForAdmin).filter(e => e.employeeId && (e.identityType === 'staff' || e.identityType === 'parttime') && lower(e.accountStatus) !== 'rejected');
    const employeeConfigMap = {};
    rows.forEach(row => {
      const e = employeeForAdmin(row);
      if(e.employeeId) employeeConfigMap[e.employeeId] = salaryConfigForAdmin(row);
    });
    return {ok:true, source:'firebase-employees-canonical', employees, rows:employees, employeeConfigMap, laborPlans:[], healthPlans:[]};
  }
  async function saveEmployeeSalaryConfig(payload){
    const p = payload || {};
    const employeeId = clean(p.employeeId || p.userId || p.id || p['員工ID']);
    if(!employeeId) return {ok:false, message:'缺少員工ID，無法儲存薪資設定。'};
    const found = await findEmployee({employeeId, userId:employeeId});
    const docId = clean((found && found.__id) || employeeId);
    const base = found || {employeeId:employeeId};
    const type = identityTypeOf(base);
    const data = {
      employeeId: clean(base.employeeId || employeeId),
      salaryDisplayType: type === 'parttime' ? 'PARTTIME_DIRECT' : 'STAFF_DIRECT',
      baseSalary: number(p.baseSalary) || 0,
      hourlyRate: number(p.hourlyRate) || 0,
      isPartialHours: clean(p.isPartialHours) || '否',
      averageSalary: number(p.averageSalary) || 0,
      laborPlan: clean(p.laborPlan),
      healthPlan: clean(p.healthPlan),
      laborStatus: clean(p.laborStatus),
      healthStatus: clean(p.healthStatus),
      selfRetirementEnabled: clean(p.selfRetirementEnabled) || '否',
      selfRetirementRate: number(p.selfRetirementRate) || 0,
      effectiveDate: dateText(p.effectiveDate),
      note: clean(p.note),
      jobAllowances: Array.isArray(p.jobAllowances) ? p.jobAllowances : [],
      allowances: Array.isArray(p.allowances) ? p.allowances : [],
      salaryUpdatedAt: serverTs(),
      updatedAt: serverTs(),
      source:'firebase-employees-canonical'
    };
    await database().collection('employees').doc(docId).set(data, {merge:true});
    return {ok:true, message:'薪資與投保設定已儲存到 Firebase employees。', employeeId:data.employeeId};
  }
  async function submitProfileChangeRequest(payload){
    const p = payload || {};
    const emp = await findEmployee(p);
    const employeeId = clean((emp && (emp.employeeId || emp.__id)) || p.employeeId || p.userId || p.id);
    if(!employeeId) return {ok:false, message:'找不到員工資料，無法送出修改申請。'};
    const pending = await database().collection('profileChangeRequests')
      .where('employeeId','==',employeeId)
      .where('status','==','待審核')
      .limit(1).get().catch(() => null);
    if(pending && !pending.empty) return {ok:false, message:'已有待審核的資料修改申請，請等待主管審核後再送出。'};
    const requestId = 'PCR_' + employeeId + '_' + Date.now();
    await database().collection('profileChangeRequests').doc(requestId).set({
      requestId,
      employeeId,
      name: clean((emp && emp.name) || p.name),
      oldData: emp ? {
        mobilePhone: clean(emp.mobilePhone),
        address: clean(emp.address || emp.contactAddress),
        email: lower(emp.email || emp.Email),
        emergencyContact: clean(emp.emergencyContact),
        emergencyPhone: clean(emp.emergencyPhone)
      } : {},
      newData: {
        mobilePhone: clean(p.mobilePhone),
        address: clean(p.address),
        email: lower(p.email),
        emergencyContact: clean(p.emergencyContact),
        emergencyPhone: clean(p.emergencyPhone)
      },
      mobilePhone: clean(p.mobilePhone),
      address: clean(p.address),
      email: lower(p.email),
      emergencyContact: clean(p.emergencyContact),
      emergencyPhone: clean(p.emergencyPhone),
      status:'待審核',
      createdAt: serverTs(),
      updatedAt: serverTs(),
      source:'firebase-employees-canonical'
    }, {merge:true});
    return {ok:true, message:'已送出修改申請，等待主管審核。', requestId};
  }

  fb.handleApi = async function(action, payload){
    const a = clean(action);
    if(a === 'getMyProfileFull' || a === 'getMyDataFull') return await getMyProfileFull(payload || {});
    if(a === 'getMyProfile') return await getMyProfile(payload || {});
    if(a === 'getMySalaryInfo') return await getMySalaryInfo(payload || {});
    if(a === 'getSalarySetupOptions') return await getSalarySetupOptions(payload || {});
    if(a === 'saveEmployeeSalaryConfig') return await saveEmployeeSalaryConfig(payload || {});
    if(a === 'submitProfileChangeRequest') return await submitProfileChangeRequest(payload || {});
    if(typeof previousHandle === 'function') return await previousHandle(action, payload || {});
    return null;
  };
  global.YZFirebase = fb;
})(window);
