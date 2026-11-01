 'use strict';
// Server counterpart of the existing employee schedule/leave logic. Read-only computation.
const clean=v=>String(v==null?'':v).trim(), lower=v=>clean(v).toLowerCase();
const truthy=v=>v===true||['true','yes','是','1','啟用'].includes(lower(v));
const isDisabled=v=>v===false||['false','no','否','0','停用','disabled','deleted','已刪除'].includes(lower(v));
const pad=v=>String(v).padStart(2,'0');
const PENDING='待審核',APPROVED='已核准',REJECTED='已駁回',VERSION='server-attendance-20261101';
const minutes=v=>{const m=clean(v).match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):NaN;};
const minToTime=v=>pad(Math.floor(v/60))+':'+pad(v%60),hhmmFromMinutes=minToTime;
const timeText=v=>v instanceof Date?new Date(v.getTime()+28800000).toISOString().slice(11,19):clean(v);
const shortTime=v=>timeText(v).slice(0,5);
const localDateKey=v=>new Date(v.getTime()+28800000).toISOString().slice(0,10);
const dateText=v=>v&&typeof v.toDate==='function'?localDateKey(v.toDate()):v instanceof Date?localDateKey(v):clean(v).slice(0,10).replace(/\//g,'-');
const dateTimeText=v=>v?dateText(v)+' '+timeText(v):'';
const hoursBetween=(a,b)=>Math.round((minutes(b)-minutes(a))/60*100)/100;
const rangesOverlap=(a,b,c,d)=>Math.max(a,c)<Math.min(b,d);
const clampInterval=(a,b,c,d)=>Math.min(b,d)>Math.max(a,c)?[Math.max(a,c),Math.min(b,d)]:null;
const addDays=(key,n)=>new Date(new Date(key+'T00:00:00Z').getTime()+n*86400000).toISOString().slice(0,10);
function datesBetween(a,b,cap=370){const out=[];for(let d=dateText(a);d&&d<=dateText(b||a)&&out.length<cap;d=addDays(d,1))out.push(d);return out;}
function createScheduleComputer(snapshot,now=new Date()){
 const currentDate=()=>localDateKey(now),nowMinutes=()=>minutes(timeText(now));
 const employeeIdFrom=p=>clean(p.employeeId||p.userId);
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
    const d = new Date(clean(dateKey) + 'T00:00:00Z');
    if(isNaN(d.getTime())) return DAY_KEYS[0];
    return DAY_KEYS[d.getUTCDay()] || DAY_KEYS[0];
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

    const todayKey = currentDate();
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
  async function resolveTodaySchedule(payload, monthlySources){
    const p = payload || {};
    const employeeId = employeeIdFrom(p);
    const dateKey = dateText(p.date || p.clockDate) || currentDate();
    if(!employeeId) return {ok:false, message:'缺少員工資料，請重新登入。', hasSchedule:false, okToClock:false, allowedClockTypes:[], schedules:[]};

    const [singleRows, assignmentRows, templateRows, leaveBlocks] = monthlySources || await Promise.all([
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
      .filter(x => x.enabled && !(Array.isArray(x.excludedDates)&&x.excludedDates.includes(dateKey)) && x.employeeId === employeeId && x.startDate && dateKey >= x.startDate && (x.indefinite || !x.endDate || dateKey <= x.endDate))
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

  function statusOf(o){ return clean((o||{}).status || (o||{})['狀態'] || (o||{}).approvalStatus || (o||{})['審核狀態']); }
  function isActiveRow(o){ const s=statusOf(o); return !o.attendanceSupersededByLeave&&!['已刪除','刪除','deleted','作廢','已取消','已被取代'].includes(lower(s)); }

  function scheduleBaseKey(s){
    s=s||{};
    return clean(s.originalScheduleKey||s.baseScheduleKey||s.scheduleKey||s.key||[
      clean(s.source||s.scheduleSource),clean(s.id||s.assignmentId||s.recordId||s.scheduleId),dateText(s.date||s.scheduleDate),shortTime(s.originalStartTime||s.startTime||s.scheduleStartTime),shortTime(s.originalEndTime||s.endTime||s.scheduleEndTime),clean(s.clockType||s.scheduleClockType)
    ].join('|'));
  }

  function scheduleRawKey(s){
    s=s||{};
    return clean(s.scheduleKey||s.key)||[
      clean(s.source||s.scheduleSource),clean(s.id||s.assignmentId||s.recordId||s.scheduleId),dateText(s.date||s.scheduleDate),shortTime(s.startTime||s.scheduleStartTime),shortTime(s.endTime||s.scheduleEndTime),clean(s.clockType||s.scheduleClockType)
    ].join('|');
  }

  function recordKey(r){ return clean((r||{}).scheduleKey||(r||{}).effectiveSegmentKey||(r||{}).originalScheduleKey); }

  function normalizeClock(r){
    r=r||{};
    return {
      id:clean(r.recordId||r['紀錄ID']||r.__id), __id:clean(r.__id), employeeId:clean(r.employeeId||r['員工ID']),
      date:dateText(r.clockDate||r.date||r['打卡日期']), time:timeText(r.clockTime||r.time||r['打卡時間']),
      actionName:clean(r.actionName||r['打卡動作']), clockType:clean(r.clockType||r['打卡方式']||'標準打卡')||'標準打卡',
      status:clean(r.status||r['狀態']||'正常'), scheduleKey:recordKey(r), originalScheduleKey:clean(r.originalScheduleKey||r.baseScheduleKey),
      scheduleStartTime:shortTime(r.scheduleStartTime), scheduleEndTime:shortTime(r.scheduleEndTime), raw:r
    };
  }

  function isIndependentTemporaryClock(record){
    const raw=record&&record.raw?record.raw:(record||{});
    return clean(raw.sourceType)==='temporaryAttendanceApproved'||!!clean(raw.temporaryAttendanceRequestId)||clean((record&&record.clockType)||raw.clockType||raw['打卡方式']).includes('臨時出勤')||clean((record&&record.status)||raw.status||raw['狀態']).includes('臨時出勤');
  }

  function normalizeTemporaryAttendanceBlock(raw){
    raw=raw||{}; const status=statusOf(raw); const approved=status===APPROVED;
    const start=minutes(approved?(raw.approvedStartTime||raw.startTime||raw['申請上班時間']):(raw.startTime||raw['申請上班時間']));
    const end=minutes(approved?(raw.approvedEndTime||raw.endTime||raw['申請下班時間']):(raw.endTime||raw['申請下班時間']));
    return {requestId:clean(raw.requestId||raw.__id),date:dateText(raw.date||raw.workDate||raw['日期']),start,end,startTime:Number.isFinite(start)?minToTime(start):'',endTime:Number.isFinite(end)?minToTime(end):'',status,reason:clean(raw.reason||raw['原因']),raw};
  }

  function temporaryAttendanceBlocksForDate(rows,dateKey,statuses){
    const allowed=new Set(statuses||[PENDING,APPROVED]);
    return (rows||[]).map(normalizeTemporaryAttendanceBlock).filter(r=>r.date===dateKey&&allowed.has(r.status)&&Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.end>r.start&&isActiveRow(r.raw));
  }

  function intervalCoveredByBlocks(start,end,blocks){
    return Number.isFinite(start)&&Number.isFinite(end)&&end>start&&subtractIntervals(start,end,blocks||[]).length===0;
  }

  function temporaryBlockCoversPunch(block,action,boundary){
    if(!block||!Number.isFinite(boundary))return false;
    return clean(action).includes('下班')?block.start<boundary&&block.end>=boundary:block.start<=boundary&&block.end>boundary;
  }

  function normalizeSegmentMode(seg){ const raw=lower((seg||{}).mode||(seg||{}).leaveTypeMode||(seg||{}).requestType); if(raw.includes('retro')||raw.includes('事後'))return'retro'; if(raw.includes('custom')||raw.includes('部分'))return'custom'; if(!raw&&((seg||{}).startTime||(seg||{}).endTime||(seg||{})['請假開始時間']||(seg||{})['請假結束時間']))return'custom'; return'schedule'; }

  function normalizeSegments(raw){
    raw=raw||{};
    const src=Array.isArray(raw.normalizedSegments)&&raw.normalizedSegments.length?raw.normalizedSegments:(Array.isArray(raw.segments)&&raw.segments.length?raw.segments:[]);
    const input=src.length?src:[{
      mode:(raw.startTime||raw.endTime)?'custom':'schedule', leaveDate:raw.leaveDate||raw.date||raw.startDate,
      startDate:raw.startDate||raw.leaveDate||raw.date, endDate:raw.endDate||raw.startDate||raw.leaveDate||raw.date,
      startTime:raw.startTime, endTime:raw.endTime, hours:raw.hours, allDay:raw.allDay
    }];
    const out=[];
    input.forEach((s,idx)=>{
      s=s||{}; const mode=normalizeSegmentMode(s); const st=shortTime(s.startTime||s['請假開始時間']); const en=shortTime(s.endTime||s['請假結束時間']);
      const explicitAll=s.allDay===true||truthy(s.allDay)||mode==='schedule'||(!st&&!en&&clean(s.session||raw.session).includes('全天'));
      if(explicitAll){
        const start=dateText(s.startDate||s.leaveDate||s.date||raw.startDate||raw.leaveDate); const end=dateText(s.endDate||start||raw.endDate);
        datesBetween(start,end,370).forEach((d,di)=>out.push({
          segmentId:clean(s.segmentId)||`SEG_${idx+1}_${di+1}`,mode,leaveTypeMode:mode==='retro'?'事後補假':'整天請假',date:d,leaveDate:d,startDate:d,endDate:d,
          allDay:true,startTime:'',endTime:'',startMinute:0,endMinute:1440,hours:Number(s.hours||0)||0,scheduleKey:clean(s.scheduleKey),scheduleKeys:Array.isArray(s.scheduleKeys)?s.scheduleKeys.map(clean).filter(Boolean):[],
          requestedStartTime:shortTime(s.requestedStartTime),requestedEndTime:shortTime(s.requestedEndTime)
        }));
      }else{
        const d=dateText(s.leaveDate||s.date||s.startDate||raw.leaveDate||raw.startDate); const a=minutes(st),b=minutes(en);
        if(d&&Number.isFinite(a)&&Number.isFinite(b)&&b>a) out.push({
          segmentId:clean(s.segmentId)||`SEG_${idx+1}`,mode,leaveTypeMode:mode==='retro'?'事後補假':'部分請假',date:d,leaveDate:d,startDate:d,endDate:d,
          allDay:false,startTime:minToTime(a),endTime:minToTime(b),startMinute:a,endMinute:b,hours:Number(s.hours||0)||Math.round(((b-a)/60)*100)/100,
          scheduleKey:clean(s.scheduleKey),scheduleKeys:Array.isArray(s.scheduleKeys)?s.scheduleKeys.map(clean).filter(Boolean):[],
          requestedStartTime:shortTime(s.requestedStartTime||st),requestedEndTime:shortTime(s.requestedEndTime||en)
        });
      }
    });
    return out.sort((a,b)=>a.date.localeCompare(b.date)||a.startMinute-b.startMinute||a.endMinute-b.endMinute);
  }

  function segmentText(s){ return s.allDay?`${s.date} 全天`:`${s.date} ${s.startTime}-${s.endTime}`; }

  function normalizeLeave(raw){
    raw=raw||{}; const segments=normalizeSegments(raw); const dates=segments.map(s=>s.date).filter(Boolean).sort();
    const hoursFromSegments=Math.round(segments.reduce((sum,s)=>sum+(Number(s.hours)||0),0)*100)/100;
    const reason=clean(raw.reason||raw.leaveName||raw.leaveType||raw['請假原因']||'請假');
    const status=statusOf(raw); const total=hoursFromSegments||Number(raw.hours||raw.leaveHours||raw['請假時數']||0)||0;
    const summary=segments.map(segmentText).join('、');
    return {
      requestId:clean(raw.requestId||raw.leaveId||raw['請假ID']||raw.__id), __id:clean(raw.__id), employeeId:clean(raw.employeeId||raw.userId||raw['員工ID']),
      name:clean(raw.name||raw.employeeName||raw['姓名']||'未命名'), email:lower(raw.email||raw.Email||raw['Email']), reason,leaveCode:clean(raw.leaveCode||raw['假別代碼']),
      status,segments,leaveDate:dates[0]||dateText(raw.leaveDate||raw.startDate),startDate:dates[0]||dateText(raw.startDate||raw.leaveDate),endDate:dates[dates.length-1]||dateText(raw.endDate||raw.startDate||raw.leaveDate),
      startTime:segments.length===1&&!segments[0].allDay?segments[0].startTime:shortTime(raw.startTime),endTime:segments.length===1&&!segments[0].allDay?segments[0].endTime:shortTime(raw.endTime),
      hours:total,session:segments.length&&segments.every(s=>s.allDay)?'全天':'部分',note:clean(raw.note||raw['備註']),rejectReason:clean(raw.rejectReason||raw['駁回理由']),
      requestedAt:dateTimeText(raw.requestedAt||raw.createdAt||raw['建立時間']),createdAt:dateTimeText(raw.createdAt||raw['建立時間']),reviewedAt:dateTimeText(raw.reviewedAt||raw['審核時間']),updatedAt:dateTimeText(raw.updatedAt||raw['更新時間']),
      caseId:clean(raw.caseId||raw.attendanceCaseId),requestType:clean(raw.requestType||raw['申請類型']),payMode:clean(raw.payMode||raw['支薪方式']),payFactor:Number(raw.payFactor),
      segmentSummaryText:clean(raw.segmentSummaryText)||summary,simpleText:clean(raw.simpleText)||`${reason}${total?`｜${total}小時`:''}${summary?`｜${summary}`:''}`,raw
    };
  }

  function leaveIntervalsForDate(leaves,dateKey,status){
    const out=[];
    (leaves||[]).forEach(l0=>{
      const l=l0&&l0.segments?l0:normalizeLeave(l0); if(status&&l.status!==status)return;
      l.segments.filter(s=>s.date===dateKey).forEach(s=>out.push({start:s.allDay?0:s.startMinute,end:s.allDay?1440:s.endMinute,allDay:s.allDay,requestId:l.requestId,reason:l.reason,status:l.status,segment:s,leave:l}));
    });
    return out;
  }

  function mergeIntervals(intervals){
    const rows=(intervals||[]).filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>x.start).slice().sort((a,b)=>a.start-b.start||a.end-b.end);
    const out=[]; rows.forEach(x=>{ const last=out[out.length-1]; if(last&&x.start<=last.end){ last.end=Math.max(last.end,x.end); last.items=(last.items||[]).concat(x.items||[x]); }else out.push({start:x.start,end:x.end,items:x.items||[x]}); }); return out;
  }

  function subtractIntervals(start,end,blocks){
    let pieces=[[start,end]]; mergeIntervals(blocks).forEach(b=>{ const next=[]; pieces.forEach(p=>{ if(b.end<=p[0]||b.start>=p[1])next.push(p); else{ if(b.start>p[0])next.push([p[0],Math.min(b.start,p[1])]); if(b.end<p[1])next.push([Math.max(b.end,p[0]),p[1]]); } }); pieces=next; });
    return pieces.filter(p=>p[1]>p[0]);
  }


  function decorateEffectiveSchedule(raw,dateKey,start,end,idx,count,approved,pending){
    const originalKey=scheduleRawKey(raw),key=`${originalKey}::EFF::${minToTime(start).replace(':','')}-${minToTime(end).replace(':','')}`;
    const today=currentDate(),now=nowMinutes(),open=Math.max(0,start-60);
    const pendingOverlaps=(pending||[]).filter(p=>rangesOverlap(start,end,p.start,p.end));
    const adjusted=start!==minutes(raw.startTime)||end!==minutes(raw.endTime);
    let statusText='';
    if(dateKey<today) statusText='班表日期已過';
    else if(dateKey>today) statusText='尚未到班表日期';
    else if(now<open) statusText=`${minToTime(open)} 後可上班打卡`;
    else statusText=adjusted?'核准請假後剩餘出勤時段':'已到可打卡時間';
    if(pendingOverlaps.length) statusText += '｜此時段另有請假待審核';
    return Object.assign({},raw,{
      date:dateKey,hasSchedule:true,originalScheduleKey:originalKey,baseScheduleKey:originalKey,effectiveSegmentKey:key,scheduleKey:key,key,
      originalStartTime:shortTime(raw.startTime),originalEndTime:shortTime(raw.endTime),startTime:minToTime(start),endTime:minToTime(end),effectiveStartTime:minToTime(start),effectiveEndTime:minToTime(end),
      splitIndex:idx+1,splitCount:count,leaveAdjusted:adjusted,approvedLeaveBlocks:(approved||[]).map(x=>({requestId:x.requestId,reason:x.reason,startTime:minToTime(x.start),endTime:minToTime(x.end),allDay:x.allDay})),
      pendingLeaveBlocks:pendingOverlaps.map(x=>({requestId:x.requestId,reason:x.reason,startTime:minToTime(x.start),endTime:minToTime(x.end),allDay:x.allDay})),
      allowedClockTypes:['標準打卡','特殊打卡'],clockInOpenMinute:open,clockInOpenAt:minToTime(open),statusText,
      canClockInNow:dateKey===today&&now>=open,canClockOutNow:dateKey===today&&now>=start,summary:`${minToTime(start)}-${minToTime(end)}`,attendanceFlowVersion:VERSION
    });
  }

  function assignRecords(schedules,records){
    const used=new Set();
    const rows=(records||[]).slice();
    function score(rec,s){
      const t=minutes(rec.time); const target=rec.actionName.includes('下班')?minutes(s.endTime):minutes(s.startTime);
      let n=Number.isFinite(t)&&Number.isFinite(target)?Math.abs(t-target):9999;
      if(rec.scheduleKey===s.scheduleKey)n-=10000;
      if(rec.scheduleKey&&[s.originalScheduleKey,s.baseScheduleKey].includes(rec.scheduleKey))n-=2000;
      if(rec.originalScheduleKey&&rec.originalScheduleKey===s.originalScheduleKey)n-=1500;
      return n;
    }
    (schedules||[]).forEach(s=>{ s.clockInRecord=null;s.clockOutRecord=null; });
    for(const action of ['上班打卡','下班打卡']){
      const actionRows=rows.filter(r=>r.actionName===action);
      (schedules||[]).forEach(s=>{
        const exact=actionRows.find(r=>!used.has(r.id)&&r.scheduleKey===s.scheduleKey);
        if(exact){ used.add(exact.id); if(action==='上班打卡')s.clockInRecord=exact;else s.clockOutRecord=exact; }
      });
      actionRows.filter(r=>!used.has(r.id)).forEach(r=>{
        const candidates=(schedules||[]).filter(s=>!(action==='上班打卡'?s.clockInRecord:s.clockOutRecord)&&(!r.scheduleKey||r.scheduleKey===s.originalScheduleKey||r.scheduleKey===s.baseScheduleKey||r.originalScheduleKey===s.originalScheduleKey));
        if(!candidates.length)return; candidates.sort((a,b)=>score(r,a)-score(r,b)); const s=candidates[0]; used.add(r.id); if(action==='上班打卡')s.clockInRecord=r;else s.clockOutRecord=r;
      });
    }
    const today=currentDate(),now=nowMinutes();
    (schedules||[]).forEach(s=>{
      s.hasClockIn=!!s.clockInRecord; s.hasClockOut=!!s.clockOutRecord;
      if(s.hasClockIn)s.canClockInNow=false;
      s.canClockOutNow=s.date===today&&now>=minutes(s.startTime)&&s.hasClockIn&&!s.hasClockOut;
      if(s.hasClockOut)s.statusText='此班段已完成上下班打卡'; else if(s.hasClockIn)s.statusText='已完成上班打卡，等待下班打卡';
    });
    return {schedules,unassigned:rows.filter(r=>!used.has(r.id))};
  }

  async function effectiveScheduleInfo(employeeId,dateKey,options){
    options=options||{};
    const employee=options.employee||await activeEmployeeMaster(employeeId);
    if(!employee)return{ok:true,employeeId,date:dateKey,hasSchedule:false,okToClock:false,originalSchedules:[],schedules:[],schedule:null,scheduleText:'',allowedClockTypes:[],message:'這個人員主檔不存在或未啟用，不會讀取舊班表。',clockRecords:[],temporaryAttendanceBlocks:[],attendanceFlowVersion:VERSION};
    const base=options.base||await baseScheduleInfo(employeeId,dateKey); const rawSchedules=(base.schedules||[]).filter(s=>Number.isFinite(minutes(s.startTime))&&Number.isFinite(minutes(s.endTime))&&minutes(s.endTime)>minutes(s.startTime));
    let leaveRows=options.leaveRows||await rowsByEmployee('leaveRequests',employeeId).catch(()=>[]);
    const leaves=leaveRows.map(normalizeLeave);
    const requested=leaveIntervalsForDate(leaves.filter(l=>isActiveRow(l.raw)),dateKey);
    if(Array.isArray(options.additionalApprovedLeaves)) options.additionalApprovedLeaves.forEach(l=>leaves.push(Object.assign({},l&&l.segments?l:normalizeLeave(l),{status:APPROVED})));
    const approved=leaveIntervalsForDate(leaves,dateKey,APPROVED),pending=leaveIntervalsForDate(leaves,dateKey,PENDING);
    const schedules=[],fullyCovered=[];
    rawSchedules.forEach(raw=>{
      const start=minutes(raw.startTime),end=minutes(raw.endTime); const blocks=approved.map(x=>{ const c=clampInterval(x.start,x.end,start,end); return c?Object.assign({},x,{start:c[0],end:c[1]}):null; }).filter(Boolean);
      const pieces=subtractIntervals(start,end,blocks);
      if(!pieces.length){ fullyCovered.push(Object.assign({},raw,{originalScheduleKey:scheduleRawKey(raw),approvedLeaveBlocks:blocks})); return; }
      pieces.forEach((p,i)=>schedules.push(decorateEffectiveSchedule(raw,dateKey,p[0],p[1],i,pieces.length,blocks,pending)));
    });
    schedules.sort((a,b)=>minutes(a.startTime)-minutes(b.startTime)||minutes(a.endTime)-minutes(b.endTime));
    let records=[],temporaryBlocks=[]; if(options.includeClockState!==false){ const attendanceRows=await Promise.all([options.clockRecords?options.clockRecords.filter(r=>r.date===dateKey):clockRows(employeeId,dateKey),options.temporaryRows||rowsByEmployee('temporaryAttendanceRequests',employeeId).catch(()=>[])]); records=attendanceRows[0]; temporaryBlocks=temporaryAttendanceBlocksForDate(attendanceRows[1],dateKey); const covered=leaveCoveredClockIds({fullyCoveredSchedules:fullyCovered,originalSchedules:rawSchedules,clockRecords:records}); assignRecords(schedules,records.filter(r=>!isIndependentTemporaryClock(r)&&!covered.has(r.id))); const approvedTemporary=temporaryBlocks.filter(r=>r.status===APPROVED),pendingTemporary=temporaryBlocks.filter(r=>r.status===PENDING); schedules.forEach(s=>{ const start=minutes(s.startTime),end=minutes(s.endTime); s.approvedTemporaryAttendanceBlocks=approvedTemporary.filter(r=>rangesOverlap(start,end,r.start,r.end)); s.pendingTemporaryAttendanceBlocks=pendingTemporary.filter(r=>rangesOverlap(start,end,r.start,r.end)); s.attendanceSatisfiedByTemporary=intervalCoveredByBlocks(start,end,s.approvedTemporaryAttendanceBlocks); s.attendancePendingTemporary=!s.attendanceSatisfiedByTemporary&&intervalCoveredByBlocks(start,end,s.approvedTemporaryAttendanceBlocks.concat(s.pendingTemporaryAttendanceBlocks)); if(s.attendanceSatisfiedByTemporary){s.canClockInNow=false;s.canClockOutNow=false;s.statusText='此班段已有另筆核准臨時出勤紀錄，不列為缺勤。';}else if(s.attendancePendingTemporary)s.statusText+='｜另有臨時出勤待審核'; }); }
    const approvedAll=rawSchedules.length>0&&schedules.length===0;
    const message=!rawSchedules.length?'今天沒有排班，如主管臨時安排出勤，請使用「臨時出勤申請」。':approvedAll?'今天原有班表已被核准請假完整覆蓋，不需要打卡。':`今日有效出勤班段共 ${schedules.length} 段。`;
    return Object.assign({},base,{
      ok:true,employeeId,date:dateKey,hasSchedule:rawSchedules.length>0,okToClock:schedules.length>0,originalSchedules:rawSchedules,schedules,schedule:schedules[0]||null,
      scheduleText:schedules.map(s=>`${s.startTime}-${s.endTime}`).join('\n'),allowedClockTypes:schedules.length?['標準打卡','特殊打卡']:[],leaveBlocks:approved,pendingLeaveBlocks:pending,leaveRequestBlocks:requested,
      fullyCoveredSchedules:fullyCovered,approvedAllDay:approvedAll,message,clockRecords:records,temporaryAttendanceBlocks:temporaryBlocks,approvedTemporaryAttendanceBlocks:temporaryBlocks.filter(r=>r.status===APPROVED),pendingTemporaryAttendanceBlocks:temporaryBlocks.filter(r=>r.status===PENDING),attendanceFlowVersion:VERSION
    });
  }

  function chooseEffectiveSchedule(info,key,action,time){
    const rows=Array.isArray(info&&info.schedules)?info.schedules:[]; if(!rows.length)return null;
    const k=clean(key); let hit=rows.find(s=>s.scheduleKey===k||s.key===k); if(hit)return hit;
    const base=rows.filter(s=>s.originalScheduleKey===k||s.baseScheduleKey===k); const pool=base.length?base:rows; const t=minutes(time);
    return pool.slice().sort((a,b)=>{
      const ta=action&&action.includes('下班')?minutes(a.endTime):minutes(a.startTime),tb=action&&action.includes('下班')?minutes(b.endTime):minutes(b.startTime);
      return Math.abs((Number.isFinite(t)?t:ta)-ta)-Math.abs((Number.isFinite(t)?t:tb)-tb);
    })[0]||null;
  }

  function attendanceState(action,clockType,clockTime,schedule,isSupplement){
    const t=minutes(clockTime),st=minutes(schedule&&schedule.startTime),en=minutes(schedule&&schedule.endTime); let status=isSupplement?'補打卡':'正常',late=0,early=0;
    if(clean(clockType)==='標準打卡'&&clean(action).includes('上班')&&Number.isFinite(t)&&Number.isFinite(st)&&t>st){late=Math.round(t-st);status='遲到';}
    if(clean(clockType)==='標準打卡'&&clean(action).includes('下班')&&Number.isFinite(t)&&Number.isFinite(en)&&t<en){early=Math.round(en-t);status='早退';}
    return {status,lateMinutes:late,earlyLeaveMinutes:early};
  }

  function leaveCoveredClockIds(info){
    const full=info.fullyCoveredSchedules||[],original=info.originalSchedules||[],keys=new Set(full.map(scheduleRawKey));
    return new Set((info.clockRecords||[]).filter(r=>{
      if(isIndependentTemporaryClock(r)||!full.length)return false;
      const key=clean(r.originalScheduleKey||r.scheduleKey).split('::EFF::')[0];
      if(key)return keys.has(key);
      if(full.length===original.length)return true;
      // Legacy punches without a schedule ID are matched to the closest shift boundary.
      const time=minutes(r.time),out=clean(r.actionName).includes('下班');
      const candidates=original.map(s=>({s,d:Math.abs(time-minutes(out?s.endTime:s.startTime))})).sort((a,b)=>a.d-b.d);
      return candidates.length&&Number.isFinite(candidates[0].d)&&!(candidates[1]&&candidates[1].d===candidates[0].d)&&keys.has(scheduleRawKey(candidates[0].s));
    }).map(r=>r.id));
  }

 async function day(employee,date){
  const employeeId=clean(employee.employeeId||employee['員工ID']||employee.__id);
  const own=col=>(snapshot[col]||[]).filter(r=>clean(r.employeeId||r['員工ID']||r.userId)===employeeId);
  const base=await resolveTodaySchedule({employeeId,date},[own('singleDaySchedules'),own('employeeSchedules'),snapshot.scheduleTemplates||[],[]]);
  return effectiveScheduleInfo(employeeId,date,{employee,base,leaveRows:own('leaveRequests'),clockRecords:own('clockRecords').map(normalizeClock).filter(r=>isActiveRow(r.raw)),temporaryRows:own('temporaryAttendanceRequests')});
 }
 return {day};
}
module.exports={createScheduleComputer,localDateKey,timeText,minutes,clean,truthy};
