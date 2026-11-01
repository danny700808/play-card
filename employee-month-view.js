(function(global){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});
  function range(month){
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('請選擇年、月。');
    const [y,m]=month.split('-').map(Number);
    return {month,startDate:month+'-01',endDate:month+'-'+new Date(Date.UTC(y,m,0)).getUTCDate()};
  }
  function mount(target,{month=today().slice(0,7),onSearch,label='查詢'}={}){
    const el=typeof target==='string'?document.querySelector(target):target;
    const [year,mo]=month.split('-').map(Number),current=Number(today().slice(0,4));
    el.classList.add('employee-month-controls');
    el.innerHTML='<label>年<select aria-label="年">'+Array.from({length:Math.max(current+2,year)-2000+1},(_,i)=>2000+i).reverse().map(y=>'<option'+(y===year?' selected':'')+'>'+y+'</option>').join('')+'</select></label><label>月<select aria-label="月">'+Array.from({length:12},(_,i)=>i+1).map(m=>'<option value="'+m+'"'+(m===mo?' selected':'')+'>'+m+' 月</option>').join('')+'</select></label><button type="button" class="btn">'+esc(label)+'</button>';
    const selects=el.querySelectorAll('select'),button=el.querySelector('button');
    const get=()=>range(selects[0].value+'-'+selects[1].value.padStart(2,'0'));
    button.onclick=async()=>{button.disabled=true;try{await onSearch?.(get());}finally{button.disabled=false;}};
    return {get};
  }
  function rowsHtml(rows,{selectable=false}={}){
    if(!rows.length)return '<div class="employee-month-empty">尚無排班</div>';
    return rows.map(row=>{
      const start=row.startTime||'',end=row.endTime||'';
      const toMinutes=t=>{const [h,m]=t.split(':').map(Number);return h*60+m;};
      const hours=Math.round((toMinutes(end)-toMinutes(start))/60*100)/100;
      const day=new Date(row.date+'T12:00:00+08:00').toLocaleDateString('zh-TW',{weekday:'short',timeZone:'Asia/Taipei'});
      const temporary=row.source==='singleDaySchedules'||row.source==='temporaryAttendanceRequests';
      return '<div class="employee-shift-row"><div><strong>'+esc(row.date.slice(5)+' '+day)+'</strong><span>'+esc(start+'–'+end)+' · '+esc(hours)+' 小時</span></div>'+(temporary?'<span class="employee-shift-tag">臨時排班</span>':'')+(selectable?'<button type="button" class="btn secondary" data-leave-day="'+esc(row.date)+'">選擇</button>':'')+'</div>';
    }).join('');
  }
  global.EmployeeMonthView={range,mount,rowsHtml,today};
})(window);
