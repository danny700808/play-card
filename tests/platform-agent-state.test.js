const test=require('node:test'),assert=require('node:assert/strict');
const {validateAgentStateOperation:v}=require('../functions/platformOrderSync')._test;
test('agent state is restricted to existing sync operations',()=>{
 assert.equal(v({operation:'query',collection:'opsPlatformSyncRequests',field:'status',value:'pending',limit:10000}).limit,500);
 assert.equal(v({operation:'get',path:'opsInternalProducts/p'}).path,'opsInternalProducts/p');
 assert.equal(v({operation:'patch',path:'opsSettings/platformLocalAgent',fields:{status:'idle'}}).op,'patch');
 for(const x of [{operation:'get',path:'employees/a'},{operation:'patch',path:'opsInternalProducts/p',fields:{currentStock:999}},{operation:'patch',path:'opsSettings/other',fields:{status:'idle'}},{operation:'patch',path:'opsPlatformSyncRequests/a',fields:{productIds:['p']}},{operation:'query',collection:'opsPlatformOrders',field:'status',value:'pending'}]) assert.throws(()=>v(x));
});
