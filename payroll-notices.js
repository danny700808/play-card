(function(root){
'use strict';
var esc=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
async function open(options){
 if(document.getElementById('payrollNoticeDialog'))return;
 var monthParts=String(options.month).split('-'),monthLabel=monthParts[0]+' 年 '+Number(monthParts[1])+' 月';
 var host=document.createElement('div');host.id='payrollNoticeDialog';
 host.innerHTML='<style>#payrollNoticeDialog{position:fixed;inset:0;background:#173b3977;z-index:12010;display:flex;align-items:center;justify-content:center;font:15px "Microsoft JhengHei",sans-serif;color:#203b35}#payrollNoticeDialog .panel{background:white;border-radius:16px;width:min(1000px,95vw);max-height:92vh;overflow:auto;padding:24px;box-sizing:border-box}#payrollNoticeDialog header{display:flex;justify-content:space-between;align-items:center}#payrollNoticeDialog button{padding:9px 14px;border-radius:7px;border:1px solid #b8cec4;background:#edf6f2;font:inherit;cursor:pointer}#payrollNoticeDialog button:disabled{opacity:.5;cursor:default}#payrollNoticeDialog table{border-collapse:collapse;width:100%;margin:16px 0}#payrollNoticeDialog th,#payrollNoticeDialog td{padding:10px;text-align:left;border-bottom:1px solid #dde7e1}#payrollNoticeDialog pre{white-space:pre-wrap;font:inherit;line-height:1.7;background:#f0f6f3;padding:18px;border-radius:10px}#payrollNoticeDialog input[type=date]{padding:8px;font:inherit}#payrollNoticeDialog footer{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:20px}#payrollNoticeDialog [data-send]{background:#18785c;color:white}#payrollNoticeDialog .month-banner{position:sticky;top:0;z-index:2;background:#fff4ce;border:2px solid #a56b13;border-radius:12px;padding:14px 18px;margin:8px 0 18px;box-shadow:0 3px 10px #203b3515}#payrollNoticeDialog .month-banner small{display:block;font-size:15px;font-weight:700;color:#795014}#payrollNoticeDialog .month-banner strong{display:block;font-size:clamp(30px,5vw,42px);line-height:1.3;font-weight:900;color:#593700}#payrollNoticeDialog .cutoff{font-size:14px;color:#52665e}#payrollNoticeDialog .confirm-label{font-size:18px;line-height:1.6}#payrollNoticeDialog .confirm-label strong{font-size:24px;color:#794600;white-space:nowrap}#payrollNoticeDialog [data-confirm]{width:22px;height:22px;vertical-align:middle}#payrollNoticeDialog .message{white-space:pre-wrap;color:#9c4026}</style><section class="panel" role="dialog" aria-modal="true" aria-labelledby="noticeTitle"><header><h2 id="noticeTitle">薪資匯款通知（LINE／Email）</h2><button data-close>關閉</button></header><div class="month-banner" role="note"><small>本次通知的薪資月份</small><strong>'+esc(monthLabel)+' 薪資</strong></div><p class="cutoff">補簽截止：次月 10 日 00:00（台灣時間）。</p><label>實際匯款日期 <input type="date" data-date></label> <button data-preview>更新通知預覽</button><div class="content"></div><p class="message" role="status" aria-live="polite"></p><footer><label class="confirm-label"><input type="checkbox" data-confirm> 我已核對 <strong>'+esc(monthLabel)+'薪資</strong> 的金額，並完成勾選老師的銀行匯款</label><button data-send disabled>發送勾選老師的通知</button></footer></section>';
 document.body.appendChild(host);
 var date=host.querySelector('[data-date]'),content=host.querySelector('.content'),message=host.querySelector('.message'),confirm=host.querySelector('[data-confirm]'),send=host.querySelector('[data-send]'),preview=null,busy=false;
 date.value=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});date.max=date.value;
 function selected(){return Array.from(host.querySelectorAll('[data-teacher]:checked')).map(function(x){return x.dataset.teacher;});}
 function update(){var n=selected().length,all=host.querySelector('[data-all]'),count=host.querySelectorAll('[data-teacher]:not([data-ineligible])').length;if(all){all.checked=count>0&&n===count;all.indeterminate=n>0&&n<count;}send.textContent='發送 '+monthLabel+'薪資通知（'+n+' 位老師）';send.disabled=busy||!preview||!confirm.checked||!n;}
 function setBusy(v){busy=v;host.querySelectorAll('button,input').forEach(function(el){el.disabled=v;});host.querySelectorAll('[data-ineligible]').forEach(function(el){el.disabled=true;});update();}
 host.querySelector('[data-close]').onclick=function(){if(!busy)host.remove();};
 confirm.onchange=update;
 date.onchange=function(){preview=null;confirm.checked=false;content.textContent='匯款日期已變更，請更新通知預覽。';update();};
 async function refresh(){
  if(busy)return;preview=null;confirm.checked=false;setBusy(true);message.textContent='正在核對薪資與 LINE／Email…';
  try{
   var result=await options.api({action:'notice-preview',month:options.month,transferDate:date.value});preview=result;
   content.innerHTML='<p>有本期應付薪資且可通知的老師已預先勾選，可取消個別勾選。有 LINE 與 Email 會兩邊都傳，只有一種就傳該管道。無可用管道、未設定銀行帳號或已通知者不會勾選。</p><table><thead><tr><th><input type="checkbox" data-all aria-label="勾選全部可通知老師" checked></th><th>老師</th><th>本期匯款金額</th><th>通知狀態</th><th>內容</th></tr></thead><tbody>'+result.rows.map(function(r,i){return '<tr><td><input type="checkbox" data-teacher="'+esc(r.teacherId)+'" aria-label="通知 '+esc(r.name)+'" '+(r.eligible?'checked':'disabled data-ineligible')+'></td><td>'+esc(r.name)+'</td><td>NT$'+Number(r.amount).toLocaleString('zh-TW')+'</td><td>'+esc(r.reason||r.noticeStatus)+'</td><td><button data-body="'+i+'">預覽訊息</button></td></tr>';}).join('')+'</tbody></table><pre data-body-preview>請點選「預覽訊息」查看傳給該老師的完整內容。</pre>';
   content.querySelector('[data-all]').onchange=function(){var checked=this.checked;confirm.checked=false;host.querySelectorAll('[data-teacher]:not([data-ineligible])').forEach(function(el){el.checked=checked;});update();};
   content.querySelectorAll('[data-teacher]').forEach(function(el){el.onchange=function(){confirm.checked=false;update();};});
   content.querySelectorAll('[data-body]').forEach(function(el){el.onclick=function(){content.querySelector('[data-body-preview]').textContent=result.rows[Number(el.dataset.body)].body;};});
   message.textContent=result.rows.length?'預覽完成。確認實際匯款後才會送出通知。':'本批次沒有應付薪資。';
  }catch(e){content.textContent='';message.textContent='預覽失敗：'+e.message;}finally{setBusy(false);}
 }
 host.querySelector('[data-preview]').onclick=refresh;
 send.onclick=async function(){
  if(busy||!preview||!confirm.checked)return;
  var ids=selected();if(!ids.length)return;setBusy(true);message.textContent='正在建立通知，請稍候…';
  try{var result=await options.api({action:'notice-send',month:options.month,previewId:preview.previewId,teacherIds:ids,confirmedTransferred:true});preview=null;confirm.checked=false;content.textContent='';message.textContent=result.message+' 可按「更新通知預覽」查看最新發送狀態。';}
  catch(e){preview=null;confirm.checked=false;message.textContent='請更新通知預覽核對狀態：'+e.message;}
  finally{setBusy(false);}
 };
 await refresh();
}
root.YouziPayrollNotices={open:open};
})(window);
