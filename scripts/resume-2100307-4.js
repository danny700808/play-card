'use strict';

const admin = require('../functions/node_modules/firebase-admin');
const PRODUCT_ID = 'Ui7HQyrWtdcfG1r7nKlt';
const SNAPSHOT_ID = 'Ui7HQyrWtdcfG1r7nKlt-mt2l5818';
const WORKFLOW_VERSION = 'youzi-four-channel-listing-v2';

async function main() {
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = admin.firestore();
  const ref = db.collection('opsProductListingCases').doc(PRODUCT_ID);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new Error('Listing case not found');
    const listingCase = snap.data() || {};
    const handoff = listingCase.codexHandoff && typeof listingCase.codexHandoff === 'object' ? listingCase.codexHandoff : {};
    const frozen = handoff.preflightSnapshot && typeof handoff.preflightSnapshot === 'object' ? handoff.preflightSnapshot : {};
    if (handoff.workflowVersion !== WORKFLOW_VERSION || frozen.workflowVersion !== WORKFLOW_VERSION) throw new Error('Only fixed v2 is allowed');
    if (frozen.snapshotId !== SNAPSHOT_ID) throw new Error('Immutable snapshot mismatch');
    if (!Array.isArray(listingCase.generatedListingImages) || listingCase.generatedListingImages.length < 11) throw new Error('Expected completed images are not ready');
    if (listingCase.publishState && listingCase.publishState.jobId) {
      console.log('Existing publish job found; no new job created');
      return;
    }
    transaction.set(ref, {
      codexHandoff: {
        ...handoff,
        autoPublishAuthorization: {
          granted: true,
          scope: 'fixed-v2-four-channel-publish',
          workflowVersion: WORKFLOW_VERSION,
          snapshotId: SNAPSHOT_ID,
          grantedAt: admin.firestore.FieldValue.serverTimestamp(),
          grantedBy: 'Approved Codex recovery for 2100307-4',
          grantedByEmail: 'danny700808@gmail.com',
          noSecondConfirmation: true
        }
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'Codex v2 recovery for 2100307-4'
    }, { merge: true });
  });
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const latest = (await ref.get()).data() || {};
    const auto = latest.codexAutoPublish && typeof latest.codexAutoPublish === 'object' ? latest.codexAutoPublish : {};
    const publish = latest.publishState && typeof latest.publishState === 'object' ? latest.publishState : {};
    console.log(JSON.stringify({ attempt: attempt + 1, autoStatus: auto.status || '', jobId: publish.jobId || auto.jobId || '', currentStage: publish.currentStage || auto.currentStage || '', publishStatus: publish.status || '', error: auto.error || '' }));
    if (publish.jobId || auto.jobId) return;
    if (auto.status === 'failed') throw new Error(auto.error || 'Automatic publish failed');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('Automatic publish job was not created within four minutes');
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});