'use strict';
// Read-only September validation. Only anonymous relationship flags are logged.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const report=console.log.bind(console);console.log=console.info=console.warn=console.error=()=>{};
const filename=path.resolve('functions/coursePortal.js'),backend=new Module(filename,module);
backend.filename=filename;backend.paths=Module._nodeModulePaths(path.dirname(filename));
backend._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.audit={db,withPortalReads,mirrorProfilesByIds,sourceId,portalRowsByDateRange,ATTENDANCE_PAYROLL,teacherPayrollStudentIds,portalAttendanceForStudents,mirrorRowsByDateRange};',filename);
const a=backend.exports.audit;
const auditPublicKey="-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAka2YscTx+e7H0+yrNcFk\nTQsiCoHTucHg/0LC5h1LrgCz3YInh2oV3as7k8Ynnz/XDquOVcaKlYD2VXxDavcz\nn69kp3G7L0CvmfoJr6xPRyEj1H2Plmkv4NcOtISLzkxvONyVdXEil8M6St6cs2HO\n3jFmTpI72tqOhjsp+TyShqPfAI91xDX396X/7A/rUsMOVl92c9PErPJDs2rf7zDW\nlpYJ5g+Pv3hWeeFrXFxmrIWjdnatd5bYp0O6eItv5K+QMMw9zZexhGggsMFFZbUT\nJhSvM3vhUoE1+3PvBM48pGo3m2D5i9UxX19WSn4lmSoi9wprQ1mJMW1afYaywI4R\n/7PQNAaEYzfFugBSfUq0NiccQf8KRdiAbpiZP/226YSDSmvgLIK9YxrPFBon+5q0\n2rAOQqTaKTW11+yEot2sfqNQwezR1xYRDb4jxzp3eMta8aA5LZxv7vZTd5XuIbqP\nUrixuCUWqXX2i/DicJEUj0cTbaCCwq0Y60CiF1cfE7LVAgMBAAE=\n-----END PUBLIC KEY-----\n";
const privateReport=value=>{const c=require('crypto'),key=c.randomBytes(32),iv=c.randomBytes(12),cipher=c.createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);report('PRIVATE_AUDIT '+JSON.stringify({key:c.publicEncrypt({key:auditPublicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}));};
async function main(){
 const rows=await a.portalRowsByDateRange(a.ATTENDANCE_PAYROLL,'2026-09-01','2026-09-30');
 const targets=rows.filter(r=>/^黃[沛佩][璇雪]$/.test(r.studentName||''));
 const ids=[...new Set(targets.flatMap(a.teacherPayrollStudentIds))];
 if(ids.length!==1)throw Error('target identity guard');
 const [students,records,mirror,changes]=await Promise.all([a.mirrorProfilesByIds('students',ids),a.portalAttendanceForStudents(ids),a.mirrorRowsByDateRange('attendance','2026-09-01','2026-09-30'),a.db.collection('coursePortalScheduleChanges').where('sourceDate','>=','2026-09-01').where('sourceDate','<=','2026-09-30').get()]);
 const legacyPayroll=(await a.mirrorRowsByDateRange('teacherPayroll','2026-09-01','2026-09-30')).filter(r=>a.teacherPayrollStudentIds(r).some(id=>ids.includes(id)));
 const feeSnaps=await Promise.all(targets.map(r=>a.db.collection('coursePortalTeacherAdjustments').doc('attendance-fee-'+r.operationId).get()));
 privateReport({legacyPayroll,fees:feeSnaps.filter(d=>d.exists).map(d=>d.data()),students:students.map(r=>({id:a.sourceId(r),name:r.name})),payroll:targets,records,mirror:mirror.filter(r=>ids.includes(r.studentId)),changes:changes.docs.map(d=>({id:d.id,...d.data()})).filter(r=>ids.some(id=>(r.event?.studentIds||[]).includes(id)))});
 report('Private attendance audit complete; no writes.');
}
a.withPortalReads(main)().catch(()=>{report('Private attendance audit failed.');process.exitCode=1;});
