
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

/* =========================================================
 * Leave Firebase complete bridge v1
 * - 補齊請假：員工/工讀生請假、主管簽核、班表檢查、請假時數計算
 * - 班表判斷順序：單日特別班表 > 員工套用班表 > 班表模板
 * ========================================================= */
(function(global){
  const old = global.YZFirebase || {};
  const cfg = (global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG) || null;
  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){ const s=lower(v); return v===true || ['是','yes','true','1','啟用','enabled','active','true'].includes(s); }
  function falsey(v){ const s=lower(v); return v===false || ['否','no','false','0','停用','disabled','inactive'].includes(s); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function fmtDate(v){
    if(!v) return '';
    if(v && typeof v.toDate === 'function') return ymd(v.toDate());
    if(v instanceof Date && !isNaN(v.getTime())) return ymd(v);
    const s=clean(v); if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
    const d=new Date(s); return isNaN(d.getTime()) ? s : ymd(d);
  }
  function fmtDateTime(v){
    if(!v) return '';
    const d = v && typeof v.toDate === 'function' ? v.toDate() : (v instanceof Date ? v : new Date(v));
    if(isNaN(d.getTime())) return clean(v);
    return ymd(d)+' '+pad(d.getHours())+':'+pad(d.getMinutes());
  }
  function db(){
    if(old.init){ try{ const d=old.init(); if(d) return d; }catch(e){} }
    if(global.firebase && global.firebase.firestore && cfg){
      try{ const apps=global.firebase.apps||[]; const app=apps.length?apps[0]:global.firebase.initializeApp(cfg); return global.firebase.firestore(app); }catch(e){}
    }
    return null;
  }
  function ts(){ return global.firebase.firestore.FieldValue.serverTimestamp(); }
  async function all(col){ const d=db(); if(!d) throw new Error('Firebase 尚未啟用'); const snap=await d.collection(col).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  async function where(col, field, val){ const d=db(); if(!d) throw new Error('Firebase 尚未啟用'); const snap=await d.collection(col).where(field,'==',val).get(); const rows=[]; snap.forEach(doc=>rows.push(Object.assign({__id:doc.id}, doc.data()||{}))); return rows; }
  async function setDoc(col,id,data,merge){ const d=db(); if(!d) throw new Error('Firebase 尚未啟用'); const key=clean(id)||('WEB_'+Date.now()+'_'+Math.random().toString(36).slice(2,8)); await d.collection(col).doc(key).set(Object.assign({},data,{updatedAt:ts()}),{merge:merge!==false}); return key; }
  async function getDoc(col,id){ const d=db(); if(!d) throw new Error('Firebase 尚未啟用'); const doc=await d.collection(col).doc(clean(id)).get(); return doc.exists?Object.assign({__id:doc.id},doc.data()||{}):null; }
  function currentUser(){ try{return JSON.parse(localStorage.getItem('employeeUser')||'null')}catch(e){return null} }
  function userIdOf(p){ const u=currentUser()||{}; return clean((p&&p.userId)||u.id||u.employeeId); }
  function minOf(t){ const s=clean(t).slice(0,5); const m=s.match(/^(\d{1,2}):(\d{2})$/); return m?Number(m[1])*60+Number(m[2]):NaN; }
  function timeOf(m){ return pad(Math.floor(m/60))+':'+pad(m%60); }
  function hoursBetween(s,e){ const a=minOf(s), b=minOf(e); return (!isNaN(a)&&!isNaN(b)&&b>a)?Math.round((b-a)/60*100)/100:0; }
  function dateAdd(dateKey,days){ const d=new Date(dateKey+'T00:00:00'); d.setDate(d.getDate()+days); return ymd(d); }
  function datesBetween(start,end){ const out=[]; if(!start||!end||end<start) return out; let d=start; for(let guard=0; d<=end && guard<370; guard++){ out.push(d); d=dateAdd(d,1); } return out; }
  const LEAVE_MAX_RANGE_DAYS=20;
  function todayKey(){ return ymd(new Date()); }
  function nowMinutes(){ const d=new Date(); return d.getHours()*60+d.getMinutes(); }
  function isHalfHourTime(t){ const m=clean(t).match(/^(\d{2}):(\d{2})$/); return !!m && (Number(m[2])===0 || Number(m[2])===30); }
  const DKEY=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const DLABEL=['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
  function dayInfo(dateKey){ const d=new Date(dateKey+'T00:00:00'); const idx=isNaN(d.getTime())?0:d.getDay(); return {idx,key:DKEY[idx],label:DLABEL[idx]}; }
  function enabledRow(o){ return !falsey(o.enabled||o['啟用']||o.active); }
  function normEmployee(o){ return {employeeId:clean(o.employeeId||o['員工ID']||o.id||o.__id), name:clean(o.name||o.employeeName||o['姓名']||o['員工姓名']), identityType:lower(o.identityType||o['身分類型'])||(truthy(o.isPartTime||o['是否工讀生'])?'parttime':'staff'), email:lower(o.email||o['Email'])}; }
  function normLeave(o){
    o=o||{}; const id=clean(o.requestId||o.leaveId||o['請假ID']||o.__id);
    const segs=Array.isArray(o.segments)?o.segments:[];
    const first=segs[0]||{};
    const reason=clean(o.reason||o.leaveName||o['請假原因']||o.leaveCode||'請假');
    const start=fmtDate(o.startDate||o.leaveDate||first.startDate||first.leaveDate||o['開始日期']||o['請假日期']);
    const end=fmtDate(o.endDate||first.endDate||start||o['結束日期']);
    const st=clean(o.startTime||first.startTime||o['請假開始時間']);
    const et=clean(o.endTime||first.endTime||o['請假結束時間']);
    const hours=Number(o.hours||o.leaveHours||o['請假時數']||0)||calcLeaveHours({segments:segs,startDate:start,endDate:end,startTime:st,endTime:et});
    const simpleText=clean(o.simpleText)||`${reason}｜${hours ? hours+' 小時' : (st&&et?st+'-'+et:'整天')}`;
    return Object.assign({},o,{requestId:id, leaveId:id, employeeId:clean(o.employeeId||o.userId||o['員工ID']), name:clean(o.name||o.employeeName||o['姓名']), email:lower(o.email||o['Email']), reason, leaveCode:clean(o.leaveCode||o['假別代碼']), leaveDate:start, startDate:start, endDate:end, startTime:st, endTime:et, hours, note:clean(o.note||o['備註']), attachmentUrl:clean(o.attachmentUrl||o['附件連結']), status:clean(o.status||o['狀態']||'待審核')||'待審核', segments:segs, simpleText, requestedAt:fmtDateTime(o.requestedAt||o.createdAt||o['建立時間']), createdAt:fmtDateTime(o.createdAt||o['建立時間']), canEdit:['待審核','已駁回'].includes(clean(o.status||'待審核')), canDelete:['待審核','已駁回'].includes(clean(o.status||'待審核'))});
  }
  function calcLeaveHours(row){
    const segs=Array.isArray(row.segments)?row.segments:[]; let total=0;
    if(segs.length){ segs.forEach(s=>{ if(s.mode==='custom'||s.mode==='retro') total+=hoursBetween(s.startTime,s.endTime); else total+=Number(s.hours||0)||0; }); return Math.round(total*100)/100; }
    if(row.startTime&&row.endTime) return hoursBetween(row.startTime,row.endTime);
    return 0;
  }
  function dayFromTemplate(t,dateKey){
    const di=dayInfo(dateKey); const days=Array.isArray(t.days)?t.days:[];
    const found=days.find(d=>clean(d.dayKey||d.key)===di.key || clean(d.dayLabel||d.label)===di.label);
    const type=clean((found&&(found.type||found.clockType)) || t[di.key+'Type'] || t[di.key+'ClockType'] || t[di.label+'類型'] || '無班') || '無班';
    const start=clean((found&&(found.startTime||found.time)) || t[di.key+'StartTime'] || t[di.key+'Time'] || t[di.label+'上班時間']);
    const end=clean((found&&found.endTime) || t[di.key+'EndTime'] || t[di.label+'下班時間']);
    return {type,startTime:start,endTime:end,source:'班表模板',templateName:clean(t.templateName||t['模板名稱']||t.name),templateId:clean(t.templateId||t['模板ID']||t.__id)};
  }
  async function resolveSchedule(userId,dateKey){
    const employeeId=clean(userId); const dateKey2=fmtDate(dateKey); if(!employeeId||!dateKey2) return {hasSchedule:false,canLeave:false,statusLabel:'缺少日期',blockedReason:'請先選擇日期。'};
    const [singles,assigns,templates]=await Promise.all([all('singleDaySchedules').catch(()=>[]), all('employeeSchedules').catch(()=>[]), all('scheduleTemplates').catch(()=>[])]);
    const single=singles.filter(s=>clean(s.employeeId||s['員工ID'])===employeeId && fmtDate(s.date||s['日期'])===dateKey2 && enabledRow(s)).sort((a,b)=>clean(b.updatedAt||b.createdAt||'').localeCompare(clean(a.updatedAt||a.createdAt||'')))[0];
    let info=null;
    if(single){ info={type:clean(single.clockType||single.type||single['打卡類型']||'標準打卡'),startTime:clean(single.startTime||single['上班時間']),endTime:clean(single.endTime||single['下班時間']),source:'單日特別班表',templateName:'單日特別班表',recordId:clean(single.recordId||single.__id)}; }
    if(!info){
      const valid=assigns.filter(a=>clean(a.employeeId||a['員工ID'])===employeeId && enabledRow(a) && fmtDate(a.startDate||a['開始日期'])<=dateKey2 && (truthy(a.indefinite||a['無期限']) || !fmtDate(a.endDate||a['結束日期']) || fmtDate(a.endDate||a['結束日期'])>=dateKey2)).sort((a,b)=>fmtDate(b.startDate||b['開始日期']).localeCompare(fmtDate(a.startDate||a['開始日期'])));
      const a=valid[0];
      if(a){ const tid=clean(a.templateId||a['模板ID']); const t=templates.find(x=>clean(x.templateId||x['模板ID']||x.__id)===tid) || {}; info=dayFromTemplate(t,dateKey2); info.source='員工套用班表'; info.assignmentId=clean(a.assignmentId||a['套用ID']||a.__id); info.templateName=clean(a.templateName||a['模板名稱']||info.templateName); }
    }
    if(!info || !info.type || info.type==='無班') return {hasSchedule:false,canLeave:false,statusLabel:'今日無排班',blockedReason:'這一天沒有排班，不能送出請假。',scheduleLabel:'今日無班'};
    if(!info.startTime || !info.endTime || hoursBetween(info.startTime,info.endTime)<=0) return {hasSchedule:false,canLeave:false,statusLabel:'班表時間不完整',blockedReason:'這一天班表沒有完整上班與下班時間，請先到班表管理修正。',scheduleLabel:`${info.source}｜${info.type}`};
    const hrs=hoursBetween(info.startTime,info.endTime);
    return Object.assign({},info,{hasSchedule:true,canLeave:true,statusLabel:'今日有班，可請假',shiftStart:info.startTime,shiftEnd:info.endTime,scheduleLabel:`${info.source}｜${info.type}｜${info.startTime}-${info.endTime}`,helperText:`請假時間會依 ${info.startTime}-${info.endTime} 計算，約 ${hrs} 小時。`,scheduledHours:hrs});
  }
  function overlap(a1,a2,b1,b2){ return a1<=b2 && b1<=a2; }
  function leaveCoversDate(row,dateKey){ const r=normLeave(row); if(['已刪除','已駁回'].includes(r.status)) return false; if(Array.isArray(r.segments)&&r.segments.length){ return r.segments.some(s=>{ if(s.mode==='custom'||s.mode==='retro') return fmtDate(s.leaveDate)===dateKey; return fmtDate(s.startDate)<=dateKey && fmtDate(s.endDate||s.startDate)>=dateKey; }); } return r.startDate<=dateKey && r.endDate>=dateKey; }

  function getLeavePolicyPublicBundle(p){
    const identity = lower((currentUser()||{}).identityType || (p&&p.identityType));
    const allRows = [
      ['事假','是','全部','是','是','否','依規定','可申請整天、部分請假或事後補假。'],
      ['病假','是','全部','是','是','否','依規定','可申請整天、部分請假或事後補假。'],
      ['特休','是','專職','是','是','否','支薪','專職員工依特休規則申請。'],
      ['喪假','是','全部','是','是','是','支薪','需依規定補證明文件。'],
      ['婚假','是','專職','是','是','是','支薪','需依規定補證明文件。']
    ];
    const rows = identity === 'parttime' ? allRows.filter(r => r[0] === '事假' || r[0] === '病假') : allRows;
    return {ok:true,bundle:{
      leaveTypes:{headers:['假別名稱','啟用','適用身分','可半天','可小時','需附件','支薪方式','說明'],rows},
      holidaySummary:{headers:['假別名稱','申請期限類型','最少提前天數','是否允許臨時申請','請畢期限說明','證明文件規則','備註'],rows:[]},
      bereavement:{headers:['親等','天數'],rows:[['父母、配偶','8'],['祖父母、子女','6'],['兄弟姊妹','3']]},
      source:'firebase-default'
    }};
  }

  async function getLeaveDateContext(p){
    const userId=clean(p.userId||p.employeeId)||userIdOf(p); const dateKey=fmtDate(p.leaveDate||p.date); const ctx=await resolveSchedule(userId,dateKey);
    const reqId=clean(p.requestId||p.leaveId);
    const leaves=(await all('leaveRequests').catch(()=>[])).filter(r=>clean(r.requestId||r.leaveId||r.__id)!==reqId && clean(r.employeeId||r.userId||r['員工ID'])===userId && leaveCoversDate(r,dateKey));
    if(leaves.length && ctx.canLeave){ ctx.helperText = (ctx.helperText||'') + `；提醒：當天已有 ${leaves.length} 筆待審/核准請假紀錄。`; ctx.hasConflict=true; }
    return {ok:true,context:ctx};
  }
  async function buildSegmentsWithSchedule(payload){
    const userId=clean(payload.userId||payload.employeeId)||userIdOf(payload); const segs=Array.isArray(payload.segments)&&payload.segments.length?payload.segments:[];
    const out=[]; let total=0; const hints=[];
    for(const raw of segs){
      const rawMode=clean(raw.mode); const mode=rawMode==='retro'?'retro':(rawMode==='custom'?'custom':'schedule');
      if(mode==='custom' || mode==='retro'){
        const dateKey=fmtDate(raw.leaveDate||raw.date); const ctx=await resolveSchedule(userId,dateKey);
        if(!ctx.canLeave) throw new Error(`${dateKey} ${ctx.blockedReason||'不可請假'}`);
        const st=clean(raw.startTime).slice(0,5), et=clean(raw.endTime).slice(0,5); const smin=minOf(st), emin=minOf(et), shiftS=minOf(ctx.shiftStart), shiftE=minOf(ctx.shiftEnd);
        if(isNaN(smin)||isNaN(emin)||emin<=smin) throw new Error(`${dateKey} 請假時間不正確。`);
        if(!isHalfHourTime(st) || !isHalfHourTime(et)) throw new Error(`${dateKey} 請假時間只能選擇整點或 30 分鐘。`);
        if(smin<shiftS || emin>shiftE) throw new Error(`${dateKey} 請假時間必須在班表 ${ctx.shiftStart}-${ctx.shiftEnd} 內。`);
        const h=hoursBetween(st,et); total+=h; hints.push(`${dateKey}｜${mode==='retro'?'事後補假':'部分請假'}｜${ctx.scheduleLabel}｜申請 ${st}-${et}，${h} 小時`);
        out.push(Object.assign({},raw,{mode,leaveTypeMode:mode==='retro'?'事後補假':'部分請假',leaveDate:dateKey,startTime:st,endTime:et,hours:h,scheduleContext:{scheduleLabel:ctx.scheduleLabel,shiftStart:ctx.shiftStart,shiftEnd:ctx.shiftEnd,scheduledHours:ctx.scheduledHours}}));
      }else{
        const start=fmtDate(raw.startDate||raw.date), end=fmtDate(raw.endDate||raw.startDate||raw.date); if(!start||!end) throw new Error('請假日期不完整。');
        const dates=datesBetween(start,end);
        if(dates.length>LEAVE_MAX_RANGE_DAYS) throw new Error(`單次整天請假最多只能選 ${LEAVE_MAX_RANGE_DAYS} 天。`);
        let h=0; const dayDetails=[]; let offDays=0;
        for(const d of dates){
          const ctx=await resolveSchedule(userId,d);
          if(ctx.canLeave){
            const shiftStart=minOf(ctx.shiftStart);
            if(d===todayKey() && !isNaN(shiftStart) && nowMinutes()>=shiftStart){
              throw new Error(`${d} 今日班表已開始，請改用事後補假。`);
            }
            h+=Number(ctx.scheduledHours||0); dayDetails.push({date:d,ok:true,scheduleLabel:ctx.scheduleLabel,shiftStart:ctx.shiftStart,shiftEnd:ctx.shiftEnd,hours:ctx.scheduledHours});
          }else{
            offDays+=1; dayDetails.push({date:d,ok:false,scheduleLabel:ctx.scheduleLabel||ctx.blockedReason||'無班，系統自動略過',hours:0,skipped:true});
          }
        }
        const workDays=dayDetails.filter(x=>x.ok).length;
        if(workDays<=0) throw new Error(`${start}${end!==start?'～'+end:''} 區間內沒有可請假的排班。`);
        h=Math.round(h*100)/100; total+=h; hints.push(`${start}${end!==start?'～'+end:''}｜整天請假｜需要請假 ${workDays} 天，無排班 ${offDays} 天自動略過，共 ${h} 小時`);
        out.push(Object.assign({},raw,{mode:'schedule',startDate:start,endDate:end,hours:h,dayDetails,workDays,offDays}));
      }
    }
    return {segments:out,totalHours:Math.round(total*100)/100,hints};
  }
  async function getLeaveHistory(p){ const uid=clean(p&&p.userId)||userIdOf(p); const rows=(await where('leaveRequests','employeeId',uid).catch(()=>[])).map(normLeave).filter(r=>r.status!=='已刪除').sort((a,b)=>clean(b.leaveDate).localeCompare(clean(a.leaveDate))); return {ok:true,year:(new Date()).getFullYear(),rows,eventCandidates:[]}; }
  async function getPendingLeaveApprovals(){ const rows=(await where('leaveRequests','status','待審核').catch(()=>[])).map(normLeave); rows.forEach(r=>{ r.reviewHints=Array.isArray(r.reviewHints)?r.reviewHints:buildReviewHints(r); }); return {ok:true,rows}; }
  function buildReviewHints(r){ const out=[]; const row=normLeave(r); if(clean(row.requestType)) out.push(`申請類型：${clean(row.requestType)}`); out.push(`請假時數：${row.hours||0} 小時`); if(row.scheduleSummaryText) out.push(row.scheduleSummaryText); if(Array.isArray(row.segments)){ row.segments.forEach(s=>{ if(s.scheduleContext) out.push(`${s.leaveDate||s.startDate}｜${s.mode==='retro'?'事後補假':(s.mode==='custom'?'部分請假':'整天請假')}｜班表 ${s.scheduleContext.shiftStart||''}-${s.scheduleContext.shiftEnd||''}`); else if(Array.isArray(s.dayDetails)) s.dayDetails.slice(0,3).forEach(d=>out.push(`${d.date}｜${d.scheduleLabel}`)); }); } return out; }
  async function getAdminLeaveEmployeeSummary(){ const [emps,leaves]=await Promise.all([all('employees').catch(()=>[]),all('leaveRequests').catch(()=>[])]); const by={}; leaves.map(normLeave).filter(r=>r.status!=='已刪除').forEach(r=>{ (by[r.employeeId]=by[r.employeeId]||[]).push(r); }); const rows=emps.map(normEmployee).filter(e=>e.employeeId).map(e=>{ const list=by[e.employeeId]||[]; const approved=list.filter(x=>x.status==='已核准').reduce((s,x)=>s+(Number(x.hours)||0),0); const pending=list.filter(x=>x.status==='待審核').length; return {name:e.name,identityLabel:e.identityType==='parttime'?'工讀生':'專職員工',lines:[`已核准請假：${Math.round(approved*100)/100} 小時`,`待審核：${pending} 筆`]}; }); return {ok:true,rows}; }
  async function saveLeave(action,payload){
    const user=currentUser()||{}; const uid=clean(payload.userId||payload.employeeId)||userIdOf(payload); const id=clean(payload.requestId||payload.leaveId)||('LV_'+uid+'_'+Date.now());
    if(action==='deleteLeaveRequest'){ await setDoc('leaveRequests',id,{status:'已刪除',deletedAt:ts(),source:'firebase-leave-v1'}); return {ok:true,message:'請假申請已刪除。'}; }
    if(action==='reviewLeaveRequest'){
      const status=/reject/i.test(clean(payload.decision||payload.action))?'已駁回':'已核准'; const base=await getDoc('leaveRequests',id).catch(()=>null);
      await setDoc('leaveRequests',id,{status,rejectReason:clean(payload.rejectReason||payload.reason),reviewedAt:ts(),reviewerId:uid,reviewerName:clean(user.name),source:'firebase-leave-v1'});
      if(status==='已核准' && base) await setDoc('leaveRecords',id,Object.assign({},base,{requestId:id,status:'已核准',reviewedAt:ts(),reviewerId:uid,reviewerName:clean(user.name),source:'firebase-leave-v1'}));
      return {ok:true,message:status==='已核准'?'請假已核准。':'請假已駁回。'};
    }
    const checked=await buildSegmentsWithSchedule(Object.assign({},payload,{userId:uid}));
    const first=checked.segments[0]||{}; const start=fmtDate(first.startDate||first.leaveDate||payload.startDate||payload.leaveDate); const end=fmtDate(first.endDate||first.startDate||first.leaveDate||payload.endDate||payload.leaveDate);
    const row={requestId:id,requestType:clean(payload.requestType||''),employeeId:uid,name:clean(payload.name||user.name),email:lower(payload.email||user.email),reason:clean(payload.reason||payload.leaveName||'請假'),leaveCode:clean(payload.leaveCode),bereavementRelation:clean(payload.bereavementRelation),leaveDate:start,startDate:start,endDate:end,startTime:clean(first.startTime||payload.startTime),endTime:clean(first.endTime||payload.endTime),hours:checked.totalHours,note:clean(payload.note),attachmentUrl:clean(payload.attachmentUrl),segments:checked.segments,reviewHints:checked.hints,status:'待審核',source:'firebase-leave-v1'};
    if(action==='modifyLeaveRequest'){ row.modifyCount=(Number((await getDoc('leaveRequests',id).catch(()=>null)||{}).modifyCount)||0)+1; }
    await setDoc('leaveRequests',id,Object.assign({},row,{createdAt:ts()}));
    return {ok:true,message:action==='modifyLeaveRequest'?'請假申請已更新。':'請假申請已送出。',requestId:id,row:normLeave(row)};
  }
  const oldHandle=old.handleApi;
  old.handleApi=async function(action,payload){
    const a=clean(action), p=payload||{};
    try{
      if(a==='getLeavePolicyPublicBundle') return getLeavePolicyPublicBundle(p);
      if(a==='getLeaveDateContext') return await getLeaveDateContext(p);
      if(a==='getLeaveHistory') return await getLeaveHistory(p);
      if(a==='getPendingLeaveApprovals') return await getPendingLeaveApprovals(p);
      if(a==='getAdminLeaveEmployeeSummary') return await getAdminLeaveEmployeeSummary(p);
      if(['leaveRequest','modifyLeaveRequest','deleteLeaveRequest','reviewLeaveRequest'].includes(a)) return await saveLeave(a,p);
    }catch(e){ return {ok:false,message:e && e.message ? e.message : '請假資料處理失敗'}; }
    if(typeof oldHandle==='function') return await oldHandle(action,payload);
    return null;
  };
  global.YZFirebase=old;
})(window);
