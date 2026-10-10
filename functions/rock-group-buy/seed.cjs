'use strict';
const admin=require('firebase-admin');
admin.initializeApp({projectId:'youzi-c1b74'});
const db=admin.firestore();
(async()=>{
 const root=db.collection('clubGroupBuyPrivate').doc('rock-2026');
 await db.runTransaction(async tx=>{
  const existing=await tx.get(root);
  if(existing.exists){console.log('Existing rock catalog preserved');return;}
  const original=await tx.get(db.collection('clubGroupBuyPrivate').doc('guitar-2026'));
  const teacherPasswordHash=original.data()?.teacherPasswordHash;
  if(!teacherPasswordHash)throw Error('Original teacher password is not configured');
  tx.create(root,{title:'熱音社團購',intro:'',open:true,revision:1,roster:[],products:require('./catalog.json'),teacherPasswordHash});
 });
 console.log('Rock catalog ready; original teacher password retained.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
