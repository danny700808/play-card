'use strict';
const {HttpsError}=require('firebase-functions/v2/https');
async function read(db,dates,tx){
  const keys=[...new Set(dates)].filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d));
  const docs=await Promise.all(keys.map(date=>{const ref=db.collection('courseClassClosures').doc(date);return tx?tx.get(ref):ref.get();}));
  return docs.filter(s=>s.data()?.active===true).map(s=>({date:s.id,reason:String(s.data().reason||'停課')}));
}
async function assertOpen(db,dates,tx){
  const closed=await read(db,Array.isArray(dates)?dates:[dates],tx);
  if(closed.length)throw new HttpsError('failed-precondition',`${closed[0].date} 因${closed[0].reason}暫停開放，無法安排課程或預約，請選擇其他日期。`);
}
module.exports={read,assertOpen};
