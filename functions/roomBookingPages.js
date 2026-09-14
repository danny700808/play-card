'use strict';
const PAGE_SIZE = 25;
const tuple = doc => { const row = doc.data(); return [row.date, row.startTime, doc.id]; };
function compare(a, b) {
  for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; }
  return 0;
}
async function bookingPage({ db, documentId, identities, view, cursor, today, HttpsError }) {
  view = view === 'all' ? 'all' : 'upcoming';
  let after;
  if (cursor) {
    try {
      if (typeof cursor !== 'string' || cursor.length > 600) throw new Error();
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      if (parsed.view !== view || !Array.isArray(parsed.after) || parsed.after.length !== 3 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(parsed.after[0]) || !/^\d{2}:\d{2}$/.test(parsed.after[1]) ||
        typeof parsed.after[2] !== 'string' || !parsed.after[2] || parsed.after[2].includes('/')) throw new Error();
      after = parsed.after;
    } catch (_) { throw new HttpsError('invalid-argument', '預約紀錄頁碼已失效，請重新整理。'); }
  }
  const direction = view === 'all' ? 'desc' : 'asc';
  const snapshots = await Promise.all(identities.filter(([, value]) => value).map(([field, value]) => {
    let query = db.collection('coursePortalRoomBookings').where(field, '==', value);
    if (view === 'upcoming') query = query.where('active', '==', true).where('date', '>=', today);
    query = query.orderBy('date', direction).orderBy('startTime', direction).orderBy(documentId, direction);
    if (after) query = query.startAfter(...after);
    return query.limit(PAGE_SIZE + 1).get();
  }));
  const docs = [...new Map(snapshots.flatMap(s => s.docs).map(doc => [doc.id, doc])).values()]
    .sort((a, b) => compare(tuple(a), tuple(b)) * (direction === 'asc' ? 1 : -1));
  const page = docs.slice(0, PAGE_SIZE);
  const hasMore = docs.length > PAGE_SIZE;
  return { docs: page, hasMore, nextCursor: hasMore ? Buffer.from(JSON.stringify({ view, after: tuple(page.at(-1)) })).toString('base64url') : '' };
}
module.exports = { bookingPage, compare, PAGE_SIZE };
