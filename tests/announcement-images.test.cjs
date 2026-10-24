const {test}=require('node:test'),assert=require('node:assert/strict');
const {send,emailImages,emailText,retryKey}=require('../functions/announcementImages');
const row={source:'teacher-announcement',queueId:'announcement-123',lineImageUrls:Array.from({length:12},(_,i)=>`https://example.test/${i}.jpg`)};
test('all photos sent in ordered LINE batches with at most five objects; checkpoint after each batch',async()=>{
 const calls=[],progress=[];
 await send({row,to:'target',token:'test',text:'Notice',fetchImpl:async(url,options)=>{calls.push(options);return {ok:true,status:200,text:async()=>''};},checkpoint:async count=>progress.push(count)});
 assert.deepEqual(calls.map(c=>JSON.parse(c.body).messages.length),[5,5,3]);assert.deepEqual(progress,[1,2,3]);
 assert.deepEqual(calls.flatMap(c=>JSON.parse(c.body).messages).filter(m=>m.type==='image').map(m=>m.originalContentUrl),row.lineImageUrls);
 assert.equal(new Set(calls.map(c=>c.headers['X-Line-Retry-Key'])).size,3);
});
test('interrupted delivery resumes from persisted batch; uncertain accepted request uses same retry key',async()=>{
 let done=0;const attempts=[];
 const fetchImpl=async(url,options)=>{attempts.push(options);if(attempts.length===2)throw Error('network');return {ok:true,status:200,text:async()=>''};};
 await assert.rejects(()=>send({row,to:'t',token:'test',text:'n',fetchImpl,checkpoint:async count=>done=count}),/network/);assert.equal(done,1);
 const retry=[];await send({row:{...row,announcementImageBatchesSent:done},to:'t',token:'test',text:'n',fetchImpl:async(url,options)=>{retry.push(options);return{ok:false,status:409,headers:new Headers({'x-line-accepted-request-id':'accepted'}),text:async()=>''};},checkpoint:async count=>done=count});
 assert.equal(retry.length,2);assert.equal(attempts[1].headers['X-Line-Retry-Key'],retry[0].headers['X-Line-Retry-Key']);assert.equal(done,3);
});
test('provider rejection is reported and never checkpoints the failed batch',async()=>{
 let done=0;await assert.rejects(()=>send({row,to:'t',token:'test',text:'n',fetchImpl:async()=>({ok:false,status:429,text:async()=> 'rate limited'}),checkpoint:async()=>done++}),error=>error.lineRejected===true);assert.equal(done,0);
});
test('email contains every photo and plain-text links; URLs are escaped',()=>{
 assert.equal((emailImages(row).match(/<img /g)||[]).length,12);assert.equal(emailText(row).split('\n').length,12);
 assert(emailImages({...row,lineImageUrls:['https://example.test/a?x="&y=2']}).includes('&quot;&amp;'));
 assert.match(retryKey('a',0),/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
});
test('server compression handles a 9 MiB original, bounds preview size and strips metadata',async()=>{
 const sharp=require('sharp'),crypto=require('node:crypto'),{prepare}=require('../functions/announcementImageProcessing');
 const raw=crypto.randomBytes(2400*1800*3),jpeg=await sharp(raw,{raw:{width:2400,height:1800,channels:3}}).jpeg({quality:95}).toBuffer();
 const input=Buffer.concat([jpeg,Buffer.alloc(9*1024*1024-jpeg.length)]),output=await prepare(input),meta=await sharp(output).metadata();
 assert(output.length<=900*1024);assert(meta.width<=2048&&meta.height<=2048);assert.equal(meta.format,'jpeg');assert(!meta.exif);
 await assert.rejects(()=>prepare(Buffer.from('not a picture')));
});

test('queue integration sends every photo by Email and keeps unrelated single-image mail unchanged',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require.resolve('../functions/index.js'),'utf8');
 const start=source.indexOf('async function sendEmailViaGmail('),end=source.indexOf('\nasync function sendEmailViaSendGrid',start);const sent=[];
 const context={require,process:{env:{GMAIL_USER:'test@example.test',GMAIL_APP_PASSWORD:'test'}},clean:v=>String(v||'').trim(),queueTargetEmail:r=>r.targetEmail,queueTitle:r=>r.title,queueBody:r=>r.body,lineImageUrlFromQueue:r=>r.lineImageUrl||'',nodemailer:{createTransport:()=>({sendMail:async message=>{sent.push(message);return{messageId:'test'};}})}};
 context.require=name=>name==='./announcementImages'?require('../functions/announcementImages'):require(name);
 vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nthis.sendMail=sendEmailViaGmail;',context);
 await context.sendMail({...row,title:'公告',body:'內容',targetEmail:'test@example.test'});
 assert.equal((sent[0].html.match(/<img /g)||[]).length,12);assert(sent[0].text.includes('照片 12'));
 await context.sendMail({title:'收據',body:'收據內容',targetEmail:'test@example.test',lineImageUrl:'https://example.test/receipt.jpg'});
 assert.equal((sent[1].html.match(/<img /g)||[]).length,1);assert.equal(sent[1].text,'收據內容');
});
