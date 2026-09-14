(function(global){
  'use strict';
  const key='youzi-unified-login-ticket-v1';
  let ticket='',busy=false;
  function node(id){return document.getElementById(id);}
  function message(text,error){const el=node('unifiedLoginMessage');if(el){el.hidden=!text;el.textContent=text;el.style.color=error?'#a12626':'#355f4a';}}
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
      await finish(result);
    }catch(error){busy=false;message(error.message+' 如連結已失效，請重新按 LINE 登入。',true);}
  }

  async function finish(result){
    if(result.kind==='employee'){
      await global.firebase.auth().signInWithCustomToken(result.token);
      global.saveUser(result.user);localStorage.setItem('employeeSecureAuthVersion','1');clearTicket();
      const target=global.requestedLoginTarget()||global.loginDestination(result.user);
      global.redirectToLoginTarget(target);
    }else if(result.kind==='portal-session'){
      const pages={teacher:'teacher-course-portal.html',student:'student-course-portal.html',renter:'room-booking.html'};
      if(!pages[result.role]||!result.sessionToken)throw new Error('登入資料不完整。');
      localStorage.setItem('youzi.coursePortal.'+result.role+'.session.v1',result.sessionToken);
      sessionStorage.removeItem('youzi.coursePortal.'+result.role+'.session.v1');
      clearTicket();global.location.replace(pages[result.role]);
    }else{
      const url=new URL(result.url,global.location.href);
      if(url.origin!==global.location.origin||!url.pathname.endsWith('/course-portal.html'))throw new Error('登入入口不正確。');
      clearTicket();global.location.assign(url.href);
    }
  }
  let challenge='';
  function showEmail(){
    node('loginChoices').hidden=true;node('emailCodeForm').hidden=false;
    node('passwordAlternative').hidden=!!ticket;
    node('loginEmail').focus();
  }
  async function ensureProof(){
    if(!sessionStorage.getItem(key+'-proof')){
      const bytes=global.crypto.getRandomValues(new Uint8Array(32));
      sessionStorage.setItem(key+'-proof',Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join(''));
    }
  }
  async function submitEmail(event){
    event.preventDefault();if(busy)return;busy=true;
    const button=node('emailCodeSubmit');button.disabled=true;
    try{
      await ensureProof();
      if(challenge){
        message('正在確認身分並進入系統…');
        await finish(await call('unifiedEmailVerify',{challengeToken:challenge,code:node('loginCode').value.trim()}));
      }else{
        message('正在寄送驗證碼…');
        const result=await call('unifiedEmailSend',{email:node('loginEmail').value.trim(),ticket});
        challenge=result.challengeToken;node('loginEmail').readOnly=true;node('codeField').hidden=false;
        node('loginCode').required=true;node('resendCode').hidden=false;button.textContent='確認並登入';
        message(result.message);node('loginCode').focus();
      }
    }catch(error){message(error.name==='AbortError'?'連線較久，請稍後重試。':error.message,true);}
    finally{busy=false;button.disabled=false;}
  }
  async function init(){
    const line=document.querySelector('[data-primary-login-method="line"]');if(!line)return;
    line.addEventListener('click',event=>{event.preventDefault();start(false);});
    node('emailChoice').onclick=()=>{clearTicket();showEmail();message('請使用原本登記的 Email，系統會寄送驗證碼。');};
    node('emailCodeForm').addEventListener('submit',submitEmail);
    node('loginBack').onclick=()=>{if(busy)return;clearTicket();challenge='';node('emailCodeForm').reset();node('loginEmail').readOnly=false;node('codeField').hidden=true;node('loginCode').required=false;node('resendCode').hidden=true;node('emailCodeSubmit').textContent='寄送驗證碼';node('emailCodeForm').hidden=true;node('loginChoices').hidden=false;message('');};
    node('resendCode').onclick=()=>{if(busy)return;challenge='';node('loginCode').value='';node('loginCode').required=false;node('codeField').hidden=true;node('loginEmail').readOnly=false;node('emailCodeSubmit').textContent='寄送驗證碼';node('resendCode').hidden=true;message('確認 Email 後，請按寄送驗證碼。');};
    const params=new URLSearchParams(global.location.search),incoming=params.get('unifiedTicket');
    if(incoming){ticket=incoming;sessionStorage.setItem(key,ticket);params.delete('unifiedTicket');global.history.replaceState(null,'',global.location.pathname+(params.size?'?'+params.toString():'')+global.location.hash);}
    else ticket=sessionStorage.getItem(key)||'';
    if(params.get('lineStart')==='1'){params.delete('lineStart');global.history.replaceState(null,'',global.location.pathname+(params.size?'?'+params.toString():''));await start(false);return;}
    if(params.get('lineError'))message(params.get('lineError'),true);
    if(!ticket)return;
    try{
      const result=await call('unifiedLoginStatus',{ticket});
      if(result.choices.length&&!result.forceEmployeeLink){await choose((result.choices.find(c=>c.id==='employee')||result.choices[0]).id);return;}
      showEmail();message('首次使用這個 LINE，請用原本登記的 Email 收驗證碼，確認是您本人。');
    }catch(error){clearTicket();message(error.message,true);}
  }
  global.YouziUnifiedLogin={start};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>init().catch(error=>message(error.message,true)));
  else init().catch(error=>message(error.message,true));
})(window);
