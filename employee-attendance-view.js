(function(global){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const action=r=>String(r.actionName||r.action||'').includes('下班')?'下班':'上班';
  const time=r=>String(r.time||r.clockTime||'').slice(0,5);
  const temporary=r=>String(r.clockType||'').includes('臨時')||!!r.temporaryAttendanceRequestId||!!r.raw?.temporaryAttendanceRequestId;
  function days(records){
    const groups=new Map(),seen=new Set();
    for(const r of records||[]){
      if(r.id&&seen.has(r.id))continue;if(r.id)seen.add(r.id);
      const date=r.date||r.workDate;if(!date)continue;
      if(!groups.has(date))groups.set(date,[]);groups.get(date).push({...r});
    }
    return [...groups].sort((a,b)=>b[0].localeCompare(a[0])).map(([date,rows])=>{
      const actual=rows.some(r=>!r.missing&&time(r)&&!r.pendingOnly);
      const absent=rows.some(r=>r.absenceConfirmed===true||r.raw?.absenceConfirmed===true);
      const unconfirmed=!actual&&!absent&&rows.some(r=>r.missing&&r.attendanceNeedsReview)&&!rows.some(r=>/待審|待主管/.test(r.status||''));
      rows.forEach(r=>{if(r.missing&&r.status==='曠職'&&!absent)r.status='未打卡';});
      const main=[],extra=[];
      for(const kind of ['上班','下班']){
        const matching=rows.filter(r=>action(r)===kind).sort((a,b)=>String(a.time||a.expectedTime||'').localeCompare(String(b.time||b.expectedTime||'')));
        const chosen=matching.find(r=>r.missing)||(kind==='上班'?matching[0]:matching[matching.length-1]);
        main.push(chosen||{date,actionName:kind+'打卡',missing:true,status:'未打卡',placeholder:true});
        extra.push(...matching.filter(r=>r!==chosen));
      }
      extra.sort((a,b)=>action(a).localeCompare(action(b),'zh-TW')||String(a.time||a.expectedTime||'').localeCompare(String(b.time||b.expectedTime||'')));
      return {date,absent,unconfirmed,temporary:rows.some(temporary),main,extra};
    });
  }
  function punch(r,index){
    const late=r.status==='遲到'||Number(r.lateMinutes)>0;
    const pending=r.pendingCorrection||/待審|待主管/.test(r.status||'');
    const status=pending?'待審核':r.missing?'未打卡':late?'遲到':r.status==='早退'?'早退':temporary(r)?'臨時出勤':'';
    const editable=!r.placeholder&&!pending&&(!r.missing||r.canModify);
    return `<div class="ea-punch"><span class="ea-action">${action(r)}</span><strong>${esc(time(r)||'—')}</strong><span class="ea-state ${late||r.missing?'ea-alert':''}">${esc(status)}</span><span class="ea-actions">${editable?`<button type="button" data-ea-correct="${index}">${r.missing?'補打卡':'修正'}</button>`:''}${r.missing&&editable?`<button type="button" data-ea-leave="${index}">請假</button>`:''}</span></div>`;
  }
  function mount(container,records,options={}){
    const rows=[];
    const render=r=>{const i=rows.push(r)-1;return punch(r,i);};
    container.innerHTML=days(records).map(d=>`<section class="ea-day"><header><strong>${esc(d.date)}</strong>${d.absent?'<span class="ea-badge ea-alert">曠職</span>':d.unconfirmed?'<span class="ea-badge">整天未打卡・待確認</span>':d.temporary?'<span class="ea-badge">含臨時出勤</span>':''}</header>${d.main.map(render).join('')}${d.extra.length?`<details><summary>其他班段（${d.extra.length} 筆）</summary>${d.extra.map(render).join('')}</details>`:''}</section>`).join('')||'<div class="ea-empty">尚無資料</div>';
    container.querySelectorAll('[data-ea-correct]').forEach(button=>button.onclick=()=>correction(rows[Number(button.dataset.eaCorrect)],options));
    container.querySelectorAll('[data-ea-leave]').forEach(button=>button.onclick=()=>options.onLeave?.(rows[Number(button.dataset.eaLeave)]));
  }
  function correction(row,options){
    const doc=global.document,dialog=doc.createElement('dialog');dialog.className='ea-dialog';
    dialog.innerHTML=`<form><header><h2>${row.missing?'補打卡':'修正打卡時間'}</h2><button type="button" data-close aria-label="關閉">×</button></header><p class="ea-selected-date">${esc(row.date)} · ${action(row)}</p><label>正確時間<input type="time" name="time" value="${esc(time(row)||String(row.expectedTime||'').slice(0,5))}" required></label><label>原因<textarea name="reason" rows="2" required></textarea></label><div class="ea-error" role="alert"></div><button class="ea-submit" type="submit" ${options.readonly?'disabled':''}>${options.readonly?'唯讀檢視':'送出修正申請'}</button></form>`;
    doc.body.append(dialog);dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();dialog.showModal();
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();if(options.readonly)return;
      const btn=dialog.querySelector('[type=submit]'),error=dialog.querySelector('.ea-error'),form=dialog.querySelector('form');
      const reason=form.elements.reason.value.trim(),correctTime=form.elements.time.value;
      if(!reason||!correctTime){error.textContent='請填寫時間與原因。';return;}
      btn.disabled=true;error.textContent='';
      try{
        const schedule=row.scheduleSnapshot||{},result=await options.api('submitClockCorrection',{userId:options.userId,requestKind:row.missing?'missingClock':'recordCorrection',originalRecordId:row.missing?'':row.id,correctDate:row.date,correctTime,correctAction:row.actionName,correctionType:row.clockType||'標準打卡',reason,...(row.missing?{scheduleKey:row.scheduleKey||schedule.scheduleKey,scheduleStartTime:schedule.startTime,scheduleEndTime:schedule.endTime,scheduleSnapshot:schedule}:{})});
        if(!result?.ok)throw Error(result?.message||'送出失敗');dialog.close();await options.onChanged?.();
      }catch(e){error.textContent=e.message;btn.disabled=false;}
    };
  }
  const exported={days,mount,punch,correction};
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
  global.EmployeeAttendanceView=exported;
})(typeof window==='undefined'?globalThis:window);
