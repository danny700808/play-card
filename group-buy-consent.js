(()=>{'use strict';
const VERSION='2026-10-01-v1',TEXT='本人為下列學生之家長或監護人，已確認本次選購的吉他款式、數量、附贈配件與總金額，同意學生參加本次吉他團購。';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let parentName='',agreed=false,strokes=[],drawing=false,host=null,options=null,canvas=null;
const money=n=>'NT$ '+Number(n).toLocaleString('zh-TW');
function draw(c,ss){const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.strokeStyle='#213d36';ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';for(const s of ss){ctx.beginPath();s.points.forEach((p,i)=>i?ctx.lineTo(p.x*c.width,p.y*c.height):ctx.moveTo(p.x*c.width,p.y*c.height));ctx.stroke();}}
function summary(s){return `<p>學生：${esc(s.className)} ${esc(s.name||s.studentName)}</p><ul>${s.items.map(p=>`<li>${esc(p.name)} × ${p.quantity}（${money(p.price*p.quantity)}）</li>`).join('')}</ul><p><strong>總金額：${money(s.total)}</strong></p>`;}
function refreshSummary(){const el=host?.querySelector('#consentSelection');if(el)el.innerHTML=summary(options.getSummary());}
function resetSignature(){strokes=[];agreed=false;drawing=false;if(canvas?.isConnected)draw(canvas,strokes);const check=host?.querySelector('#parentAgree');if(check)check.checked=false;options?.onChange();}
function clear(){parentName='';resetSignature();}
function mount(el,o){host=el;options=o;canvas=null;if(o.noPurchase){el.innerHTML='';return;}
el.innerHTML=`<section style="margin-top:24px;border-top:1px solid var(--line);padding-top:22px" aria-labelledby="parentConsentTitle"><h2 id="parentConsentTitle">家長同意與簽名</h2><p style="font-size:14px">請由家長或監護人確認以下內容，親自填寫並簽名。</p><div id="consentSelection" style="font-size:14px;background:#f3f5ee;padding:14px 18px;border-radius:8px;margin-bottom:18px"></div><p style="font-size:14px">${TEXT}</p><label>家長或監護人姓名<input id="parentName" maxlength="60" autocomplete="off" value="${esc(parentName)}" placeholder="請填家長或監護人姓名"></label><label><input type="checkbox" id="parentAgree" ${agreed?'checked':''}> 我已確認以上選購內容並同意。</label><label for="parentSignature">家長或監護人簽名</label><p class="muted" style="font-size:13px;margin-bottom:8px">請用手指或滑鼠在框內簽名。</p><canvas id="parentSignature" width="1000" height="360" aria-label="家長或監護人手寫簽名區" style="display:block;width:100%;height:auto;aspect-ratio:25/9;background:white;border:1px solid #aebcad;border-radius:8px;touch-action:none"></canvas><button type="button" id="clearParentSignature" class="secondary" style="margin-top:10px">清除重簽</button><p class="muted" style="font-size:12px;margin-top:10px">家長姓名與簽名僅供本次團購同意紀錄及管理者查核使用。</p></section>`;
canvas=el.querySelector('canvas');draw(canvas,strokes);refreshSummary();
el.querySelector('#parentName').oninput=e=>{parentName=e.target.value;resetSignature();};
el.querySelector('#parentAgree').onchange=e=>{agreed=e.target.checked;o.onChange();};
el.querySelector('#clearParentSignature').onclick=resetSignature;
const pos=e=>{const r=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};};
let pointer=null;
canvas.onpointerdown=e=>{if(pointer!==null||e.button!==0)return;e.preventDefault();if(strokes.length>=100)return;pointer=e.pointerId;drawing=true;canvas.setPointerCapture(pointer);strokes.push({points:[pos(e)]});o.onChange();};
canvas.onpointermove=e=>{if(!drawing||e.pointerId!==pointer)return;e.preventDefault();const s=strokes[strokes.length-1],p=pos(e),last=s.points[s.points.length-1];if(Math.hypot(p.x-last.x,p.y-last.y)<.001)return;if(s.points.length>=2000||strokes.reduce((n,s)=>n+s.points.length,0)>=12000)return;s.points.push(p);draw(canvas,strokes);};
const end=e=>{if(e.pointerId!==pointer)return;drawing=false;pointer=null;};canvas.onpointerup=end;canvas.onpointercancel=end;canvas.onlostpointercapture=end;
}
function value(noPurchase){if(noPurchase)return null;if(!parentName.trim())throw Error('請填寫家長或監護人姓名');if(!agreed)throw Error('請由家長勾選同意');let count=0,len=0;for(const s of strokes){count+=s.points.length;for(let i=1;i<s.points.length;i++)len+=Math.hypot(s.points[i].x-s.points[i-1].x,s.points[i].y-s.points[i-1].y);}if(drawing||count<6||len<.08)throw Error('請完成家長手寫簽名');return{parentName:parentName.trim(),agreed,version:VERSION,strokes:JSON.parse(JSON.stringify(strokes))};}
function show(dialog,c){if(!c){dialog.innerHTML='<h2>尚無家長同意紀錄</h2><button id="closeConsent">關閉</button>';}else{dialog.innerHTML=`<h2>家長同意紀錄</h2><p>${esc(c.text)}</p>${summary(c)}<p>家長或監護人：<strong>${esc(c.parentName)}</strong></p><p>簽署時間：${esc(new Date(c.signedAt).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}))}</p><canvas width="1000" height="360" aria-label="已保存的家長簽名" style="width:100%;max-width:600px;background:white;border:1px solid #ddd"></canvas><p class="muted" style="font-size:12px">以上為簽署當時的選購內容。</p><button id="closeConsent">關閉</button>`;draw(dialog.querySelector('canvas'),c.strokes);}dialog.querySelector('#closeConsent').onclick=()=>dialog.close();dialog.showModal();}
window.ClubConsent={mount,value,clear,resetSignature,refreshSummary,isDrawing:()=>drawing,show};
})();
