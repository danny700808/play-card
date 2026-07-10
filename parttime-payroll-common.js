(function(global){
  'use strict';

  function clean(v){ return String(v == null ? '' : v).trim(); }
  function lower(v){ return clean(v).toLowerCase(); }
  function truthy(v){
    const s = lower(v);
    return v === true || ['是','yes','true','1','active','enabled','啟用'].includes(s);
  }
  function number(v){
    if(v && typeof v.toDate === 'function') return 0;
    if(v instanceof Date) return 0;
    const n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  }
  function firstValue(o, keys){
    const sources = [o, o && o.source, o && o.raw, o && o.raw && o.raw.source];
    for(const src of sources){
      if(!src || typeof src !== 'object') continue;
      for(const key of keys){
        if(src[key] != null && clean(src[key]) !== '') return src[key];
      }
    }
    return '';
  }
  function recordIdOf(r){
    return clean(r && (r.id || r.recordId || r.__id || firstValue(r, ['recordId','紀錄ID'])));
  }
  function employeeIdOf(r){
    return clean(r && (r.employeeId || firstValue(r, ['員工ID'])));
  }
  function employeeNameOf(r){
    return clean(r && (r.name || firstValue(r, ['姓名','employeeName']))).replace(/\s+/g, ' ');
  }
  function employeeEmailOf(r){
    return lower(r && (r.email || firstValue(r, ['Email'])));
  }
  function knownEmployeeIdSet(employees){
    return new Set((employees || []).map(e=>clean(e && (e.id || e.employeeId || firstValue(e, ['員工ID'])))).filter(Boolean));
  }

  // 配對優先順序：員工 ID → Email → 舊資料姓名。
  // 姓名只在紀錄沒有 ID，或該 ID 已不屬於現有任何員工時才作為備援，避免同名誤配。
  function employeeMatchReason(record, employee, employees){
    if(!record || !employee) return '';
    const rid = employeeIdOf(record);
    const eid = clean(employee.id || employee.employeeId || firstValue(employee, ['員工ID']));
    if(rid && eid && rid === eid) return 'id';

    const remail = employeeEmailOf(record);
    const eemail = lower(employee.email || firstValue(employee, ['Email']));
    if(remail && eemail && remail === eemail) return 'email';

    const rname = employeeNameOf(record);
    const ename = clean(employee.name || firstValue(employee, ['姓名'])).replace(/\s+/g, ' ');
    if(!rname || !ename || rname !== ename) return '';
    if(!rid) return 'name';

    const knownIds = knownEmployeeIdSet(employees);
    return knownIds.has(rid) ? '' : 'legacyName';
  }
  function sameEmployee(record, employee, employees){
    return !!employeeMatchReason(record, employee, employees);
  }

  function isApprovedStatus(status){
    const s = lower(status);
    return ['已核准','核准','approved','approve','已同意','通過'].includes(s);
  }
  function isBadStatus(status){
    const s = lower(status);
    if(!s) return false;
    const exact = [
      '待審核','pending','待主管審核','審核中','已駁回','駁回','rejected','已退回','退回',
      '已刪除','刪除','deleted','作廢','void','voided','已取消','取消','cancelled','canceled',
      '被取代','已被取代','superseded','已被修正','不計薪','不支薪'
    ];
    if(exact.includes(s)) return true;
    return ['待審核','駁回','退回','已刪除','作廢','已取消','被取代','不計薪','不支薪'].some(x=>s.includes(x));
  }
  function isDeletedLike(record){
    return truthy(firstValue(record, [
      'deleted','isDeleted','已刪除','voided','isVoided','作廢','cancelled','canceled','isCancelled','已取消'
    ]));
  }

  function timestampValue(v){
    if(v && typeof v.toDate === 'function') v = v.toDate();
    if(v instanceof Date && !isNaN(v.getTime())) return v.getTime();
    if(typeof v === 'number' && Number.isFinite(v)) return v;
    const parsed = Date.parse(clean(v));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  function updatedValue(record){
    return timestampValue(record && (record.updatedAt || firstValue(record, ['最後更新時間','reviewedAt','審核時間','createdAt','建立時間'])));
  }

  function isPayableParttimeRecord(record){
    if(!record || !clean(record.date)) return false;
    if(isBadStatus(record.status)) return false;
    if(clean(record.replacedByRecordId || firstValue(record, ['supersededBy','被取代紀錄ID']))) return false;
    if(isDeletedLike(record)) return false;
    const payable = lower(record.payable || firstValue(record, ['是否計薪']));
    if(['否','no','false','0','不計薪','不支薪'].includes(payable)) return false;
    return true;
  }

  function latestEffectiveParttimeRecords(rows){
    const good = (rows || []).filter(isPayableParttimeRecord);
    const replacedIds = new Set();
    good.forEach(r=>{
      [r.replacementOf, r.replacesRecordId, firstValue(r, ['replacementOf','replacesRecordId','取代紀錄ID','原紀錄ID'])]
        .map(clean).filter(Boolean).forEach(id=>replacedIds.add(id));
    });
    const map = new Map();
    good.forEach(r=>{
      const id = recordIdOf(r);
      if(id && replacedIds.has(id)) return;
      const key = id || [employeeIdOf(r), clean(r.date), clean(r.note), number(r.totalHours || r.hours)].join('|');
      const old = map.get(key);
      if(!old || updatedValue(r) >= updatedValue(old)) map.set(key, r);
    });
    return Array.from(map.values());
  }

  function isClockRecordEffective(record){
    if(!record || !clean(record.date)) return false;
    if(isBadStatus(record.status)) return false;
    if(lower(record.status).includes('已被補登修正')) return false;
    if(clean(record.replacedByRecordId || firstValue(record, ['supersededBy','被取代紀錄ID']))) return false;
    if(isDeletedLike(record)) return false;
    return true;
  }

  function latestEffectiveClockRecords(rows){
    const good = (rows || []).filter(isClockRecordEffective);
    const replacedIds = new Set();
    good.forEach(r=>{
      const explicit = [r.replacementOf, r.replacesRecordId, firstValue(r, ['replacementOf','replacesRecordId','取代紀錄ID'])];
      explicit.map(clean).filter(Boolean).forEach(id=>replacedIds.add(id));
      const originalId = clean(r.originalRecordId || firstValue(r, ['原始紀錄ID']));
      const isSupplement = truthy(r.isSupplement || firstValue(r, ['是否補登'])) || lower(r.status).includes('補打卡');
      if(isSupplement && originalId) replacedIds.add(originalId);
    });
    const map = new Map();
    good.forEach(r=>{
      const id = recordIdOf(r);
      if(id && replacedIds.has(id)) return;
      const key = id || [employeeIdOf(r), clean(r.date), clean(r.actionName || r.action), clean(r.time || r.clockIn || r.clockOut)].join('|');
      const old = map.get(key);
      if(!old || updatedValue(r) >= updatedValue(old)) map.set(key, r);
    });
    return Array.from(map.values());
  }

  function clockIds(record){
    return Array.from(new Set([
      clean(record && record.id),
      clean(record && record.recordId),
      clean(record && record.__id),
      recordIdOf(record),
      clean(record && record.originalRecordId),
      clean(record && record.replacementOf),
      clean(record && record.sourceClockId),
      clean(record && record.appliedRecordId)
    ].filter(Boolean)));
  }
  function correctionIds(correction){
    return [
      clean(correction && correction.originalRecordId),
      clean(correction && correction.sourceClockId),
      clean(correction && correction.clockRecordId),
      clean(correction && correction.targetRecordId),
      clean(correction && correction.approvedRecordId),
      clean(correction && correction.appliedRecordId)
    ].filter(Boolean);
  }
  function correctionDate(correction){
    return clean(correction && (correction.date || correction.correctDate || correction.originalDate || firstValue(correction, ['日期','修正日期','原日期'])));
  }
  function correctionMatchesClock(correction, clockRecord, employee, employees){
    if(!correction || !clockRecord || !isApprovedStatus(correction.status)) return false;
    if(employee && !sameEmployee(correction, employee, employees)) return false;

    const requestId = clean(correction.id || correction.requestId || correction.__id);
    const rowRequestId = clean(clockRecord.correctionRequestId || firstValue(clockRecord, ['correctionRequestId','修正申請ID']));
    if(requestId && rowRequestId && requestId === rowRequestId) return true;

    const refs = correctionIds(correction);
    const rowIds = clockIds(clockRecord);
    if(refs.length) return refs.some(id=>rowIds.includes(id));

    // 舊資料沒有紀錄 ID 時才退回同日配對；新資料有 ID 卻對不到時不會誤把整天都免扣。
    const cDate = correctionDate(correction);
    return !!(cDate && cDate === clean(clockRecord.date));
  }

  function isExplicitLateWaiver(correction){
    if(!correction) return false;

    const flagValues = [
      correction.noLateDeduction,
      correction.lateDeductionWaived,
      firstValue(correction, ['noLateDeduction','lateDeductionWaived','不扣款','免扣款'])
    ];
    if(flagValues.some(truthy)) return true;

    // 只有主管明確選擇「不扣款／免扣款」才算免扣。
    // 不讀取員工填寫的原因或備註，避免一般打卡修正被誤判為免扣款。
    const decision = lower([
      correction.decision,
      firstValue(correction, ['decision','處理結果','審核結果','waiverDecision','lastAdjustmentType','調整類型'])
    ].filter(Boolean).join('|'));
    return decision.includes('不扣款') || decision.includes('免扣款') || decision.includes('latewaiver') || decision.includes('late waiver');
  }

  function isClockInLike(record){
    const action = lower(record && (record.actionName || record.action));
    if(!action) return true;
    const isOut = action.includes('下班') || action.includes('clockout') || action === 'out' || action.includes('簽退');
    const isIn = action.includes('上班') || action.includes('clockin') || action === 'in' || action.includes('簽到');
    if(isOut && !isIn) return false;
    return true;
  }

  function calculateLate(options){
    const opts = options || {};
    const employee = opts.employee || {};
    const employees = opts.employees || [];
    const month = clean(opts.month);
    const hourlyRate = number(opts.hourlyRate || employee.hourlyRate);
    const approvedCorrections = (opts.corrections || []).filter(c=>isApprovedStatus(c.status) && sameEmployee(c, employee, employees));
    const rows = latestEffectiveClockRecords(opts.clockRows || []).filter(r=>{
      if(!sameEmployee(r, employee, employees)) return false;
      if(month && clean(r.date).slice(0,7) !== month) return false;
      return true;
    });

    const entries = [];
    const correctedEntries = [];
    rows.forEach(r=>{
      if(!isClockInLike(r)) return;
      const matchingCorrections = approvedCorrections.filter(c=>correctionMatchesClock(c, r, employee, employees));
      const recordWaived = [
        r.noLateDeduction,
        r.lateDeductionWaived,
        firstValue(r, ['noLateDeduction','lateDeductionWaived','不扣款','免扣款'])
      ].some(truthy);
      const correctionWaived = matchingCorrections.some(isExplicitLateWaiver);
      const waived = recordWaived || correctionWaived;
      let minutes = Math.max(0, Math.round(number(r.lateMinutes != null ? r.lateMinutes : r.late)));

      // 舊版「核准不扣款」曾把遲到分鐘直接改成 0。若資料中仍保留原始分鐘，將它放回
      // correctedEntries，才能在畫面顯示「原遲到 X 分鐘，主管核准不扣款」，同時不計入扣款。
      if(minutes <= 0 && waived){
        const candidates = [
          number(firstValue(r, ['originalLateMinutes','原始遲到分鐘','原遲到分鐘'])),
          ...matchingCorrections.map(c=>number(firstValue(c, ['originalLateMinutes','原始遲到分鐘','原遲到分鐘'])))
        ];
        minutes = Math.max(0, ...candidates.map(v=>Math.round(v)));
      }
      if(minutes <= 0) return;
      const item = {
        id: recordIdOf(r),
        date: clean(r.date),
        minutes,
        record:r,
        matchReason:employeeMatchReason(r, employee, employees)
      };
      (waived ? correctedEntries : entries).push(item);
    });

    function groupByDate(list){
      const map = new Map();
      list.forEach(item=>{
        const old = map.get(item.date) || {date:item.date, minutes:0, entries:[]};
        old.minutes += item.minutes;
        old.entries.push(item);
        map.set(item.date, old);
      });
      return Array.from(map.values()).sort((a,b)=>a.date.localeCompare(b.date));
    }

    const byDate = groupByDate(entries);
    const correctedByDate = groupByDate(correctedEntries);
    const lateMinutes = Math.round(entries.reduce((sum,item)=>sum + item.minutes, 0));
    const lateDeduction = Math.round((hourlyRate / 60) * lateMinutes);
    return {
      rows,
      entries,
      correctedEntries,
      byDate,
      correctedByDate,
      lateMinutes,
      lateDeduction,
      hourlyRate,
      legacyMatchCount: entries.filter(x=>x.matchReason !== 'id').length
    };
  }

  global.YZParttimePayroll = Object.freeze({
    clean,
    lower,
    truthy,
    number,
    firstValue,
    recordIdOf,
    employeeMatchReason,
    sameEmployee,
    isApprovedStatus,
    isBadStatus,
    isDeletedLike,
    isPayableParttimeRecord,
    latestEffectiveParttimeRecords,
    isClockRecordEffective,
    latestEffectiveClockRecords,
    correctionMatchesClock,
    isExplicitLateWaiver,
    calculateLate
  });
})(window);
