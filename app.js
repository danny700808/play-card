
(function(){
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => Array.from(root.querySelectorAll(s));
  const storageKey = 'employee_system_user';

  function setMsg(el, text, isError=false){
    if(!el) return;
    el.textContent = text;
    el.style.display = text ? 'block' : 'none';
    el.classList.toggle('error', !!isError);
  }
  async function getPublicIP(){
    try{
      const r = await fetch('https://api.ipify.org?format=json');
      const data = await r.json();
      return data.ip || '';
    }catch(e){ return ''; }
  }
  async function api(action, payload={}){
    const res = await fetch(window.APP_CONFIG.API_URL, {
      method: 'POST',
      headers: {'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({action, ...payload})
    });
    const data = await res.json();
    if(!data.ok) throw new Error(data.message || '系統錯誤');
    return data;
  }
  function saveUser(user){ localStorage.setItem(storageKey, JSON.stringify(user)); }
  function getUser(){ try { return JSON.parse(localStorage.getItem(storageKey)||'null'); } catch(e){ return null; } }
  function clearUser(){ localStorage.removeItem(storageKey); }
  function requireLogin(){ const u = getUser(); if(!u){ location.href='index.html'; return null; } return u; }
  function renderTopbar(title){
    const u = getUser();
    const top = document.createElement('div');
    top.className = 'topbar';
    top.innerHTML = `<div><strong>${window.APP_CONFIG.APP_NAME}</strong><div class="hint" style="color:#cbd5e1">${title}</div></div>
    <div class="actions"><a class="btn small light" href="dashboard.html">首頁</a><span class="hint" style="color:#e5e7eb">${u?u.name:''}</span><button class="btn small danger" id="logoutBtn">登出</button></div>`;
    document.body.prepend(top);
    $('#logoutBtn', top).onclick = ()=>{ clearUser(); location.href='index.html'; };
  }
  async function initIndex(){
    const loginTab=$('#loginTab'), registerTab=$('#registerTab');
    const loginBox=$('#loginBox'), registerBox=$('#registerBox'), forgotBox=$('#forgotBox');
    function show(x){ loginBox.classList.add('hidden'); registerBox.classList.add('hidden'); forgotBox.classList.add('hidden'); x.classList.remove('hidden'); }
    loginTab.onclick=()=>{loginTab.classList.add('active');registerTab.classList.remove('active');show(loginBox);};
    registerTab.onclick=()=>{registerTab.classList.add('active');loginTab.classList.remove('active');show(registerBox);};
    $('#toForgot').onclick=()=>show(forgotBox); $('#backToLogin').onclick=()=>show(loginBox);
    $$('#togglePassword').forEach(btn=>btn.onclick=()=>{ const t=document.getElementById(btn.dataset.target); t.type=t.type==='password'?'text':'password'; btn.textContent=t.type==='password'?'顯示密碼':'隱藏密碼'; });
    $('#loginForm').addEventListener('submit', async e=>{ e.preventDefault(); const msg=$('#loginMsg'); setMsg(msg,'登入中...'); try{ const data=await api('login',{email:$('#loginEmail').value.trim(),password:$('#loginPassword').value}); saveUser(data.user); location.href='dashboard.html'; }catch(err){ setMsg(msg,err.message,true);} });
    $('#registerForm').addEventListener('submit', async e=>{ e.preventDefault(); const msg=$('#registerMsg'); if($('#regPassword').value!==$('#regPassword2').value){ setMsg(msg,'兩次密碼不一致',true); return; } setMsg(msg,'註冊中...'); try{ const data=await api('register',{name:$('#regName').value.trim(),email:$('#regEmail').value.trim(),password:$('#regPassword').value,isPartTime:$('#regPartTime').value}); setMsg(msg,data.message||'註冊成功'); $('#registerForm').reset(); }catch(err){ setMsg(msg,err.message,true);} });
    $('#forgotForm').addEventListener('submit', async e=>{ e.preventDefault(); const msg=$('#forgotMsg'); setMsg(msg,'送出中...'); try{ const data=await api('forgotPassword',{email:$('#forgotEmail').value.trim()}); setMsg(msg,data.message||'已寄出'); }catch(err){ setMsg(msg,err.message,true);} });
  }
  async function initDashboard(){
    const user=requireLogin(); if(!user) return; renderTopbar('首頁');
    $('#welcome').textContent=`${user.name}，歡迎使用`;
    $('#whoami').textContent=`角色：${user.role==='admin'?'管理者':'員工'}｜工讀生：${user.isPartTime?'是':'否'}｜Email：${user.email}`;
    const cards=[['clock.html','打卡系統','上班 / 下班打卡與紀錄'],['parttime.html','工讀生時數登記','工讀時數與薪資估算'],['leave.html','請假系統','請假登記與歷史紀錄'],['tasks.html','交辦事項','查看任務與完成回報']];
    $('#menuGrid').innerHTML=cards.map(c=>`<a class="card menu-card" href="${c[0]}"><h3>${c[1]}</h3><p>${c[2]}</p></a>`).join('');
  }
  async function initClock(){
    const user=requireLogin(); if(!user) return; renderTopbar('打卡系統');
    const tick=()=>{ const n=new Date(); const wd='日一二三四五六'[n.getDay()]; $('#nowBox').innerHTML=`<div><strong>${n.toLocaleDateString('zh-TW')}</strong></div><div>${n.toLocaleTimeString('zh-TW')}</div><div>星期${wd}</div>`; };
    tick(); setInterval(tick,1000);
    async function submit(actionName){
      const msg=$('#clockMsg'); setMsg(msg,'送出中...');
      try{ const ip=await getPublicIP(); const data=await api('clock',{userId:user.id,clockType:$('#clockType').value,actionName,clientIp:ip}); setMsg(msg,data.message||'成功'); load(); }catch(err){ setMsg(msg,err.message,true); load(); }
    }
    $('#clockInBtn').onclick=()=>submit('上班打卡'); $('#clockOutBtn').onclick=()=>submit('下班打卡');
    async function load(){ const box=$('#clockHistory'); box.innerHTML='讀取中...'; try{ const data=await api('getClockHistory',{userId:user.id}); const rows=data.rows||[]; box.innerHTML=rows.length?rows.map(r=>`<div class="item"><div class="pill">${r.status||'—'}</div><div><strong>${r.date}</strong> ${r.weekday||''}</div><div>${r.actionName}｜${r.clockType}｜${r.time}</div><div class="muted">遲到：${r.lateMinutes||0} 分鐘</div></div>`).join(''):'<div class="item">目前沒有打卡紀錄</div>'; }catch(err){ box.innerHTML=`<div class="item">${err.message}</div>`; } }
    load();
  }
  async function initLeave(){
    const user=requireLogin(); if(!user) return; renderTopbar('請假系統');
    function fileToDataURL(file){ return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file); });}
    $('#leaveForm').addEventListener('submit', async e=>{ e.preventDefault(); const msg=$('#leaveMsg'); setMsg(msg,'送出中...'); try{ const f=$('#leaveFile').files[0]; const attachment=f?await fileToDataURL(f):''; const data=await api('leave',{userId:user.id,leaveDate:$('#leaveDate').value,hours:$('#leaveHours').value,reason:$('#leaveReason').value,note:$('#leaveNote').value,attachment}); setMsg(msg,data.message||'已送出'); $('#leaveForm').reset(); load(); }catch(err){ setMsg(msg,err.message,true);} });
    async function load(){ const box=$('#leaveHistory'); box.innerHTML='讀取中...'; try{ const data=await api('getLeaveHistory',{userId:user.id}); const rows=data.rows||[]; box.innerHTML=rows.length?rows.map(r=>`<div class="item"><div><strong>${r.leaveDate}</strong>｜${r.hours} 小時｜${r.reason}</div><div>${r.note||''}</div></div>`).join(''):'<div class="item">目前沒有請假紀錄</div>'; }catch(err){ box.innerHTML=`<div class="item">${err.message}</div>`; } }
    load();
  }
  async function initParttime(){
    const user=requireLogin(); if(!user) return; renderTopbar('工讀生時數登記'); $('#hourRate').textContent='預設時薪：196 元';
    $('#parttimeForm').addEventListener('submit', async e=>{ e.preventDefault(); const msg=$('#parttimeMsg'); setMsg(msg,'送出中...'); try{ const data=await api('parttime',{userId:user.id,workDate:$('#workDate').value,hours:$('#hours').value,halfHour:$('#halfHour').checked?'0.5':'0',note:$('#workNote').value}); setMsg(msg,data.message||'已送出'); $('#parttimeForm').reset(); load(); }catch(err){ setMsg(msg,err.message,true);} });
    async function load(){ const box=$('#parttimeHistory'); box.innerHTML='讀取中...'; try{ const data=await api('getParttimeHistory',{userId:user.id}); const rows=data.rows||[]; let totalHours=0,totalPay=0; box.innerHTML=rows.length?rows.map(r=>{ totalHours+=Number(r.totalHours||0); totalPay+=Number(r.dailyPay||0); return `<div class="item"><div><strong>${r.date}</strong>｜${r.totalHours} 小時｜$${r.dailyPay}</div><div>${r.note||''}</div></div>`; }).join(''):'<div class="item">目前沒有工讀時數紀錄</div>'; $('#parttimeSummary').innerHTML=`<div class="item"><strong>目前頁面合計：</strong>${totalHours} 小時，$${totalPay}</div>`; }catch(err){ box.innerHTML=`<div class="item">${err.message}</div>`; } }
    load();
  }
  async function initTasks(){
    const user=requireLogin(); if(!user) return; renderTopbar('交辦事項');
    function fileToDataURL(file){ return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.onerror=reject; r.readAsDataURL(file); });}
    if(user.role==='admin'){ $('#adminPanel').classList.remove('hidden'); $('#taskCreateForm').addEventListener('submit', async e=>{ e.preventDefault(); const msg=$('#taskCreateMsg'); setMsg(msg,'建立中...'); try{ const data=await api('createTask',{creatorId:user.id,title:$('#taskTitle').value,content:$('#taskContent').value,assigneeEmail:$('#assigneeEmail').value.trim(),dueDate:$('#dueDate').value,dueTime:$('#dueTime').value,requirePhoto:$('#requirePhoto').value,remindFreq:$('#remindFreq').value}); setMsg(msg,data.message||'已建立'); $('#taskCreateForm').reset(); load(); }catch(err){ setMsg(msg,err.message,true);} });}
    $('#taskCompleteForm').addEventListener('submit', async e=>{ e.preventDefault(); const msg=$('#taskCompleteMsg'); setMsg(msg,'送出中...'); try{ const f=$('#taskPhoto').files[0]; const photo=f?await fileToDataURL(f):''; const data=await api('completeTask',{taskId:$('#completeTaskId').value,userId:user.id,note:$('#taskCompleteNote').value,photo}); setMsg(msg,data.message||'已完成'); $('#taskCompleteForm').reset(); load(); }catch(err){ setMsg(msg,err.message,true);} });
    async function load(){ const myBox=$('#myTasks'); myBox.innerHTML='讀取中...'; try{ const data=await api('getTasks',{userId:user.id,email:user.email,role:user.role}); const rows=data.rows||[]; myBox.innerHTML=rows.length?rows.map(r=>`<div class="item"><div class="pill">${r.status}</div><div><strong>${r.title}</strong></div><div>${r.content}</div><div class="muted">截止：${r.dueDate||''} ${r.dueTime||''}</div><div class="muted">需要照片：${r.requirePhoto}</div><div class="muted">任務ID：${r.id}</div></div>`).join(''):'<div class="item">目前沒有任務</div>'; if(user.role==='admin'){ const all=$('#allTasks'); all.innerHTML=rows.length?rows.map(r=>`<div class="item"><div><strong>${r.title}</strong>｜${r.assigneeName}</div><div>${r.content}</div><div class="muted">${r.dueDate||''} ${r.dueTime||''}｜${r.status}｜提醒：${r.remindFreq}</div></div>`).join(''):'<div class="item">目前沒有任務</div>'; } }catch(err){ myBox.innerHTML=`<div class="item">${err.message}</div>`; } }
    load();
  }
  window.EmployeeApp={initIndex,initDashboard,initClock,initLeave,initParttime,initTasks};
})();
