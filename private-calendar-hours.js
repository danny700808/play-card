(function(root){'use strict';
 function hourRanges(date,hours){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('請選擇日期。');
  const selected=[...new Set(hours)].sort((a,b)=>a-b);
  if(!selected.length)throw Error('請至少選一格時間。');
  if(selected.some(h=>!Number.isInteger(h)||h<0||h>23))throw Error('時間格無效。');
  const groups=[];
  for(const h of selected){const last=groups[groups.length-1];if(last&&last.to===h)last.to=h+1;else groups.push({from:h,to:h+1});}
  return groups.map(g=>{const a=new Date(date+'T00:00:00'),b=new Date(a);if(!Number.isFinite(a.getTime()))throw Error('日期無效。');a.setHours(g.from);b.setHours(g.to);return {start:a.toISOString(),end:b.toISOString(),from:g.from,to:g.to};});
 }
 function agendaEvents(events,month,now=new Date()){
  const first=new Date(month.getFullYear(),month.getMonth(),1),end=new Date(month.getFullYear(),month.getMonth()+1,1);
  const cutoff=new Date(Math.max(first.getTime(),new Date(now).getTime()));if(cutoff>=end)return [];
  return events.filter(e=>new Date(e.start)<end&&new Date(e.end)>cutoff).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
 }
 async function saveJobs(jobs,api,progress=()=>{}){
  for(let index=0;index<jobs.length;index++){
   const job=jobs[index];if(job.done)continue;progress(index,jobs.length);
   if(!job.googleDone){
    if(job.googleWrite){const r=await api('googleWrite',{calendarId:job.event.calendarId,googleId:job.original?.googleId,etag:job.original?.etag,requestId:job.requestId,event:job.event});job.id=r.event.id;Object.assign(job.event,{source:'google',calendarId:r.event.calendarId,googleId:r.event.googleId});}
    job.googleDone=true;
   }
   if(!job.saved){
    // A response can be lost after the server has committed. Recover only an exact matching save.
    if(job.saveAttempted){const r=await api('detail',{id:job.id}).catch(e=>{if(String(e.code).includes('not-found'))return null;throw e;});const row=r?.event;
     if(row&&row.revision===job.revision+1&&['title','start','end','note','remind','reminderMinutes','completed','source','calendarId','googleId'].every(k=>k==='start'||k==='end'?Date.parse(row[k])===Date.parse(job.event[k]):(row[k]??'')===(job.event[k]??''))){job.saved=true;job.revision=row.revision;}
    }
    if(!job.saved){job.saveAttempted=true;const r=await api('save',{id:job.id,revision:job.revision,event:job.event});job.id=r.id;job.revision++;job.saved=true;}
   }
   while(job.uploaded<job.files.length){const f=job.files[job.uploaded];
    if(job.uploadAttempted){const r=await api('detail',{id:job.id});const found=(r.event.assets||[]).find(a=>!job.knownAssets.includes(a.id)&&a.name===f.name&&a.mime===f.mime&&a.size===f.size);if(found){job.knownAssets.push(found.id);job.uploaded++;job.uploadAttempted=false;continue;}}
    job.uploadAttempted=true;const r=await api('upload',{id:job.id,name:f.name,mime:f.mime,base64:f.base64});job.knownAssets.push(r.asset.id);job.uploaded++;job.uploadAttempted=false;
   }
   job.done=true;
  }
  return jobs.length;
 }
 const value={hourRanges,agendaEvents,saveJobs};if(typeof module==='object'&&module.exports)module.exports=value;else root.CalendarHours=value;
})(typeof globalThis!=='undefined'?globalThis:this);
