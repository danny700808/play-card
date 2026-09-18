'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

async function main() {
  if (!/COURSE_PORTAL_TAIWAN_EXTENDED:\s*true/.test(fs.readFileSync('config.js', 'utf8'))) {
    console.log('Extended Taiwan routing is disabled.');
    return;
  }
  const actions = ['TeacherUtilitySession', 'TeacherUpdateStudent', 'TeacherSubmitContactBookPost', 'TeacherBonusRequest'];
  for (const action of actions) {
    const name = `coursePortal${action}Taiwan`;
    // All four handlers require a session before any business-data reads or writes.
    // A normal callable UNAUTHENTICATED response proves routing and IAM reachability.
    const response = await fetch(`https://asia-east1-youzi-c1b74.cloudfunctions.net/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://danny700808.github.io' },
      body: JSON.stringify({ data: {} }),
      signal: AbortSignal.timeout(60000)
    });
    let body;
    try { body = await response.json(); } catch { body = null; }
    assert.equal(response.status, 401, `${name}: expected callable authentication rejection; HTTP ${response.status}`);
    assert.equal(body?.error?.status, 'UNAUTHENTICATED', `${name}: did not reach the protected callable handler`);
    console.log(`${name}: deployed and authentication enforced`);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
