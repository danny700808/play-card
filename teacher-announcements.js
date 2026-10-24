(function(global){
  'use strict';
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const taipeiTime=value=>new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
  const shift=(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
  let root,rows=[],recent=[],closures=[],selected=new Set(),loadedRange='',directoryVersion='',loading=false,submitting=false,requestId='',assetId='',assetUrl='',revision=0;
  let draft={kind:'closure',startDate:today(),endDate:today(),reason:'颱風停課',title:'【柚子樂器｜颱風停課通知】',body:''};
  const el=id=>root?.querySelector('#'+id);
  const uuid=()=>crypto.randomUUID().replaceAll('-','');
  function template(){return `各位老師您好：\n因臺中市政府宣布 ${draft.startDate}${draft.endDate!==draft.startDate?' 至 '+draft.endDate:''} 停班停課，本教室當日同步停課，請老師不用到班。\n\n停課日期的課程與晚間相關自動提醒將暫停發送，後續補課安排另行通知。\n請大家注意安全，謝謝老師配合。`;}
  draft.body=template();
  async function api(action,data={}){
    const response=await global.firebase.app().functions('asia-east1').httpsCallable('coursePortalTeacherAnnouncements',{timeout:180000})({action,...data});
    return response.data;
  }
  function status(message,error=false){const node=el('taStatus');if(node){node.textContent=message;node.classList.toggle('error',error);}const dialog=el('taConfirm');if(dialog?.open&&error){let note=el('taDialogError');if(!note){note=document.createElement('p');note.id='taDialogError';note.className='ta-status error';note.setAttribute('role','alert');el('taConfirmBody').appendChild(note);}note.textContent=message;}}
  function readDraft(){for(const key of ['kind','startDate','endDate','reason','title','body']){const node=el('ta-'+key);if(node)draft[key]=node.value;}}
  function invalidate(){revision++;requestId='';el('taConfirm')?.close();}
  function channel(row){return row.channel==='line'?'LINE':'Email';}
  function currentRange(){return draft.startDate+'|'+draft.endDate;}
  function validRange(){return /^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)&&/^\d{4}-\d{2}-\d{2}$/.test(draft.endDate)&&draft.endDate>=draft.startDate&&(Date.parse(draft.endDate)-Date.parse(draft.startDate))/86400000<=30;}
  function summary(){const targets=rows.filter(r=>selected.has(r.teacherId));el('taSummary').textContent=`已選 ${targets.length} 位老師 · LINE ${targets.filter(r=>r.channel==='line').length} 位 · Email ${targets.filter(r=>r.channel==='email').length} 位`;}
  function renderPeople(){
    el('taPeople').innerHTML=rows.map(r=>`<label class="ta-person"><input type="checkbox" data-teacher="${esc(r.teacherId)}" ${selected.has(r.teacherId)?'checked':''} ${!r.eligible?'disabled':''}><span><b>${esc(r.name)}</b><small>${r.lessonCount} 堂課${r.reason?' · '+esc(r.reason):''}</small></span>${r.eligible?`<span class="ta-badge ${r.channel==='email'?'email':''}">${channel(r)}</span>`:''}</label>`).join('')||'<p class="ta-help">此區間沒有可列出的老師。</p>';
    el('taPeople').querySelectorAll('input').forEach(input=>input.onchange=()=>{invalidate();input.checked?selected.add(input.dataset.teacher):selected.delete(input.dataset.teacher);summary();});summary();
  }
  function renderHistory(){
    el('taHistory').innerHTML=recent.map(r=>`<details><summary>${esc(r.title)} <span class="ta-help">${esc(taipeiTime(r.createdAtText))} · ${r.deliveries.length} 位${r.kind==='closure'?(r.released?' · 已解除停課':' · 停課設定保留中'):''}</span></summary><p class="ta-help">${esc(r.dates.join('、'))}</p><pre>${esc(r.body)}</pre>${r.imageUrl?`<img class="ta-preview-image" src="${esc(r.imageUrl)}" alt="公告附圖">`:''}${r.deliveries.map(d=>`<div class="ta-result"><span>${esc(d.name)}</span><span>${channel(d)}</span><span>${esc(d.status)}${d.error?'<small class="ta-help"> · '+esc(d.error)+'</small>':''}</span></div>`).join('')}${r.kind==='closure'&&!r.released?`<button type="button" class="ta-button" data-release="${esc(r.id)}">解除這筆停課</button>`:''}</details>`).join('')||'<p class="ta-help">尚無公告紀錄。</p>';
    el('taHistory').querySelectorAll('[data-release]').forEach(button=>button.onclick=()=>releasePreview(button.dataset.release));
  }
  async function load(){
    readDraft();if(!validRange()){status('請選擇有效日期，最多 31 天。',true);return;}
    invalidate();const version=revision,dates={startDate:draft.startDate,endDate:draft.endDate};
    loading=true;status('正在讀取課表與老師既有通知綁定…');el('taPreview').disabled=true;
    try{
      const data=await api('inspect',dates);if(version!==revision)return;
      rows=data.rows;recent=data.history;closures=data.closures;directoryVersion=data.directoryVersion;loadedRange=dates.startDate+'|'+dates.endDate;
      selected=new Set(rows.filter(r=>r.eligible&&r.lessonCount>0).map(r=>r.teacherId));renderPeople();renderHistory();
      const closed=closures.filter(c=>c.active);el('taClosures').hidden=!closed.length;el('taClosures').innerHTML=closed.map(c=>`<div>${esc(c.date)}：${esc(c.reason)}（已停課） <button type="button" class="ta-button" data-release-active="${esc(c.announcementId)}">查看解除</button></div>`).join('');
      el('taClosures').querySelectorAll('[data-release-active]').forEach(button=>button.onclick=()=>releasePreview(button.dataset.releaseActive));
      status(`名單已更新。預選所選日期有課且有可用聯絡方式的老師。${rows.some(r=>!r.eligible)?' 部分老師無可用或唯一綁定，請查看名單說明。':''}`);
    }catch(error){status(error.message||'讀取失敗，請重新登入或稍後再試。',true);}
    finally{loading=false;el('taPreview').disabled=false;}
  }
  function choose(mode){invalidate();selected=new Set(rows.filter(r=>r.eligible&&(mode==='all'||mode==='scheduled'&&r.lessonCount>0)).map(r=>r.teacherId));renderPeople();}
  function preview(){
    readDraft();if(loading||submitting)return;
    if(!validRange()||loadedRange!==currentRange()){status('日期已變更，請先按「載入這些日期的老師」。',true);return;}
    if(!draft.title.trim()||!draft.body.trim()||draft.body.length>3500||draft.title.length>100){status('請填寫標題與公告內容，內容最多 3,500 字。',true);return;}
    if(draft.kind==='closure'&&(draft.startDate<today()||!draft.reason.trim())){status('停課請選今天或未來日期，並填寫停課原因。',true);return;}
    if(draft.kind==='closure'&&closures.some(c=>c.active)){status('所選日期已有停課設定。如需補發訊息，請使用一般公告。',true);return;}
    if(!selected.size&&draft.kind!=='closure'){status('請至少勾選一位老師。',true);return;}
    requestId=requestId||uuid();const targets=rows.filter(r=>selected.has(r.teacherId));
    el('taConfirmBody').innerHTML=`<h2>${draft.kind==='closure'?'確認停課與公告':'確認老師公告'}</h2><p>${esc(draft.startDate)} ～ ${esc(draft.endDate)}</p><div class="ta-closure">${draft.kind==='closure'?'全教室停課；將停止停課日期的早上、晚間課程提醒。取消勾選老師只影響公告收件人。':'一般公告，不更動課表及自動提醒。'}</div><p><b>${targets.length} 位收件老師</b>：${esc(targets.map(r=>r.name+'（'+channel(r)+'）').join('、')||'未選老師：僅儲存停課設定，不發公告')}</p><h3>${esc(draft.title)}</h3><pre>${esc(draft.body)}</pre>${assetUrl?`<img class="ta-preview-image" src="${esc(assetUrl)}" alt="即將發送的公告圖片">`:''}<p class="ta-help">${draft.kind==='closure'?'已寄出的提醒無法收回；停課設定不刪除原課程，也不自動變更學費、薪資或租用預約。':''}</p>`;
    const button=el('taSend');button.textContent=selected.size?(draft.kind==='closure'?'確認停課並發送':'確認發送公告'):'只儲存停課設定';button.onclick=submit;el('taConfirm').showModal();
  }
  async function submit(){
    if(submitting)return;submitting=true;el('taSend').disabled=true;el('taCancel').disabled=true;
    const payload={...draft,requestId,teacherIds:[...selected],assetId,directoryVersion};
    try{const result=await api('submit',payload);el('taConfirm').close();await load();status(result.message||'這份公告已建立，不會重複發送。');requestId='';}
    catch(error){status((error.message||'送出失敗')+' 若連線中斷，可用相同內容重試；系統會防止重複建立。',true);}
    finally{submitting=false;el('taSend').disabled=false;el('taCancel').disabled=false;}
  }
  async function releasePreview(id){
    if(submitting)return;let row=recent.find(r=>r.id===id);if(!row){try{row=(await api('detail',{id})).row;}catch(error){status(error.message,true);return;}}
    el('taConfirmBody').innerHTML=`<h2>解除停課</h2><p>${esc(row.dates.join('、'))}</p><p>這些日期恢復原本提醒規則。已取消或已經錯過時間的提醒不會補發。</p><p>本次不發送恢復上課公告；如需通知老師，解除後請建立一般公告。</p>`;
    el('taSend').textContent='確認解除停課';el('taSend').onclick=async()=>{if(submitting)return;submitting=true;el('taSend').disabled=true;el('taCancel').disabled=true;try{const result=await api('release',{id});el('taConfirm').close();await load();status(result.message||'已解除停課');}catch(error){status(error.message,true);}finally{submitting=false;el('taSend').disabled=false;el('taCancel').disabled=false;}};el('taConfirm').showModal();
  }
  function fillTemplate(){readDraft();invalidate();draft.title=draft.reason==='颱風停課'?'【柚子樂器｜颱風停課通知】':'【柚子樂器｜停課通知】';draft.body=draft.reason==='颱風停課'?template():`各位老師您好：\n因${draft.reason}，本教室 ${draft.startDate}${draft.endDate!==draft.startDate?' 至 '+draft.endDate:''} 停課，請老師不用到班。\n\n停課日期的課程與晚間相關自動提醒將暫停發送，後續安排另行通知。\n謝謝老師配合。`;el('ta-title').value=draft.title;el('ta-body').value=draft.body;}
  async function upload(file){
    if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>4*1024*1024){status('請選擇 4 MB 以下的 JPG、PNG 或 WebP 圖片。',true);return;}
    invalidate();el('taPreview').disabled=true;status('正在上傳與處理公告圖片…');
    try{const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});const data=await api('upload',{base64:encoded});assetId=data.assetId;assetUrl=data.url;el('taImage').src=assetUrl;el('taImage').hidden=false;el('taRemoveImage').hidden=false;status('圖片已加入，送出前可預覽。');}catch(error){status(error.message||'圖片上傳失敗',true);}finally{el('taPreview').disabled=false;}
  }
  function mount(content){
    if(root&&content.contains(root))return;
    content.innerHTML=`<div class="ta-workspace"><div class="ta-intro"><h2>老師公告與停課</h2><p>臨時停課、教室公告，在這裡一次通知老師。沿用已註冊的 LINE／Email，不需要重新綁定。</p></div><div id="taStatus" class="ta-status" role="status"></div><div id="taClosures" class="ta-closure" hidden></div><div class="ta-grid"><section class="ta-card"><h3>1. 公告內容</h3><label class="ta-label" for="ta-kind">公告類型</label><select id="ta-kind" class="ta-input"><option value="closure">停課公告 · 同步暫停課程提醒</option><option value="notice">一般公告 · 保留原課表與提醒</option></select><div class="ta-row"><label><span class="ta-label">開始日期</span><input id="ta-startDate" class="ta-input" type="date"></label><label><span class="ta-label">結束日期</span><input id="ta-endDate" class="ta-input" type="date"></label></div><div class="ta-actions"><button class="ta-button" id="taToday">今天</button><button class="ta-button" id="taTomorrow">明天</button><button class="ta-button" id="taLoad">載入這些日期的老師</button></div><div id="taClosureFields"><label class="ta-label" for="ta-reason">停課原因</label><select id="ta-reason" class="ta-input"><option>颱風停課</option><option>臨時休館</option><option>其他臨時停課</option></select><p class="ta-help">颱風範本請在確認臺中市政府停班停課公告後使用。全教室停課，不因取消勾選老師而恢復上課。</p><button class="ta-button" id="taTemplate">套用停課文字範本</button></div><label class="ta-label" for="ta-title">公告標題</label><input id="ta-title" class="ta-input" maxlength="100"><label class="ta-label" for="ta-body">文字內容</label><textarea id="ta-body" class="ta-input" maxlength="3500"></textarea><label class="ta-label" for="taFile">附加圖片（選填）</label><input id="taFile" class="ta-input" type="file" accept="image/jpeg,image/png,image/webp"><p class="ta-help">1 張 JPG／PNG／WebP，最多 4 MB。LINE 與 Email 都會附上圖片。</p><img id="taImage" class="ta-preview-image" alt="公告圖片預覽" hidden><button class="ta-button" id="taRemoveImage" hidden>移除圖片</button></section><section class="ta-card"><h3>2. 選擇收件老師</h3><p class="ta-help">預選所選日期有課的老師；每位老師一份公告。有 LINE 優先發 LINE，沒有 LINE 使用已註冊的 Email。</p><div class="ta-actions"><button class="ta-button" id="taScheduled">有課老師</button><button class="ta-button" id="taAll">全選</button><button class="ta-button" id="taNone">清除勾選</button></div><p id="taSummary"></p><div id="taPeople" class="ta-list"></div><div class="ta-status">停課會保留原課程紀錄，暫停早上與晚間課程提醒。一般公告不影響提醒。</div><button class="ta-button primary" id="taPreview">預覽並確認</button><p class="ta-help">確認前不會發送。未勾選老師時，可只儲存停課設定。</p></section></div><section class="ta-card ta-history"><div class="ta-row"><h3>公告與停課紀錄</h3><button class="ta-button" id="taRefresh">更新發送結果</button></div><p class="ta-help">顯示最近 30 筆。發送成功代表平台已接受，不代表老師已讀。失敗通知由原系統重試。</p><div id="taHistory"></div></section><dialog id="taConfirm" class="ta-dialog" aria-label="公告確認"><div id="taConfirmBody"></div><div class="ta-actions"><button class="ta-button" id="taCancel">返回修改</button><button class="ta-button primary" id="taSend">確認發送</button></div></dialog></div>`;
    root=content.querySelector('.ta-workspace');for(const key of Object.keys(draft)){if(el('ta-'+key))el('ta-'+key).value=draft[key];}
    if(assetUrl){el('taImage').src=assetUrl;el('taImage').hidden=false;el('taRemoveImage').hidden=false;}
    el('taClosureFields').hidden=draft.kind!=='closure';
    ['kind','startDate','endDate','reason','title','body'].forEach(key=>el('ta-'+key).oninput=()=>{const autoTemplate=draft.body===template();readDraft();invalidate();if(autoTemplate&&['startDate','endDate'].includes(key)){draft.body=template();el('ta-body').value=draft.body;}el('taClosureFields').hidden=draft.kind!=='closure';});
    el('taLoad').onclick=load;el('taTemplate').onclick=fillTemplate;el('taPreview').onclick=preview;
    function quickDate(date){const autoTemplate=draft.body===template();draft.startDate=draft.endDate=date;el('ta-startDate').value=date;el('ta-endDate').value=date;if(autoTemplate){draft.body=template();el('ta-body').value=draft.body;}load();}
    el('taToday').onclick=()=>quickDate(today());
    el('taTomorrow').onclick=()=>quickDate(shift(today(),1));
    el('taScheduled').onclick=()=>choose('scheduled');el('taAll').onclick=()=>choose('all');el('taNone').onclick=()=>choose('none');
    el('taFile').onchange=()=>upload(el('taFile').files[0]);el('taRemoveImage').onclick=()=>{invalidate();assetId=assetUrl='';el('taImage').hidden=true;el('taRemoveImage').hidden=true;el('taFile').value='';};
    el('taCancel').onclick=()=>{if(!submitting)el('taConfirm').close();};el('taConfirm').oncancel=event=>{if(submitting)event.preventDefault();};
    el('taRefresh').onclick=load;load();
  }
  global.YouziTeacherAnnouncements={mount};
})(window);
