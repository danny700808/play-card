'use strict';

const { GoogleAuth } = require('../../functions/node_modules/google-auth-library');

const PROJECT = 'youzi-c1b74';
const LOCATION = 'us-central1';
const FUNCTION_ID = 'loadInjiaoyunEducationMirrorAuto';
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const IAM_RETRY_DELAYS_MS = [15000, 30000, 60000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryableQuotaError(error) {
  const status = Number(error && error.response && error.response.status || error && error.code || 0);
  const message = String(error && error.message || error || '');
  return status === 429 || /quota exceeded|insufficient_tokens|resource_exhausted/i.test(message);
}

async function readPolicy(client, service) {
  const response = await client.request({
    method: 'GET',
    url: `https://run.googleapis.com/v2/${service}:getIamPolicy`
  });
  const policy = response.data || {};
  policy.bindings = Array.isArray(policy.bindings) ? policy.bindings : [];
  return policy;
}

function addPublicInvoker(policy) {
  let binding = policy.bindings.find((row) => row.role === 'roles/run.invoker');
  if (!binding) {
    binding = { role: 'roles/run.invoker', members: [] };
    policy.bindings.push(binding);
  }
  binding.members = Array.isArray(binding.members) ? binding.members : [];
  if (binding.members.includes('allUsers')) return false;
  binding.members.push('allUsers');
  return true;
}

async function ensurePublicInvoker(client, service) {
  for (let attempt = 0; attempt <= IAM_RETRY_DELAYS_MS.length; attempt += 1) {
    const policy = await readPolicy(client, service);
    const changed = addPublicInvoker(policy);
    if (!changed) {
      console.log('roles/run.invoker for allUsers is already configured; no IAM write needed.');
      return;
    }
    try {
      await client.request({
        method: 'POST',
        url: `https://run.googleapis.com/v2/${service}:setIamPolicy`,
        data: { policy, updateMask: 'bindings,etag' }
      });
      return;
    } catch (error) {
      if (!retryableQuotaError(error) || attempt >= IAM_RETRY_DELAYS_MS.length) throw error;
      const delay = IAM_RETRY_DELAYS_MS[attempt];
      console.warn(`Cloud Run IAM write quota is busy; retrying in ${Math.round(delay / 1000)} seconds.`);
      await sleep(delay);
    }
  }
}

async function main() {
  const functionResource = `projects/${PROJECT}/locations/${LOCATION}/functions/${FUNCTION_ID}`;
  const auth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] });
  const client = await auth.getClient();

  const functionResponse = await client.request({
    method: 'GET',
    url: `https://cloudfunctions.googleapis.com/v2/${functionResource}`
  });
  const service = functionResponse.data && functionResponse.data.serviceConfig && functionResponse.data.serviceConfig.service;
  if (!service) throw new Error('Cloud Functions API did not return the linked Cloud Run service.');
  console.log('Cloud Run service:', service);

  await ensurePublicInvoker(client, service);

  const verifiedPolicy = await readPolicy(client, service);
  const verifiedBindings = verifiedPolicy.bindings;
  const publicBinding = verifiedBindings.find((row) => row.role === 'roles/run.invoker');
  if (!publicBinding || !Array.isArray(publicBinding.members) || !publicBinding.members.includes('allUsers')) {
    throw new Error('Cloud Run public invoker binding was not saved.');
  }
  console.log('Verified roles/run.invoker for allUsers.');
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
