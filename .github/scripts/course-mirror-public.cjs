'use strict';

const { GoogleAuth } = require('../../functions/node_modules/google-auth-library');

const PROJECT = 'youzi-c1b74';
const LOCATION = 'us-central1';
const FUNCTION_ID = 'loadInjiaoyunEducationMirrorAuto';
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

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

  const policyResponse = await client.request({
    method: 'GET',
    url: `https://run.googleapis.com/v2/${service}:getIamPolicy`
  });
  const policy = policyResponse.data || {};
  policy.bindings = Array.isArray(policy.bindings) ? policy.bindings : [];

  let binding = policy.bindings.find((row) => row.role === 'roles/run.invoker');
  if (!binding) {
    binding = { role: 'roles/run.invoker', members: [] };
    policy.bindings.push(binding);
  }
  binding.members = Array.isArray(binding.members) ? binding.members : [];
  if (!binding.members.includes('allUsers')) binding.members.push('allUsers');

  await client.request({
    method: 'POST',
    url: `https://run.googleapis.com/v2/${service}:setIamPolicy`,
    data: { policy, updateMask: 'bindings,etag' }
  });

  const verifiedResponse = await client.request({
    method: 'GET',
    url: `https://run.googleapis.com/v2/${service}:getIamPolicy`
  });
  const verifiedBindings = Array.isArray(verifiedResponse.data && verifiedResponse.data.bindings)
    ? verifiedResponse.data.bindings
    : [];
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
