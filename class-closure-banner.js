(function(global){
  'use strict';
  const states=new WeakMap();
  const datesBySession=new Map();
  async function show(container,startDate,endDate,sessionToken=''){
    if(!container||!/^\d{4}-\d{2}-\d{2}$/.test(startDate||'')||!global.firebase?.apps?.length)return;
    const key=startDate+'|'+endDate+'|'+sessionToken,previous=states.get(container);
    if(previous?.key===key&&Date.now()-previous.at<30000)return;
    const state={key,at:Date.now()};states.set(container,state);
    let banner=container.querySelector(':scope > .ta-closed-banner');
    if(banner)banner.remove();
    try{
      const result=await global.firebase.app().functions('asia-east1').httpsCallable('coursePortalClassClosures')({startDate,endDate,sessionToken});
      if(states.get(container)!==state||!container.isConnected)return;
      const dates=datesBySession.get(sessionToken)||new Map();
      for(const date of dates.keys()){if(date>=startDate&&date<=endDate)dates.delete(date);}
      result.data.closures.forEach(row=>dates.set(row.date,row));datesBySession.set(sessionToken,dates);
      global.dispatchEvent(new CustomEvent('youzi-class-closures-updated'));
      if(!result.data.closures.length)return;
      banner=document.createElement('div');banner.className='ta-closed-banner';banner.setAttribute('role','status');
      banner.style.cssText='padding:12px 16px;margin:10px 0;background:#fff4d5;color:#65501a;border-radius:10px;line-height:1.6';
      banner.textContent=result.data.closures.map(c=>`${c.date} ${c.reason}｜停課，無法安排課程或預約。`).join(' ');
      container.prepend(banner);
    }catch(error){
      // A failed secondary read must not clear or change the existing timetable.
      states.delete(container);
      console.warn('停課標示暫時無法讀取',error.code||'unavailable');
    }
  }
  function adminCalendar(){
    if(location.hash!=='#course-calendar')return;
    const shadow=document.getElementById('opsCourseInlineShadowHost')?.shadowRoot;
    const page=shadow?.getElementById('calendarPage'),date=shadow?.getElementById('calendarDate')?.value;
    if(page&&date)show(page,date,date);
  }
  global.YouziClassClosureBanner={show,get:(date,sessionToken='')=>datesBySession.get(sessionToken)?.get(date)};
  global.addEventListener('youzi-calendar-layout',()=>setTimeout(adminCalendar,100));
  global.addEventListener('hashchange',()=>setTimeout(adminCalendar,100));
  global.addEventListener('focus',()=>{states.delete(document.getElementById('opsCourseInlineShadowHost')?.shadowRoot?.getElementById('calendarPage'));adminCalendar();});
  // Only observe the displayed date label, never the entire timetable.
  let observedLabel;
  setInterval(()=>{
    if(document.visibilityState==='hidden')return;
    const shadow=document.getElementById('opsCourseInlineShadowHost')?.shadowRoot;
    const label=shadow?.querySelector('.date-heading');
    if(label&&label!==observedLabel){observedLabel=label;new MutationObserver(adminCalendar).observe(label,{subtree:true,childList:true,characterData:true});}
    adminCalendar();
  },30000);
})(window);
