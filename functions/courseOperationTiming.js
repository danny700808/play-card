'use strict';
const {AsyncLocalStorage} = require('node:async_hooks');
const {performance} = require('node:perf_hooks');
const logger = require('firebase-functions/logger');

function createOperationTiming({now=()=>performance.now(),log=row=>logger.info('course-operation-timing',row)}={}) {
  const context=new AsyncLocalStorage();
  let first=true;
  async function stage(name,work) {
    const record=context.getStore(),started=now();
    try{return await work();}finally{if(record)record.stages.push({stage:name,ms:Math.round(now()-started)});}
  }
  function wrap(operation,region,handler) {
    return async(data,request)=>{
      // A callable may already wrap a timed business handler. Keep one request
      // record so inner stages remain attached to the same operation.
      if(context.getStore())return handler(data,request);
      const record={operation,region,firstRequestInInstance:first,stages:[]},started=now();first=false;
      return context.run(record,async()=>{
        try{const result=await handler(data,request);record.outcome='ok';return result;}
        catch(error){record.outcome='error';record.errorCode=['aborted','invalid-argument','not-found','permission-denied','unauthenticated','failed-precondition','already-exists','unavailable','deadline-exceeded'].includes(error&&error.code)?error.code:'internal';throw error;}
        finally{record.totalMs=Math.round(now()-started);try{log(record);}catch(_){}}
      });
    };
  }
  return {timeOperationStage:stage,withOperationTiming:wrap};
}
module.exports={...createOperationTiming(),createOperationTiming};
