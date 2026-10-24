(function(global){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const time=v=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));
  const shift=(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
  const fields=['kind','startDate','endDate','reason','title','body','renterTitle','renterBody'];
  let root,rows=[],renters=[],recent=[],closures=[],impact={},selected=new Set(),selectedRenters=new Set(),loadedRange='',directoryVersion='',loading=false,submitting=false,uploading=0,requestId='',revision=0;
  const images={teacher:{id:'',url:''},renter:{id:'',url:''}};
  const draft={kind:'closure',startDate:today(),endDate:today(),reason:'颱風天',title:'',body:'',renterTitle:'',renterBody:''};
  const el=id=>root?.querySelector('#'+id);
  const channel=r=>r.channel==='line'?'LINE':'Email';
  const currentRange=()=>draft.startDate+'|'+draft.endDate;
  const validRange=()=>/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)&&/^\d{4}-\d{2}-\d{2}$/.test(draft.endDate)&&draft.endDate>=draft.startDate&&(Date.parse(draft.endDate)-Date.parse(draft.startDate))/86400000<=30;
  function templates(){
    const typhoon=draft.reason==='颱風天';
    return {
      title:typhoon?'【柚子樂器｜颱風停課通知】':'【柚子樂器｜停課通知】',
      body:'{姓名最後兩字}老師您好：\n\n'+(typhoon?'配合臺中市政府停班停課公告，':'因'+draft.reason+'，')+'本教室於 {日期} 同步停課，當日課程暫停，老師不用到班。\n\n當日尚未上課的課程，系統會自動登記為「請假」，老師無須另外操作系統。\n\n'+(typhoon?'請老師留意風雨、注意安全，':'')+'謝謝老師配合。',
      renterTitle:'【柚子樂器｜教室預約取消通知】',
      renterBody:'{客人完整姓名}您好：\n\n'+(typhoon?'因颱風影響，':'因'+draft.reason+'，')+'本教室於 {日期} 暫停開放，以下教室預約將為您取消：\n\n{教室名稱／預約日期與時段}\n\n很抱歉造成您的不便，請重新預約您適合的時間。\n\n'+(typhoon?'請您留意風雨、注意安全，':'')+'謝謝您的理解。'
    };
  }
  Object.assign(draft,templates());
  function personalize(body,row,audience){
    const name=audience==='teacher'?Array.from(row.name.replace(/老師$/u,'')).slice(-2).join(''):row.name;
    const values={'姓名最後兩字':name,'客人完整姓名':name,'日期':draft.startDate===draft.endDate?draft.startDate:draft.startDate+' 至 '+draft.endDate,'教室名稱／預約日期與時段':(row.bookings||[]).map(b=>b.roomName+'／'+b.date+' '+b.startTime+'～'+b.endTime).join('\n')};
    return body.replace(/\{(姓名最後兩字|客人完整姓名|日期|教室名稱／預約日期與時段)\}/g,(_,key)=>values[key]);
  }
  async function api(action,data={}){return (await global.firebase.app().functions('asia-east1').httpsCallable('coursePortalTeacherAnnouncements',{timeout:180000})({action,...data})).data;}
  function status(message,error=false){const node=el('taStatus');if(node){node.textContent=message;node.classList.toggle('error',error);}if(el('taConfirm')?.open&&error)el('taDialogError').textContent=message;}
  function readDraft(){fields.forEach(key=>{if(el('ta-'+key))draft[key]=el('ta-'+key).value;});}
  function invalidate(){revision++;requestId='';el('taConfirm')?.close();}
  function summary(){
    const teachers=rows.filter(r=>selected.has(r.teacherId)),customers=draft.kind==='closure'?renters.filter(r=>selectedRenters.has(r.renterId)):[],all=[...teachers,...customers];
    el('taSummary').textContent='老師 '+teachers.length+' 位 · 客人 '+customers.length+' 位｜LINE '+all.filter(r=>r.channel==='line').length+' · Email '+all.filter(r=>r.channel==='email').length;
    el('taImpact').hidden=draft.kind!=='closure';el('taImpact').textContent='請假 '+(impact.lessonCount||0)+' 堂（'+(impact.studentCount||0)+' 人次） · 取消預約 '+(impact.bookingCount||0)+' 筆';
  }
  function person(row,audience){
    const isTeacher=audience==='teacher',id=isTeacher?row.teacherId:row.renterId,chosen=isTeacher?selected:selectedRenters;
    const detail=isTeacher?row.lessonCount+' 堂課':row.bookings.map(b=>esc(b.roomName)+' · '+esc(b.date)+' '+esc(b.startTime)+'～'+esc(b.endTime)).join('<br>');
    return '<label class="ta-person"><input type="checkbox" data-'+audience+'="'+esc(id)+'" '+(chosen.has(id)?'checked':'')+' '+(row.eligible?'':'disabled')+'><span><b>'+esc(row.name)+'</b><small>'+detail+(row.reason?' · '+esc(row.reason):'')+'</small></span>'+(row.eligible?'<span class="ta-badge '+(row.channel==='email'?'email':'')+'">'+channel(row)+'</span>':'')+'</label>';
  }
  function renderPeople(){
    el('taPeople').innerHTML=rows.map(r=>person(r,'teacher')).join('')||'<p class="ta-help">沒有老師資料</p>';
    el('taRenters').innerHTML=renters.map(r=>person(r,'renter')).join('')||'<p class="ta-help">沒有待取消的預約</p>';
    root.querySelectorAll('[data-teacher],[data-renter]').forEach(input=>input.onchange=()=>{invalidate();const set=input.dataset.teacher?selected:selectedRenters,id=input.dataset.teacher||input.dataset.renter;input.checked?set.add(id):set.delete(id);summary();});summary();
  }
  const imageHTML=(url,alt)=>url?'<img class="ta-preview-image" src="'+esc(url)+'" alt="'+esc(alt)+'">':'';
  function renderHistory(){
    el('taHistory').innerHTML=recent.map(r=>'<details><summary>'+esc(r.title)+' <span class="ta-help">'+esc(time(r.createdAtText))+' · '+r.deliveries.length+' 位'+(r.kind==='closure'?(r.released?' · 已解除':' · 停課中'):'')+'</span></summary><p>'+esc(r.dates.join('、'))+'</p>'+(r.impact?'<p>請假 '+r.impact.lessonCount+' 堂 · 取消預約 '+r.impact.bookingCount+' 筆</p>':'')+'<h4>老師通知</h4><pre>'+esc(r.body)+'</pre>'+imageHTML(r.imageUrl,'老師通知圖片')+(r.renterBody?'<h4>'+esc(r.renterTitle)+'</h4><pre>'+esc(r.renterBody)+'</pre>'+imageHTML(r.renterImageUrl,'客人通知圖片'):'')+r.deliveries.map(d=>'<div class="ta-result"><span>'+esc(d.name)+(d.audience==='renter'?'（客人）':'')+'</span><span>'+channel(d)+'</span><span>'+esc(d.status)+(d.error?'<small> · '+esc(d.error)+'</small>':'')+'</span></div>').join('')+(r.kind==='closure'&&!r.released?'<button class="ta-button" data-release="'+esc(r.id)+'">解除停課</button>':'')+'</details>').join('')||'<p class="ta-help">尚無公告紀錄</p>';
    el('taHistory').querySelectorAll('[data-release]').forEach(button=>button.onclick=()=>releasePreview(button.dataset.release));
  }
  async function load(){
    readDraft();if(!validRange()){status('請選擇有效日期，最多 31 天。',true);return;}
    invalidate();const version=revision,dates={startDate:draft.startDate,endDate:draft.endDate};loading=true;el('taPreview').disabled=true;status('正在載入…');
    try{const data=await api('inspect',dates);if(version!==revision)return;
      rows=data.rows;renters=data.renters||[];impact=data.impact||{};recent=data.history;closures=data.closures;directoryVersion=data.directoryVersion;loadedRange=dates.startDate+'|'+dates.endDate;
      selected=new Set(rows.filter(r=>r.eligible&&r.lessonCount>0).map(r=>r.teacherId));selectedRenters=new Set(renters.filter(r=>r.eligible).map(r=>r.renterId));renderPeople();renderHistory();
      const closed=closures.filter(c=>c.active);el('taClosures').hidden=!closed.length;el('taClosures').innerHTML=closed.map(c=>'<div>'+esc(c.date)+' · '+esc(c.reason)+' · 已停課 <button class="ta-button" data-release-active="'+esc(c.announcementId)+'">查看解除</button></div>').join('');
      el('taClosures').querySelectorAll('[data-release-active]').forEach(button=>button.onclick=()=>releasePreview(button.dataset.releaseActive));status('');
    }catch(error){loadedRange='';status(error.message||'載入失敗，請重試。',true);}finally{loading=false;el('taPreview').disabled=uploading>0;}
  }
  function choose(mode,audience='teacher'){invalidate();if(audience==='teacher')selected=new Set(rows.filter(r=>r.eligible&&(mode==='all'||mode==='scheduled'&&r.lessonCount>0)).map(r=>r.teacherId));else selectedRenters=new Set(renters.filter(r=>r.eligible&&mode==='all').map(r=>r.renterId));renderPeople();}
  function messagePreview(targets,audience){return targets.map((r,i)=>'<details '+(i===0?'open':'')+'><summary>'+esc(r.name)+' · '+channel(r)+'</summary><h3>'+esc(audience==='teacher'?draft.title:draft.renterTitle)+'</h3><pre>'+esc(personalize(audience==='teacher'?draft.body:draft.renterBody,r,audience))+'</pre>'+imageHTML(images[audience].url,'通知圖片')+'</details>').join('');}
  function preview(){
    readDraft();if(loading||submitting||uploading)return;
    if(!validRange()||loadedRange!==currentRange()){status('請先載入所選日期的名單。',true);return;}
    if(!draft.title.trim()||!draft.body.trim()||draft.body.length>3500||draft.title.length>100){status('請填寫老師通知標題與內容。',true);return;}
    const closure=draft.kind==='closure',customers=closure?renters.filter(r=>selectedRenters.has(r.renterId)):[];
    if(closure&&(draft.startDate<today()||!draft.reason.trim())){status('停課請選今天或未來日期，並填寫原因。',true);return;}
    if(closure&&closures.some(c=>c.active)){status('所選日期已有停課設定。',true);return;}
    if(customers.length&&(!draft.renterTitle.trim()||!draft.renterBody.trim())){status('請填寫客人通知標題與內容。',true);return;}
    if(!selected.size&&!closure){status('請至少勾選一位老師。',true);return;}
    requestId=requestId||crypto.randomUUID().replaceAll('-','');const teachers=rows.filter(r=>selected.has(r.teacherId));
    el('taConfirmBody').innerHTML='<h2>'+(closure?'確認停課與通知':'確認老師公告')+'</h2><p>'+esc(draft.startDate)+' ～ '+esc(draft.endDate)+'</p>'+(closure?'<div class="ta-closure">'+esc(el('taImpact').textContent)+'<br>內部原因：'+esc(draft.reason)+'</div>':'')+'<p>老師 '+teachers.length+' 位 · 客人 '+customers.length+' 位</p>'+messagePreview(teachers,'teacher')+messagePreview(customers,'renter')+(closure?'<p class="ta-help">勾選只決定通知對象，所有受影響課程與預約都會處理。</p>':'');
    el('taDialogError').textContent='';el('taSend').textContent=teachers.length+customers.length?(closure?'確認停課並發送':'確認發送'):'確認停課';el('taSend').onclick=submit;el('taConfirm').showModal();
  }
  async function submit(){
    if(submitting)return;submitting=true;el('taSend').disabled=el('taCancel').disabled=true;
    try{const result=await api('submit',{...draft,schemaVersion:2,requestId,teacherIds:[...selected],renterIds:draft.kind==='closure'?[...selectedRenters]:[],assetId:images.teacher.id,renterAssetId:draft.kind==='closure'?images.renter.id:'',directoryVersion});el('taConfirm').close();await load();status(result.message||'通知已建立。');requestId='';}
    catch(error){status(error.message||'送出失敗，可重試。',true);}finally{submitting=false;el('taSend').disabled=el('taCancel').disabled=false;}
  }
  async function releasePreview(id){
    if(submitting)return;let row=recent.find(r=>r.id===id);if(!row){try{row=(await api('detail',{id})).row;}catch(error){status(error.message,true);return;}}
    el('taConfirmBody').innerHTML='<h2>解除停課</h2><p>'+esc(row.dates.join('、'))+'</p><p>已登記的請假及已取消的預約不會自動恢復，請另行安排。</p>';el('taDialogError').textContent='';el('taSend').textContent='確認解除停課';
    el('taSend').onclick=async()=>{if(submitting)return;submitting=true;el('taSend').disabled=el('taCancel').disabled=true;try{const result=await api('release',{id});el('taConfirm').close();await load();status(result.message||'已解除停課');}catch(error){status(error.message,true);}finally{submitting=false;el('taSend').disabled=el('taCancel').disabled=false;}};el('taConfirm').showModal();
  }
  function fillTemplate(){readDraft();invalidate();Object.assign(draft,templates());['title','body','renterTitle','renterBody'].forEach(key=>el('ta-'+key).value=draft[key]);}
  async function upload(file,audience){
    if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>4*1024*1024){status('請選擇 4 MB 以下的 JPG、PNG 或 WebP 圖片。',true);return;}
    invalidate();uploading++;el('taPreview').disabled=true;status('正在上傳圖片…');
    try{const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});const data=await api('upload',{base64});images[audience]={id:data.assetId,url:data.url};renderImage(audience);status('');}catch(error){status(error.message||'圖片上傳失敗',true);}finally{uploading--;el('taPreview').disabled=loading||uploading>0;}
  }
  function renderImage(audience){el('taImage-'+audience).src=images[audience].url;el('taImage-'+audience).hidden=el('taRemove-'+audience).hidden=!images[audience].url;}
  function imageFields(audience){return '<label class="ta-label" for="taFile-'+audience+'">圖片（選填，最多 4 MB）</label><input id="taFile-'+audience+'" class="ta-input" type="file" accept="image/jpeg,image/png,image/webp"><img id="taImage-'+audience+'" class="ta-preview-image" alt="通知圖片預覽" hidden><button class="ta-button" id="taRemove-'+audience+'" hidden>移除圖片</button>';}
  function syncKind(){el('taClosureFields').hidden=el('taRenterContent').hidden=el('taRenterRecipients').hidden=draft.kind!=='closure';summary();}
  function mount(content){
    if(root&&content.contains(root))return;
    content.innerHTML='<div class="ta-workspace"><div class="ta-intro"><h2>公告與停課</h2></div><div id="taStatus" class="ta-status" role="status"></div><div id="taClosures" class="ta-closure" hidden></div><div class="ta-grid"><section class="ta-card"><h3>通知內容</h3><label class="ta-label" for="ta-kind">公告類型</label><select id="ta-kind" class="ta-input"><option value="closure">停課通知</option><option value="notice">一般老師公告</option></select><div class="ta-row"><label><span class="ta-label">開始日期</span><input id="ta-startDate" class="ta-input" type="date"></label><label><span class="ta-label">結束日期</span><input id="ta-endDate" class="ta-input" type="date"></label></div><div class="ta-actions"><button class="ta-button" id="taToday">今天</button><button class="ta-button" id="taTomorrow">明天</button><button class="ta-button" id="taLoad">載入名單</button></div><div id="taClosureFields"><label class="ta-label" for="ta-reason">內部停課原因</label><select id="ta-reason" class="ta-input"><option>颱風天</option><option>臨時休館</option><option>其他臨時停課</option></select><button class="ta-button" id="taTemplate">套用通知範本</button></div><h3>老師通知</h3><label class="ta-label" for="ta-title">標題</label><input id="ta-title" class="ta-input" maxlength="100"><label class="ta-label" for="ta-body">內容</label><textarea id="ta-body" class="ta-input" maxlength="3500"></textarea>'+imageFields('teacher')+'<div id="taRenterContent"><h3>租用客人通知</h3><label class="ta-label" for="ta-renterTitle">標題</label><input id="ta-renterTitle" class="ta-input" maxlength="100"><label class="ta-label" for="ta-renterBody">內容</label><textarea id="ta-renterBody" class="ta-input" maxlength="3500"></textarea>'+imageFields('renter')+'</div></section><section class="ta-card"><h3>通知對象</h3><p id="taImpact" class="ta-closure"></p><h4>老師</h4><div class="ta-actions"><button class="ta-button" id="taScheduled">有課老師</button><button class="ta-button" id="taAll">全選</button><button class="ta-button" id="taNone">清除</button></div><div id="taPeople" class="ta-list"></div><div id="taRenterRecipients"><h4>租用教室客人</h4><div class="ta-actions"><button class="ta-button" id="taRenterAll">全選</button><button class="ta-button" id="taRenterNone">清除</button></div><div id="taRenters" class="ta-list"></div></div><p id="taSummary"></p><button class="ta-button primary" id="taPreview">預覽並確認</button></section></div><section class="ta-card ta-history"><div class="ta-row"><h3>公告紀錄</h3><button class="ta-button" id="taRefresh">更新發送結果</button></div><div id="taHistory"></div></section><dialog id="taConfirm" class="ta-dialog" aria-label="公告確認"><div id="taConfirmBody"></div><p id="taDialogError" class="ta-status error" role="alert"></p><div class="ta-actions"><button class="ta-button" id="taCancel">返回修改</button><button class="ta-button primary" id="taSend">確認發送</button></div></dialog></div>';
    root=content.querySelector('.ta-workspace');fields.forEach(key=>{el('ta-'+key).value=draft[key];el('ta-'+key).oninput=()=>{readDraft();invalidate();syncKind();};});syncKind();
    el('taLoad').onclick=load;el('taTemplate').onclick=fillTemplate;el('taPreview').onclick=preview;
    function quickDate(date){draft.startDate=draft.endDate=date;el('ta-startDate').value=el('ta-endDate').value=date;load();}
    el('taToday').onclick=()=>quickDate(today());el('taTomorrow').onclick=()=>quickDate(shift(today(),1));
    el('taScheduled').onclick=()=>choose('scheduled');el('taAll').onclick=()=>choose('all');el('taNone').onclick=()=>choose('none');el('taRenterAll').onclick=()=>choose('all','renter');el('taRenterNone').onclick=()=>choose('none','renter');
    for(const audience of ['teacher','renter']){renderImage(audience);el('taFile-'+audience).onchange=()=>upload(el('taFile-'+audience).files[0],audience);el('taRemove-'+audience).onclick=()=>{invalidate();images[audience]={id:'',url:''};renderImage(audience);el('taFile-'+audience).value='';};}
    el('taCancel').onclick=()=>{if(!submitting)el('taConfirm').close();};el('taConfirm').oncancel=event=>{if(submitting)event.preventDefault();};el('taRefresh').onclick=load;load();
  }
  global.YouziTeacherAnnouncements={mount};
})(window);
