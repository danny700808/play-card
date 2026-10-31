const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(require('path').join(__dirname,'../data-center.html'),'utf8');
for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){if(script[1].trim())new vm.Script(script[1]);}
const source=html.slice(html.indexOf('    function dailyCardHtml(day){'),html.indexOf('    function updateDailyFilterLabels'));
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const ctx={esc:escape,escjs:escape,weekdayLabel:d=>d+'（二）',hours:n=>n+' 小時',money:n=>n+' 元',workSource:r=>r.source,dayStatusPills:()=>'<span>有主管處理</span>',clockSectionHtml:()=>'<button>修正遲到</button>',workEntriesHtml:()=>'<button>調整工時</button>',leavesHtml:()=>'',supervisorHtml:()=>'',auditHtml:()=>'<p>完整歷程</p>'};
vm.createContext(ctx);vm.runInContext(source,ctx);
const result=ctx.dailyCardHtml({date:'2026-08-04',totalHours:4,gross:800,deduction:20,net:780,workRows:[{source:'員工登記'},{source:'補時數',payMultiplier:2}],leaves:[{type:'事假',hours:1,note:'<私人原因>'}],supervisorActions:[{text:'主管核准補時數'}],issues:[{text:'需確認'}]});
assert.match(result,/^<details class="daily-card"/);assert.doesNotMatch(result,/^<details[^>]* open/);
const summary=result.slice(0,result.indexOf('</summary>'));
for(const value of ['2026-08-04','800 元','20 元','780 元','補時數（雙倍）','主管核准補時數','&lt;私人原因&gt;','需確認'])assert.ok(summary.includes(value),value);
assert.doesNotMatch(summary,/<button/);assert.match(result,/<button>調整工時/);assert.match(result,/完整歷程/);
console.log('Compact daily rows retain date, events, amounts, exceptions and expandable actions');
