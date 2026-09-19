'use strict';
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const names=['coursePortalCompleteLineRegistration','coursePortalRenterContactLogin','coursePortalRentalMyBookings','coursePortalAdminSaveLeaveReason','coursePortalAdminSaveTeacherSubjects','coursePortalAdminSaveFeePlan','emailSendCheckHttp'];
async function main(){
  const {GoogleAuth}=require('../../functions/node_modules/google-auth-library');
  const client=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  for(const name of names){
    console.log('Sequential recovery:',name);
    // Preserve the existing two-region declarations. The CLI skips unchanged
    // US revisions; never remove them by narrowing the application exports.
    const result=spawnSync('firebase',['deploy','--project','youzi-c1b74','--non-interactive','--only','functions:'+name],{encoding:'utf8',maxBuffer:16*1024*1024,env:process.env});
    const log=String(result.stdout||'')+'\n'+String(result.stderr||'');
    // Do not print credentials or request bodies. Only deployment summaries.
    const lines=log.replace(/\x1b\[[0-9;]*m/g,'').split('\n');
    for(const line of lines.filter(l=>/functions\[|CPU|quota|Error:/.test(l)))console.log(line);
    assert.equal(result.status,0,'Isolated deployment failed for '+name);
    assert(lines.some(l=>l.includes('functions['+name+'(asia-east1)')&&/Successful (update|create) operation|Skipped/.test(l)),'Taiwan deployment completion not confirmed for '+name);
    const {data}=await client.request({url:`https://cloudfunctions.googleapis.com/v2/projects/youzi-c1b74/locations/asia-east1/functions/${name}`});
    assert.equal(data.state,'ACTIVE',name+' is not ACTIVE');
    // Empty unauthenticated requests cannot create registrations, bookings,
    // course settings or send mail. They must reach application validation.
    const response=await fetch(`https://asia-east1-youzi-c1b74.cloudfunctions.net/${name}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:{}}),signal:AbortSignal.timeout(60000)});
    const body=await response.text();
    assert([400,401,403].includes(response.status),name+' expected validation/auth rejection, got '+response.status);
    assert(/error|invalid|unauthenticated|permission|登入|驗證|權限|缺少/i.test(body),name+' did not return an application validation response');
    console.log(JSON.stringify({name,region:'asia-east1',state:data.state,updated:data.updateTime,status:response.status,unauthenticatedRequestRejected:true}));
    await new Promise(resolve=>setTimeout(resolve,15000));
  }
  console.log('All seven Taiwan functions recovered; no webhook, provider setting, storage cutover or business write was performed.');
}
main().catch(error=>{console.error('Seven-function recovery failed:',error.code||error.message);process.exitCode=1;});
