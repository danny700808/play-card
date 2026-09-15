'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../functions/coursePortal.js'),'utf8');
test('schedule date helpers reuse formatters while preserving Taipei calendar validation',()=>{
  let constructions=0;
  const c={clean:v=>String(v??'').trim(),TAIPEI:'Asia/Taipei',Intl:{DateTimeFormat:function(...args){constructions++;return new Intl.DateTimeFormat(...args);}}};
  vm.createContext(c);
  for(const name of ['dateKey','addDays']){const start=source.indexOf('function '+name+'(');vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),c);}
  assert.equal(c.dateKey('2024-02-29'),'2024-02-29');
  assert.equal(c.dateKey('2026-02-29'),'');
  assert.equal(c.dateKey('2026-04-31'),'');
  assert.equal(c.dateKey('2026-13-01'),'');
  assert.equal(c.dateKey('2026-9-15'),'');
  assert.equal(c.addDays('2024-02-28',1),'2024-02-29');
  assert.equal(c.addDays('2026-12-31',1),'2027-01-01');
  assert.equal(c.addDays('2026-03-01',-1),'2026-02-28');
  for(let i=0;i<10000;i++)assert.equal(c.dateKey(c.addDays('2026-09-15',7)),'2026-09-22');
  assert.equal(constructions,2,'large recurrence validation must not allocate formatters per date');
});
test('permanent move checks three calendar months without shortening the recurring contract',()=>{
  const c={clean:v=>String(v??'').trim(),TAIPEI:'Asia/Taipei',Intl};vm.createContext(c);
  for(const name of ['dateKey','addDays','addMonths']){const start=source.indexOf('function '+name+'(');vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),c);}
  const start=source.indexOf('    const validationWindowEnd =');
  const end=source.indexOf('    validatedThrough =',start);
  vm.runInContext('function horizon(date,recurrenceEndDate){'+source.slice(start,end)+'return {horizonEnd,recurrenceEndDate};}',c);
  assert.equal(c.horizon('2026-09-16','').horizonEnd,'2026-12-15');
  assert.equal(c.horizon('2026-09-16','2026-10-01').horizonEnd,'2026-10-01');
  assert.equal(c.horizon('2026-09-16','2028-10-01').horizonEnd,'2026-12-15');
  assert.equal(c.horizon('2026-09-16','2028-10-01').recurrenceEndDate,'2028-10-01');
  assert.equal(c.horizon('2026-11-30','').horizonEnd,'2027-02-27');
});
