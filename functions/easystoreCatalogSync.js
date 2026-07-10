const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');

const EASYSTORE_ACCESS_TOKEN = defineSecret('EASYSTORE_ACCESS_TOKEN');
const OPERATIONS_SYNC_KEY = defineSecret('OPERATIONS_SYNC_KEY');
const EASYSTORE_STORE_URL = defineString('EASYSTORE_STORE_URL', { default: 'https://www.mingtinghuang.com' });
const EASYSTORE_API_BASE_PATH = defineString('EASYSTORE_API_BASE_PATH', { default: '/api/3.0' });

function clean(v){ return String(v == null ? '' : v).trim(); }
function normalizeSku(v){ return clean(v).replace(/^'+/, '').replace(/\u00a0/g,' ').trim().toUpperCase(); }
function numberOrNull(v){ if(v===null||v===undefined||clean(v)==='') return null; const n=Number(String(v).replace(/,/g,'').replace(/[^0-9.\-]/g,'')); return Number.isFinite(n)?n:null; }
function safeUrl(v){ const s=clean(v); if(!s) return ''; try{ const u=new URL(s); return /^https?:$/.test(u.protocol)?u.href:''; }catch(_){ return ''; } }
function pushImage(list,v){
  if(!v) return;
  if(Array.isArray(v)){ v.forEach(x=>pushImage(list,x)); return; }
  if(typeof v==='object'){
    ['src','url','imageUrl','original','large','medium','small','secure_url','downloadURL'].forEach(k=>{ if(v[k]) pushImage(list,v[k]); });
    ['images','photos','media','gallery','imageUrls','additionalImages'].forEach(k=>{ if(v[k]) pushImage(list,v[k]); });
    return;
  }
  const u=safeUrl(v); if(u&&!list.includes(u)) list.push(u);
}
function collectImages(obj){ const out=[]; if(!obj) return out; ['image','imageUrl','featuredImage','featured_image','mainImage','thumbnail','picture','photo','images','photos','media','gallery','imageUrls','additionalImages'].forEach(k=>pushImage(out,obj[k])); return out; }
function extractProducts(payload){ if(Array.isArray(payload)) return payload; if(payload&&typeof payload==='object'){ for(const k of ['products','data','items']) if(Array.isArray(payload[k])) return payload[k]; } return []; }
async function apiRequest(url,token){
  const res=await fetch(url,{headers:{'EasyStore-Access-Token':token,'Accept':'application/json','Content-Type':'application/json'}});
  const text=await res.text();
  if(!res.ok) throw new Error(`EasyStore HTTP ${res.status}: ${text.slice(0,500)}`);
  try{return text?JSON.parse(text):{};}catch(_){throw new Error(`EasyStore 回傳不是 JSON：${text.slice(0,500)}`);}
}
async function fetchAllProducts(token){
  const store=EASYSTORE_STORE_URL.value().replace(/\/$/,'');
  const api=EASYSTORE_API_BASE_PATH.value().replace(/^\/?/,'/').replace(/\/$/,'');
  const all=[], seen=new Set();
  for(let page=1;page<=250;page++){
    const url=`${store}${api}/products.json?page=${page}&limit=100`;
    const payload=await apiRequest(url,token);
    const rows=extractProducts(payload);
    if(!rows.length) break;
    let fresh=0;
    for(const p of rows){ const id=clean(p.id||p.product_id||p._id||JSON.stringify(p).slice(0,120)); if(seen.has(id)) continue; seen.add(id); all.push(p); fresh++; }
    if(!fresh||rows.length<100) break;
    await new Promise(r=>setTimeout(r,150));
  }
  return all;
}
function buildVariants(products){
  const variants=[], duplicateSkus=new Set(), seenSku=new Set();
  for(const product of products){
    const productId=clean(product.id||product.product_id||product._id);
    const productName=clean(product.title||product.name||product.product_title);
    const productUrl=safeUrl(product.url||product.product_url||product.permalink||product.handle_url||'');
    const parentImages=collectImages(product);
    let rows=Array.isArray(product.variants)?product.variants:[];
    if(!rows.length&&(product.sku||product.code)) rows=[product];
    for(const v of rows){
      const sku=normalizeSku(v.sku||v.code||product.sku||product.code); if(!sku) continue;
      if(seenSku.has(sku)) duplicateSkus.add(sku); else seenSku.add(sku);
      const variantImages=collectImages(v); const images=[]; [...variantImages,...parentImages].forEach(u=>{if(u&&!images.includes(u))images.push(u);});
      const variantName=clean(v.title||v.name||v.option_name||v.variant_title||'');
      const price=numberOrNull(v.price??v.sale_price??product.price??product.sale_price);
      variants.push({sku,productId,variantId:clean(v.id||v.variant_id||v._id),productName,variantName,price,productUrl,imageUrls:images.slice(0,6)});
    }
  }
  return {variants,duplicateSkus:[...duplicateSkus]};
}
async function commitInChunks(db, updates){
  let writes=0;
  for(let i=0;i<updates.length;i+=400){
    const batch=db.batch();
    updates.slice(i,i+400).forEach(u=>batch.set(u.ref,u.data,{merge:true}));
    await batch.commit(); writes+=Math.min(400,updates.length-i);
  }
  return writes;
}

function registerEasyStoreCatalogSync(exportsObj){
  exportsObj.syncEasyStoreCatalog = onCall({region:'us-central1',timeoutSeconds:540,memory:'1GiB',secrets:[EASYSTORE_ACCESS_TOKEN,OPERATIONS_SYNC_KEY]}, async request=>{
    const supplied=clean(request.data&&request.data.syncKey);
    if(!supplied||supplied!==clean(OPERATIONS_SYNC_KEY.value())) throw new HttpsError('permission-denied','同步密碼不正確。');
    const token=clean(EASYSTORE_ACCESS_TOKEN.value());
    if(!token) throw new HttpsError('failed-precondition','尚未設定 EASYSTORE_ACCESS_TOKEN。');
    if(!admin.apps.length) admin.initializeApp();
    const db=admin.firestore(); const startedAt=admin.firestore.Timestamp.now();
    try{
      const products=await fetchAllProducts(token);
      const built=buildVariants(products);
      const apiBySku=new Map();
      for(const row of built.variants){ if(!apiBySku.has(row.sku)) apiBySku.set(row.sku,row); }
      const snap=await db.collection('opsInternalProducts').get();
      const updates=[]; let matchedCount=0,imageMatchedCount=0;
      for(const doc of snap.docs){
        const data=doc.data()||{}; const sku=normalizeSku(data.internalSku||data.sku||data.code||data.productCode);
        if(!sku) continue;
        const row=apiBySku.get(sku); if(!row) continue;
        matchedCount++; if(row.imageUrls.length) imageMatchedCount++;
        updates.push({ref:doc.ref,data:{
          easyStoreMatched:true,sourceCollection:'easyStoreApi',sourceProductId:row.productId,sourceVariantId:row.variantId,
          onlineName:row.productName,variantName:row.variantName,onlinePrice:row.price,onlineUrl:row.productUrl,
          imageUrl:row.imageUrls[0]||'',imageUrls:row.imageUrls,easyStoreSyncedAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp()
        }});
      }
      const written=await commitInChunks(db,updates);
      const completedAt=admin.firestore.Timestamp.now();
      const stats={ok:true,productCount:products.length,variantCount:built.variants.length,centralCount:snap.size,matchedCount,imageMatchedCount,unmatchedCentralCount:Math.max(0,snap.size-matchedCount),duplicateApiSkuCount:built.duplicateSkus.length,unmatchedApiSkuCount:Math.max(0,apiBySku.size-matchedCount),written,startedAt,completedAt,updatedAt:completedAt,source:'EasyStore API'};
      await db.collection('opsSettings').doc('easyStoreCatalogSync').set(stats,{merge:true});
      await db.collection('opsSyncLogs').add({...stats,type:'easyStoreCatalog',createdAt:completedAt});
      return {...stats,startedAt:startedAt.toDate().toISOString(),completedAt:completedAt.toDate().toISOString()};
    }catch(error){
      console.error('syncEasyStoreCatalog failed',error);
      await db.collection('opsSyncLogs').add({type:'easyStoreCatalog',ok:false,error:clean(error&&error.message||error),createdAt:admin.firestore.FieldValue.serverTimestamp()}).catch(()=>{});
      throw new HttpsError('internal',clean(error&&error.message||error)||'EasyStore 同步失敗');
    }
  });
}
module.exports={registerEasyStoreCatalogSync};
