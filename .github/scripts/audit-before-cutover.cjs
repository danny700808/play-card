'use strict';
// Read-only September validation. Only anonymous relationship flags are logged.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const report=console.log.bind(console);console.log=console.info=console.warn=console.error=()=>{};
const filename=path.resolve('functions/coursePortal.js'),backend=new Module(filename,module);
backend.filename=filename;backend.paths=Module._nodeModulePaths(path.dirname(filename));
backend._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.audit={withPortalReads,mirrorRows,mirrorRowsByDateRange,portalRowsByDateRange,ATTENDANCE_PAYROLL,ATTENDANCE_RECORDS,ATTENDANCE_CANCELLATIONS,enrichTeacherPayrollRows,mergeTeacherPayrollRows,teacherPayrollStudentIds,eventDate,sourceId};',filename);
const a=backend.exports.audit;
const auditPublicKey="-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAka2YscTx+e7H0+yrNcFk\nTQsiCoHTucHg/0LC5h1LrgCz3YInh2oV3as7k8Ynnz/XDquOVcaKlYD2VXxDavcz\nn69kp3G7L0CvmfoJr6xPRyEj1H2Plmkv4NcOtISLzkxvONyVdXEil8M6St6cs2HO\n3jFmTpI72tqOhjsp+TyShqPfAI91xDX396X/7A/rUsMOVl92c9PErPJDs2rf7zDW\nlpYJ5g+Pv3hWeeFrXFxmrIWjdnatd5bYp0O6eItv5K+QMMw9zZexhGggsMFFZbUT\nJhSvM3vhUoE1+3PvBM48pGo3m2D5i9UxX19WSn4lmSoi9wprQ1mJMW1afYaywI4R\n/7PQNAaEYzfFugBSfUq0NiccQf8KRdiAbpiZP/226YSDSmvgLIK9YxrPFBon+5q0\n2rAOQqTaKTW11+yEot2sfqNQwezR1xYRDb4jxzp3eMta8aA5LZxv7vZTd5XuIbqP\nUrixuCUWqXX2i/DicJEUj0cTbaCCwq0Y60CiF1cfE7LVAgMBAAE=\n-----END PUBLIC KEY-----\n";
const privateReport=value=>{const c=require('crypto'),key=c.randomBytes(32),iv=c.randomBytes(12),cipher=c.createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);report('PRIVATE_AUDIT '+JSON.stringify({key:c.publicEncrypt({key:auditPublicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}));};
const students=r=>JSON.stringify(a.teacherPayrollStudentIds(r).sort());
const same=(x,y)=>a.eventDate(x)===a.eventDate(y)&&x.teacherId===y.teacherId&&students(x)===students(y);
async function main(){
 const start='2026-09-01',end='2026-09-30';
 const [mirror,attendance,native,cancels,records]=await Promise.all([a.mirrorRowsByDateRange('teacherPayroll',start,end),a.mirrorRowsByDateRange('attendance',start,end),a.portalRowsByDateRange(a.ATTENDANCE_PAYROLL,start,end),a.portalRowsByDateRange(a.ATTENDANCE_CANCELLATIONS,start,end),a.portalRowsByDateRange(a.ATTENDANCE_RECORDS,start,end)]);
 const baseline=a.enrichTeacherPayrollRows(mirror,attendance);
 const current=a.mergeTeacherPayrollRows(baseline,native,cancels.filter(r=>r.status==='approved').concat(native.filter(r=>r.active===false)));
 const nativeIds=new Set(native.map(a.sourceId)),baselineIds=new Set(baseline.map(a.sourceId));
 const groups=new Map();
 current.forEach(p=>a.teacherPayrollStudentIds(p).forEach(id=>{const key=a.eventDate(p)+'|'+id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p);}));
 let cases=0;
 for(const rows of groups.values())if(rows.length>1){cases++;report(JSON.stringify({kind:'sameStudentSameDay',case:cases,date:a.eventDate(rows[0]),rows:rows.length,teachers:new Set(rows.map(r=>r.teacherId)).size,origins:rows.map(r=>nativeIds.has(a.sourceId(r))?'native':'legacy'),sameSubject:new Set(rows.map(r=>r.subjectId||r.subject||'')).size===1}));}
 for(const r of current.filter(r=>a.eventDate(r)<'2026-09-15'&&nativeIds.has(a.sourceId(r))))report(JSON.stringify({kind:'preCutoverNative',date:a.eventDate(r),sameLegacyId:baselineIds.has(a.sourceId(r)),sameLegacyLesson:baseline.filter(b=>same(b,r)).length,hasActiveAttendance:records.some(n=>n.operationId===r.operationId&&n.active!==false&&n.status==='attended'),explicitManagerAdjustment:!!r.teacherPayAdjustmentReason,hasPayrollSnapshot:!!r.payrollCalculation?.version,source:r.source==='teacher-attendance'?'teacher-attendance':r.source==='teacher-late-attendance'?'teacher-late-attendance':'other'}));
 const teacherDirectory=await a.mirrorRows('teachers'); const safeRow=r=>({date:a.eventDate(r),student:r.studentName||'',teacher:(teacherDirectory.find(t=>a.sourceId(t)===r.teacherId)||{}).name||'',start:r.startTime||'',end:r.endTime||'',amount:r.teacherAmount,status:r.status,operationAttendance:records.filter(n=>n.operationId===r.operationId).map(n=>({status:n.status,active:n.active!==false,date:a.eventDate(n),start:n.startTime||'',end:n.endTime||''})),legacyAttendance:attendance.filter(n=>a.eventDate(n)===a.eventDate(r)&&students(n)===students(r)).map(n=>({status:n.status,active:n.active!==false})),otherActiveSameLesson:records.filter(n=>same(n,r)&&n.status==='attended'&&n.active!==false).length});
 privateReport({preCutover:current.filter(r=>a.eventDate(r)<'2026-09-15'&&nativeIds.has(a.sourceId(r))).map(safeRow),postMultiple:[...groups.values()].filter(rs=>rs.length>1&&a.eventDate(rs[0])>='2026-09-15').map(rs=>rs.map(safeRow))});
 const invalid=current.filter(r=>!Number.isFinite(Number(r.teacherAmount))||Number(r.teacherAmount)<0);
 const post=current.filter(r=>a.eventDate(r)>='2026-09-15');
 const unsigned=post.filter(r=>!records.some(n=>n.active!==false&&n.status==='attended'&&same(n,r))&&!attendance.some(n=>n.active!==false&&n.status==='attended'&&same(n,r)));
 const activeNative=records.filter(r=>a.eventDate(r)>='2026-09-15'&&r.active!==false&&r.status==='attended');
 const unpaid=activeNative.filter(r=>!current.some(p=>same(p,r)));
 report(JSON.stringify({kind:'monthValidation',payrollRows:current.length,invalidAmounts:invalid.length,postCutoverPayrollWithoutAttendance:unsigned.length,postCutoverAttendanceWithoutPayroll:unpaid.length,sameStudentDayGroups:cases}));
 for(const r of unsigned)report(JSON.stringify({kind:'unsignedPayroll',date:a.eventDate(r),origin:nativeIds.has(a.sourceId(r))?'native':'legacy'}));
 for(const r of unpaid)report(JSON.stringify({kind:'attendanceWithoutPayroll',date:a.eventDate(r)}));
}
a.withPortalReads(main)().catch(()=>{report('Read-only audit failed.');process.exitCode=1;});
