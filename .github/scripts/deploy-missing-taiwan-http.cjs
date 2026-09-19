'use strict';
function httpNames(exports){return Object.entries(exports).filter(([,fn])=>fn.__endpoint?.httpsTrigger||fn.__endpoint?.callableTrigger).map(([name])=>name);}
function missingNames(expected,functions){const active=new Set(functions.filter(row=>row.state==='ACTIVE').map(row=>row.name.split('/').pop()));return expected.filter(name=>!active.has(name));}
async function main(){
 const {GoogleAuth}=require('../../functions/node_modules/google-auth-library');
 const {spawnSync}=require('node:child_process');
 const client=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
 const expected=httpNames(require('../../functions/courseLoginIndexV3'));
 async function missing(){
  let pageToken,rows=[];
  do{const {data}=await client.request({url:'https://cloudfunctions.googleapis.com/v2/projects/youzi-c1b74/locations/asia-east1/functions',params:{pageSize:1000,...(pageToken?{pageToken}:{})}});rows.push(...data.functions||[]);pageToken=data.nextPageToken;}while(pageToken);
  return missingNames(expected,rows);
 }
 for(let attempt=0;attempt<3;attempt++){
  const names=await missing();console.log('Taiwan HTTP entries remaining',names.length);
  if(!names.length)return;
  for(let i=0;i<names.length;i+=25){
   const batch=names.slice(i,i+25);
   console.log('Deploying verified missing batch',JSON.stringify(batch));
   const result=spawnSync('firebase',['deploy','--project','youzi-c1b74','--non-interactive','--force','--only',batch.map(name=>'functions:'+name).join(',')],{stdio:'inherit',env:process.env});
   if(result.error)throw new Error('Unable to start Firebase deployment');
   // Firebase can exit early on a concurrent update, even with status 0.
   // Cloud Functions ACTIVE state, rather than exit code, decides completion.
   if(result.status!==0)console.log('Batch will be reconciled against actual deployed state');
  }
 }
 const names=await missing();if(names.length)throw new Error('Taiwan entries remain incomplete: '+names.join(','));
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={httpNames,missingNames};
