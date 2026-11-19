'use strict';
(function(){
  const ENDPOINT='https://asia-east1-youzi-c1b74.cloudfunctions.net/shippingDeskApi';
  const KEY='youziPackingSessionV1';
  const embedded=new URLSearchParams(location.search).get('embedded')==='1'&&window.parent!==window;
  let systemAuth=null,systemUser=null;
  let token='',generation=0,start;
  const $=id=>document.getElementById(id);
  if(!embedded)try{token=localStorage.getItem(KEY)||sessionStorage.getItem(KEY)||'';}catch(e){}
  function locked(message=''){
    generation++;token='';
    if(!embedded)try{localStorage.removeItem(KEY);sessionStorage.removeItem(KEY);}catch(e){}
    $('packingLogin').hidden=false;$('packingApp').hidden=true;
    $('loginError').textContent=message;
    if($('packingPassword'))$('packingPassword').value='';
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    if($('documentFrame'))$('documentFrame').src='about:blank';
  }
  async function request(action,body={},auth=token,timeout=120000){
    if(embedded){
      const user=systemAuth&&systemAuth.currentUser;
      if(!user||user!==systemUser)throw Error('系統登入已失效，請重新登入系統。');
      auth=await user.getIdToken();
      if(systemAuth.currentUser!==user||systemUser!==user)throw Error('系統登入已變更，請重新開啟出貨工作台。');
    }
    let response;
    try{response=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},
      body:JSON.stringify({action,...body}),signal:AbortSignal.timeout(timeout),cache:'no-store'});}
    catch(cause){const error=Error('連線暫時中斷，尚未確認主機結果。');error.retryable=true;throw error;}
    let payload;
    try{payload=await response.json();}catch(cause){const error=Error('未收到完整的主機回應。');error.retryable=response.ok||[408,429,500,502,503,504].includes(response.status);throw error;}
    if(!response.ok){
      if(response.status===401&&action!=='login')locked(embedded?'系統登入已失效，請重新登入系統。':'登入已失效，請重新輸入密碼。');
      const error=Error(payload.error||'連線失敗，請稍後再試。');
      error.retryable=[408,429,500,502,503,504].includes(response.status);throw error;
    }
    return payload;
  }
  function status(data){
    const el=$('hostStatus');
    if(data.agentOnline!==undefined){el.textContent=data.agentOnline?'主機已連線':'主機未連線';el.classList.toggle('offline',!data.agentOnline);}
  }
  window.ShippingTransport={
    loggedIn:()=>!!token,
    async api(path,body){
      const ownGeneration=generation;
      if(!token)throw Error('請先登入包貨窗口。');
      if(path==='/api/orders'){const r=await request('orders');if(generation!==ownGeneration)throw Error('已登出。');status(r);return r;}
      const command=path.replace('/api/','');
      const {jobId}=await request('enqueue',{command,body,requestId:crypto.randomUUID()});
      const until=Date.now()+180000;
      let polls=0,connectionFailures=0;
      while(Date.now()<until){
        // Detect short jobs promptly; back off for longer platform operations.
        await new Promise(r=>setTimeout(r,polls++===0?300:polls<=8?600:1200));
        if(generation!==ownGeneration)throw Error('已登出。');
        let r;
        try{r=await request('result',{jobId},token,Math.max(1,Math.min(15000,until-Date.now())));connectionFailures=0;}
        catch(error){
          if(generation!==ownGeneration)throw Error('已登出。');
          // Retry only the read of this job. Never enqueue or execute shipping again.
          if(!error.retryable)throw error;
          if(++connectionFailures>=5)throw Error('主機結果查詢連續中斷；工作可能仍在處理，請讀取最新訂單確認，勿重複申請出貨。');
          await new Promise(resolve=>setTimeout(resolve,Math.min(connectionFailures*1000,4000)));
          continue;
        }
        if(generation!==ownGeneration)throw Error('已登出。');
        if(r.status==='error')throw Error(r.error||'操作未完成。');
        if(r.status==='done')return r.result;
      }
      throw Error('主機仍在處理，請重新讀取訂單確認結果，勿重複申請出貨。');
    },
    ready(fn){
      start=fn;
      if(embedded){
        $('packingLogin').innerHTML='<div><h1>出貨工作台</h1><p id="loginError" role="status">正在讀取系統登入狀態…</p><button id="systemRetry" type="button">重新讀取</button></div>';
        $('packingLogout').hidden=true;
        $('systemRetry').onclick=()=>location.reload();
        try{
          if(window.parent.location.origin!==location.origin)throw Error('請從系統開啟出貨工作台。');
          systemAuth=window.parent.firebase.auth();
          const unsubscribe=systemAuth.onAuthStateChanged(async user=>{
            systemUser=user;locked(user?'正在讀取訂單…':'系統登入已失效，請重新登入系統。');
            if(!user)return;
            token='system';
            $('packingLogin').hidden=true;$('packingApp').hidden=false;
            try{await start();}catch(e){if(systemUser===user)locked(e.message);}
          });
          window.addEventListener('pagehide',unsubscribe,{once:true});
        }catch(e){locked('無法讀取系統登入狀態，請重新整理系統後再試。');}
        return;
      }
      $('packingLoginForm').addEventListener('submit',async e=>{
        e.preventDefault();const button=$('packingLoginButton');button.disabled=true;$('loginError').textContent='';
        try{
          const r=await request('login',{password:$('packingPassword').value,remember:$('packingRemember').checked},'');
          generation++;token=r.token;$('packingPassword').value='';
          try{sessionStorage.setItem(KEY,token);if($('packingRemember').checked)localStorage.setItem(KEY,token);else localStorage.removeItem(KEY);}catch(e){}
          $('packingLogin').hidden=true;$('packingApp').hidden=false;await start();
        }catch(e){$('loginError').textContent=e.message;}
        finally{button.disabled=false;}
      });
      $('packingLogout').addEventListener('click',async()=>{
        const old=token;locked();
        try{await request('logout',{},old);}catch(e){$('loginError').textContent='此電腦已登出。';}
      });
      if(token){$('packingLogin').hidden=true;$('packingApp').hidden=false;start();}
      else locked();
    }
  };
})();

