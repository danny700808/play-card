'use strict';
// Read-only production audit. No names, contact details, document IDs or money values are logged.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const filename = path.resolve('functions/coursePortal.js');
const backend = new Module(filename, module);
backend.filename = filename;
backend.paths = Module._nodeModulePaths(path.dirname(filename));
const exportsForAudit = `
// Diagnostic simulation must never persist period-number assignments.
assignNewSystemPeriodNumbers = async function(periods) {
  const ids = [...new Set(periods.map(row => clean(row.studentId)).filter(Boolean))];
  const snapshots = await Promise.all(ids.map(id => db.collection(TUITION_SYSTEM_PERIODS).where('studentId','==',id).get()));
  const numbers = new Map(snapshots.flatMap(s => s.docs).map(doc => {const row=doc.data();return [clean(row.periodId || doc.id),Number(row.systemPeriodNo || 0)];}));
  return periods.map(row => ({...row,systemPeriodNo:numbers.get(sourceId(row)) || Number(row.systemPeriodNo || 0)}));
};
module.exports.audit = {db,scheduleBundle,attendancePeriodsForEvent,assertAttendanceRolloverPeriod,assertAttendanceRolloverPaymentRequest,attendancePeriodFinancialFingerprint,tuitionPeriodAvailable,TUITION_PERIODS,withPortalReads};
`;
backend._compile(fs.readFileSync(filename,'utf8') + exportsForAudit,filename);
const a = backend.exports.audit;
function differingPaths(left,right,prefix='') {
  const out=[];
  for(const key of new Set([...Object.keys(left||{}),...Object.keys(right||{})])) {
    const p=prefix?prefix+'.'+key:key,l=left?.[key],r=right?.[key];
    if(l && r && typeof l==='object' && typeof r==='object')out.push(...differingPaths(l,r,p));
    else if(JSON.stringify(l)!==JSON.stringify(r))out.push(p);
  }
  return out;
}
async function main() {
  const {GoogleAuth}=require('../../functions/node_modules/google-auth-library');
  const client=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
  for(const name of ['coursePortalAdminSetAttendanceTaiwan','coursePortalTeacherAttendanceTaiwan','loadInjiaoyunEducationMirrorAutoTaiwan']) {
    const {data}=await client.request({url:'https://cloudfunctions.googleapis.com/v2/projects/youzi-c1b74/locations/asia-east1/functions/'+name});
    console.log(JSON.stringify({service:name,state:data.state,updatedAt:data.updateTime}));
  }
  for(const date of ['2026-09-22','2026-09-25']) {
    const board=await a.withPortalReads(()=>a.scheduleBundle(date,date,''))();
    const events=board.resourceEvents.filter(e=>e.studentIds.length && (date==='2026-09-22'?['17:00','18:00'].includes(e.startTime):e.startTime==='14:00'));
    for(const [index,event] of events.entries()) {
      const label={date,start:event.startTime,end:event.endTime,index,managerCreated:event.id.startsWith('manager-'),status:event.status};
      try {
        const detail=await a.withPortalReads(()=>a.attendancePeriodsForEvent(event,date,{allowRollover:true}))();
        const report={...label,selectedPeriods:detail.rows.length,rollovers:detail.rollovers.length,conflicts:[]};
        for(const rollover of detail.rollovers) {
          const snapshot=await a.db.collection(a.TUITION_PERIODS).doc(rollover.period.id).get();
          if(!snapshot.exists)continue;
          const existing=snapshot.data();
          let conflict=false;
          try {a.assertAttendanceRolloverPeriod(existing,rollover.period);}catch {conflict=true;}
          report.conflicts.push({conflict,nextPeriodNo:rollover.period.periodNo,existingPeriodNo:existing.periodNo,active:existing.active,status:existing.status,available:a.tuitionPeriodAvailable(existing),sameFinance:a.attendancePeriodFinancialFingerprint(rollover.studentId,existing)===a.attendancePeriodFinancialFingerprint(rollover.studentId,rollover.period),differingFields:differingPaths(existing,rollover.period).filter(p=>!['createdAt','updatedAt'].some(k=>p.startsWith(k)))});
        }
        console.log(JSON.stringify(report));
      } catch(error) {console.log(JSON.stringify({...label,errorCode:error.code||'unknown',errorType:error.constructor.name}));}
    }
  }
}
main().catch(error=>{console.error('Attendance audit failed:',error.code||error.constructor.name);process.exitCode=1;});
