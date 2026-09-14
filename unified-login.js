(function(global){
  'use strict';
  const key='youzi-unified-login-ticket-v1';
  let ticket='',busy=false;
  function node(id){return document.getElementById(id);}
  function message(text,error){const el=node('unifiedLoginMessage');if(el){el.textContent=text;el.style.color=error?'#a12626':'#355f4a';}}
  async function call(name,data,authenticated){
    if(name!=='coursePortalStartLineLogin')data={...data,proof:sessionStorage.getItem(key+'-proof')||''};
    if(global.YZFirebase&&global.YZFirebase.init)global.YZFirebase.init();
    const project=global.APP_CONFIG&&global.APP_CONFIG.FIREBASE_CONFIG&&global.APP_CONFIG.FIREBASE_CONFIG.projectId;
    if(!project)throw new Error('登入設定尚未載入，請重新整理。');
    const headers={'Content-Type':'application/json'};
    if(authenticated){const user=global.firebase.auth().currentUser;if(!user)throw new Error('請先使用原帳密登入。');headers.Authorization='Bearer '+await user.getIdToken(true);}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
    try{
      const response=await fetch('https://us-central1-'+project+'.cloudfunctions.net/'+name,{method:'POST',headers,body:JSON.stringify({data}),signal:controller.signal});
      const json=await response.json();
      if(!response.ok||json.error)throw new Error(json.error&&json.error.message||'登入暫時無法完成，請稍後重試。');
      return json.result||json.data||{};
    }finally{clearTimeout(timer);}
  }
  function clearTicket(){ticket='';sessionStorage.removeItem(key);sessionStorage.removeItem(key+'-proof');}
  async function start(forceEmployeeLink){
    if(busy)return;busy=true;
    message('正在開啟 LINE 登入…');
    try{clearTicket();const bytes=global.crypto.getRandomValues(new Uint8Array(32));const proof=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');sessionStorage.setItem(key+'-proof',proof);const digest=await global.crypto.subtle.digest('SHA-256',new TextEncoder().encode(proof));const challenge=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');const result=await call('coursePortalStartLineLogin',{type:'unified',forceEmployeeLink:forceEmployeeLink===true,challenge});const url=new URL(result.authorizationUrl);if(url.origin!=='https://access.line.me')throw new Error('LINE 登入連結不正確。');global.location.assign(url.href);}
    catch(error){busy=false;message(error.message,true);}
  }
  async function choose(choice){
    if(busy)return;busy=true;message('正在確認身分並進入系統…');
    try{
      const result=await call('unifiedLoginRedeem',{ticket,choice});
      if(result.kind==='employee'){
        await global.firebase.auth().signInWithCustomToken(result.token);
        global.saveUser(result.user);localStorage.setItem('employeeSecureAuthVersion','1');clearTicket();
        const target=typeof global.requestedLoginTarget==='function'?global.requestedLoginTarget():'';
        if(target&&typeof global.redirectToLoginTarget==='function')global.redirectToLoginTarget(target);
        else global.redirectAfterLogin(result.user);
      }else{
        const url=new URL(result.url,global.location.href);
        if(url.origin!==global.location.origin||!url.pathname.endsWith('/course-portal.html'))throw new Error('登入入口不正確。');
        clearTicket();global.location.assign(url.href);
      }
    }catch(error){busy=false;message(error.message+' 如連結已失效，請重新按 LINE 登入。',true);}
  }
  async function afterPasswordLogin(){
    if(!ticket)return;
    message('正在將 LINE 綁定到這個既有帳號…');
    await call('employeeLinkLineLogin',{ticket},true);
    clearTicket();message('LINE 已綁定，之後可直接使用 LINE 登入。');
  }
  function addButton(host,label,action){const button=document.createElement('button');button.type='button';button.className='btn secondary';button.textContent=label;button.addEventListener('click',action);host.appendChild(button);}
  async function init(){
    const host=document.querySelector('.login-method-list');if(!host)return;
    const panel=document.createElement('section');panel.className='auth-note';panel.innerHTML='<p id="unifiedLoginMessage" role="status">管理者、員工、老師與客人都可由 LINE 入口登入。</p><div id="unifiedLoginChoices" style="display:flex;gap:8px;flex-wrap:wrap"></div>';
    host.prepend(panel);
    const link=document.querySelector('[data-primary-login-method="line"]');
    if(link){link.href='login.html?lineStart=1';link.addEventListener('click',event=>{event.preventDefault();start(false);});}
    const email=document.querySelector('[data-primary-login-method="email-password"]');
    if(email)addButton(email,'首次綁定員工／管理者 LINE',()=>start(true));
    if(email)addButton(email,'解除此帳號的 LINE 登入綁定',async()=>{
      if(busy)return;busy=true;
      try{
        const account=node('email')&&node('email').value.trim(),password=node('password')&&node('password').value;
        if(!account||!password)throw new Error('請先在下方填入原本的 Email 與密碼，再按解除綁定。');
        const result=await global.api('login',{email:account,account,password});
        if(!result||!result.ok)throw new Error(result&&result.message||'帳密驗證失敗。');
        await call('employeeUnlinkLineLogin',{},true);clearTicket();message('已解除這個帳號的 LINE 登入綁定。可繼續使用帳密，或重新綁定 LINE。');
      }catch(error){message(error.message,true);}finally{busy=false;}
    });
    const params=new URLSearchParams(global.location.search),incoming=params.get('unifiedTicket');
    if(incoming){ticket=incoming;sessionStorage.setItem(key,ticket);params.delete('unifiedTicket');global.history.replaceState(null,'',global.location.pathname+(params.size?'?'+params.toString():'')+global.location.hash);}
    else ticket=sessionStorage.getItem(key)||'';
    if(params.get('lineStart')==='1'){params.delete('lineStart');global.history.replaceState(null,'',global.location.pathname+(params.size?'?'+params.toString():''));await start(false);return;}
    if(params.get('lineError'))message(params.get('lineError'),true);
    if(!ticket)return;
    try{
      const result=await call('unifiedLoginStatus',{ticket}),choices=node('unifiedLoginChoices');
      if(result.choices.length===1&&!result.forceEmployeeLink){await choose(result.choices[0].id);return;}
      message(result.forceEmployeeLink?'請在下方使用原本的 Email 與密碼登入，完成一次綁定。':result.choices.length?'請選擇這次要使用的身分。':'LINE 已驗證。員工請在下方登入既有帳號；其他服務請選擇入口。');
      if(!result.forceEmployeeLink){
        result.choices.forEach(choice=>addButton(choices,choice.label,()=>choose(choice.id)));
        [['teacher','老師課務'],['student','學生／家長'],['renter','教室租用']].filter(([id])=>!result.choices.some(choice=>choice.id===id)).forEach(([id,label])=>addButton(choices,label,()=>choose(id)));
      }
    }catch(error){message(error.message,true);}
  }
  global.YouziUnifiedLogin={afterPasswordLogin,start};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init().catch(error=>message(error.message,true)));
  else init().catch(error=>message(error.message,true));
})(window);
