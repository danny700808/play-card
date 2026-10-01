import fs from 'node:fs/promises';import vm from 'node:vm';import assert from 'node:assert/strict';
const html=await fs.readFile(new URL('../parttime.html',import.meta.url),'utf8'),backend=await fs.readFile(new URL('../firebase-client.js',import.meta.url),'utf8');
const picker=html.slice(html.indexOf('    function nextHoursSelection('),html.indexOf('    function daysBetweenInclusive('));
const buttons=Array.from({length:12},(_,i)=>String(i+1)).concat('0.5').map(hour=>({dataset:{hour},classList:{toggle(k,v){this[k]=v;}},setAttribute(k,v){this[k]=v;}}));
const nodes={'#hoursGrid':{querySelectorAll:()=>buttons},'#hoursSelect':{value:''},'#halfHour':{checked:false},'#parttimeSelectedTotal':{textContent:''}};
const ctx={qs:k=>nodes[k],formatHoursLabel:n=>n+' 小時',clearValidation:()=>{}};vm.createContext(ctx);vm.runInContext(picker,ctx);ctx.renderHoursGrid();const click=v=>buttons.find(b=>b.dataset.hour===v).onclick();
click('0.5');click('2');assert.equal(nodes['#hoursSelect'].value,'2.5');assert.equal(buttons.find(b=>b.dataset.hour==='0.5')['aria-pressed'],'true');click('3');assert.equal(nodes['#hoursSelect'].value,'3.5');click('0.5');assert.equal(nodes['#hoursSelect'].value,'3');click('0.5');assert.equal(nodes['#hoursSelect'].value,'3.5');click('12');assert.equal(nodes['#hoursSelect'].value,'12');assert.equal(buttons.find(b=>b.dataset.hour==='0.5').disabled,true);
nodes['#hoursSelect'].value='';ctx.updateHoursGrid();click('0.5');assert.equal(nodes['#hoursSelect'].value,'0.5');click('0.5');assert.equal(nodes['#hoursSelect'].value,'');
for(let h=.5;h<=12;h+=.5)assert.ok(html.includes('<option value="'+h+'">'));
const flow=backend.slice(backend.indexOf('  async function submitParttimeFlow('),backend.indexOf('  function timeOverlap(',backend.indexOf('  async function submitParttimeFlow(')));
let writes=[];const bc={currentUser:()=>({name:'Test'}),employeeIdFrom:()=> 'test',dateText:x=>x,truthy:v=>v===true,parttimeContext:async()=>({context:{canRegister:true,scheduledHours:8}}),employeeRow:async()=>({}),hourlyRateOf:()=>200,safeId:x=>x,clean:x=>x||'',lower:x=>x||'',VERSION:'test',serverTs:()=>0,setDoc:async(...args)=>writes.push(args)};vm.createContext(bc);vm.runInContext(flow,bc);
for(const hours of [.5,2.5,3.5]){const result=await bc.submitParttimeFlow({hours:String(hours),halfHour:false,workDate:'2026-10-01'});assert.equal(result.ok,true);const row=writes.at(-1)[2];assert.equal(row.totalHours,hours);assert.equal(row.hours,hours);assert.equal(row.grossPay,hours*200);}
assert.equal(writes.reduce((sum,x)=>sum+x[2].totalHours,0),6.5);assert.equal(writes.reduce((sum,x)=>sum+x[2].grossPay,0),1300);
const before=writes.length;assert.equal((await bc.submitParttimeFlow({hours:'8.5',halfHour:false,workDate:'2026-10-01'})).blockedBySchedule,true);assert.equal(writes.length,before);
assert.ok(html.includes("hours: qs('#hoursSelect').value,\n        halfHour: false")||html.includes("hours: qs('#hoursSelect').value,\r\n        halfHour: false"));
console.log('PASS: 0.5→2=2.5; 3+0.5=3.5; cancel half; reset; 12-hour limit; 24 valid choices; decimal persistence; wages 100/500/700; totals 6.5h/1300; schedule guard; no double half-hour');
