/* One shared print template. Loading never creates or replaces saved content. */
(function(root){
  'use strict';
  const fields=['cardTitle','cardSubtitle','badgeText','fieldA','fieldB','fieldC','rules'];
  function db(){
    if(!root.firebase||!root.APP_CONFIG?.FIREBASE_CONFIG)throw new Error('服務未載入，請重新整理。');
    if(!root.firebase.apps.length)root.firebase.initializeApp(root.APP_CONFIG.FIREBASE_CONFIG);
    return root.firebase.firestore();
  }
  async function employeeSession(){
    db();
    const auth=root.firebase.auth();
    if(typeof auth.authStateReady==='function')await auth.authStateReady();
    else await new Promise((resolve,reject)=>{
      let off,done=false,timer;
      const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);if(off)off();error?reject(error):resolve();};
      off=auth.onAuthStateChanged(()=>finish(),finish);
      if(done)off();else timer=setTimeout(()=>finish(new Error('登入確認逾時，請重試。')),15000);
    });
    if(!auth.currentUser)throw new Error('登入已失效，請重新登入。');
  }
  async function load(user,manager){
    if(manager)await root.YZManagerAuth.requireManagerSession({redirect:false,expectedManager:user});
    else if(user?.portalSessionBridge===true){
      const result=await root.YZProtectedData.call('externalTeacherWork',{action:'getGiftPointCardTemplate'});
      if(!result||result.ok!==true)throw new Error(result?.message||'集點卡讀取失敗。');
      return {exists:result.exists===true,data:result.template||{}};
    }else await employeeSession();
    const snap=await db().collection('printTemplates').doc('giftPointCard').get({source:'server'});
    return {exists:snap.exists,data:snap.exists?snap.data():{}};
  }
  async function save(user,data){
    await root.YZManagerAuth.requireManagerSession({redirect:false,expectedManager:user});
    const patch=Object.fromEntries(fields.map(key=>[key,String(data[key]??'')]));
    patch.updatedAt=new Date().toISOString();
    await db().collection('printTemplates').doc('giftPointCard').set(patch,{merge:true});
    return patch;
  }
  root.GiftCardService={load,save};
})(window);
