'use strict';
const clean=v=>String(v==null?'':v).trim();
function feeDescription(studentName,lessonDate,amount){return `補簽到行政處理費｜${clean(studentName)}${clean(lessonDate)?'｜原上課日 '+clean(lessonDate):''}｜NT$${Math.abs(Number(amount)||0)}`;}
async function enrichLateAttendanceFees(db,rows){
 return Promise.all(rows.map(async row=>{
  if(row.type!=='late_attendance_fee')return row;
  const id=clean(row.id||row.__id),operationId=clean(row.attendanceOperationId)||(id.startsWith('attendance-fee-')?id.slice(15):'');
  if(!operationId||operationId.includes('/'))return row;
  let name=clean(row.studentName),date=clean(row.lessonDate);
  const snap=await db.collection('coursePortalTeacherAttendancePayroll').doc(operationId).get();
  const pay=snap.exists?snap.data():null;
  if(!pay||clean(pay.teacherId)!==clean(row.teacherId))return {...row,payoutNeedsReview:true};
  name=name||clean(pay.studentName)||(Array.isArray(pay.studentNames)?pay.studentNames.map(clean).filter(Boolean).join('、'):'');date=clean(pay.date)||date;
  return {...row,studentName:name,lessonDate:date,attendanceOperationId:operationId,attendanceSignedAt:pay.createdAt||pay.createdAtText,note:feeDescription(name||'學生待核對',date,row.amount)};
 }));
}
module.exports={feeDescription,enrichLateAttendanceFees};

