const assert=require('node:assert/strict');
function fakeDb(initial={}){
 const records=new Map(Object.entries(initial));let tail=Promise.resolve();
 const snap=key=>{const value=records.get(key);return {id:key.split('/').pop(),exists:records.has(key),data:()=>value};};
 const db={records,collection(name){return query(name,[]);},runTransaction(fn){const job=tail.then(async()=>{const writes=[];const result=await fn({get:ref=>ref.get(),create(ref,v){writes.push(()=>{assert(!records.has(ref.key));records.set(ref.key,v);});},update(ref,v){writes.push(()=>records.set(ref.key,{...records.get(ref.key),...v}));}});writes.forEach(f=>f());return result;});tail=job.catch(()=>{});return job;}};
 function query(name,filters){return {where(k,op,v){return query(name,[...filters,[k,op,v]]);},async get(){const docs=[...records.keys()].filter(k=>k.startsWith(name+'/')).map(snap).filter(s=>filters.every(([k,op,v])=>op==='=='?s.data()[k]===v:op==='>='?s.data()[k]>=v:s.data()[k]<=v));return {docs,size:docs.length};},doc(id){const key=name+'/'+id;return {id,key,async get(){return snap(key);},async create(value){assert(!records.has(key));records.set(key,value);}};}};}
 return db;
}

module.exports={fakeDb};
