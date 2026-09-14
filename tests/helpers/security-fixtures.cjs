'use strict';
function database(initial={}){
  const rows=new Map(Object.entries(structuredClone(initial))),FieldValue={serverTimestamp:()=>new Date('2026-09-14T08:00:00Z')};let serial=Promise.resolve(),count=0;
  const snap=path=>{const value=structuredClone(rows.get(path));return {id:path.split('/').at(-1),ref:ref(path),exists:value!==undefined,data:()=>structuredClone(value)};};
  const ref=path=>({path,id:path.split('/').at(-1),get:async()=>snap(path),set:async(value,options)=>rows.set(path,{...(options&&options.merge?rows.get(path):{}),...structuredClone(value)})});
  const Filter={where:(field,op,value)=>({field,op,value}),or:(...filters)=>({filters})};
  const matches=(value,filter)=>filter.filters?filter.filters.some(f=>matches(value,f)):value[filter.field]===filter.value;
  const query=(name,filters=[],cap=Infinity)=>({doc:id=>ref(name+'/'+(id||'generated-'+(++count))),where:(field,op,value)=>query(name,filters.concat(typeof field==='string'?{field,op,value}:field),cap),limit:n=>query(name,filters,n),get:async()=>{const docs=[...rows.keys()].filter(path=>path.split('/')[0]===name&&filters.every(filter=>matches(rows.get(path),filter))).slice(0,cap).map(snap);return {docs,empty:!docs.length};}});
  function writer(){const writes=[];return {get:async r=>snap(r.path),set:(r,value,options)=>writes.push(()=>rows.set(r.path,{...(options&&options.merge?rows.get(r.path):{}),...structuredClone(value)})),update:(r,value)=>writes.push(()=>rows.set(r.path,{...rows.get(r.path),...structuredClone(value)})),create:(r,value)=>{if(rows.has(r.path))throw Error('already exists');writes.push(()=>rows.set(r.path,structuredClone(value)));},delete:r=>writes.push(()=>rows.delete(r.path)),commit:async()=>writes.forEach(fn=>fn())};}
  const db={rows,collection:query,batch:writer,runTransaction(fn){const task=serial.then(async()=>{const tx=writer(),result=await fn(tx);await tx.commit();return result;});serial=task.catch(()=>{});return task;}};
  return {db,rows,FieldValue,Filter};
}
module.exports={database};
