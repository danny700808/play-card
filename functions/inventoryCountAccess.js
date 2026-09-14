'use strict';
const crypto=require('node:crypto');
const clean=v=>String(v==null?'':v).trim(),num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
function normalizeLayers(value){return (Array.isArray(value)?value:[]).map((l,i)=>({layerId:clean(l.layerId)||'L'+i,qtyRemaining:Math.max(0,Number(l.qtyRemaining||l.qty||0)),originalQty:Math.max(0,Number(l.originalQty||l.qty||0)),unitCost:num(l.unitCost),costKnown:l.costKnown!==false&&num(l.unitCost)!=null,receivedAt:l.receivedAt||'',referenceType:clean(l.referenceType)||'unknown',referenceId:clean(l.referenceId)})).filter(l=>l.qtyRemaining>0).sort((a,b)=>new Date(a.receivedAt||0)-new Date(b.receivedAt||0));}
function materialize(raw){const target=Math.max(0,Number(raw.currentStock||0));let layers=normalizeLayers(raw.costLayers),total=layers.reduce((s,l)=>s+l.qtyRemaining,0);if(total<target){const fallback=num(raw.averageCost)!=null?num(raw.averageCost):num(raw.latestPurchaseCost);layers.push({layerId:'mobile-fallback',qtyRemaining:target-total,originalQty:target-total,unitCost:fallback,costKnown:fallback!=null,receivedAt:'1970-01-01T00:00:00.000Z',referenceType:'fallback',referenceId:'LEGACY'});}if(total>target){let extra=total-target;for(let i=layers.length-1;i>=0&&extra>0;i--){const take=Math.min(extra,layers[i].qtyRemaining);layers[i].qtyRemaining-=take;extra-=take;}layers=layers.filter(l=>l.qtyRemaining>0);}return layers;}
function stats(layers){layers=normalizeLayers(layers);const qty=layers.reduce((s,l)=>s+l.qtyRemaining,0),known=layers.filter(l=>l.costKnown&&l.unitCost!=null),knownQty=known.reduce((s,l)=>s+l.qtyRemaining,0),value=known.reduce((s,l)=>s+l.qtyRemaining*l.unitCost,0);return {layers,averageCost:qty>0&&knownQty===qty?value/qty:null,inventoryValue:value,costIncomplete:qty>knownQty};}
function adjustLayers(raw,target){const old=Math.max(0,Number(raw.currentStock||0)),latest=num(raw.latestPurchaseCost)!=null?num(raw.latestPurchaseCost):num(raw.averageCost);let layers=materialize(raw);if(target>old){const add=target-old;layers.push({layerId:'COUNT-'+Date.now(),qtyRemaining:add,originalQty:add,unitCost:latest,costKnown:latest!=null,receivedAt:new Date().toISOString(),referenceType:'stocktakeIncrease',referenceId:'MOBILE'});}else if(target<old){let take=old-target;for(const l of layers){if(take<=0)break;const n=Math.min(take,l.qtyRemaining);l.qtyRemaining-=n;take-=n;}layers=layers.filter(l=>l.qtyRemaining>0);}return stats(layers);}

