/* Adds only capabilities already verified by the server; never creates a staff role. */
(async function(){
 'use strict';
 const entry=document.getElementById('teacherEmployeeEntry');if(!entry||!window.CoursePortal)return;
 if(window.parent!==window)return;
 (async()=>{try{if(!firebase.apps.length)firebase.initializeApp(APP_CONFIG.FIREBASE_CONFIG);const auth=firebase.auth();if(auth.authStateReady)await auth.authStateReady();const claims=auth.currentUser?(await auth.currentUser.getIdTokenResult()).claims:{};if(claims.employee===true&&claims.manager===true){const preview=document.getElementById('teacherMobilePreview');if(preview){preview.hidden=false;preview.style.display='';}}}catch(e){}})();
 try{
  const sessionToken=CoursePortal.getSession('teacher');if(!sessionToken)return;
  const res=await CoursePortal.call('personalWorkspace',{action:'portal-capabilities',sessionToken});
  if(!res.employee)return;
  entry.hidden=false;entry.style.display='';entry.parentElement.style.gridTemplateColumns='repeat(6,minmax(0,1fr))';entry.addEventListener('click',async()=>{
   entry.disabled=true;
   try{
    const r=await CoursePortal.call('personalWorkspace',{action:'employee-entry',sessionToken});
    if(!firebase.apps.length)firebase.initializeApp(APP_CONFIG.FIREBASE_CONFIG);
    await firebase.auth().signInWithCustomToken(r.token);
    localStorage.setItem('employeeUser',JSON.stringify(r.user));localStorage.setItem('employeeUserId',r.user.id);localStorage.setItem('employeeSecureAuthVersion','1');location.href='dashboard.html?ui=20261031-mobile1';
   }catch(e){CoursePortal.toast(e.message||'暫時無法開啟出勤。','error');entry.disabled=false;}
  });
 }catch(e){/* The existing teacher portal remains available if capability lookup fails. */}
})();
