'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const files = fs.readdirSync('tests').filter(n => /^(course-|teacher-|student-|room-|portal-|attendance-|calendar-|external-teacher|injiaoyun-).*\.test\.(c?js)$/.test(n));
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...files.map(n => 'tests/' + n)], {
  stdio: 'inherit', env: { ...process.env, NODE_PATH: path.resolve('functions/node_modules') }
});
process.exitCode = result.status ?? 1;
