const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const src=fs.readFileSync('functions/coursePortal.js','utf8');
const helpers=src.slice(src.indexOf('function suspensionAppliesToEvent('),src.indexOf('function verifiedScheduleDates('));
const check=src.slice(src.indexOf('const dynamicConflict ='),src.indexOf('if (storedPending || dynamicConflict)'));
function conflict(stop={},otherPatch={}) {
 const candidate={date:'2026-09-16',start:'17:00',end:'18:00',teacherId:'t',roomId:'new',studentIds:['newStudent'],subjectId:'piano'};
 const other={...candidate,roomId:'old',studentIds:['stopped'],...otherPatch};
 const ctx={candidate,base:[other],key:candidate.date,roomId:'new',storedPending:false,permanent:[],overlay:[],maps:{},recurringLineages:[],candidateResources:[],irregularModes:[],suspensions:[{teacherId:'t',subjectId:'piano',studentId:'stopped',effectiveDate:'2026-09-16',...stop}],clean:v=>String(v||''),dateKey:v=>v,eventDate:r=>r.date,eventStudentIds:r=>r.studentIds,eventSubjectId:r=>r.subjectId,eventTeacherId:r=>r.teacherId,eventRoomId:r=>r.roomId,eventStart:r=>r.start,eventEnd:r=>r.end,eventBlocksResource:()=>true,replacedTeachingOccurrence:()=>false,applyIrregularStudentModes:r=>r,overlaps:(a,b,c,d)=>a<d&&c<b,sharedResourceConflict:()=>false,eventSharedResourceIds:()=>[],resourceEvent:r=>r};
 vm.createContext(ctx);vm.runInContext(helpers+check+'\nglobalThis.result=dynamicConflict;',ctx);return ctx.result;
}
test('stop effective today releases the old teacher slot',()=>assert.equal(conflict(),undefined));
test('future stop still blocks today',()=>assert.ok(conflict({effectiveDate:'2026-09-17'})));
test('different subject stop does not release an active class',()=>assert.ok(conflict({subjectId:'violin'})));
test('one stopped group member does not release remaining students teacher slot',()=>assert.ok(conflict({}, {studentIds:['stopped','active']})));
test('adjacent lessons do not conflict',()=>assert.equal(conflict({effectiveDate:'2026-09-17'},{start:'18:00',end:'19:00'}),undefined));
