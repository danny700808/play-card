(function(root){'use strict';
 async function saveJobs(jobs,api,progress=()=>{}){const totals={sent:0,pending:0};for(let i=0;i<jobs.length;i++){const job=jobs[i];if(job.done){totals.sent+=job.notification?.sent||0;totals.pending+=job.notification?.pending||0;continue;}progress(i,jobs.length);
  if(!job.saved){if(job.attempted){const old=await api('detail',{id:job.id}).catch(e=>{if(['PERMISSION_DENIED','NOT_FOUND'].includes(e.code))return null;throw e;});if(old?.task&&old.task.revision===job.revision+1&&old.task.assignedTo===job.assignedTo&&Object.keys(job.event).every(k=>JSON.stringify(old.task[k])===JSON.stringify(job.event[k])))job.saved=true;}
   if(!job.saved){job.attempted=true;await api('save',{id:job.id,revision:job.revision,assignedTo:job.assignedTo,event:job.event});job.saved=true;}}
  while(job.uploaded<job.files.length){await api('upload',{id:job.id,...job.files[job.uploaded]});job.uploaded++;}
  const result=await api('publish',{id:job.id});job.notification=result.notification;job.done=true;totals.sent+=result.notification?.sent||0;totals.pending+=result.notification?.pending||0;
 }return totals;}
 if(typeof module==='object'&&module.exports)module.exports={saveJobs};else root.SharedCalendarJobs={saveJobs};
})(typeof globalThis!=='undefined'?globalThis:this);
