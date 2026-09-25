/* Private calendar: all data and attachments go through owner-checked Functions. */
(()=>{'use strict';
 const $=id=>document.getElementById(id),S={month:new Date(),events:[],calendars:[],status:{},current:null,pending:[],urls:[],recorder:null,stream:null,saving:false};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const local=d=>{const date=new Date(d);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);};
 const stamp=d=>new Date(d).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
 let call,accessCall;
 let calendarSession=sessionStorage.getItem("youziCalendarSession")||"";
 async function api(action,data={}){if(!call)throw Error('請稍候再試。');try{return (await call({action,...data,...(calendarSession?{calendarSession}:{})})).data;}catch(e){if(e.code==='functions/unauthenticated')showGate(e.message);throw e;}}
 async function workApi(action,data={}){try{return (await calendarRequest('sharedCalendarApi',{action,...data,calendarSession})).data;}catch(e){if(e.code==='functions/unauthenticated')showGate(e.message);throw e;}}
 function workEvent(t){return {...t,id:'shared:'+t.id,taskId:t.id,source:'shared',completed:t.status==='done'};}
 const workLabels={pending:'待處理',in_progress:'處理中',done:'已完成',cancelled:'已取消'};
 function message(msg,error=false){$('status').textContent=msg;$('status').hidden=!msg;$('status').classList.toggle('error',error);}
 async function safely(fn,target='status'){try{await fn();}catch(e){if(target==='status')message(e.message,true);else $(target).textContent=e.message;}}
 function range(){const first=new Date(S.month.getFullYear(),S.month.getMonth(),1),offset=(first.getDay()+6)%7;return {start:new Date(first.getFullYear(),first.getMonth(),1-offset).toISOString(),end:new Date(first.getFullYear(),first.getMonth(),43-offset).toISOString()};}
 async function refresh(){
  message('正在讀取行程…');S.status=await api('status');S.workStatus=await workApi('status').catch(()=>null);
  S.calendars=S.status.googleConnected?(await api('calendars').catch(()=>({calendars:[]}))).calendars:[];
  const result=await api('list',range());let workWarning='';const work=await workApi('list',range()).catch(e=>{if(e.code==='functions/unauthenticated')throw e;workWarning='交辦工作未能載入：'+e.message;return {tasks:[]};});if(!calendarSession)return;S.events=[...result.events,...work.tasks.filter(t=>!t.draft).map(workEvent)];render();if(workWarning)result.warnings=[...(result.warnings||[]),workWarning];
  $('connection').hidden=true;
  message(result.warnings?.length?result.warnings.join('；'):'',!!result.warnings?.length);settingsRender();
 }
 const dayKey=d=>local(d).slice(0,10);
 S.selected=dayKey(new Date());
 const sourceColor=e=>e.source==='shared'?'#a32270':e.source!=='google'?'#202020':S.calendars.find(c=>c.id===e.calendarId)?.primary?'#6524d6':'#d71920';
 const sourceName=e=>e.source==='shared'?(e.createdBy==='owner'?'我交辦給 '+(e.assignedTo==='owner'?'自己':e.assignedName):e.assignedTo==='owner'?(e.createdName||'成員')+' 交辦給我':(e.createdName||'成員')+' → '+(e.assignedName||'成員'))+' · '+(workLabels[e.status]||'待處理'):e.source!=='google'?'私人記事 · 未同步 Google':S.calendars.find(c=>c.id===e.calendarId)?.primary?'我的行程 · 黃DO RE MI':e.calendarId==='d3460fysw@gmail.com'?'豐原西南社':e.calendarName||'其他日曆';
 function onDay(e,date){const d=new Date(date+'T00:00:00'),next=new Date(d);next.setDate(next.getDate()+1);const begin=e.allDay?new Date(e.start.slice(0,10)+'T00:00:00'):new Date(e.start);return begin<next&&new Date(e.end)>d;}
 function eventTime(e){return e.allDay?new Date(e.start).toLocaleDateString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric'})+' 全天':stamp(e.start)+' → '+stamp(e.end);}
 let googlePreviewVersion=0;
 async function showGooglePreview(id){const version=++googlePreviewVersion;$('googlePreview').textContent='正在從 Google 讀取…';$('googleViewer').showModal();try{const result=await api('list',range()),event=result.events.find(e=>e.id===id&&e.source==='google');if(!event)throw Error(result.warnings?.join('；')||'找不到這筆 Google 行程，請同步更新後重試。');if(version!==googlePreviewVersion||!$('googleViewer').open)return;$('googlePreview').innerHTML='<h3>'+esc(event.title)+'</h3><p class="previewTime">'+esc(eventTime(event))+'</p><p>'+esc(event.calendarName||'Google 行事曆')+'</p>'+(event.description?'<p class="googleDescription">'+esc(event.description)+'</p>':'');}catch(e){if(version===googlePreviewVersion)$('googlePreview').textContent=e.message;}}
 $('googleViewer').addEventListener('close',()=>{googlePreviewVersion++;$('googlePreview').replaceChildren();});
 function renderReminderChoices(row){const selected=row?(row.reminderOffsets||[row.reminderMinutes??10]):[60],values=[30,60,120,180,1440,2880,4320],labels={30:'提前30分鐘',60:'提前1小時',120:'提前2小時',180:'提前3小時',1440:'提前1天',2880:'提前2天',4320:'提前3天'};for(const n of selected)if(!values.includes(n)){values.push(n);labels[n]=n===0?'開始時（原設定）':'提前'+n+'分鐘（原設定）';}$('reminderChoices').innerHTML=values.map(n=>'<label class="reminderChoice"><input type="checkbox" value="'+n+'" '+(selected.includes(n)?'checked':'')+'><span>'+labels[n]+'</span></label>').join('');}
 function selectedReminders(){const values=[...$('reminderChoices').querySelectorAll('input:checked')].map(e=>Number(e.value)).sort((a,b)=>a-b);if($('remind').checked&&!values.length)throw Error('請至少選擇一個 LINE 提醒時間。');return values;}
 function eventRows(rows){return rows.map(e=>'<article class="dayEvent '+(e.completed?'done':'')+'" style="--event-color:'+sourceColor(e)+'"><button class="eventMain" data-event="'+esc(e.id)+'"><time>'+esc(eventTime(e))+'</time><strong>'+esc(e.title)+'</strong><small>'+esc(sourceName(e))+(e.remind?' · LINE 提醒':'')+(e.completed?' · 已完成':'')+'</small></button>'+((e.assets||[]).length?'<div class="quickAttachments" aria-label="記事附件">'+e.assets.map((a,i)=>'<button type="button" data-attachment="'+esc(a.id)+'" data-owner="'+esc(e.id)+'" title="'+esc(a.name)+'">'+(a.mime.startsWith('image/')?'▧ 圖片':'▶ 錄音')+((e.assets||[]).length>1?' '+(i+1):'')+'</button>').join('')+'</div>':'')+(e.source==='google'?'<button type="button" class="googleEventLink" data-google="'+esc(e.id)+'">查看 Google 行程</button>':'')+'</article>').join('');}
 let attachmentVersion=0,attachmentUrl='';
 function closeAttachment(){attachmentVersion++;for(const a of $('attachmentBody').querySelectorAll('audio'))a.pause();$('attachmentBody').replaceChildren();if(attachmentUrl)URL.revokeObjectURL(attachmentUrl);attachmentUrl='';}
 async function showAttachment(eventId,assetId){
  closeAttachment();const version=attachmentVersion,entry=S.events.find(e=>e.id===eventId),file=entry?.assets?.find(a=>a.id===assetId);if(!file)return;
  $('attachmentTitle').textContent=file.name||'附件';$('attachmentStatus').textContent='正在載入…';$('attachmentViewer').showModal();
  try{const data=entry.source==='shared'?await workApi('asset',{id:entry.taskId,assetId}):await api('asset',{id:eventId,assetId});if(version!==attachmentVersion||!$('attachmentViewer').open)return;
   if(!/^(image|audio)\//.test(data.mime))throw Error('不支援這個附件格式。');
   const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));attachmentUrl=URL.createObjectURL(new Blob([bytes],{type:data.mime}));
   const media=document.createElement(data.mime.startsWith('image/')?'img':'audio');media.src=attachmentUrl;
   if(media.tagName==='IMG')media.alt=file.name;else media.controls=true;
   $('attachmentBody').append(media);$('attachmentStatus').textContent='';
   if(media.tagName==='AUDIO')await media.play().catch(()=>{if(version===attachmentVersion)$('attachmentStatus').textContent='按播放鍵即可聆聽。';});
  }catch(e){if(version===attachmentVersion)$('attachmentStatus').textContent=e.message;}
 }
 $('attachmentViewer').addEventListener('close',closeAttachment);

 let workPreviewVersion=0,currentWork=null;
 async function showWork(id,focusDate=false){
  const version=++workPreviewVersion;currentWork=null;$('workBody').textContent='正在讀取工作…';$('workMessage').textContent='';$('workProgressControls').hidden=true;if(!$('workViewer').open)$('workViewer').showModal();
  try{const {task}=await workApi('detail',{id});if(version!==workPreviewVersion||!calendarSession||!$('workViewer').open)return;
   if(task.draft)throw Error('這筆工作尚未發佈。');currentWork=task;const row=workEvent(task);
   if(focusDate){S.month=new Date(task.start);S.selected=dayKey(S.month);await refresh();if(version!==workPreviewVersion||!calendarSession)return;}
   S.events=S.events.filter(e=>e.id!==row.id);S.events.push(row);render();
   $('workBody').innerHTML='<h3>'+esc(task.title)+'</h3><p class="previewTime">'+esc(eventTime(row))+'</p><p><strong>'+esc(task.createdBy==='owner'?'我建立的工作':task.assignedTo==='owner'?(task.createdName||'成員')+' 交辦給我':(task.createdName||'成員')+' 建立的交辦')+'</strong></p><p>負責人：'+esc(task.assignedTo==='owner'?'我':task.assignedName)+'</p><p>'+esc(workLabels[task.status]||'待處理')+'</p>'+(task.note?'<p class="googleDescription">'+esc(task.note)+'</p>':'')+'<div class="quickAttachments">'+(task.assets||[]).map(a=>'<button type="button" data-work-asset="'+esc(a.id)+'">'+(a.mime.startsWith('image/')?'▧ 圖片':'▶ 錄音')+' · '+esc(a.name)+'</button>').join('')+'</div>';
   $('workProgress').value=task.status;$('workProgressControls').hidden=false;
  }catch(e){if(version===workPreviewVersion)$('workBody').textContent=e.message;}
 }
 $('workBody').onclick=e=>{const b=e.target.closest('[data-work-asset]');if(b&&currentWork)showAttachment('shared:'+currentWork.id,b.dataset.workAsset);};
 $('workViewer').addEventListener('close',()=>{workPreviewVersion++;currentWork=null;$('workBody').replaceChildren();});
 $('saveWorkProgress').onclick=()=>safely(async()=>{if(!currentWork)return;const task=currentWork,b=$('saveWorkProgress');b.disabled=true;try{const result=await workApi('progress',{id:task.id,revision:task.revision,status:$('workProgress').value});await refresh();if($('workViewer').open)await showWork(task.id);$('workMessage').textContent=result.notification?.pending?'進度已更新，LINE 通知尚待送出。':'進度已更新。';}finally{b.disabled=false;}},'workMessage');

 function renderDay(){const rows=S.events.filter(e=>onDay(e,S.selected)).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));$('dayTitle').textContent=new Date(S.selected+'T12:00:00').toLocaleDateString('zh-TW',{month:'long',day:'numeric',weekday:'long'});$('dayCount').textContent=rows.length+' 件事情';$('dayEvents').innerHTML=rows.length?eventRows(rows):'<p class="emptyDay">這天沒有安排，按「新增這天的事情」記下待辦。</p>';}
 function render(){
  const y=S.month.getFullYear(),m=S.month.getMonth();$('monthTitle').textContent=y+' 年 '+(m+1)+' 月';$('miniMonthTitle').textContent=(m+1)+' 月';
  let html=['一','二','三','四','五','六','日'].map(d=>'<div class="weekday">'+d+'</div>').join('');
  const first=new Date(y,m,1),offset=(first.getDay()+6)%7;
  for(let i=0;i<42;i++){const d=new Date(y,m,1-offset+i),key=dayKey(d),today=key===dayKey(new Date()),rows=S.events.filter(e=>onDay(e,key)),colors=[...new Set(rows.map(sourceColor))];
   html+='<button class="miniDay '+(d.getMonth()!==m?'outside ':'')+(today?'isToday ':'')+(key===S.selected?'selected':'')+'" data-day="'+key+'" aria-pressed="'+(key===S.selected)+'" '+(today?'aria-current="date" ':'')+'aria-label="'+(d.getMonth()+1)+' 月 '+d.getDate()+' 日，'+rows.length+' 件事情"><span class="dateNumber">'+d.getDate()+'</span><span class="dayDots" aria-hidden="true">'+colors.map(c=>'<i style="background:'+c+'"></i>').join('')+'</span></button>';
  }
  $('calendar').innerHTML=html;renderDay();
  const todayStart=new Date();todayStart.setHours(0,0,0,0);const currentMonth=y===todayStart.getFullYear()&&m===todayStart.getMonth();
  const rows=CalendarHours.agendaEvents(S.events,S.month);
  $('agenda').innerHTML=rows.length?eventRows(rows):'<p>'+ '這個月沒有尚未結束的行程。'+'</p>';
 }
 function cleanup(){S.urls.forEach(URL.revokeObjectURL);S.urls=[];if(S.recorder?.state==='recording')S.recorder.stop();S.stream?.getTracks().forEach(t=>t.stop());clearTimeout(S.recordTimer);S.recorder=null;S.stream=null;}
 function selectedRanges(){
  if(S.current?.source==='google'&&(!S.current.editable||S.current.allDay))return [{start:S.current.start,end:S.current.end}];
  if($('preciseUse').checked){const a=new Date($('start').value),b=new Date($('end').value);if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||b<=a)throw Error('請選擇正確的開始與結束時間。');return [{start:a.toISOString(),end:b.toISOString()}];}
  return CalendarHours.hourRanges($('hourDate').value,[...S.hours]);
 }
 function renderHours(){
  const disabled=S.timeReadonly||!!S.batch;
  $('hourDate').disabled=disabled||$('preciseUse').checked;
  $('hourGrid').innerHTML=Array.from({length:24},(_,h)=>'<button type="button" data-hour="'+h+'" aria-pressed="'+(S.hours.has(h)&&!$('preciseUse').checked)+'" '+(disabled?'disabled':'')+'>'+String(h).padStart(2,'0')+'–'+String(h+1).padStart(2,'0')+'</button>').join('');
  try{const ranges=selectedRanges();$('hourSummary').textContent=ranges.map(r=>stamp(r.start)+' → '+stamp(r.end)).join(' ／ ')+' · '+ranges.length+' 段行程';}catch(e){$('hourSummary').textContent=e.message;}
 }
 $('hourGrid').onclick=e=>{const b=e.target.closest('[data-hour]');if(!b||S.timeReadonly||S.batch)return;const h=Number(b.dataset.hour);if(S.hours.has(h))S.hours.delete(h);else S.hours.add(h);$('preciseUse').checked=false;renderHours();};
 $('hourDate').onchange=()=>{if(!$('preciseUse').checked)renderHours();};
 $('preciseUse').onchange=renderHours;
 for(const id of ['start','end'])$(id).oninput=()=>{$('preciseUse').checked=true;renderHours();};
 function editorLock(locked){for(const el of $('eventForm').querySelectorAll('input,select,textarea,button')){if(el.id==='save'||el.hasAttribute('data-close'))continue;if(locked){el.dataset.wasDisabled=String(el.disabled);el.disabled=true;}else if(el.dataset.wasDisabled!==undefined){el.disabled=el.dataset.wasDisabled==='true';delete el.dataset.wasDisabled;}}}
 function showEditor(row,date){
  cleanup();editorLock(false);S.batch=null;S.workMode=false;S.current=row?{...row}:null;S.googleDraftId=crypto.randomUUID();S.pending=[];$('eventForm').reset();$('workAssigneeLabel').hidden=!!row;$('workAssignee').innerHTML='<option value="">自己（私人行程）</option>'+(S.workStatus?.assignees||[]).filter(m=>m.id!=='owner').map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name)+(m.lineLinked||m.emailLinked?'':'（未設定提醒）')+'</option>').join('');$('workAssignee').disabled=!!row||!S.workStatus;workModeChanged();$('formStatus').textContent='';$('recordStatus').textContent='';$('record').textContent='● 開始錄音';
  const start=row?.start||date+'T09:00:00';$('title').value=row?.title||'';$('start').value=local(start);$('end').value=local(row?.end||new Date(new Date(start).getTime()+3600000));$('remind').checked=row?!!row.remind:!!S.status.lineEnabled;renderReminderChoices(row);$('completed').checked=!!row?.completed;
  const readonly=row?.source==='google'&&(!row.editable||row.allDay);
  ['title','start','end'].forEach(id=>$(id).disabled=readonly);
  $('editorTitle').textContent=row?'行程與私人記事':'新增行程';
  const writable=S.calendars.filter(c=>['owner','writer'].includes(c.accessRole)),personal=writable.find(c=>c.primary)||writable.find(c=>c.summary.includes('DO RE MI'));
  if(!row&&S.status.googleConnected&&!personal){message('無法取得個人 Google 行事曆，請先按同步更新或在設定重新連接，再新增行程。',true);return;}
  const ordered=personal?[personal,...writable.filter(c=>c.id!==personal.id)]:writable;
  $('destination').innerHTML=ordered.map(c=>'<option value="'+esc(c.id)+'">Google · '+esc(c.summary)+'（同步）</option>').join('')+'<option value="local">只存私人記事（不同步 Google）</option>';
  $('destination').value=row?(row.source==='google'?row.calendarId:'local'):(personal?.id||'local');$('destinationLabel').hidden=row?.source==='google';
  S.timeReadonly=!!readonly;S.hours=new Set();$('hourDate').value=local(start).slice(0,10);$('hourDate').disabled=readonly;$('preciseUse').disabled=readonly;$('preciseTime').open=false;
  const a=new Date($('start').value),b=new Date($('end').value),midnight=new Date(a);midnight.setHours(24,0,0,0);
  const aligned=a.getMinutes()===0&&b.getMinutes()===0&&b>a&&b<=midnight;
  if(row&&aligned)for(let h=a.getHours();h<(b.getTime()===midnight.getTime()?24:b.getHours());h++)S.hours.add(h);
  $('preciseUse').checked=!!row&&!aligned;renderHours();$('save').textContent='儲存行程';
  $('googleLink').hidden=row?.source!=='google';$('googleLink').onclick=()=>showGooglePreview(row.id);
  $('archive').hidden=!row||row.source!=='local';$('assets').replaceChildren();assetsRender();$('editor').showModal();
 }
 function workModeChanged(){const shared=!!$('workAssignee').value;$('destinationLabel').hidden=shared||S.current?.source==='google';$('completedLabel').hidden=shared;$('handoffNoteLabel').hidden=!shared;$('remindLabel').textContent=shared?'提醒負責人':'用 LINE 提醒我';$('save').textContent=shared?'儲存並交辦':'儲存行程';}
 $('workAssignee').onchange=workModeChanged;
 async function prepareWorkJobs(){if(S.current)throw Error('請新增一筆共用交辦。');const ranges=selectedRanges(),offsets=selectedReminders();if(!$('title').value.trim())throw Error('請填事情名稱。');const files=await Promise.all(S.pending.map(async f=>({assetId:crypto.randomUUID(),name:f.name,mime:f.type,base64:await base64(f)})));return ranges.map(r=>({id:crypto.randomUUID(),revision:0,assignedTo:$('workAssignee').value,event:{title:$('title').value.trim(),note:$('handoffNote').value,start:r.start,end:r.end,remind:$('remind').checked,reminderMinutes:offsets[0]??60,reminderOffsets:offsets},files,uploaded:0}));}
 function assetNode(file,pending=false){const div=document.createElement('div');div.className='asset';const small=document.createElement('small');small.textContent=file.name+(pending?' · 等待儲存':'');div.append(small);return div;}
 async function assetsRender(){
  $('assets').replaceChildren();
  for(const file of S.current?.assets||[]){const div=assetNode(file),button=document.createElement('button');button.type='button';button.textContent=file.mime.startsWith('image/')?'查看圖片':'載入錄音';button.onclick=()=>safely(async()=>{button.disabled=true;const id=S.current.id;const data=await api('asset',{id,assetId:file.id});const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:data.mime}));S.urls.push(url);const media=document.createElement(data.mime.startsWith('image/')?'img':'audio');media.src=url;if(media.tagName==='AUDIO')media.controls=true;else media.alt=file.name;div.append(media);button.remove();},'formStatus');div.append(button);$('assets').append(div);}
  for(const file of S.pending){const div=assetNode(file,true),url=URL.createObjectURL(file);S.urls.push(url);const media=document.createElement(file.type.startsWith('image/')?'img':'audio');media.src=url;if(media.tagName==='AUDIO')media.controls=true;else media.alt=file.name;const remove=document.createElement('button');remove.type='button';remove.textContent='移除待上傳附件';remove.onclick=()=>{S.pending=S.pending.filter(x=>x!==file);assetsRender();};div.append(media,remove);$('assets').append(div);}
 }
 function addFiles(files){for(const f of files){if(f.size>5*1024*1024){$('formStatus').textContent='附件 '+f.name+' 超過 5 MB，未加入。';continue;}if((S.current?.assets?.length||0)+S.pending.length>=12){$('formStatus').textContent='每則記事最多 12 個附件。';break;}S.pending.push(f);}assetsRender();}
 $('files').onchange=e=>{addFiles([...e.target.files]);e.target.value='';};
 $('editor').addEventListener('paste',e=>{const images=[...e.clipboardData.items].filter(x=>x.kind==='file'&&x.type.startsWith('image/')).map(x=>x.getAsFile());if(images.length){e.preventDefault();addFiles(images);}});
 $('record').onclick=()=>safely(async()=>{
  if(S.recorder?.state==='recording'){S.recorder.stop();return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('此瀏覽器不支援錄音，請改用手機錄好後上傳音檔。');
  S.stream=await navigator.mediaDevices.getUserMedia({audio:true});const type=['audio/webm','audio/mp4','audio/ogg'].find(t=>MediaRecorder.isTypeSupported(t));if(!type){S.stream.getTracks().forEach(t=>t.stop());throw Error('此瀏覽器的錄音格式尚不支援，請上傳音檔。');}
  const chunks=[],rec=new MediaRecorder(S.stream,{mimeType:type,audioBitsPerSecond:64000});S.recorder=rec;rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};rec.onstop=()=>{S.stream?.getTracks().forEach(t=>t.stop());clearTimeout(S.recordTimer);if($('editor').open)addFiles([new File(chunks,'錄音-'+new Date().toISOString().slice(0,19).replace(/:/g,'-')+'.'+(type==='audio/mp4'?'m4a':type.split('/')[1]),{type})]);$('record').textContent='● 開始錄音';$('recordStatus').textContent='錄音已停止，按儲存後才會上傳。';};rec.start();$('record').textContent='■ 停止錄音';$('recordStatus').textContent='錄音中…最長 60 秒。';S.recordTimer=setTimeout(()=>{if(rec.state==='recording')rec.stop();},60000);
 },'formStatus');
 const base64=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});
 async function prepareJobs(){
  const ranges=selectedRanges(),c=S.current,reminderOffsets=selectedReminders();
  if(!$('title').value.trim())throw Error('請填事情名稱。');
  const uploads=await Promise.all(S.pending.map(async f=>({name:f.name,mime:f.type,size:f.size,base64:await base64(f)})));
  const originals=[];
  const converting=c?.source==='local'&&$('destination').value!=='local';
  if(c&&(ranges.length>1||converting))for(const a of c.assets||[]){const data=await api('asset',{id:c.id,assetId:a.id});originals.push({name:a.name,mime:a.mime,size:a.size,base64:data.base64});}
  const destination=c?.source==='google'?c.calendarId:$('destination').value;
  return ranges.map((r,i)=>{
   const original=i===0&&!converting?c:null,google=destination!=='local';
   const event={title:$('title').value,start:r.start,end:r.end,note:c?.note||'',remind:$('remind').checked,reminderMinutes:reminderOffsets[0]??60,reminderOffsets,completed:$('completed').checked,source:google?'google':'local',calendarId:google?destination:'',googleId:original?.googleId||''};
   const changed=original&&google&&original.editable&&!original.allDay&&(event.title!==original.title||Date.parse(event.start)!==Date.parse(original.start)||Date.parse(event.end)!==Date.parse(original.end));
   return {id:original?.id||crypto.randomUUID(),original,event,requestId:crypto.randomUUID(),revision:original?.revision||0,googleWrite:google&&(!original||!!changed),files:i===0&&!converting?uploads:[...originals,...uploads],uploaded:0,knownAssets:(original?.assets||[]).map(a=>a.id)};
  });
 }
 $('eventForm').onsubmit=e=>{e.preventDefault();if(S.saving)return;safely(async()=>{
  if(S.recorder?.state==='recording')throw Error('請先停止錄音，再儲存。');
  S.saving=true;$('save').disabled=true;$('formStatus').textContent='正在儲存…';
  if(!S.batch)editorLock(true);
  try{
   if(!S.batch){S.workMode=!!$('workAssignee').value;S.batch=S.workMode?await prepareWorkJobs():await prepareJobs();}
   if(S.workMode){const result=await SharedCalendarJobs.saveJobs(S.batch,workApi,(i,n)=>{$('formStatus').textContent='正在交辦第 '+(i+1)+' / '+n+' 段…';});const savedDay=SharedCalendarJobs.rememberChange(localStorage,S.batch[0].event.start);if(savedDay){S.selected=savedDay;S.month=new Date(savedDay+'T12:00:00');syncSharedDate();}S.batch=null;S.pending=[];editorLock(false);$('editor').close();cleanup();let refreshError='';await refresh().catch(e=>{refreshError=' 畫面更新失敗，請按同步更新：'+e.message;});message((result.pending?'已交辦，通知尚未送達。':result.sent?'已交辦並送出通知。':'已交辦。')+refreshError,!!refreshError);return;}
   const total=await CalendarHours.saveJobs(S.batch,api,(i,n)=>{$('formStatus').textContent='正在儲存第 '+(i+1)+' / '+n+' 段行程…';});
   const remind=S.batch[0].event.remind,google=S.batch[0].event.source==='google';if(S.current?.source==='local'&&google)await api('archive',{id:S.current.id});S.batch=null;S.pending=[];editorLock(false);$('editor').close();cleanup();await refresh();message('已儲存 '+total+' 段行程'+(google?'，已同步至 Google。':'，只存私人記事。')+(remind&&!S.status.lineEnabled?'LINE 尚未啟用，請到連線設定啟用。':''));
  }catch(e){if(S.batch){const done=S.batch.filter(j=>j.done).length;$('save').textContent='重試未完成的部分';throw Error('已完成 '+done+' / '+S.batch.length+' 段。'+e.message+' 按重試繼續。');}editorLock(false);throw e;
  }finally{S.saving=false;$('save').disabled=false;}
 },'formStatus');};
 $('archive').onclick=()=>safely(async()=>{await api('archive',{id:S.current.id});$('editor').close();cleanup();await refresh();},'formStatus');
 function settingsRender(){const s=S.status;$('googleStatus').textContent=s.googleConnected?'已連接 '+s.googleEmail:s.googleConfigured?'已設定 Google 串接，請按連接完成帳號授權。':'Google 串接程式已就緒，尚需完成下方的首次 OAuth 設定。';$('connectGoogle').textContent=s.googleConnected?'重新授權 Google':'連接 Google 行事曆';$('disconnectGoogle').hidden=!s.googleConnected;$('callback').value=s.callback||'';$('oauthSetup').open=!s.googleConfigured;
  $('calendarChoices').innerHTML=S.calendars.map(c=>'<label class="check"><input type="checkbox" value="'+esc(c.id)+'" '+(s.calendarIds.includes(c.id)?'checked':'')+'>'+esc(c.summary)+' · '+(['owner','writer'].includes(c.accessRole)?'可編輯':'唯讀')+'</label>').join('');$('saveCalendars').hidden=!s.googleConnected;
  $('lineTarget').innerHTML=s.targets?.length?s.targets.map(t=>'<option value="'+esc(t.key)+'">'+esc(t.name)+' ('+esc(t.masked)+')</option>').join(''):'<option value="">尚未找到自己的 LINE 綁定</option>';if(s.targetKey)$('lineTarget').value=s.targetKey;$('lineEnabled').checked=!!s.lineEnabled;
  $('lineStatus').textContent=s.lastReminderError||(!s.lineConfigured?'官方 LINE 發送設定尚未完成。':s.lastSentAt?'上次通知已送交 LINE：'+stamp(s.lastSentAt):'尚未發送提醒。測試按鈕會實際傳送一則訊息。');
 }
 $('settingsButton').onclick=()=>{$('settingsStatus').textContent='';settingsRender();$('settings').showModal();};
 $('connectGoogle').onclick=()=>safely(async()=>{const r=await api('connect');location.assign(r.url);},'settingsStatus');
 $('disconnectGoogle').onclick=()=>safely(async()=>{await api('disconnect');await refresh();$('settingsStatus').textContent='已中斷持續同步；Google 原始行程沒有刪除。';},'settingsStatus');
 $('saveOAuth').onclick=()=>safely(async()=>{await api('configureGoogle',{clientId:$('clientId').value,clientSecret:$('clientSecret').value});$('clientSecret').value='';await refresh();$('settingsStatus').textContent='已儲存。請按「連接 Google 行事曆」完成授權。';},'settingsStatus');
 $('saveCalendars').onclick=()=>safely(async()=>{await api('settings',{calendarIds:[...$('calendarChoices').querySelectorAll('input:checked')].map(x=>x.value)});await refresh();$('settingsStatus').textContent='已更新要顯示的行事曆。';},'settingsStatus');
 $('saveLine').onclick=()=>safely(async()=>{await api('settings',{lineEnabled:$('lineEnabled').checked,targetKey:$('lineTarget').value});await refresh();$('settingsStatus').textContent='已儲存 LINE 提醒設定。';},'settingsStatus');
 $('testLine').onclick=()=>safely(async()=>{await api('testLine',{targetKey:$('lineTarget').value});$('settingsStatus').textContent='測試訊息已送交 LINE，請查看個人 LINE。';},'settingsStatus');
 document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{if(S.saving)return;$(b.dataset.close).close();if(b.dataset.close==='editor')cleanup();});$('editor').addEventListener('cancel',e=>{if(S.saving)e.preventDefault();else cleanup();});
 for(const id of ['calendar','agenda','dayEvents'])$(id).onclick=e=>{const b=e.target.closest('button');if(b?.dataset.google){showGooglePreview(b.dataset.google);return;}if(b?.dataset.attachment){showAttachment(b.dataset.owner,b.dataset.attachment);return;}if(b?.dataset.event){const row=S.events.find(x=>x.id===b.dataset.event);if(row?.source==='shared')safely(()=>showWork(row.taskId));else showEditor(row);}if(b?.dataset.day){S.selected=b.dataset.day;render();}};
 $('newButton').onclick=()=>showEditor(null,S.selected);$('newDay').onclick=()=>showEditor(null,S.selected);
 for(const [id,n] of [['previous',-1],['next',1]])$(id).onclick=()=>safely(async()=>{S.month=new Date(S.month.getFullYear(),S.month.getMonth()+n,1);S.selected=dayKey(S.month);await refresh();});
 $('today').onclick=()=>safely(async()=>{S.month=new Date();S.selected=dayKey(S.month);await refresh();});$('refresh').onclick=()=>safely(refresh);
 $('monthView').onclick=()=>{$('monthPanel').hidden=false;$('agenda').hidden=true;$('monthView').setAttribute('aria-pressed','true');$('listView').setAttribute('aria-pressed','false');};$('listView').onclick=()=>{render();$('monthPanel').hidden=true;$('agenda').hidden=false;$('monthView').setAttribute('aria-pressed','false');$('listView').setAttribute('aria-pressed','true');};
 function showGate(msg='請用 Face ID 或專用密碼進入。'){
  calendarSession='';sessionStorage.removeItem('youziCalendarSession');$('calendarWorkspace').hidden=true;$('calendarGate').hidden=false;$('settingsButton').hidden=true;$('editor').close();$('settings').close();$('googleViewer').close();$('workViewer').close();workPreviewVersion++;$('workBody').replaceChildren();googlePreviewVersion++;$('googlePreview').replaceChildren();$('attachmentViewer').close();closeAttachment();cleanup();S.events=[];$('calendar').innerHTML='';$('agenda').innerHTML='';$('dayEvents').innerHTML='';$('loginMessage').textContent=msg;
 }
 async function access(action,data={}){if(!accessCall)throw Error('登入服務尚在載入，請稍後再試。');return (await accessCall({action,...data,...(calendarSession?{calendarSession}:{})})).data;}
 async function openCalendar(result){
  if(result?.token){calendarSession=result.token;sessionStorage.setItem('youziCalendarSession',calendarSession);}
  const entry=await access('entryOptions');$('autoFace').checked=entry.autoFace;
  syncSharedDate();await refresh();$('calendarGate').hidden=true;$('calendarWorkspace').hidden=false;$('settingsButton').hidden=false;$('newButton').disabled=false;$('newDay').disabled=false;
  const sharedParams=new URLSearchParams(location.search);if(sharedParams.get('task')){await showWork(sharedParams.get('task'),true);return;}if(sharedParams.get('shared')==='1'){location.replace('shared-calendar.html?owner=1'+(sharedParams.get('task')?'&task='+encodeURIComponent(sharedParams.get('task')):''));return;}
  const id=new URLSearchParams(location.search).get('event');if(id){let row=S.events.find(e=>e.id===id);if(!row)row=(await api('detail',{id})).event;if(row)showEditor(row);}
 }
 async function loginTask(fn){$('faceLogin').disabled=true;$('passwordLogin').disabled=true;$('loginMessage').textContent='正在驗證…';try{await fn();}catch(e){$('loginMessage').textContent=e.name==='NotAllowedError'?'尚未完成 Face ID，可重試或改用專用密碼。':e.message;$('passwordFallback').open=true;}finally{$('faceLogin').disabled=false;$('passwordLogin').disabled=false;}}
 async function faceAuthenticate(){
  if(!window.PublicKeyCredential)throw Error('此瀏覽器不支援通行密鑰，請改用 Safari 或專用密碼。');
  const c=await access('authenticationOptions'),response=await SimpleWebAuthnBrowser.startAuthentication({optionsJSON:c.options});await openCalendar(await access('authenticationVerify',{ticket:c.ticket,response}));
 }
 $('faceLogin').onclick=()=>loginTask(faceAuthenticate);
 $('saveAutoFace').onclick=()=>safely(async()=>{await access('setAutoFace',{enabled:$('autoFace').checked});$('settingsStatus').textContent='已儲存登入設定。';},'settingsStatus');
 $('passwordForm').onsubmit=e=>{e.preventDefault();loginTask(async()=>{const password=$('calendarPassword').value;$('calendarPassword').value='';await openCalendar(await access('password',{password}));});};
 $('enrollFace').onclick=async()=>{const b=$('enrollFace');b.disabled=true;try{
  if(!window.PublicKeyCredential)throw Error('請在支援 Face ID 的 iPhone Safari 開啟此頁。');
  const c=await access('registrationOptions'),response=await SimpleWebAuthnBrowser.startRegistration({optionsJSON:c.options});await access('registrationVerify',{ticket:c.ticket,response});$('settingsStatus').textContent='通行密鑰已啟用，下次可用 Face ID／裝置驗證進入。';
 }catch(e){$('settingsStatus').textContent=e.name==='NotAllowedError'?'尚未完成手機驗證，仍可使用專用密碼。':e.message;}finally{b.disabled=false;}};
 $('lockCalendar').onclick=async()=>{try{await access('logout');showGate();}catch(e){$('settingsStatus').textContent='鎖定未完成，請重試。'+e.message;}};
 let lastChange=0,returnRefresh=false;
 function syncSharedDate(){const change=SharedCalendarJobs.recentChange(localStorage,lastChange);if(change){lastChange=change.at;S.selected=change.day;S.month=new Date(change.day+'T12:00:00');$('monthPanel').hidden=false;$('agenda').hidden=true;$('monthView').setAttribute('aria-pressed','true');$('listView').setAttribute('aria-pressed','false');}}
 async function refreshOnReturn(){if(!calendarSession||$('calendarWorkspace').hidden||document.hidden||S.saving||$('editor').open||returnRefresh)return;returnRefresh=true;try{syncSharedDate();await refresh();}catch(e){message(e.message,true);}finally{returnRefresh=false;}}
 window.addEventListener('focus',refreshOnReturn);document.addEventListener('visibilitychange',refreshOnReturn);window.addEventListener('storage',e=>{if(e.key===SharedCalendarJobs.changeKey)refreshOnReturn();});
 // Dedicated sessions must not carry the main system's Firebase Authorization header.
 async function calendarRequest(endpoint,data){
  const r=await fetch('https://asia-east1-youzi-c1b74.cloudfunctions.net/'+endpoint,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({data}),signal:AbortSignal.timeout(120000)});
  let body;try{body=await r.json();}catch{throw Error('登入服務暫時無法連線，請稍後再試。');}
  if(!r.ok||body.error){const e=Error(body.error?.message||'服務暫時無法連線。');e.code='functions/'+String(body.error?.status||'internal').toLowerCase().replaceAll('_','-');throw e;}return {data:body.result};
 }
 call=data=>calendarRequest('privateCalendarApi',data);accessCall=data=>calendarRequest('privateCalendarAccess',data);
 // Every page opening starts locked, including reloads with an old session.
 const previousSession=calendarSession;showGate('正在準備登入…');
 loginTask(async()=>{
  if(previousSession)await accessCall({action:'logout',calendarSession:previousSession});
  const entry=await access('entryOptions');
  if(entry.autoFace&&entry.hasPasskey)await faceAuthenticate();
  else {$('loginMessage').textContent=entry.hasPasskey?'請用 Face ID 或專用密碼進入。':'第一次使用，請先用專用密碼進入，再啟用 Face ID。';if(!entry.hasPasskey)$('passwordFallback').open=true;}
 });
 // A restored browser page must not reveal a previous authenticated view.
 window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
})();