function createInventoryCountAccess({db,FieldValue,now=Date.now}){
  const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  async function login(data){
    const doc=await db.collection('opsSettings').doc('inventoryCount').get(),setting=doc.exists?doc.data():{};
    if(setting.enabled===false)throw Error('盤點入口目前已停用。');
    if(!/^[a-f0-9]{64}$/i.test(clean(setting.pinHash)))throw Error('請管理者先在庫存作業設定盤點密碼。');
    const actual=hash(clean(data.pin)),expected=clean(setting.pinHash).toLowerCase();
    if(!crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))throw Error('盤點密碼不正確。');
    const token=crypto.randomBytes(32).toString('base64url');
    await db.collection('inventoryCountSessions').doc(hash(token)).set({expiresAtMs:now()+8*3600000,expiresAt:new Date(now()+8*3600000),pinVersion:expected});
    return {ok:true,token};
  }
  async function session(token){
    if(!/^[A-Za-z0-9_-]{40,100}$/.test(clean(token)))throw Error('請重新輸入盤點密碼。');
    const [doc,settings]=await Promise.all([db.collection('inventoryCountSessions').doc(hash(token)).get(),db.collection('opsSettings').doc('inventoryCount').get()]);
    if(!doc.exists||doc.data().expiresAtMs<=now()||!settings.exists||settings.data().enabled===false||doc.data().pinVersion!==clean(settings.data().pinHash).toLowerCase())throw Error('盤點登入已失效，請重新輸入密碼。');
  }
  async function products(data){
    await session(data.token);
    const rows=(await db.collection('opsInternalProducts').limit(10000).get()).docs;
    const fields=['internalName','originalName','onlineName','name','internalSku','sku','code','barcode','model','brand','category','variantName','alternateNames','searchKeywords','imageUrl','imageUrls','enabled','currentStock'];
    return {ok:true,products:rows.filter(doc=>doc.data().enabled!==false).map(doc=>({id:doc.id,...Object.fromEntries(fields.filter(key=>doc.data()[key]!==undefined).map(key=>[key,doc.data()[key]]))}))};
  }
  async function save(data){
    await session(data.token);
    const id=clean(data.productId),operationId=clean(data.operationId),operator=clean(data.operator).slice(0,100),target=Number(data.target),expected=Number(data.expectedStock);
    if(!id||id.includes('/')||!/^[A-Za-z0-9_-]{16,100}$/.test(operationId)||!operator||!Number.isSafeInteger(target)||target<0||target>1000000||!Number.isFinite(expected))throw Error('盤點資料不完整。');
    const productRef=db.collection('opsInternalProducts').doc(id),operationRef=db.collection('inventoryCountOperations').doc(operationId),inventoryRef=db.collection('opsInventoryTransactions').doc('COUNT-'+operationId),queueRef=db.collection('opsPlatformInventoryQueue').doc(id);
    const fingerprint=hash(JSON.stringify([id,target,expected,operator,clean(data.note)]));
    return db.runTransaction(async tx=>{
      const prior=await tx.get(operationRef);if(prior.exists){if(prior.data().fingerprint!==fingerprint)throw Error('這筆盤點操作已使用，請重新確認。');return prior.data().result;}
      const doc=await tx.get(productRef);if(!doc.exists)throw Error('商品主檔不存在。');const raw=doc.data(),before=Number(raw.currentStock||0);
      if(before!==expected)throw Error('庫存已被其他銷售或盤點更新，請重新搜尋商品並確認數量。');
      const adjusted=adjustLayers(raw,target),sku=clean(raw.internalSku||raw.sku),result={ok:true,before,after:target};
      tx.update(productRef,{currentStock:target,costLayers:adjusted.layers,averageCost:adjusted.averageCost,inventoryValue:adjusted.inventoryValue,costIncomplete:adjusted.costIncomplete,updatedAt:FieldValue.serverTimestamp(),updatedBy:operator});
      tx.set(queueRef,{productId:id,sku,targetStock:target,status:'pending',reason:'mobileStocktake',updatedAt:FieldValue.serverTimestamp(),updatedBy:operator,version:'mobile-count-server-v1'},{merge:true});
      tx.set(inventoryRef,{type:'adjustment',productId:id,productName:clean(raw.internalName||raw.originalName||raw.onlineName),sku,qtyChange:target-before,beforeStock:before,afterStock:target,unitCost:num(raw.latestPurchaseCost)||num(raw.averageCost),costMethod:'FIFO',referenceType:'stocktake',referenceId:'COUNT-'+operationId,stocktakeNo:'COUNT-'+operationId,counterName:operator,source:'mobile',note:clean(data.note)||'手機庫存盤點',occurredAt:new Date(),createdAt:FieldValue.serverTimestamp(),createdBy:operator,version:'mobile-count-server-v1'});
      tx.create(operationRef,{fingerprint,result,createdAt:FieldValue.serverTimestamp()});return result;
    });
  }
  return {login,products,save};
}
module.exports={createInventoryCountAccess,adjustLayers};
