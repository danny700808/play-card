'use strict';

const fs = require('fs');

const sourcePath = 'course-scheduler.html';
const targetPath = 'course-scheduler-live.html';
const runtimeVersion = '20260729-formal-runtime-v4';
const routeVersion = '20260729-authoritative-course-v4';
let html = fs.readFileSync(sourcePath, 'utf8');

html = html.replace(/course-scheduler\.css\?v=[^"']+/g, `course-scheduler.css?v=${runtimeVersion}`);

const firstScript = html.indexOf('  <script src="config.js');
const bodyEnd = html.lastIndexOf('</body>');
if (firstScript < 0 || bodyEnd < 0 || firstScript >= bodyEnd) {
  throw new Error('Unable to locate the scheduler script block.');
}

const scripts = `  <script src="config.js?v=20260722-course-scheduler-v2"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-functions-compat.js"></script>
  <script src="course-scheduler-data.js?v=${runtimeVersion}"></script>
  <script src="course-scheduler-live-entry-v1.js?v=${runtimeVersion}"></script>
`;

html = html.slice(0, firstScript) + scripts + html.slice(bodyEnd);
fs.writeFileSync(targetPath, html);

const legacyScripts = [
  'course-data-auto-bootstrap-v1.js',
  'operations-course-persistence-v1.js',
  'operations-course-simple-full-v1.js',
  'operations-course-snapshot-bridge-v1.js',
  'operations-course-live-route-v1.js'
];

for (const path of ['operations-hub.html', 'portal.html']) {
  let source = fs.readFileSync(path, 'utf8');
  for (const legacy of legacyScripts) {
    const escaped = legacy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    source = source.replace(new RegExp(`\\s*<script src="${escaped}\\?v=[^"]+"><\\/script>\\s*`, 'g'), '\n');
  }
  source = source.replace(
    /operations-course-authoritative-v1\.js\?v=[^"']+/g,
    `operations-course-authoritative-v1.js?v=${routeVersion}`
  );
  fs.writeFileSync(path, source);
}

console.log(`Built ${targetPath} with ${runtimeVersion} and route ${routeVersion}`);
