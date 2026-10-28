(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.YouziInventoryAverageCost=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function unit(raw){const value=raw&&raw.averageCost;if(value==null||value==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;}
  function snapshot(raw,stock){
    const cost=unit(raw),qty=Math.max(0,Number(stock==null?raw.currentStock:stock)||0);
    const layers=qty?[{layerId:'MANUAL-AVERAGE',qtyRemaining:qty,originalQty:qty,unitCost:cost,costKnown:cost!=null,receivedAt:'1970-01-01T00:00:00.000Z',referenceType:'manualAverageCost',referenceId:''}]:[];
    return {layers,qty,trackedQty:qty,untrackedQty:0,averageCost:cost,nextFifoCost:cost,inventoryValue:qty*(cost||0),costIncomplete:qty>0&&cost==null,consumedCost:0};
  }
  function consume(raw,quantity,allowNegative){
    const before=Number(raw.currentStock)||0,qty=Math.max(0,Math.round(Number(quantity)||0)),cost=unit(raw);
    if(!allowNegative&&qty>before)throw Error('庫存不足，請先確認庫存數量');
    if(qty>0&&cost==null)throw Error('尚未設定平均成本，請在商品資訊填入平均成本');
    return Object.assign(snapshot(raw,before-qty),{before,after:before-qty,costTotal:qty*(cost||0),unknownCostQty:0,breakdown:qty?[{layerId:'MANUAL-AVERAGE',qty,unitCost:cost,referenceId:'product.averageCost'}]:[]});
  }
  function receive(raw,quantity,purchaseCost){
    const before=Number(raw.currentStock)||0,qty=Number(quantity),incoming=purchaseCost==null||purchaseCost===''?NaN:Number(purchaseCost),oldCost=unit(raw);
    if(!Number.isInteger(qty)||qty<=0)throw Error('進貨數量必須是大於 0 的整數');
    if(!Number.isFinite(incoming)||incoming<0)throw Error('請填寫有效的最近一次進貨成本');
    if(before>0&&oldCost==null)throw Error('原有庫存缺少平均成本，請先修正平均成本再進貨');
    // Negative inventory carries no positive stock value into the next receipt.
    const carriedQty=Math.max(0,before),averageCost=Math.round((carriedQty*(oldCost||0)+qty*incoming)/(carriedQty+qty));
    return Object.assign(snapshot({averageCost},before+qty),{before,after:before+qty,beforeAverageCost:oldCost,receiptUnitCost:incoming,receiptTotal:qty*incoming,costMethod:'WEIGHTED_AVERAGE_ROUNDED'});
  }
  function reviseReceipt(raw,oldItem,newItem,effectiveCost){
    const before=Number(raw.currentStock)||0,oldQty=Number(oldItem.qty)||0,newQty=Number(newItem.qty)||0,after=before+newQty-oldQty;
    if(after<0)throw Error('更正後庫存不可小於 0');
    const oldCost=oldItem.effectiveUnitCost==null?Number(oldItem.unitCost)||0:Number(oldItem.effectiveUnitCost),newCost=newQty?Number(effectiveCost):0;
    if(!Number.isFinite(newCost)||newCost<0)throw Error('進貨成本必須是有效的非負數');
    if(oldQty===newQty&&(!newQty||Math.abs(oldCost-newCost)<0.0000001))return snapshot(raw,after);
    // Legacy receipts did not update the average. Only newly added units are weighted.
    if(oldItem.costMethod!=='WEIGHTED_AVERAGE_ROUNDED')return newQty>oldQty?receive(raw,newQty-oldQty,newCost):snapshot(raw,after);
    const currentCost=unit(raw);
    if(before>0&&currentCost==null)throw Error('原有庫存缺少平均成本，請先修正平均成本');
    // Re-editing the latest unchanged receipt recomputes from its original baseline,
    // avoiding rounding drift (and restoring that baseline when it is removed).
    if(before===oldItem.afterStock&&currentCost===oldItem.afterAverageCost&&Number.isFinite(oldItem.beforeStock)){
      const baseline={currentStock:oldItem.beforeStock,averageCost:oldItem.beforeAverageCost};
      return newQty?receive(baseline,newQty,newCost):snapshot(baseline,after);
    }
    // Later sales keep their historical cost; apply only this receipt's value difference
    // to the stock that remains. Never rewrite previous sales or other receipts.
    if(after===0)return snapshot(raw,0);
    const value=Math.max(0,before)*(currentCost||0)+newQty*newCost-oldQty*oldCost;
    if(value<0)throw Error('此進貨已有後續庫存異動，成本更正將造成負庫存價值，請先確認商品平均成本');
    return snapshot({averageCost:Math.round(value/after)},after);
  }
  return {unit,snapshot,consume,receive,reviseReceipt};
});
