/* Restore the existing manager session before reading personnel data. */
window.ensureHrSession = async function(user){
  if(!window.firebase || !window.APP_CONFIG || !APP_CONFIG.FIREBASE_CONFIG) throw new Error('無法載入登入服務，請重新整理。');
  if(!firebase.apps.length) firebase.initializeApp(APP_CONFIG.FIREBASE_CONFIG);
  const result = await window.YouziOperationsManagerAuth.ensureManagerAuth(window,user);
  if(!result.ok) throw new Error(result.message || '登入已失效，請重新登入。');
};
