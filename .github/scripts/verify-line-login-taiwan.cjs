'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const project='youzi-c1b74';
const callback='https://asia-east1-'+project+'.cloudfunctions.net/coursePortalLineLoginCallback';
async function main(){
  for(const region of ['asia-east1','us-central1']){
    // Synthetic OAuth state only: no LINE authorization code, user identity or messages.
    const response=await fetch(`https://${region}-${project}.cloudfunctions.net/coursePortalStartLineLogin`,{
      method:'POST',headers:{'Content-Type':'application/json',Origin:'https://danny700808.github.io'},
      body:JSON.stringify({data:{type:'unified',challenge:crypto.randomBytes(32).toString('hex')}}),signal:AbortSignal.timeout(60000)
    });
    assert.equal(response.status,200,'Login starter must be reachable in '+region);
    const payload=await response.json(),authorization=new URL((payload.result||payload.data).authorizationUrl);
    assert.equal(authorization.origin,'https://access.line.me');
    assert.equal(authorization.searchParams.get('client_id'),'2010902226');
    assert.equal(authorization.searchParams.get('redirect_uri'),callback,'Runtime must issue Taiwan callback');
    const state=authorization.searchParams.get('state');assert(state);
    const cancel=new URL(callback);cancel.searchParams.set('state',state);cancel.searchParams.set('error','access_denied');
    const cancelled=await fetch(cancel,{redirect:'manual',signal:AbortSignal.timeout(60000)});
    assert.equal(cancelled.status,302,'Cancellation must return to the portal');
    const destination=new URL(cancelled.headers.get('location'));
    assert.equal(destination.origin,'https://danny700808.github.io');assert.equal(destination.pathname,'/play-card/login.html');assert(destination.searchParams.has('lineError'));
    console.log(region+': Taiwan callback configuration and cancellation verified; no LINE account used');
  }
}
main().catch(error=>{console.error('LINE regional smoke check failed:',error.message);process.exitCode=1;});
