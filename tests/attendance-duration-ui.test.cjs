const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('teacher-course-portal-v8.js','utf8');
const flow=source.slice(source.indexOf('  function showAttendanceDuration('),source.indexOf('  async function requestAttendanceCancellation('));
function fixture({half=true,confirm=true,lateFee=0}={}){
 const calls=[],saved=[],errors=[];let busy=false;
 const row={id:'lesson',date:'2026-10-09',studentNames:['測試學生'],startTime:'20:00',endTime:'21:00'};
 const c={token:'test',quickContext:{type:'lesson',row},operationKey:r=>r.id,teacherOperations:{busy:()=>busy},dayLabel:x=>x,
  confirm:()=>confirm,showQuick:(title,subtitle,html,context)=>{c.html=html;c.quickContext=context;},
  beginLessonOperation:(r,b)=>{busy=true;return {row:r,context:c.quickContext};},finishLessonOperation:()=>{busy=false;},
  completeLessonOperation:(j,result)=>saved.push(result),failLessonOperation:(j,e)=>errors.push(e),
  invoke:async(name,payload)=>{calls.push({name,payload});return payload.attendancePreview?{attendancePreview:true,halfHourPlan:half,defaultDurationMinutes:60,lateFee}:{ok:true,attendanceDurationMinutes:payload.attendanceDurationMinutes||60};}};
 vm.createContext(c);vm.runInContext(flow,c);return{c,row,calls,saved,errors};
}
test('half-hour click opens choices with 60 minutes selected and never signs before confirmation',async()=>{
 const f=fixture();await f.c.updateAttendance(f.row,{});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'coursePortalTeacherAttendanceV2');assert.equal(f.calls[0].payload.attendancePreview,true);assert.equal(f.saved.length,0);
 assert.match(f.c.html,/value="60" checked/);for(const [minutes,units] of [[30,1],[60,2],[90,3]]){assert.match(f.c.html,new RegExp(minutes+' 分鐘'));assert.match(f.c.html,new RegExp('扣 '+units+' 格'));}
 const context=f.c.quickContext;await f.c.submitAttendance(f.row,{},false,{...context.payload,attendancePreview:false,attendanceDurationMinutes:90});
 assert.equal(f.calls.length,2);assert.equal(f.calls[1].payload.attendanceDurationMinutes,90);assert.equal(f.saved.length,1);assert.equal(f.errors.length,0);
});
test('ordinary-plan confirmation can be cancelled without attendance writes',async()=>{
 const f=fixture({half:false,confirm:false});await f.c.updateAttendance(f.row,{});assert.equal(f.calls.length,1);assert.equal(f.saved.length,0);
});
test('late selector shows administrative fee before committing and retains late status',async()=>{
 const f=fixture({lateFee:50});await f.c.updateLateAttendance(f.row,{});assert.equal(f.calls[0].payload.late,true);assert.match(f.c.html,/NT\$50/);assert.equal(f.saved.length,0);
});
test('failed preview retains the lesson without reporting it as signed',async()=>{
 const f=fixture();f.c.invoke=async()=>{throw Error('offline');};await f.c.updateAttendance(f.row,{});assert.equal(f.saved.length,0);assert.equal(f.errors.length,1);assert.equal(f.c.teacherOperations.busy(),false);
});
