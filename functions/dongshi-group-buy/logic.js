'use strict';
const crypto = require('node:crypto');
const hash = x => crypto.createHash('sha256').update(String(x)).digest('hex');
function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
function text(x,max=120){return String(x??'').trim().slice(0,max);}
function manager(t){return !!(t&&(t.manager===true||t.admin===true||t.owner===true||['admin','manager','owner','主管','管理者'].includes(t.role)||(t.email_verified===true&&t.email==='danny700808@gmail.com')));}
function sanitizeSettings(data,old){
 if(!Array.isArray(data.products)||data.products.length>60)fail('商品清單格式不正確');
 const ids=new Set();
 const products=data.products.map(p=>{
  const id=text(p.id,80);if(!/^[a-z0-9_-]+$/.test(id)||ids.has(id))fail('商品編號重複或無效');ids.add(id);
  const prior=old.products.find(x=>x.id===id); const reserved=prior?.reserved||0;
  const price=Number(p.price),total=p.total==null||p.total===''?null:Number(p.total);
  if(!text(p.name)||!Number.isSafeInteger(price)||price<0||price>1000000)fail('請填寫商品名稱及正確價格');
  if(total!==null&&(!Number.isSafeInteger(total)||total<reserved||total>10000))fail(`${p.name} 的總配額不可少於已訂 ${reserved} 支`);
  if(total===null&&reserved&&p.unlimited!==true)fail('已有訂單的商品不能清空配額');
  const image=text(p.image,2048);if(image&&!/^https:\/\//.test(image))fail('圖片請填 HTTPS 網址');
  return {id,kind:prior?.kind==='book'?'book':'guitar',unlimited:p.unlimited===true,name:text(p.name),description:text(p.description,500),price,total,reserved,image,enabled:p.enabled===true};
 });
 for(const p of old.products)if(p.reserved&&!ids.has(p.id))fail('已有訂單的商品請停用，不能刪除');
 if(!Array.isArray(data.roster)||data.roster.length>1500)fail('名單最多 1500 人');
 const memberIds=new Set();const roster=data.roster.map(m=>{const className=text(m.className,60),name=text(m.name,60);if(!className||!name)fail('名單每列都需要班級與姓名');const id=hash(className+'\n'+name).slice(0,32);if(memberIds.has(id))fail('班級姓名重複：'+className+' '+name);memberIds.add(id);return{id,className,name};});
 return {...old,title:text(data.title)||'吉他社團購',intro:text(data.intro,500),open:data.open===true,products,roster,revision:old.revision+1};
}
function orderPlan(config,memberId,items,noPurchase){
 const member=config.roster.find(m=>m.id===memberId);if(!member)fail('請重新選擇班級姓名');
 if(!Array.isArray(items)||items.length>60)fail('訂購項目格式不正確');
 if(noPurchase===true&&items.length)fail('不購買不能同時選商品');
 if(!noPurchase&&!items.length)fail('請選擇商品，或勾選本次不購買');
 const seen=new Set(), lines=items.map(line=>{const p=config.products.find(p=>p.id===line.id);const quantity=Number(line.quantity);if(!p||!p.enabled||(!p.unlimited&&p.total===null))fail('商品尚未開放訂購');if(seen.has(p.id))fail('商品重複');seen.add(p.id);if(!Number.isSafeInteger(quantity)||quantity<1||quantity>8)fail('數量需為 1 至 8');if(!p.unlimited&&p.total-p.reserved<quantity)fail(`${p.name} 剩餘數量不足，請重新選擇`,409);return{id:p.id,name:p.name,price:p.price,quantity};});
 return {memberId:member.id,className:member.className,name:member.name,items:lines,noPurchase:noPurchase===true,total:lines.reduce((n,p)=>n+p.price*p.quantity,0)};
}
function changeReservation(config,lines,direction){for(const line of lines){const p=config.products.find(p=>p.id===line.id);if(!p)fail('商品資料缺失',409);p.reserved+=direction*line.quantity;if(p.reserved<0||(!p.unlimited&&p.reserved>p.total))fail('庫存不一致，請重新整理',409);}config.revision++;}
module.exports={hash,fail,text,manager,sanitizeSettings,orderPlan,changeReservation};
