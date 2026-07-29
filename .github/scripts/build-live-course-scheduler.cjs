'use strict';

const fs = require('fs');

const sourcePath = 'course-scheduler.html';
const targetPath = 'course-scheduler-live.html';
let html = fs.readFileSync(sourcePath, 'utf8');

html = html.replace(/course-scheduler\.css\?v=[^"']+/g, 'course-scheduler.css?v=20260729-live-full-scheduler-v2');

const firstScript = html.indexOf('  <script src="config.js');
const bodyEnd = html.lastIndexOf('</body>');
if (firstScript < 0 || bodyEnd < 0 || firstScript >= bodyEnd) {
  throw new Error('Unable to locate the scheduler script block.');
}

const scripts = `  <script>(function(){try{var p=new URLSearchParams(location.search);var q='course-scheduler.html?live=20260729-v2&embed='+encodeURIComponent(p.get('embed')||'1')+'&view='+encodeURIComponent(p.get('view')||'calendar');history.replaceState(null,'',q+location.hash);}catch(_){}})();</script>
  <script src="config.js?v=20260722-course-scheduler-v2"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-functions-compat.js"></script>
  <script src="course-scheduler-data.js?v=20260729-live-full-scheduler-v2"></script>
  <script src="course-data-auto-bootstrap-v1.js?v=20260729-live-full-scheduler-v2"></script>
  <script>window.__YOUZI_COURSE_AUTO_BOOTSTRAP_REQUESTED__=true;</script>
  <script src="course-scheduler-review-data.js?v=20260729-live-full-scheduler-v2"></script>
  <script src="course-scheduler-live-entry-v1.js?v=20260729-live-full-scheduler-v2"></script>
`;

html = html.slice(0, firstScript) + scripts + html.slice(bodyEnd);
fs.writeFileSync(targetPath, html);
console.log(`Built ${targetPath}`);
