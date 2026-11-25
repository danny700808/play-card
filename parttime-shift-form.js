(() => {
  'use strict';
  const call=(action,payload)=>YZProtectedData.call('employeeSelfService',{action,payload});
  const context=workDate=>call('shift-hours-context',{workDate});
  const duration=n=>[Math.floor(n/60)?Math.floor(n/60)+' 小時':'',n%60?n%60+' 分鐘':''].filter(Boolean).join(' ')||'0 分鐘';
  const element=(tag,text='',cls='')=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
  function link(parent,text,url){const a=element('a',text);a.href=url;parent.append(a);}
  function inputField(parent,title,type){
    const label=element('label',title),input=element('input');input.type=type;input.required=true;
    if(type==='text')input.maxLength=500;label.append(input);parent.append(label);return input;
  }
  function form(parent,day,s,onDone){
    const box=element('section','','shift-confirm'), heading=element('h3');
    const pending=s.sides.filter(x=>x.status==='待審核');
    const needsChoice=s.sides.map(x=>x.time && x.delta>0 && !x.handled && x.status!=='已核准' && x.status!=='待審核');
    heading.textContent=s.submitted?'這班的工時':!s.ready?'這班還缺打卡紀錄':needsChoice[0]?'你今天幾點開始工作？':needsChoice[1]?'你今天幾點結束工作？':'確認這班工時';
    box.append(heading,element('p','排班時間　'+s.start+'–'+s.end));
    for(const [i,x] of s.sides.entries()){
      const label=i?'下班':'上班',delta=x.delta?'（'+(i?'早退':'遲到')+' '+x.delta+' 分鐘）':'';
      box.append(element('p',label+'打卡　'+(x.time?x.time+delta:'尚未打卡')));
      if(x.status) box.append(element('p',label+'時間更正 '+x.requestedTime+' · '+(x.status==='待審核'?'待主管審核':x.status),'shift-status'));
    }
    parent.append(box);
    if(s.separate){box.append(element('p','此班次由臨時出勤或提早下班申請處理。'));return;}
    if(s.submitted){
      box.append(element('p',s.ready?(pending.length?'目前暫計 ':'計薪工時 ')+duration(s.workedMinutes):'工時已送出，等候補卡確認。'));
      if(!s.ready && !pending.length)link(box,'查看打卡紀錄並補卡','clock.html?view=history');
      return;
    }
    if(!s.ready && !s.ended){
      box.append(element('p',s.sides[0].time?'下班打卡後即可確認工時。':'請先上班打卡。班次結束後若有漏打，可在這裡一併補卡。'));
      link(box,'前往打卡','clock.html');return;
    }
    if(day.managed || day.legacy) box.append(element('p','這天已有工時紀錄。更正會保留原有登記。'));
    const controls=element('form'),read=[];
    const bothMissing=s.sides.every(x=>!x.time && x.status!=='待審核');
    let sharedReason;
    box.append(controls);
    for(const [i,x] of s.sides.entries()){
      if(x.status==='待審核' || (x.time && (!x.delta || x.handled || x.status==='已核准')))continue;
      const side=i?'下班':'上班',group=element('fieldset'), fields=element('div');
      controls.append(group);group.append(element('legend',x.time?'請確認'+side+'時間':'補登'+side+'時間'));
      let choice='',time,reason;
      function choose(value){
        choice=value;fields.replaceChildren();time=null;
        if(choice==='correct')time=inputField(fields,'實際'+side+'時間','time');
        if(!bothMissing)reason=inputField(fields,choice==='actual'?(i?'早退原因':'遲到原因'):'原因','text');
      }
      if(x.time){
        for(const [value,text] of [['actual','我 '+x.time+(i?' 結束工作':' 開始工作')],['correct','更正'+side+'時間']]){
          const label=element('label','','shift-option'),radio=element('input');radio.type='radio';radio.name='side'+i;radio.required=true;
          radio.addEventListener('change',()=>choose(value));label.append(radio,document.createTextNode(text));group.append(label);
        }
      }else choose('correct');
      group.append(fields);read[i]=()=>({choice,time:time?.value||'',reason:(reason||sharedReason)?.value.trim()||''});
    }
    if(bothMissing)sharedReason=inputField(controls,'漏打原因','text');
    if(s.ready) controls.append(element('p','依打卡暫計 '+duration(s.workedMinutes)+'。','shift-status'));
    const doubleLabel=element('label','','shift-option'),double=element('input');double.type='checkbox';
    doubleLabel.append(double,document.createTextNode('雙倍計薪'));controls.append(doubleLabel);
    const submit=element('button','送出','btn'),result=element('p');submit.type='submit';result.setAttribute('role','status');controls.append(submit,result);
    controls.onsubmit=async e=>{
      e.preventDefault();if(submit.disabled)return;submit.disabled=true;result.textContent='送出中…';
      try{
        const res=await call('shift-hours-submit',{workDate:day.date,scheduleKey:s.key,doublePay:double.checked,answers:[0,1].map(i=>read[i]?read[i]():null)});
        if(!res.ok)throw Error(res.message);controls.replaceChildren(element('p',res.message,'shift-status'));onDone?.();
      }catch(err){result.textContent=err.message||'未送出，請再試一次。';submit.disabled=false;}
    };
  }
  function afterLateClockIn(date,key,recordId,clockTime,late){
    const parent=document.querySelector('#clockShiftConfirmation');parent.replaceChildren();
    const box=element('div','','shift-confirm'), opener=element('button','更正上班時間');
    box.append(element('p','上班打卡 '+shortTime(clockTime)+'（遲到 '+late+' 分鐘）'),opener);
    parent.append(box);
    opener.type='button';opener.onclick=()=>{
      opener.remove();
      const detail=element('form'),time=inputField(detail,'實際開始時間','time'),reason=inputField(detail,'更正原因','text');
      const submit=element('button','送出','btn'),msg=element('p');submit.type='submit';detail.append(submit,msg);box.append(detail);
      detail.onsubmit=async e=>{
        e.preventDefault();if(submit.disabled)return;submit.disabled=true;
        try{const r=await call('shift-clock-correction',{workDate:date,correctDate:date,scheduleKey:key,originalRecordId:recordId,correctAction:'上班打卡',correctTime:time.value,reason:reason.value});
          if(!r.ok)throw Error('班表已更新，請至打卡紀錄更正。');
          detail.replaceChildren(element('p',r.message,'shift-status'));
        }catch(err){msg.textContent=err.message;submit.disabled=false;}
      };
    };
  }
  const shortTime=t=>String(t||'').slice(0,5);
  async function afterClock(date,key){
    const parent=document.querySelector('#clockShiftConfirmation');parent.replaceChildren();
    try{
      const day=await context(date),s=day.shifts.find(x=>x.key===key);
      if(!s || s.separate)return;
      if(!s.exception || s.submitted || s.sides.every(x=>x.time && (!x.delta || x.handled || x.status==='待審核' || x.status==='已核准'))){
        if(s.sides.some(x=>x.status==='待審核'))parent.append(element('p','時間更正待主管審核。'));
        if(!s.submitted && !day.hoursRecorded)link(parent,'前往確認今日工時','parttime.html?date='+date);
        return;
      }
      const dlg=element('dialog','','shift-dialog'),inner=element('div'),later=element('button','稍後處理');later.type='button';
      dlg.setAttribute('aria-label','確認打卡與工時');dlg.append(inner,later);parent.append(dlg);
      form(inner,day,s,()=>{later.textContent='關閉';});later.onclick=()=>dlg.close();dlg.showModal();
    }catch{link(parent,'打卡已完成，前往確認工時','parttime.html?date='+date);}
  }
  window.ParttimeShiftForm={context,form,afterClock,afterLateClockIn};
})();
