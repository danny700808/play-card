'use strict';
const clean=v=>String(v==null?'':v).trim();
const urls=v=>(Array.isArray(v)?v:[]).map(clean).filter(Boolean);
function detailImageMap(documents){
  const map=new Map();
  function put(id,url,stamp){id=clean(id);url=clean(url);if(id&&url&&(!map.has(id)||map.get(id).stamp<stamp))map.set(id,{url,stamp});}
  for(const doc of documents){const row=doc.data(),stamp=row.updatedAt?.toMillis?row.updatedAt.toMillis():new Date(row.updatedAt||0).getTime()||0;
    const id=clean(row.productId||doc.id);
    if(row.variantGroupEnabled)put(id,row.variantGroupPrimaryImageUrl,stamp);
    if(row.listingIntent==='add-variant'||row.listingMode==='add-variant')put(id,row.variantChildImageUrl,stamp);
    let items=row.variantGroupItems;if(typeof items==='string'){try{items=JSON.parse(items);}catch{items=[];}}
    for(const item of Array.isArray(items)?items:[])put(item.productId,urls(item.imageUrls)[0],stamp);
  }
  return map;
}
function thumbnail(row,id,details){
  const group=urls(row.parentImageUrls)[0]||clean(row.imageUrl)||urls(row.imageUrls)[0]||'';
  // A saved small variant card belongs to this exact product id, never its sibling.
  const detail=details.get(id)?.url||urls(row.variantImageUrls)[0]||clean(row.variantImageUrl)||'';
  return {detailThumbnailUrl:detail,groupThumbnailUrl:group};
}
module.exports={detailImageMap,thumbnail};
