(function(root){
 'use strict';
 function create(options){
  const pending=new Set(),dirty=new Set();let version=0,reading=false,timer=null;
  function schedule(){if(timer||reading||pending.size||!dirty.size)return;timer=setTimeout(()=>{timer=null;flush();},80);}
  async function flush(){
   if(reading||pending.size||!dirty.size)return;
   reading=true;const epoch=version,dates=[...dirty].sort().slice(0,7);let failed=false;
   try{const snapshot=await options.read(dates);if(epoch!==version||pending.size)return;
    options.apply(snapshot);options.synced?.(Math.max(0,dirty.size-dates.length));dates.forEach(day=>dirty.delete(day));
   }catch(error){failed=true;options.error(error);}finally{reading=false;if(!failed)schedule();}
  }
  return {
   begin(key){if(pending.has(key))return false;pending.add(key);version++;return true;},
   finish(key){pending.delete(key);version++;schedule();},
   saved(dates){dates.filter(Boolean).forEach(day=>dirty.add(day));version++;schedule();},
   invalidate(){version++;},busy:key=>pending.has(key),hasPending:()=>pending.size>0,
   version:()=>version,retry:schedule,flush
  };
 }
 root.YouziTeacherOperations={create};
})(typeof window==='undefined'?globalThis:window);
