'use strict';
const rules=require('./parttimePayrollRules');
const clean=v=>String(v??'').trim();
const pick=(r,keys)=>keys.map(k=>r?.[k]).find(v=>v!==undefined&&v!==null&&clean(v)!=='');
const amount=v=>{if(v===undefined||v===null||clean(v)==='')return null;const n=Number(clean(v).replace(/[,元$\s]/g,''));return Number.isFinite(n)?n:null;};
const num=(r,keys)=>amount(pick(r,keys));
const date=r=>clean(pick(r,['date','workDate','clockDate','日期','打卡日期'])).slice(0,10);
const enabled=v=>['是','true','1','在保','已投保','投保','加保','有效'].includes(clean(v));
async function owned(db,collection,id){
 const results=await Promise.all(['employeeId','員工ID'].map(field=>db.collection(collection).where(field,'==',id).get()));
 return [...new Map(results.flatMap(s=>s.docs).map(d=>[d.id,{...d.data(),__id:d.id}])).values()];
}
function configForMonth(rows,current,month){
 const end=month+'-31';const candidates=rows.concat(current?[current]:[]).filter(r=>/^\d{4}-\d{2}-\d{2}/.test(clean(r.effectiveDate))&&clean(r.effectiveDate)<=end);
 return candidates.sort((a,b)=>clean(b.effectiveDate).localeCompare(clean(a.effectiveDate))||clean(b.historyId||b.__id||b.updatedAt).localeCompare(clean(a.historyId||a.__id||a.updatedAt)))[0]||null;
}
function insuranceOf(config){
 if(!config)return {labor:null,health:null,retirement:null,employerRetirement:null};
 const contribution=(status,keys)=>{const v=num(config,keys);return v!==null?v:(status&&!enabled(status)?0:null);};
 const labor=contribution(pick(config,['laborStatus','勞保狀態']),['laborSelfPay','laborEmployeeSelfPay','laborInsuranceSelfPay','laborSelfPayText','勞保自付額']);
 const health=contribution(pick(config,['healthStatus','健保狀態']),['healthSelfPay','healthEmployeeSelfPay','healthInsuranceSelfPay','healthSelfPayText','健保自付額']);
 const retirementEnabled=enabled(pick(config,['selfRetirementEnabled','laborRetirementSelfEnabled','勞退自提']));
 const base=num(config,['laborRetirementSalary','retirementSalary','laborPensionSalary','勞退月提繳工資','averageSalary','baseSalary']);
 const rate=num(config,['selfRetirementRate','laborRetirementSelfRate']);
 const retirement=retirementEnabled?(num(config,['selfRetirementAmount','laborRetirementSelfAmount'])??(base!==null&&rate!==null?Math.round(base*rate/100):null)):0;
 return {labor,health,retirement,employerRetirement:num(config,['laborRetirementEmployerAmount','laborEmployerRetirement','retirementEmployerAmount','employerRetirementAmount','雇主提繳金額']),laborStatus:clean(config.laborStatus),healthStatus:clean(config.healthStatus)};
}
async function monthData(db,account,user,month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('請選擇月份。');
 const id=user.employeeId;const [parts,clocks,corrections,history,configDoc]=await Promise.all([
  owned(db,'parttimeRecords',id),owned(db,'clockRecords',id),owned(db,'clockCorrections',id),owned(db,'employeeSalaryConfigHistory',id),db.collection('employeeSalaryConfigs').doc(id).get()
 ]);
 const current={...account.data,...(configDoc.exists?configDoc.data():{})};
 const config=configForMonth(history,current,month);
 const effective=rules.latestEffectiveParttimeRecords(parts.map(r=>({...r,id:r.recordId||r.__id,date:date(r),employeeId:id,status:clean(r.status||r['狀態']),totalHours:num(r,['totalHours','hours','總時數','時數'])||0,grossPay:num(r,['grossPay','當日工資','當筆毛額']),hourlyRate:num(r,['hourlyRate','時薪'])}))).filter(r=>r.date.startsWith(month));
 const normalizedClocks=clocks.map(r=>({...r,id:r.recordId||r.__id,date:date(r),employeeId:id,time:clean(r.clockTime||r.time||r['打卡時間']),actionName:clean(r.actionName||r['打卡動作']),lateMinutes:num(r,['finalLateMinutes','lateMinutes','遲到分鐘'])||0,status:clean(r.status||r['狀態'])}));
 const rate=num(config,['hourlyRate','parttimeHourlyRate','時薪'])??effective.find(r=>r.hourlyRate!==null)?.hourlyRate??null;
 const employee={id,employeeId:id,hourlyRate:rate};
 const late=rules.calculateLate({clockRows:normalizedClocks,corrections:corrections.map(r=>({...r,employeeId:id,status:r.status||r['狀態']})),employee,employees:[employee],month,hourlyRate:rate||0});
 const insurance=insuranceOf(config);
 // A recorded monthly snapshot is preferable when no historical configuration exists.
 if(insurance.labor===null){const snapshot=effective.map(r=>num(r,['laborSelfPaySnapshot','勞保自付額快照'])).find(v=>v!==null);if(snapshot!==undefined)insurance.labor=snapshot;}
 const rows=effective.map(r=>({date:r.date,hours:r.totalHours,grossPay:r.grossPay??(r.hourlyRate!==null?Math.round(r.totalHours*r.hourlyRate*(r.payMultiplier===2||r.doublePay===true?2:1)):null)})).sort((a,b)=>b.date.localeCompare(a.date));
 const baseSalary=num(config,['staffBaseSalary','baseSalary','monthlySalary','本薪']);
 const hasData=user.identityType==='parttime'?rows.length>0:!!config&&baseSalary!==null;
 const gross=hasData?(user.identityType==='parttime'?(rows.some(r=>r.grossPay===null)?null:rows.reduce((s,r)=>s+r.grossPay,0)):baseSalary):null;
 const deductions=[insurance.labor,insurance.health,insurance.retirement,late.lateMinutes>0&&rate===null?null:late.lateDeduction];
 const deduction=deductions.some(v=>v===null)?null:deductions.reduce((s,v)=>s+v,0);
 return {ok:true,month,hasData,rate: user.identityType==='parttime'?rate:baseSalary,gross,deduction,net:gross!==null&&deduction!==null?Math.max(0,gross-deduction):null,insurance,lateDeduction:deductions[3],hours:rows.reduce((s,r)=>s+r.hours,0),rows,configKnown:!!config};
}
module.exports={monthData,configForMonth,insuranceOf};
