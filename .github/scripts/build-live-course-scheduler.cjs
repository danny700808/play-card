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

const scripts = `  <script src="config.js?v=20260722-course-scheduler-v2"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-functions-compat.js"></script>
  <script src="course-scheduler-data.js?v=20260729-live-full-scheduler-v2"></script>
  <script src="course-scheduler-live-entry-v1.js?v=20260729-live-full-scheduler-v2"></script>
`;

html = html.slice(0, firstScript) + scripts + html.slice(bodyEnd);
fs.writeFileSync(targetPath, html);

for (const path of ['operations-hub.html', 'portal.html']) {
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace(/operations-course-live-route-v1\.js\?v=[^"']+/g, 'operations-course-live-route-v1.js?v=20260729-direct-calendar-v1');
  fs.writeFileSync(path, source);
}

console.log(`Built ${targetPath} and preserved the direct calendar route version`);
