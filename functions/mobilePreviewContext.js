'use strict';
const {AsyncLocalStorage}=require('node:async_hooks');
const context=new AsyncLocalStorage();
function current(){return context.getStore();}
function run(session,fn){return context.run(Object.freeze({...session}),fn);}
const writes=new Set(['set','update','create','delete','add','commit','runTransaction','bulkWriter','recursiveDelete']);
// Wrap references, queries and snapshots only inside a preview request.
function guard(value){
 if(!value||typeof value!=='object')return value;
 if(Array.isArray(value))return value.map(guard);
 if(value instanceof Date||value.constructor?.name==='Timestamp')return value;
 return new Proxy(value,{get(target,key){
  const member=Reflect.get(target,key,target);
  if(typeof member!=='function')return current()?guard(member):member;
  return (...args)=>{
   if(current()&&writes.has(key))throw Error('唯讀檢視不允許寫入。');
   const result=member.apply(target,args);if(!current())return result;
   // Data values are inert and do not need proxying.
   if(key==='data'||key==='toDate')return result;
   return result&&typeof result.then==='function'?result.then(guard):guard(result);
  };
 }});
}
module.exports={current,run,guard};
