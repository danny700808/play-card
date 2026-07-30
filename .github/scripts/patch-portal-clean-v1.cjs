'use strict';
const fs=require('fs');
function patch(path,fn){let source=fs.readFileSync(path,'utf8');const next=fn(source);if(next===source)throw new Error('No change for '+path);fs.writeFileSync(path,next);}
patch('teacher-course-portal.html',source=>{
  source=source.replace('<link rel="stylesheet" href="teacher-course-portal-v8.css?v=20260729-teacher-app-v8b">','<link rel="stylesheet" href="teacher-course-portal-v8.css?v=20260730-teacher-rules-v1">\n  <link rel="stylesheet" href="portal-clean-ui-v1.css?v=20260730-teacher-rules-v1">');
  source=source.replace('<body class="teacher-course-app">','<body class="teacher-course-app clean-portal-ui">');
  source=source.replace('teacher-course-portal-v8.js?v=20260730-late-attendance-v1','teacher-course-portal-v8.js?v=20260730-teacher-rules-v1');
  source=source.replace('</body>','  <script src="teacher-room-rules-v1.js?v=20260730-teacher-rules-v1"></script>\n</body>');
  return source;
});
patch('teacher-course-portal-v8.js',source=>source.replace("new Date(`${day}T12:00:00`).getDay() !== 2","new Date(`${day}T12:00:00`).getDay() !== 1"));
patch('student-course-portal.html',source=>{
  source=source.replace('<link rel="stylesheet" href="course-portal.css?v=20260727-mobile-v6">','<link rel="stylesheet" href="course-portal.css?v=20260730-clean-portal-v1">\n  <link rel="stylesheet" href="portal-clean-ui-v1.css?v=20260730-clean-portal-v1">');
  source=source.replace('<body>','<body class="clean-portal-ui">');
  source=source.replace('course-portal-common.js?v=20260727-mobile-v6','course-portal-common.js?v=20260730-clean-portal-v1');
  return source;
});
console.log('Clean portal UI installed.');