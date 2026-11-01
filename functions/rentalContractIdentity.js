'use strict';
const crypto=require('node:crypto');
const normalize=value=>String(value??'').trim().replace(/^[a-z]/,c=>c.toUpperCase());
function identityFor(contract){return normalize(['customerIdNumber','customerTaxId','identityNo','customerIdNo','idNumber','taxId'].map(k=>contract[k]).find(v=>String(v??'').trim()));}
function initialSigning(contract,token){
 const draft=['草稿','待店家確認','待客人補資料','待客人簽署','待簽署','待簽名','formal_sent','pending_customer'].includes(String(contract.status||''));
 return draft&&!identityFor(contract)&&!contract.customerSubmittedFormalAt&&!contract.customerSignedAt&&!contract.officialConfirmedAt&&!contract.paperSignedConfirmedAt&&!!token&&[contract.signToken,contract.token].filter(Boolean).includes(token);
}
function assertUnchangedIdentity(contract,value){
 const previous=identityFor(contract);
 if(previous&&normalize(value)!==previous)throw Error('身分證字號與原合約不符，請聯絡店家確認。');
}
function createRentalContractIdentity({db,authorize,now=Date.now}){
 async function read(data,req={}){
  const id=String(data.contractId||data.id||'').trim(),token=String(data.token||data.signToken||'').trim();
  const {contract}=await authorize(id,token);
  const expected=identityFor(contract);
  if(initialSigning(contract,token))return {contract};
  if(!expected)return {requiresIdentity:true,identityUnavailable:true,message:'此合約尚未建檔身分證字號，請聯絡店家補齊資料後再查看。'};
  const entered=normalize(data.identityNumber);
  if(!entered)return {requiresIdentity:true};
  const current=now(),windowMs=15*60*1000;
  const keys=[['client',String(req.ip||'unknown'),6],['contract','all',60]];
  const refs=keys.map(([kind,ip])=>db.collection('rentalContractIdentityAttempts').doc(crypto.createHash('sha256').update(kind+'|'+id+'|'+ip).digest('hex')));
  const matches=entered.length<=64&&crypto.timingSafeEqual(crypto.createHash('sha256').update(entered).digest(),crypto.createHash('sha256').update(expected).digest());
  const outcome=await db.runTransaction(async tx=>{
   const snapshots=await Promise.all(refs.map(ref=>tx.get(ref)));
   const records=snapshots.map(s=>s.exists?s.data():{});
   const recent=records.map(r=>current-Number(r.startedAt||0)<windowMs);
   const failures=records.map((r,i)=>recent[i]?Number(r.failures||0):0);
   if(failures.some((count,i)=>count>=keys[i][2]))return 'limited';
   if(!matches){refs.forEach((ref,i)=>tx.set(ref,{startedAt:recent[i]?records[i].startedAt:current,failures:failures[i]+1,expiresAt:new Date(current+windowMs*2)}));return 'invalid';}
   return 'ok';
  });
  if(outcome==='limited')throw Error('嘗試次數過多，請 15 分鐘後再試，或聯絡店家確認證號。');
  if(outcome!=='ok')throw Error('身分證字號不符，請輸入簽約時填寫的完整證號。');
  return {contract};
 }
 return {read};
}
module.exports={normalize,identityFor,initialSigning,assertUnchangedIdentity,createRentalContractIdentity};
