'use strict';
const admin=require('firebase-admin');
admin.initializeApp({projectId:'youzi-c1b74'});
const db=admin.firestore();
const version='dongshi-20261010-book-v1';
function updateBook(products){return products.map(p=>p.id==='book-tanzhi-zhijian'?{...p,name:'新琴點撥',price:400,description:'',image:'https://danny700808.github.io/play-card/group-buy-assets/dongshi-xinqin-dianbo.jpg'}:p);}
(async()=>{
 const target=db.collection('clubGroupBuyPrivate').doc('dongshi-guitar-2026');
 await db.runTransaction(async tx=>{
  const existing=await tx.get(target);
  if(existing.exists){
   const current=existing.data();
   if(current.catalogVersion===version){console.log('Dongshi book already updated');return;}
   tx.update(target,{products:updateBook(current.products),catalogVersion:version,revision:current.revision+1});
   return;
  }
  const original=await tx.get(db.collection('clubGroupBuyPrivate').doc('guitar-2026'));
  if(!original.exists)throw Error('Original catalog missing');
  const source=original.data();
  if(!source.teacherPasswordHash)throw Error('Teacher password missing');
  tx.create(target,{title:'東勢高工｜吉他團購',intro:source.intro||'',open:source.open,revision:1,roster:[],teacherPasswordHash:source.teacherPasswordHash,catalogVersion:version,products:updateBook(source.products.map(p=>({...p,reserved:0})))});
 });
 console.log('Dongshi book updated; existing orders and original school preserved');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
