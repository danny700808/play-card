'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const policy=require('../functions/trialNotificationNotice');
const teacherRow={source:'course-portal',eventCode:'teacher_daily_courses',teacherId:'teacher-test',body:'【今日課程】\n課程明細'};
const source=fs.readFileSync('functions/index.js','utf8');
function fn(name){const start=source.indexOf('async function '+name+'(');const end=source.indexOf('\n}',start)+2;return source.slice(start,end);}
test('Taipei trial ends exactly at September 15 midnight, not UTC midnight',()=>{
 const body='【昨日未完成紀錄】\n課程資料與入口';
 assert.equal(policy.trialNotificationText(body,policy.START-1),body);
 assert(policy.trialNotificationText(body,policy.START).startsWith(policy.NOTICE));
 assert(policy.trialNotificationText(body,Date.parse('2026-09-14T23:59:59+08:00')).startsWith(policy.NOTICE));
 assert.equal(policy.trialNotificationText(body,Date.parse('2026-09-15T00:00:00+08:00')),body);
 assert.equal(policy.trialNotificationText(body,Date.parse('2026-09-16T12:00:00+08:00')),body);
});
test('notice preserves original text, is idempotent, and wraps custom HTML',()=>{
 const now=policy.START+1,body='學生課程\nhttps://example.com/receipt';
 const result=policy.trialNotificationText(body,now);
 assert(result.endsWith(body));assert.equal(policy.trialNotificationText(result,now),result);
 const html='<p>付款確認</p><img src="https://example.com/receipt.png">';
 const wrapped=policy.trialNotificationHtml(html,now);assert(wrapped.endsWith(html));
 assert.equal(policy.trialNotificationHtml(wrapped,now),wrapped);
 assert.equal(policy.trialNotificationHtml(html,policy.END),html);
});
test('rental LINE stays unchanged and keeps receipt image',async()=>{
 let payload;
 const c={shouldAddTrialNotice:policy.shouldAddTrialNotice,clean:s=>String(s||'').trim(),queueTargetLineUserId:()=> 'test-recipient',isValidLinePushTargetId:()=>true,getLineAccessToken:async()=> 'fake',queueTitle:r=>r.title,queueBody:r=>r.body,lineImageUrlFromQueue:r=>r.imageUrl,trialNotificationText:s=>policy.trialNotificationText(s,policy.START+1),fetch:async(_,options)=>{payload=JSON.parse(options.body);return {ok:true,status:200,text:async()=>''};}};
 vm.createContext(c);vm.runInContext(fn('sendLinePush'),c);
 await c.sendLinePush({title:'通知',body:'一般內容',lineText:'直接通知內容',imageUrl:'https://example.com/receipt.png'});
 assert.equal(payload.messages.length,2);assert.equal(payload.messages[0].text,'直接通知內容');assert.equal(payload.messages[1].originalContentUrl,'https://example.com/receipt.png');
});
test('queued email and fallback get notice in text and HTML; authentication email stays usable',async()=>{
 const sent=[];
 const c={shouldAddTrialNotice:policy.shouldAddTrialNotice,clean:s=>String(s||'').trim(),process:{env:{GMAIL_USER:'test@example.com',GMAIL_APP_PASSWORD:'fake'}},queueTargetEmail:()=> 'test@example.com',queueTitle:r=>r.title,queueBody:r=>r.body,lineImageUrlFromQueue:()=>'',nodemailer:{createTransport:()=>({sendMail:async row=>{sent.push(row);return {messageId:'fake'};}})},trialNotificationText:s=>policy.trialNotificationText(s,policy.START+1),trialNotificationHtml:s=>policy.trialNotificationHtml(s,policy.START+1)};
 vm.createContext(c);vm.runInContext(fn('sendEmailViaGmail')+'\n'+fn('sendEmailViaSendGrid'),c);
 await c.sendEmailViaSendGrid({...teacherRow,title:'課程通知',body:'【昨日未完成紀錄】\n' + '本次 LINE 發送失敗，改用 Email 通知。',html:'<p>通知內容</p>'});
 assert(sent[0].text.startsWith(policy.NOTICE));assert(sent[0].html.includes('新系統試用期間提醒'));
 await c.sendEmailViaGmail({title:'驗證碼',body:'1234',html:'<p>1234</p>'});
 assert.equal(sent[1].text,'1234');assert.equal(sent[1].html,'<p>1234</p>');
});

 test('only teacher course reminders qualify; every other category defaults to no notice',()=>{
  assert(policy.shouldAddTrialNotice(teacherRow));
  assert(policy.shouldAddTrialNotice({...teacherRow,body:'【昨日未完成紀錄】\n尚未簽到'}));
  const excluded=[{}, {...teacherRow,source:'rental'}, {...teacherRow,eventCode:'rental_payment'},
   {...teacherRow,teacherId:''}, {...teacherRow,targetRole:'student'}, {...teacherRow,targetRole:'admin'},
   {...teacherRow,targetRole:'employee'}, {...teacherRow,body:'【系統待辦】\n公告或協助事項'},
   {...teacherRow,lineText:'租賃付款資訊'},
   ...['tuition_due_on_lesson_day','contact_book_posted','attendance_cancellation_pending',
    'announcement.published','task.published','external_teacher_admin_notice','contract.signed',
    'goods.inquiry','room_booking','clock.work','unknown_future_event'].map(eventCode=>({...teacherRow,eventCode}))];
  for(const row of excluded) assert.equal(policy.shouldAddTrialNotice(row),false,JSON.stringify(row));
 });
 test('teacher LINE, ordinary email, and direct push enforce the delivery scope',async()=>{
  const payloads=[],emails=[];
  const c={shouldAddTrialNotice:policy.shouldAddTrialNotice,clean:s=>String(s||'').trim(),normalizeText:s=>String(s||'').trim(),
   queueTargetLineUserId:()=> 'fake',isValidLinePushTargetId:()=>true,getLineAccessToken:async()=> 'fake',
   queueTitle:r=>r.title,queueBody:r=>r.body,lineImageUrlFromQueue:r=>r.imageUrl || '',
   trialNotificationText:s=>policy.trialNotificationText(s,policy.START+1),trialNotificationHtml:s=>policy.trialNotificationHtml(s,policy.START+1),
   process:{env:{GMAIL_USER:'test@example.com',GMAIL_APP_PASSWORD:'fake'}},queueTargetEmail:()=> 'test@example.com',
   nodemailer:{createTransport:()=>({sendMail:async row=>{emails.push(row);return {messageId:'fake'};}})},
   fetch:async(_,options)=>{payloads.push(JSON.parse(options.body));return {ok:true,status:200,text:async()=>''};}};
  vm.createContext(c);vm.runInContext(['sendLinePush','pushLineMessage','sendEmailViaGmail','sendEmailViaSendGrid'].map(fn).join('\n'),c);
  await c.sendLinePush(teacherRow);
  assert(payloads[0].messages[0].text.startsWith(policy.NOTICE));
  await c.sendLinePush({...teacherRow,body:'【系統待辦】\n新公告'});
  assert.equal(payloads[1].messages[0].text,'【系統待辦】\n新公告');
  await c.pushLineMessage('fake','租賃付款通知');
  assert.equal(payloads[2].messages[0].text,'租賃付款通知');
  await c.sendEmailViaSendGrid({title:'租賃付款',body:'請繳租金 8,000 元',html:'<p>請繳租金 8,000 元</p>'});
  assert.equal(emails[0].text,'請繳租金 8,000 元');assert.equal(emails[0].html,'<p>請繳租金 8,000 元</p>');
  const fallback=require('../functions/portalNotificationPolicy').fallbackEmail({...teacherRow,emailFallbackEnabled:true,targetEmail:'test@example.com'}, {lineRejected:true});
  await c.sendEmailViaSendGrid(fallback);
  assert(emails[1].text.startsWith(policy.NOTICE));
 });
