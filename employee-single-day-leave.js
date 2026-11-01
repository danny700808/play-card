(function(global){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const minutes=t=>{const [h,m]=String(t||'').split(':').map(Number);return h*60+m;};
  const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
  function ranges(shifts){
    const result=[];
    for(const s of [...shifts].sort((a,b)=>a.startTime.localeCompare(b.startTime))){
      const start=minutes(s.startTime),end=minutes(s.endTime);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue;
      const last=result[result.length-1];if(last&&start<=last.end)last.end=Math.max(last.end,end);else result.push({start,end});
    }
    return result;
  }
  function timeOptions(shifts,start){
    const periods=ranges(shifts),values=[];
    for(const r of periods){
      if(start!==undefined){const n=minutes(start);if(n<r.start||n>=r.end)continue;for(let t=n+30;t<r.end;t+=30)values.push(clock(t));values.push(clock(r.end));}
      else {values.push(clock(r.start));for(let t=Math.ceil((r.start+1)/30)*30;t<r.end;t+=30)values.push(clock(t));}
    }
    return [...new Set(values)];
  }
  function open(options){
    const {date,shifts,api,userId}=options,doc=global.document;
    if(!shifts?.length)throw Error('這一天沒有可請假的班表。');
    const request=options.request,segment=request?.segments?.[0];let mode=segment&&!segment.allDay&&segment.mode!=='schedule'?'custom':'schedule';
    const dialog=doc.createElement('dialog');dialog.className='ea-dialog';
    dialog.innerHTML=`<form><header><h2>${request?'修改請假':'請假申請'}</h2><button type="button" data-close aria-label="關閉">×</button></header><p class="ea-selected-date">${esc(date)}</p><p class="ea-shifts">${shifts.map(s=>esc(s.startTime+'–'+s.endTime)).join('／')}</p><label>假別<select name="reason" required><option value="">請選擇</option>${(options.reasons||['事假','病假']).map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select></label><div class="ea-choice"><button type="button" data-mode="schedule">整天請假</button><button type="button" data-mode="custom">部分請假</button></div><div class="ea-time-grid" hidden><label>開始時間<select name="start"></select></label><label>結束時間<select name="end"></select></label></div><label>理由<textarea name="note" rows="2" required></textarea></label><details><summary>附件（選填）</summary><input class="ea-attachment" name="attachment" type="file" accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"></details><div class="ea-error" role="alert"></div><button class="ea-submit" type="submit" ${options.readonly?'disabled':''}>${options.readonly?'唯讀檢視':'送出請假申請'}</button></form>`;
    const form=dialog.querySelector('form'),error=dialog.querySelector('.ea-error'),start=form.elements.start,end=form.elements.end;
    const fill=(el,values,value)=>{el.innerHTML=values.map(v=>`<option value="${v}">${v}</option>`).join('');if(values.includes(value))el.value=value;};
    const ends=()=>fill(end,timeOptions(shifts,start.value),end.value);
    fill(start,timeOptions(shifts),segment?.startTime||options.startTime);ends();if(timeOptions(shifts,start.value).includes(segment?.endTime||options.endTime))end.value=segment?.endTime||options.endTime;
    if(options.startTime&&options.endTime)mode='custom';
    const setMode=next=>{mode=next;dialog.querySelector('.ea-time-grid').hidden=mode!=='custom';dialog.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));error.textContent='';};
    dialog.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));start.onchange=ends;setMode(mode);
    form.elements.reason.value=request?.reason||'';form.elements.note.value=request?.note||'';
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();doc.body.append(dialog);dialog.showModal();
    form.onsubmit=async event=>{
      event.preventDefault();if(options.readonly)return;
      const reason=form.elements.reason.value,note=form.elements.note.value.trim();
      if(!reason||!note){error.textContent='請選擇假別並填寫理由。';return;}
      if(mode==='custom'&&(!timeOptions(shifts).includes(start.value)||!timeOptions(shifts,start.value).includes(end.value)||minutes(end.value)<=minutes(start.value))){error.textContent='結束時間必須晚於開始時間，並在當天班表內。';return;}
      const button=dialog.querySelector('[type=submit]');button.disabled=true;error.textContent='';
      try{
        const segments=[mode==='schedule'?{mode:'schedule',allDay:true,startDate:date,endDate:date}:{mode:'custom',leaveDate:date,startTime:start.value,endTime:end.value}];
        const payload={...options.extraPayload,userId,reason,note,segments,singleDayFlow:true,requestType:'一般請假',...(request?{requestId:request.requestId}:{})};
        const impact=await api('getLeaveReplacementImpact',payload);if(!impact?.ok)throw Error(impact?.message||'無法核對既有出勤，請稍後再試。');
        if(impact.requiresConfirmation){
          const replaced=impact.rows.some(r=>r.clocks?.some(c=>c.replaced));
          const message=mode==='schedule'&&replaced?'這一天已有打卡。主管核准整天請假後，原打卡將從出勤紀錄移除，對應工時也會調整。':'這個請假時段已有出勤或工時。主管核准後，系統會調整對應紀錄與工時。';
          if(!global.confirm(message+'\n原始紀錄保留供查核，送審期間不變動。\n是否確認送出？')){button.disabled=false;return;}
        }
        payload.leaveReplacementAcknowledged=true;
        const file=form.elements.attachment.files[0];if(file){if(file.size>30*1024*1024)throw Error('附件請勿超過 30 MB。');payload.attachment=await options.fileToDataUrl(file);}
        const result=await api(request?'modifyLeaveRequest':'leaveRequest',payload);if(!result?.ok)throw Error(result?.message||'送出失敗');
        dialog.close();await options.onSaved?.(result,payload);
      }catch(e){error.textContent=e.message;button.disabled=false;}
    };
    return dialog;
  }
  const exported={open,ranges,timeOptions};if(typeof module!=='undefined'&&module.exports)module.exports=exported;global.EmployeeSingleDayLeave=exported;
})(typeof window==='undefined'?globalThis:window);
