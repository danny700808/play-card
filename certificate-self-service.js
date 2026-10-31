/* Personal certificate requests always use the authenticated server identity. */
(function(root){
  const original=root.YZFirebase.handleApi;
  const actions=new Set(['getCertificateTemplate','getCertificateApplications','submitCertificateApplication']);
  root.YZFirebase.handleApi=async function(action,payload){
    if(actions.has(action))return root.YZProtectedData.call('externalTeacherWork',{...payload,action});
    return original(action,payload);
  };
})(window);
