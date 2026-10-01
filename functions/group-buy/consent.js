'use strict';
const VERSION='2026-10-01-v1';
const TEXT='本人為下列學生之家長或監護人，已確認本次選購的吉他款式、數量、附贈配件與總金額，同意學生參加本次吉他團購。';
function validateConsent(c,noPurchase){
 if(noPurchase===true)return null;
 const bad=m=>{const e=new Error(m);e.status=400;throw e;};
 if(!c||c.agreed!==true||c.version!==VERSION)bad('請由家長閱讀並勾選同意');
 if(typeof c.parentName!=='string'||!c.parentName.trim()||c.parentName.trim().length>60)bad('請填寫家長或監護人姓名');
 if(!Array.isArray(c.strokes)||!c.strokes.length||c.strokes.length>100)bad('請由家長在簽名框內簽名');
 let count=0,distance=0;
 const strokes=c.strokes.map(s=>{
  if(!s||!Array.isArray(s.points)||s.points.length<1||s.points.length>2000)bad('簽名格式不正確');
  const points=s.points.map(p=>{count++;if(count>12000||!p||typeof p.x!=='number'||typeof p.y!=='number'||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)bad('簽名格式不正確');return{x:Math.round(p.x*10000)/10000,y:Math.round(p.y*10000)/10000};});
  for(let i=1;i<points.length;i++)distance+=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);
  return{points};
 });
 if(count<6||distance<0.08)bad('請完成家長手寫簽名，不可只點一下');
 return{...(c.canvasHeight===540?{canvasHeight:540}:{}),version:VERSION,text:TEXT,parentName:c.parentName.trim(),agreed:true,strokes};
}
module.exports={VERSION,TEXT,validateConsent};
