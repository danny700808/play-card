'use strict';
function number(value){return Number(String(value==null?'':value).replace(/[^0-9.-]/g,''))||0;}
function addDays(value,days){const date=new Date(String(value).slice(0,10)+'T00:00:00Z');if(Number.isNaN(date.getTime()))throw Error('契約日期不完整，請聯絡店家。');date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function renewalDraft(contract,input,nowText,template={}){
  const periods=Number(input.periods);if(!Number.isInteger(periods)||periods<1||periods>3)throw Error('請選擇 1 至 3 期。');
  const custom={};for(const p of [1,2,3])custom[p]=number(contract['renewalFee'+p]||contract['renewalPrice'+p]||contract['renewalRentFee'+p]);
  const base=number(contract.renewalRentFee||contract.rentFee||contract.rentalFee);
  const prices=Object.values(custom).some(Boolean)?custom:contract.rentalType==='electronicDrum'?{1:3000,2:5200,3:7500}:contract.rentalType==='digitalPiano'?{1:2800,2:5200,3:7500}:{1:base,2:base*2,3:base*3};
  const days=periods*Math.max(1,number(contract.periodDays||template.periodDays)||90),startDate=addDays(contract.endDate,1);
  return {decision:'renew',source:'customer-renewal-page',periods,startDate,endDate:addDays(startDate,days-1),days,rentFee:prices[periods]||'',customerNote:String(input.note||input.renewNote||'').slice(0,3000),customerSubmittedAt:nowText,status:'續約待確認'};
}
function assertOnlineSignable(contract){
  if(contract.customerOnlineSigningDisabled===true||contract.customerPortalReadOnly===true||['租賃中','租用中','已成立','active','已退租','completed','cancelled','已取消'].includes(String(contract.status||'')))throw Error('這份契約目前不接受線上補件，請聯絡店家確認。');
}
function assertCustomerRequestable(contract){
  if(['已退租','已取消','已結案','completed','cancelled','closed'].includes(String(contract.status||'')))throw Error('這份契約已結束，請聯絡店家確認。');
}
module.exports={renewalDraft,assertOnlineSignable,assertCustomerRequestable};
