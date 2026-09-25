(function(root){'use strict';
 async function saveJobs(jobs,api,progress=()=>{}){const totals={sent:0,pending:0};for(let i=0;i<jobs.length;i++){const job=jobs[i];if(job.done){totals.sent+=job.notification?.sent||0;totals.pending+=job.notification?.pending||0;continue;}progress(i,jobs.length);
  if(!job.saved){if(job.attempted){const old=await api('detail',{id:job.id}).catch(e=>{if(['PERMISSION_DENIED','NOT_FOUND','functions/permission-denied','functions/not-found'].includes(e.code))return null;throw e;});if(old?.task&&old.task.revision===job.revision+1&&old.task.assignedTo===job.assignedTo&&Object.keys(job.event).every(k=>JSON.stringify(old.task[k])===JSON.stringify(job.event[k])))job.saved=true;}
   if(!job.saved){job.attempted=true;await api('save',{id:job.id,revision:job.revision,assignedTo:job.assignedTo,event:job.event});job.saved=true;}}
  while(job.uploaded<job.files.length){await api('upload',{id:job.id,...job.files[job.uploaded]});job.uploaded++;}
  const result=await api('publish',{id:job.id});job.notification=result.notification;job.done=true;totals.sent+=result.notification?.sent||0;totals.pending+=result.notification?.pending||0;
 }return totals;}
 const changeKey='youziSharedCalendarChange';
 function rememberChange(storage,start,now=Date.now()){const date=new Date(start);if(!Number.isFinite(+date))return '';const day=new Date(+date-date.getTimezoneOffset()*60000).toISOString().slice(0,10);try{storage.setItem(changeKey,JSON.stringify({day,at:now}));}catch{}return day;}
 function recentChange(storage,lastAt=0,now=Date.now()){try{const row=JSON.parse(storage.getItem(changeKey));if(!row||!/^\d{4}-\d{2}-\d{2}$/.test(row.day)||!Number.isFinite(Date.parse(row.day+'T12:00:00'))||!Number.isFinite(row.at)||row.at<=lastAt||row.at>now||now-row.at>30*60000)return null;return row;}catch{return null;}}
 if(typeof module==='object'&&module.exports)module.exports={saveJobs,rememberChange,recentChange,changeKey};else root.SharedCalendarJobs={saveJobs,rememberChange,recentChange,changeKey};
})(typeof globalThis!=='undefined'?globalThis:this);
