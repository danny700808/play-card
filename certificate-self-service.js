/* Personal certificate requests always use the authenticated server identity. */
(function(root){
  const original=root.api;
  const actions=new Set(['getCertificateTemplate','getCertificateApplications','submitCertificateApplication']);
  root.api=async function(action,payload={}){
    if(actions.has(action)){
      if(!root.firebase.apps.length)root.firebase.initializeApp(root.APP_CONFIG.FIREBASE_CONFIG);
      return root.YZProtectedData.call('externalTeacherWork',{...payload,action});
    }
    return original(action,payload);
  };
})(window);
