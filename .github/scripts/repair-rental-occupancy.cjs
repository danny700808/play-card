'use strict';
// Read-only September validation. Only anonymous relationship flags are logged.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const report=console.log.bind(console);console.log=console.info=console.warn=console.error=()=>{};
const filename=path.resolve('functions/coursePortal.js'),backend=new Module(filename,module);
backend.filename=filename;backend.paths=Module._nodeModulePaths(path.dirname(filename));
backend._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.audit={withPortalReads,db,adminSaveSchedule,mirrorProfilesByIds,scheduleBundle,eventBlocksResource,overlaps,sourceId};',filename);
const a=backend.exports.audit;
const auditPublicKey="-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAka2YscTx+e7H0+yrNcFk\nTQsiCoHTucHg/0LC5h1LrgCz3YInh2oV3as7k8Ynnz/XDquOVcaKlYD2VXxDavcz\nn69kp3G7L0CvmfoJr6xPRyEj1H2Plmkv4NcOtISLzkxvONyVdXEil8M6St6cs2HO\n3jFmTpI72tqOhjsp+TyShqPfAI91xDX396X/7A/rUsMOVl92c9PErPJDs2rf7zDW\nlpYJ5g+Pv3hWeeFrXFxmrIWjdnatd5bYp0O6eItv5K+QMMw9zZexhGggsMFFZbUT\nJhSvM3vhUoE1+3PvBM48pGo3m2D5i9UxX19WSn4lmSoi9wprQ1mJMW1afYaywI4R\n/7PQNAaEYzfFugBSfUq0NiccQf8KRdiAbpiZP/226YSDSmvgLIK9YxrPFBon+5q0\n2rAOQqTaKTW11+yEot2sfqNQwezR1xYRDb4jxzp3eMta8aA5LZxv7vZTd5XuIbqP\nUrixuCUWqXX2i/DicJEUj0cTbaCCwq0Y60CiF1cfE7LVAgMBAAE=\n-----END PUBLIC KEY-----\n";
const privateReport=value=>{const c=require('crypto'),key=c.randomBytes(32),iv=c.randomBytes(12),cipher=c.createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);report('PRIVATE_AUDIT '+JSON.stringify({key:c.publicEncrypt({key:auditPublicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}));};
const operationId='repair-empty-day-room-20261008-v1';
async function main(){
 const source='teacher-fbba154f890d03ad9bc47ff1f692dcd35ad8a58f63e85a1f06aff45c82e7881e';
 const ref=a.db.collection('coursePortalScheduleChanges').doc(source);
 const backup=a.db.collection('coursePortalRepairBackups').doc(operationId);
 const cancel=a.db.collection('coursePortalScheduleChanges').doc('manager-'+operationId);
 if(!(await cancel.get()).exists){
  const before=await a.withPortalReads(()=>a.scheduleBundle('2026-10-08','2026-10-08','',{adminWrite:true,studentIds:[]}))();
  const original=before.resourceEvents.find(r=>r.portalChangeId===source&&r.date==='2026-10-08');
  if(!original||original.roomId!=='63181389f3c4de00b1f1513d'||original.startTime!=='19:00'||original.endTime!=='20:00'||original.status!=='scheduled')throw Error('Source changed; no repair performed');
  await a.db.runTransaction(async tx=>{const record=await tx.get(ref),saved=await tx.get(backup);if(!record.exists||record.data().active!==true)throw Error('Source changed');if(!saved.exists)tx.create(backup,{sourcePath:ref.path,before:record.data(),reason:'Owner confirmed day calendar is authoritative and this occurrence is empty',createdAt:new Date().toISOString()});});
  const result=await a.withPortalReads(()=>a.adminSaveSchedule({operationId,mode:'delete',sourceEventId:original.id,sourceCourseId:original.fixedCourseId,sourceDate:original.date,event:{...original,start:original.startTime,duration:60,type:'fixed',note:'依管理者確認日表空檔，取消背景殘留的本次調課占用。'}}))();
  if(!result.ok)throw Error('Repair failed');
 }
 const after=await a.withPortalReads(()=>a.scheduleBundle('2026-10-08','2026-10-08','',{adminWrite:true,studentIds:[]}))();
 const conflicts=after.resourceEvents.filter(r=>r.roomId==='63181389f3c4de00b1f1513d'&&a.eventBlocksResource(r)&&a.overlaps('18:00','20:00',r.startTime,r.endTime));
 report(JSON.stringify({repairComplete:true,backupSaved:(await backup.get()).exists,remainingConflicts:conflicts.length}));
 if(conflicts.length)throw Error('Interval remains occupied');
}
main().catch(()=>{report('Repair stopped; inspect private backup before retry.');process.exitCode=1;});
