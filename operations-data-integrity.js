(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.OperationsDataIntegrity=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function formatLabelSku(value){
    const raw=String(value==null?'':value).trim().replace(/\s+/g,'');
    if(!raw||/^\d{3}-/.test(raw))return raw;
    const match=raw.match(/^(\d{3})(\d{4})(.*)$/),suffix=match&&String(match[3]||'').replace(/^-+/,'');
    return match?match[1]+'-'+match[2]+(suffix?'-'+suffix:''):raw;
  }

  function positiveInventoryDelta(beforeValue,quantityValue){
    const before=Number(beforeValue||0),delta=Math.max(0,Math.round(Number(quantityValue||0))),after=before+delta;
    return {before:before,after:after,delta:delta,layerQty:Math.max(0,after)-Math.max(0,before)};
  }

  return {formatLabelSku:formatLabelSku,positiveInventoryDelta:positiveInventoryDelta};
});
