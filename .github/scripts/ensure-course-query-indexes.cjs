'use strict';
// Add only the indexes required by teacher-scoped monthly reads. Never delete
// an existing index or change database placement from the deployment workflow.
const {GoogleAuth} = require('../../functions/node_modules/google-auth-library');
const indexes = require('../../firestore.indexes.json').indexes.filter(index =>
  index.fields.some(field => /^(source\.)?teacherId$/.test(field.fieldPath)) &&
  index.fields.some(field => /^(source\.)?date$/.test(field.fieldPath))
);
const signature = index => JSON.stringify({queryScope:index.queryScope,fields:index.fields.map(({fieldPath,order})=>({fieldPath,order}))});
async function main() {
  const client = await new GoogleAuth({scopes:['https://www.googleapis.com/auth/datastore']}).getClient();
  const groups = [...new Set(indexes.map(index=>index.collectionGroup))];
  const url = group => 'https://firestore.googleapis.com/v1/projects/youzi-c1b74/databases/(default)/collectionGroups/' + group + '/indexes';
  async function list(group) {
    let pageToken,rows=[];
    do {
      const {data}=await client.request({url:url(group),params:pageToken?{pageToken}:{}});
      rows.push(...(data.indexes||[]));pageToken=data.nextPageToken;
    } while(pageToken);
    return rows;
  }
  for(const group of groups) {
    const existing=await list(group);
    for(const index of indexes.filter(index=>index.collectionGroup===group)) {
      if(existing.some(row=>signature(row)===signature(index)))continue;
      try {await client.request({url:url(group),method:'POST',data:{queryScope:index.queryScope,fields:index.fields}});}
      catch(error){if(error.response?.status!==409)throw error;}
    }
  }
  const deadline=Date.now()+20*60*1000;
  while(Date.now()<deadline) {
    const rows=new Map(await Promise.all(groups.map(async group=>[group,await list(group)])));
    const matching=indexes.map(index=>rows.get(index.collectionGroup).find(row=>signature(row)===signature(index)));
    if(matching.some(index=>index?.state==='NEEDS_REPAIR'))throw Error('Course query index needs repair');
    if(matching.every(index=>index?.state==='READY')){console.log('Teacher monthly query indexes are READY.');return;}
    console.log('Waiting for teacher monthly query indexes.');
    await new Promise(resolve=>setTimeout(resolve,15000));
  }
  throw Error('Teacher monthly query indexes are not ready; deployment stopped.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
