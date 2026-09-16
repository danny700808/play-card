'use strict';
const {applyLessonSettings}=require('./courseLessonSettings');
const CUTOFF='2026-09-15';
const number=v=>Number.isFinite(Number(v))?Number(v):0;
const key=v=>String(v||'').slice(0,10);
const valid=r=>r.active!==false&&!['cancelled','voided','rejected'].includes(r.status);
function buildNativeEducationDays(input){
  const days=new Map(),people=new Map((input.students||[]).map(s=>[s.id,s])),teachers=new Map((input.teachers||[]).map(s=>[s.id,s]));
  function day(date){date=key(date);if(date<CUTOFF||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;if(!days.has(date))days.set(date,{id:'native_'+date,source:'course-portal',dateKey:date,businessDate:date,sessions:[],tuitionReceipts:[],roomRentals:[]});return days.get(date);}
  for(const date of input.existingDates||[])day(date);
  // Payroll is one record per lesson, including group lessons. It is not cash received.
  for(const p of input.payroll||[]){const d=day(p.date);if(!d||!valid(p)||p.status!=='attended')continue;const price=number(p.lessonPrice),teacher=number(p.teacherAmount);d.sessions.push({id:p.id,occurredAt:p.occurredAt||p.date+'T'+(p.startTime||'12:00')+':00+08:00',studentName:p.studentName||'',subject:p.subjectName||'',teacherId:p.teacherId||'',teacherName:p.teacherName||teachers.get(p.teacherId)?.name||'',lessonUnits:number(p.lessonUnits)||1,lessonPrice:price,teacherAmount:teacher,schoolShare:p.schoolShare==null?price-teacher:number(p.schoolShare),allotRate:number(p.allotRate),hourlyFee:number(p.hourlyFee),chargeName:p.planSnapshot?.name||''});}
  const payments=new Map();
  for(const p of input.periods||[]){if(!valid(p))continue;for(const t of p.transactions||[])payments.set(t.id,{...t,studentId:t.studentId||p.studentId,subject:t.subject||p.subjectName||''});}
  for(const t of input.transactions||[])payments.set(t.id,t);
  for(const t of payments.values()){const d=day(t.date);if(!d||!valid(t)||t.status&&t.status!=='confirmed')continue;d.tuitionReceipts.push({id:t.id,paidAt:t.date+'T12:00:00+08:00',studentName:t.studentName||people.get(t.studentId)?.name||'未命名學生',subject:t.subject||'',paymentMethod:t.method||'',amount:(t.type==='refund'?-1:1)*number(t.amount),isRevenue:true});}
  const rentals=new Map();
  for(const r of input.mirrorRentals||[])if(r.sourceActive!==false){const e=r.source||{};if(e.type==='rental')rentals.set(e.id,e);}
  // A schedule mutation replaces its source occurrence; a cancellation must remove its revenue.
  const changes=(input.changes||[]).filter(c=>c.active!==false).sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
  for(const c of changes){const e=c.event||{};if(e.type!=='rental'&&e.portalAction!=='room_booking')continue;for(const [id,r]of rentals)if(r.date===c.sourceDate&&([r.id,r.sourceCourseId,r.fixedCourseId].filter(Boolean).includes(c.sourceEventId)||[r.id,r.sourceCourseId,r.fixedCourseId].filter(Boolean).includes(c.sourceCourseId)))rentals.delete(id);if(c.action!=='cancel'&&valid(e))rentals.set(e.id,{...e,id:e.id,portalChangeId:c.id});}
  for(const b of input.bookings||[]){for(const [id,r]of rentals)if(r.portalBookingId===b.id||r.bookingId===b.id||r.id==='rental-'+b.id)rentals.delete(id);if(valid(b))rentals.set(b.id,{...b,portalBookingId:b.id,sourceId:'rental-'+b.id,type:'rental',rentalFee:b.amount,rentalPaymentStatus:b.paymentStatus});}
  for(const r of applyLessonSettings([...rentals.values()],input.settings||[])){const d=day(r.date);if(!d||!valid(r)||!['paid','received','已收款','已付款'].includes(r.rentalPaymentStatus||r.paymentStatus))continue;d.roomRentals.push({id:r.id,startAt:r.date+'T'+(r.startTime||r.start||'12:00')+':00+08:00',clientName:r.clientName||'',roomName:r.roomName||'',amount:number(r.rentalFee??r.amount)});}
  return [...days.values()].sort((a,b)=>a.dateKey.localeCompare(b.dateKey)).map(d=>{for(const k of ['sessions','tuitionReceipts','roomRentals'])d[k].sort((a,b)=>String(a.id).localeCompare(String(b.id)));const sum=(rows,k)=>rows.reduce((s,r)=>s+number(r[k]),0);d.summary={lessonCount:d.sessions.length,lessonGross:sum(d.sessions,'lessonPrice'),teacherPayable:sum(d.sessions,'teacherAmount'),schoolShare:sum(d.sessions,'schoolShare'),tuitionReceived:sum(d.tuitionReceipts,'amount'),roomRentalReceived:sum(d.roomRentals,'amount')};return d;});
}
module.exports={CUTOFF,buildNativeEducationDays};
