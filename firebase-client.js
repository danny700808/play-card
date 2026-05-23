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
    }catch(err){
      console.warn('[Firebase] init failed:', err);
      return null;
    }
  }

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function todayKey(){
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
  }
  function ymd(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function timeText(d){ return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function addDays(dateKey, days){
    const d = new Date(String(dateKey||'') + 'T00:00:00');
    if(isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + Number(days||0));
    return ymd(d);
  }
  function inTodayOrYesterday(dateKey){
    const today = todayKey();
    const yesterday = addDays(today, -1);
    return clean(dateKey) === today || clean(dateKey) === yesterday;
  }

  function normalizeClockDoc(doc){
    const data = doc.data ? (doc.data() || {}) : (doc || {});
    const date = clean(data.clockDate || data.date || data['打卡日期']);
    const time = clean(data.clockTime || data.time || data['打卡時間']);
    const status = clean(data.status || data['狀態'] || '正常') || '正常';
    return {
      id: clean(data.recordId || data.id || doc.id || data['紀錄ID']),
      recordId: clean(data.recordId || data.id || doc.id || data['紀錄ID']),
      employeeId: clean(data.employeeId || data['員工ID']),
      name: clean(data.name || data['姓名']),
      email: clean(data.email || data['Email']).toLowerCase(),
      date: date,
      time: time,
      actionName: clean(data.actionName || data['打卡動作']),
      clockType: clean(data.clockType || data['打卡方式'] || '標準打卡') || '標準打卡',
      status: status,
      lateMinutes: Number(data.lateMinutes || data['遲到分鐘'] || 0) || 0,
      note: clean(data.note || data['備註']),
      sourceIp: clean(data.sourceIp || data.clientIp || data['來源IP']),
      isSupplement: data.isSupplement === true || clean(data.isSupplement || data['是否補登']) === '是',
      originalRef: clean(data.originalRecordId || data.originalRef || data['原始紀錄ID']),
      canModify: inTodayOrYesterday(date)
    };
  }

  function sortClockRows(rows){
    return (rows || []).slice().sort(function(a,b){
      const ka = clean(a.date) + ' ' + clean(a.time);
      const kb = clean(b.date) + ' ' + clean(b.time);
      return kb.localeCompare(ka);
    });
  }

  async function getClockRowsByEmployee(employeeId){
    const d = init();
    if(!d) throw new Error('Firebase 尚未啟用');
    const snap = await d.collection('clockRecords').where('employeeId','==', clean(employeeId)).get();
    const rows = [];
    snap.forEach(doc => rows.push(normalizeClockDoc(doc)));
    return sortClockRows(rows);
  }

  async function getEditableClockHistory(employeeId){
    const rows = await getClockRowsByEmployee(employeeId);
    return rows.filter(r => inTodayOrYesterday(r.date));
  }

  async function getClockHistoryRange(employeeId, startDate, endDate){
    const s = clean(startDate), e = clean(endDate);
    const rows = await getClockRowsByEmployee(employeeId);
    return rows.filter(r => clean(r.date) >= s && clean(r.date) <= e);
  }

  async function addClockRecordFromClient(payload){
    const d = init();
    if(!d) return { ok:false, message:'Firebase 尚未啟用' };
    const now = new Date();
    const employeeId = clean(payload.employeeId || payload.userId);
    const recordId = clean(payload.recordId) || ('WEB_' + employeeId + '_' + now.getTime());
    const row = {
      recordId: recordId,
      employeeId: employeeId,
      name: clean(payload.name),
      email: clean(payload.email).toLowerCase(),
      clockDate: clean(payload.clockDate) || ymd(now),
      clockTime: clean(payload.clockTime) || timeText(now),
      actionName: clean(payload.actionName),
      clockType: clean(payload.clockType || '標準打卡') || '標準打卡',
      status: clean(payload.status || '正常') || '正常',
      lateMinutes: Number(payload.lateMinutes || 0) || 0,
      note: clean(payload.note || ''),
      sourceIp: clean(payload.sourceIp || ''),
      isSupplement: false,
      originalRecordId: '',
      source: 'web-after-gas-ok',
      createdAt: global.firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: global.firebase.firestore.FieldValue.serverTimestamp()
    };
    await d.collection('clockRecords').doc(recordId).set(row, { merge:true });
    return { ok:true, recordId };
  }

  global.YZFirebase = {
    init,
    enabled,
    normalizeClockDoc,
    getClockRowsByEmployee,
    getEditableClockHistory,
    getClockHistoryRange,
    addClockRecordFromClient
  };
})(window);
