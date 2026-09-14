'use strict';
const { GoogleAuth } = require('../../functions/node_modules/google-auth-library');
const indexes = require('../../firestore.indexes.json').indexes.filter(i => i.collectionGroup === 'coursePortalRoomBookings');
const endpoint = 'https://firestore.googleapis.com/v1/projects/youzi-c1b74/databases/(default)/collectionGroups/coursePortalRoomBookings/indexes';
const signature = i => JSON.stringify({ queryScope: i.queryScope, fields: i.fields.map(f => ({ fieldPath: f.fieldPath, order: f.order })) });
async function main() {
  const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] }).getClient();
  async function list() {
    let pageToken, rows = [];
    do {
      const { data } = await client.request({ url: endpoint, params: pageToken ? { pageToken } : {} });
      rows.push(...(data.indexes || [])); pageToken = data.nextPageToken;
    } while (pageToken);
    return rows;
  }
  const existing = await list();
  for (const index of indexes) {
    if (existing.some(i => signature(i) === signature(index))) continue;
    try {
      await client.request({ url: endpoint, method: 'POST', data: { queryScope: index.queryScope, fields: index.fields } });
      console.log('Requested booking index:', index.fields.map(f => f.fieldPath).join(', '));
    } catch (error) { if (error.response?.status !== 409) throw error; }
  }
  const deadline = Date.now() + 20 * 60 * 1000;
  while (Date.now() < deadline) {
    const rows = await list();
    const matching = indexes.map(index => rows.find(i => signature(i) === signature(index)));
    if (matching.some(i => i?.state === 'NEEDS_REPAIR')) throw new Error('Booking index needs repair');
    if (matching.every(i => i?.state === 'READY')) { console.log('All booking indexes are READY.'); return; }
    console.log('Waiting for booking indexes before deploying paginated reads.');
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  throw new Error('Booking indexes are not ready; function deployment stopped.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
