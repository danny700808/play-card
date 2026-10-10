'use strict';
const admin=require('firebase-admin');
admin.initializeApp({projectId:'youzi-c1b74'});
const db=admin.firestore();
(async()=>{
 const root=db.collection('clubGroupBuyPrivate').doc('rock-2026');
 await db.runTransaction(async tx=>{
  const existing=await tx.get(root);
  if(existing.exists){
   const current=existing.data();
   if(current.catalogVersion==='guitars-20261010-v5'){console.log('Guitar catalog already applied');return;}
   const incoming=require('./catalog.json');
   const products=current.products.map(p=>{
    const source=incoming.find(x=>x.id===p.id);if(!source)return p;
    if(p.kind==='amp')return {...p,name:source.name};
    if(p.id==='ibanez-blue')return {...p,sku:source.sku};
    if(p.family==='farida')return {...p,familyName:source.familyName,optionLabel:source.optionLabel||source.color};
    if(p.id.startsWith('irin-'))return {...p,family:source.family,familyName:source.familyName,color:source.color};
    return p;
   });
   for(const p of incoming.filter(p=>['farida','ibanez','squier','premium'].includes(p.family)))if(!products.some(x=>x.id===p.id))products.push(p);
   tx.update(root,{products,catalogVersion:'guitars-20261010-v5',revision:current.revision+1});
   console.log('Added guitar options; existing orders, prices and reservations preserved');return;
  }
  const original=await tx.get(db.collection('clubGroupBuyPrivate').doc('guitar-2026'));
  const teacherPasswordHash=original.data()?.teacherPasswordHash;
  if(!teacherPasswordHash)throw Error('Original teacher password is not configured');
  tx.create(root,{title:'熱音社團購',intro:'',open:true,revision:1,roster:[],products:require('./catalog.json'),teacherPasswordHash});
 });
 console.log('Rock catalog ready; original teacher password retained.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
