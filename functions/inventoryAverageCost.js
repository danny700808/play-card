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
  return {unit,snapshot,consume};
});
