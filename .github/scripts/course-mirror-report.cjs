'use strict';

const fs = require('fs');

async function main() {
  const deploy = process.env.DEPLOY_OUTCOME || 'unknown';
  const access = process.env.ACCESS_OUTCOME || 'unknown';
  const health = process.env.HEALTH_OUTCOME || 'unknown';
  const success = deploy === 'success' && access === 'success' && health === 'success';
  let description = success
    ? 'Course mirror deployed, opened, and returned actual schedule data'
    : `deploy=${deploy}, access=${access}, health=${health}`;

  try {
    const responseText = fs.readFileSync('/tmp/course-mirror-response.json', 'utf8')
      .replace(/\nHTTP_STATUS=\d+\n?$/, '');
    const body = JSON.parse(responseText);
    const message = body.error && (body.error.message || body.error.status);
    if (!success && message) description = String(message);
  } catch (_) {}

  const response = await fetch(
    `https://api.github.com/repos/${process.env.REPOSITORY}/statuses/${process.env.COMMIT_SHA}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        state: success ? 'success' : 'failure',
        context: 'firebase/functions-course-mirror',
        description: description.slice(0, 140),
        target_url: process.env.RUN_URL
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Unable to report final status: ${response.status} ${await response.text()}`);
  }
  console.log('Reported final deployment status:', success ? 'success' : 'failure', description);
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
