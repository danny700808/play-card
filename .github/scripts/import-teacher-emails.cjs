'use strict';
const admin=require('../../functions/node_modules/firebase-admin');
admin.initializeApp();const db=admin.firestore();const report=console.log.bind(console);
const auditPublicKey="-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAka2YscTx+e7H0+yrNcFk\nTQsiCoHTucHg/0LC5h1LrgCz3YInh2oV3as7k8Ynnz/XDquOVcaKlYD2VXxDavcz\nn69kp3G7L0CvmfoJr6xPRyEj1H2Plmkv4NcOtISLzkxvONyVdXEil8M6St6cs2HO\n3jFmTpI72tqOhjsp+TyShqPfAI91xDX396X/7A/rUsMOVl92c9PErPJDs2rf7zDW\nlpYJ5g+Pv3hWeeFrXFxmrIWjdnatd5bYp0O6eItv5K+QMMw9zZexhGggsMFFZbUT\nJhSvM3vhUoE1+3PvBM48pGo3m2D5i9UxX19WSn4lmSoi9wprQ1mJMW1afYaywI4R\n/7PQNAaEYzfFugBSfUq0NiccQf8KRdiAbpiZP/226YSDSmvgLIK9YxrPFBon+5q0\n2rAOQqTaKTW11+yEot2sfqNQwezR1xYRDb4jxzp3eMta8aA5LZxv7vZTd5XuIbqP\nUrixuCUWqXX2i/DicJEUj0cTbaCCwq0Y60CiF1cfE7LVAgMBAAE=\n-----END PUBLIC KEY-----\n";
const privateReport=value=>{const c=require('crypto'),key=c.randomBytes(32),iv=c.randomBytes(12),cipher=c.createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);report('PRIVATE_AUDIT '+JSON.stringify({key:c.publicEncrypt({key:auditPublicKey,oaepHash:'sha256'},key).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}));};


const crypto=require('crypto');
const clean=v=>String(v==null?'':v).trim();
const profileId=id=>'EXTP_'+crypto.createHash('sha256').update('course-portal-profile-v2:'+id).digest('hex').slice(0,24);
(async()=>{
 const inputs=JSON.parse(process.env.TEACHER_EMAIL_IMPORT_JSON||'[]');if(!Array.isArray(inputs)||!inputs.length||inputs.length>100)throw Error('Invalid import');
 const apply=process.env.APPLY==='true',run='teacher-email-'+process.env.GITHUB_RUN_ID;
 const result=await db.runTransaction(async tx=>{
  const directory=await tx.get(db.collection('opsEducationMirrorTeachers'));
  const refs=inputs.map(r=>({row:r,id:profileId(r.id),private:db.collection('teacherPrivateProfiles').doc(profileId(r.id)),public:db.collection('externalTeacherProfiles').doc(profileId(r.id))}));
  const snaps=await Promise.all(refs.map(async r=>({private:await tx.get(r.private),public:await tx.get(r.public)})));
  const bankRef=db.collection('coursePayrollTransferSettings').doc('bankAccounts'),bank=await tx.get(bankRef),drafts=await tx.get(db.collection('coursePayrollTransferDrafts'));
  const summary=[];const patches=[];
  refs.forEach((r,i)=>{
   const source=directory.docs.map(d=>d.data().source||{}).find(d=>d.id===r.row.id);
   if(!source||source.name!==r.row.name)throw Error('Teacher identity mismatch');
   const email=clean(r.row.email).toLowerCase(),existing=clean(snaps[i].private.data()?.email||snaps[i].public.data()?.email).toLowerCase();
   const status=!email?'empty-source':! /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)?'invalid-source':existing?(existing===email?'already-present':'existing-preserved'):'import';
   summary.push({teacherId:r.row.id,name:r.row.name,status});
   if(status==='import')patches.push({ref:r.private,before:snaps[i].private.exists?snaps[i].private.data():null,value:{profileId:r.id,coursePortalTeacherId:r.row.id,email,emailImportSource:'injiaoyun-teacher-basic-profile',emailImportedAt:new Date(),emailImportRun:run}});
  });
  if(apply){
   tx.create(db.collection('coursePortalAdminImportBackups').doc(run),{createdAt:new Date(),kind:'teacher-contact-email-and-manager-default',profiles:patches.map(p=>({path:p.ref.path,before:p.before})),bank:bank.exists?bank.data():null,drafts:drafts.docs.filter(d=>d.id>='2026-09'&&Number(d.data().managerAmount)===12000).map(d=>({id:d.id,before:d.data()}))});
   patches.forEach(p=>tx.set(p.ref,p.value,{merge:true}));
   tx.set(bankRef,{managerDefaultAmount:120000,revision:new Date().toISOString()},{merge:true});
   drafts.docs.filter(d=>d.id>='2026-09'&&Number(d.data().managerAmount)===12000).forEach(d=>tx.update(d.ref,{managerAmount:120000,updatedAt:new Date().toISOString(),correctionRun:run}));
  }
  return {apply,summary,importCount:patches.length};
 });privateReport(result);
})().catch(()=>{console.error('Import stopped without exposing contact data');process.exitCode=1;});
