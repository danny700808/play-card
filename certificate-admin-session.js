/* Keep certificate administration on the authenticated current data source. */
(function(root){
  const original=root.api;
  root.api=async function(action,payload={}){
    if(/Certificate/.test(action)){
      await root.YZManagerAuth.requireManagerSession({redirect:false,expectedManager:root.getUser()});
      const result=await root.YZFirebase.handleApi(action,payload);
      if(!result||result.ok===false)throw new Error(result?.message||'證明服務暫時無法使用，請重試。');
      return result;
    }
    return original(action,payload);
  };
})(window);
