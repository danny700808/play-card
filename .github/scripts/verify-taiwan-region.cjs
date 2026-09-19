'use strict';
const {GoogleAuth}=require('../../functions/node_modules/google-auth-library');
const PROJECT='youzi-c1b74';
async function main(){
  const client=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  const exported=require('../../functions/courseLoginIndexV3');
  const expected=Object.entries(exported).filter(([,fn])=>fn.__endpoint?.httpsTrigger||fn.__endpoint?.callableTrigger).map(([name])=>name);
  const deployed=[];
  let pageToken;
  do{
    const {data}=await client.request({url:`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/asia-east1/functions`,params:{pageSize:1000,...(pageToken?{pageToken}:{})}});
    deployed.push(...data.functions||[]);pageToken=data.nextPageToken;
  }while(pageToken);
  const active=new Set(deployed.filter(row=>row.state==='ACTIVE').map(row=>row.name.split('/').pop()));
  const missing=expected.filter(name=>!active.has(name));
  console.log(JSON.stringify({region:'asia-east1',expectedHttpFunctions:expected.length,activeFunctions:active.size,missing}));
  if(missing.length)throw new Error('Taiwan HTTP deployment incomplete');
  // Read only sanitized operation timings; never log request data or raw log entries.
  try{
    const {data}=await client.request({method:'POST',url:'https://logging.googleapis.com/v2/entries:list',data:{resourceNames:[`projects/${PROJECT}`],filter:`resource.type="cloud_run_revision" AND jsonPayload.message="course-operation-timing" AND timestamp>="${new Date(Date.now()-86400000).toISOString()}"`,orderBy:'timestamp desc',pageSize:100}});
    const rows=(data.entries||[]).map(row=>({operation:row.jsonPayload?.operation,region:row.resource?.labels?.location,ms:row.jsonPayload?.totalMs,cold:row.jsonPayload?.firstRequestInInstance,outcome:row.jsonPayload?.outcome}));
    console.log('Recent course latency (milliseconds, server processing only)',JSON.stringify(rows));
  }catch(error){console.log('Timing log access unavailable',{status:error.response?.status||null});}
  for(const bucket of [`${PROJECT}.firebasestorage.app`,`${PROJECT}-taiwan`]){
    try{const {data}=await client.request({url:`https://storage.googleapis.com/storage/v1/b/${bucket}`,params:{fields:'name,location,iamConfiguration'}});console.log('Storage region',JSON.stringify({name:data.name,location:data.location,uniformAccess:data.iamConfiguration?.uniformBucketLevelAccess?.enabled}));}
    catch(error){console.log('Storage metadata unavailable',{bucket,status:error.response?.status||null});}
  }
}
main().catch(error=>{console.error('Regional verification failed',error.message);process.exitCode=1;});
