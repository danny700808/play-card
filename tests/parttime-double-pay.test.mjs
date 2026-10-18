import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../parttime.html',import.meta.url),'utf8');
const backend=fs.readFileSync(new URL('../firebase-client.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../data-center.html',import.meta.url),'utf8');
for(const page of [html,admin])for(const m of page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(m[1].trim())new vm.Script(m[1]);
const buttons=Array.from({length:12},(_,i)=>String(i+1)).concat('0.5').map(hour=>({dataset:{hour},classList:{toggle(){}},setAttribute(){}}));
const doubleBtn={attrs:{'aria-pressed':'false'},classList:{toggle(k,v){this[k]=v;}},getAttribute(k){return this.attrs[k]},setAttribute(k,v){this.attrs[k]=v}};
const nodes={'#hoursGrid':{querySelectorAll:()=>buttons},'#hoursSelect':{value:''},'#halfHour':{},'#doublePayBtn':doubleBtn};
const ui={qs:k=>nodes[k],clearValidation(){},formatHoursLabel:n=>n+' 小時'};
vm.createContext(ui);vm.runInContext(html.slice(html.indexOf('    function nextHoursSelection('),html.indexOf('    function daysBetweenInclusive(')),ui);
ui.renderHoursGrid();doubleBtn.onclick();assert.equal(doubleBtn.attrs['aria-pressed'],'true');assert.equal(doubleBtn.textContent,'☑ 雙倍計薪');
buttons.find(b=>b.dataset.hour==='4').onclick();buttons.find(b=>b.dataset.hour==='0.5').onclick();assert.equal(nodes['#hoursSelect'].value,'4.5');assert.equal(doubleBtn.attrs['aria-pressed'],'true');
doubleBtn.onclick();assert.equal(doubleBtn.attrs['aria-pressed'],'false');assert.equal(doubleBtn.textContent,'☐ 雙倍計薪');
let writes=[];
const bc={currentUser:()=>({name:'Test'}),employeeIdFrom:()=> 'test',dateText:x=>x,truthy:v=>v===true,parttimeContext:async()=>({context:{canRegister:true,scheduledHours:8}}),employeeRow:async()=>({}),hourlyRateOf:()=>200,safeId:x=>x,clean:x=>x||'',lower:x=>x||'',VERSION:'test',serverTs:()=>0,setDoc:async(...args)=>writes.push(args)};
vm.createContext(bc);const start=backend.indexOf('  async function submitParttimeFlow(');vm.runInContext(backend.slice(start,backend.indexOf('  function timeOverlap(',start)),bc);
for(const doublePay of [true,false,undefined]){
 const result=await bc.submitParttimeFlow({hours:'4.5',doublePay,workDate:'2026-10-18'});assert.equal(result.ok,true);
 const row=writes.at(-1)[2];assert.equal(row.totalHours,4.5);assert.equal(row.hours,4.5);assert.equal(row.payMultiplier,doublePay?2:1);assert.equal(row.doublePay,!!doublePay);assert.equal(row.grossPay,doublePay?1800:900);
}
const count=writes.length;assert.equal((await bc.submitParttimeFlow({hours:'8.5',doublePay:true,workDate:'2026-10-18'})).blockedBySchedule,true);assert.equal(writes.length,count);
bc.parttimeContext=async()=>({context:{canRegister:false}});assert.equal((await bc.submitParttimeFlow({hours:'4',doublePay:true,workDate:'2026-10-18'})).ok,false);assert.equal(writes.length,count);
const history={num:Number,clean:x=>x||'',dateText:x=>x};vm.createContext(history);
const hs=backend.indexOf('  function normParttime(o)');vm.runInContext(backend.slice(hs,backend.indexOf('  async function parttimeRows(',hs)),history);
const gs=backend.indexOf('  function groupParttime(rows)');vm.runInContext(backend.slice(gs,backend.indexOf('  async function getParttimeHistory(payload)',gs)),history);
const rows=[{date:'2026-10-18',totalHours:4.5,grossPay:1800,payMultiplier:2},{date:'2026-10-18',totalHours:1,grossPay:200}].map(history.normParttime);
const grouped=history.groupParttime(rows)[0];assert.equal(grouped.totalHours,5.5);assert.equal(grouped.doublePayHours,4.5);assert.equal(grouped.grossPay,2000);
// Exercise the real manager adjustment flow; payroll must keep the multiplier on edits.
const row={__id:'record',hours:4.5,totalHours:4.5,hourlyRate:200,payMultiplier:2};let answers=[],patch;
const ac={state:{parttime:[row]},prompt:()=>answers.shift(),clean:x=>String(x??'').trim(),safeNum:x=>Number(x)||0,currentManager:()=>({id:'admin',name:'Admin'}),nowIso:()=> 'now',hours:x=>String(x),money:x=>String(x),msg(){},reloadAll:async()=>{},mergeWithAudit:async(c,id,data)=>{patch=data;}};
vm.createContext(ac);const as=admin.indexOf('    async function modifyParttimeRecord(');vm.runInContext(admin.slice(as,admin.indexOf('    async function addParttimeRecord(',as)),ac);
answers=['1','3','test'];await ac.modifyParttimeRecord('record');assert.equal(patch.grossPay,1200);assert.equal(patch.totalHours,3);
answers=['2','250','test'];await ac.modifyParttimeRecord('record');assert.equal(patch.grossPay,2250);
answers=['3','1','test'];await ac.modifyParttimeRecord('record');assert.equal(patch.grossPay,900);assert.equal(patch.payMultiplier,1);assert.equal(patch.doublePay,false);
row.payMultiplier=1;answers=['3','2','test'];await ac.modifyParttimeRecord('record');assert.equal(patch.grossPay,1800);assert.equal(patch.payMultiplier,2);
console.log('PASS: toggle and half-hours; double/normal wages; schedule guards; mixed history; manager hours/rate/multiplier edits; inline script syntax');
