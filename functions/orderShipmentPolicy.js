'use strict';
// Structured platform states only: buyer notes and substring matches are not evidence.
const text = v => String(v == null ? '' : v).trim().toLowerCase();
const shipped = new Set(['shipped','fulfilled','partially_fulfilled','partial','shipping','departure','delivering','delivered','final_delivery','none_tracking','in_transit','customer_picked_up','出貨確認','已出貨','出貨完成','配送中','配送結束','已配送','已送達','已收貨','已簽收','門市已進驗','進驗成功']);
const unshipped = new Set(['unshipped','unfulfilled','not_shipped','pending_shipment','ready_to_ship','accept','instruct','待出貨','未出貨','尚未出貨','備貨中']);
const cancelled = new Set(['cancelled','canceled','void','voided','expired','payment_failed','cancelled_before_shipment','已取消','取消完成','客戶取消','買家取消','賣家取消','系統確認訂單已取消','已作廢','付款失敗','付款逾期','逾期未付']);
const requests = /cancel|refund|return|restocked|取消|退貨|退款|拒收|退回|作廢|逾期/;
function hasDate(v) {
  if (!v) return false;
  if (typeof v.toDate === 'function') v=v.toDate();
  return Number.isFinite(new Date(v).getTime()) && new Date(v).getTime()>0;
}
function states(row) { return ['orderStatus','fulfillmentStatus','shippingStatus'].map(k=>text(row&&row[k])).filter(Boolean); }
function shipmentState(row) {
  row=row||{};
  if (row.shipmentConfirmed===true || hasDate(row.shippedAt) || ['y','a'].includes(text(row.releaseStatus)) || states(row).some(s=>shipped.has(s))) return 'shipped';
  if (['n','s'].includes(text(row.releaseStatus)) || states(row).some(s=>unshipped.has(s)) || row.confirmedUnshipped===true) return 'unshipped';
  return 'unknown';
}
function cancellationConfirmed(row) {
  if (row.cancellationConfirmed===true || hasDate(row.cancelledAt)) return true;
  // Coupang return requests are not cancellation confirmations.
  if (text(row.platform)==='coupang' && row.cancellationEventId) return text(row.receiptStatus)==='returns_completed';
  return [row.orderStatus,row.paymentStatus].map(text).some(s=>cancelled.has(s));
}
function isClaim(row) { return !!row && (row.cancellationConfirmed===true || hasDate(row.cancelledAt) || [row.orderStatus,row.paymentStatus,row.receiptStatus,row.fulfillmentStatus].map(text).some(s=>requests.test(s))); }
function mergeEvidence(existing,incoming) {
  existing=existing||{}; incoming=incoming||{};
  const merged={...existing,...incoming};
  // Shipment is a one-way historical fact, even if the latest state is cancelled.
  merged.shipmentConfirmed=shipmentState(existing)==='shipped'||shipmentState(incoming)==='shipped';
  for(const k of ['shippedAt']) if(!hasDate(incoming[k])&&hasDate(existing[k])) merged[k]=existing[k];
  return merged;
}
function decision(existing,incoming) {
  const row=mergeEvidence(existing,incoming);
  if(!isClaim(incoming)) return 'active';
  if(row.shipmentConfirmed) return 'manual-return-review';
  // Old pre-shipment states are not proof that an order is still unshipped now.
  if(cancellationConfirmed(incoming)&&shipmentState(incoming)==='unshipped') return 'reverse';
  return 'cancellation-review';
}
module.exports={shipmentState,cancellationConfirmed,isClaim,mergeEvidence,decision};
