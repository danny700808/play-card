'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('firebase-client.js','utf8'),start=source.lastIndexOf('  async function saveEmployeeSalaryConfig(payload){'),end=source.indexOf('  async function getEmployeeSalaryConfigHistory',start);
async function save(fail){
  const stored=new Map(),pending=[];
  const database={collection:name=>({doc:id=>({path:name+'/'+id})}),batch:()=>({set:(ref,data)=>pending.push([ref.path,data]),commit:async()=>{if(fail)throw Error('rejected');pending.forEach(([path,value])=>stored.set(path,value));}})};
  const ctx={db:()=>database,clean:v=>String(v||''),findEmployee:async()=>({__id:'employee-doc'}),configFromPayload:()=>({monthlySalary:32000}),fmtDate:v=>v,localDateKey:()=> '2026-09-14',safeId:v=>v,serverTs:()=>1};
  vm.runInNewContext(source.slice(start,end),ctx);
  if(fail)await assert.rejects(ctx.saveEmployeeSalaryConfig({employeeId:'e1'}),/rejected/);
  else assert.equal((await ctx.saveEmployeeSalaryConfig({employeeId:'e1'})).ok,true);
  return stored;
}
test('all four salary records commit together',async()=>assert.equal((await save(false)).size,4));
test('a rejected salary batch changes none of the four records',async()=>assert.equal((await save(true)).size,0));
