'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('vm'),fs=require('fs');
const source=fs.readFileSync(require('path').join(__dirname,'../functions/coursePortal.js'),'utf8');
function fixture({future=false,stale=false}={}){
 const writes=[],date=future?'2026-09-17':'2026-09-16';
 const event={id:'rental',sourceId:'rental',date,type:'rental',teacherId:'',status:'scheduled'};
 const context={clean:v=>String(v||'').trim(),dateKey:v=>v,readScheduleVersion:async()=>1,
 scheduleBundle:async(a,b,t,options)=>{assert.equal(a,date);assert.equal(b,date);assert.equal(options.occupancyOnly,true);return {resourceEvents:[event]};},
 hash:v=>v,scheduleVersionRef:()=>({version:true}),assertScheduleWritable:()=>{},currentTaipeiDay:()=> '2026-09-16',FieldValue:{serverTimestamp:()=>1},HttpsError:class extends Error{constructor(code,message){super(message);this.code=code;}},
 db:{collection:()=>({doc:id=>({id})}),runTransaction:async work=>work({get:async r=>({exists:!!r.version,data:()=>r.version?{version:stale?2:1}:{}}),set:(ref,data)=>writes.push({ref,data})})}};
 vm.createContext(context);const start=source.indexOf('async function adminSaveLessonSettings(');vm.runInContext(source.slice(start,source.indexOf('\n}',start)+2),context);return {context,writes,date};
}
test('rental check-in and cancellation return committed status and scope reads to occupancy',async()=>{
 for(const status of ['attended','scheduled']){const f=fixture();const result=await f.context.adminSaveLessonSettings({date:f.date,sourceEventId:'rental',kind:'rentalStatus',status});assert.equal(result.fields.status,status);assert.equal(f.writes[0].data.fields.status,status);assert.equal(f.writes.length,2);}
});
test('future rental check-in and stale-version write fail without committing status',async()=>{
 for(const options of [{future:true},{stale:true}]){const f=fixture(options);await assert.rejects(f.context.adminSaveLessonSettings({date:f.date,sourceEventId:'rental',kind:'rentalStatus',status:'attended'}));assert.equal(f.writes.length,0);}
});

test('online rental check-in reads just the booking, without rebuilding the schedule',async()=>{
 const f=fixture(),c=f.context;let reads=0;
 c.scheduleBundle=async()=>{throw Error('must not load full schedule');};
 c.resourceEvent=row=>({...row,sourceId:row.id,studentIds:[]});
 c.db.collection=name=>({doc:id=>({id,get:async()=>{reads++;assert.equal(name,'coursePortalRoomBookings');return {exists:true,data:()=>({date:f.date,active:true,status:'confirmed',roomId:'r',startTime:'13:00',endTime:'14:00'})};}})});
 const result=await c.adminSaveLessonSettings({date:f.date,sourceEventId:'booking',bookingId:'booking',kind:'rentalStatus',status:'attended'});
 assert.equal(result.fields.status,'attended');assert.equal(reads,1);assert.equal(f.writes.length,2);
 await assert.rejects(c.adminSaveLessonSettings({date:f.date,sourceEventId:'other',bookingId:'booking',kind:'rentalStatus',status:'attended'}),/不一致/);
});
