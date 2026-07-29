'use strict';
const fs=require('fs');
let html=fs.readFileSync('teacher-course-portal.html','utf8');
if(!html.includes('data-late-attendance')){
  html=html.replace('<button class="btn soft" type="button" data-lesson-state="leave">學生請假</button>','<button class="btn soft" type="button" data-lesson-state="leave">學生請假</button><button class="btn" type="button" data-late-attendance>補簽到</button>');
  html=html.replace(/teacher-course-portal-v8\.js\?v=[^"]+/g,'teacher-course-portal-v8.js?v=20260730-late-attendance-v1');
  fs.writeFileSync('teacher-course-portal.html',html);
}
let js=fs.readFileSync('teacher-course-portal-v8.js','utf8');
if(!js.includes("coursePortalTeacherLateAttendance")){
  const marker="  document.getElementById('lessonStateActions').addEventListener('click', async (event) => {";
  if(!js.includes(marker)) throw new Error('lesson state handler not found');
  js=js.replace(marker,`  document.getElementById('lessonStateActions').addEventListener('click', async (event) => {\n    const lateButton=event.target.closest('[data-late-attendance]');\n    if(lateButton){\n      const form=document.getElementById('actionForm');\n      if(!confirm('補簽到會收取行政處理費 NT$50，並直接列入本月薪資扣款。確定要補簽到嗎？'))return;\n      loading(lateButton,true,'補簽中…');\n      try{\n        const result=await invoke('coursePortalTeacherLateAttendance',{sessionToken:token,sourceEventId:form.elements.sourceEventId.value,sourceCourseId:form.elements.sourceCourseId.value,sourceDate:form.elements.sourceDate.value});\n        document.getElementById('actionModal').classList.add('hidden');\n        clearCache();\n        toast(result.message||'補簽到已完成。');\n        await load(true);\n      }catch(error){toast(error.message,'error');}\n      finally{loading(lateButton,false);}\n      return;\n    }`);
  fs.writeFileSync('teacher-course-portal-v8.js',js);
}
console.log('late attendance UI installed');