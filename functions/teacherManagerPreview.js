'use strict';
// Resolve approved personnel for a manager's read-only preview. This never
// provisions a teacher login, binding, session token, or employee record.
const clean=value=>String(value??'').trim();
const validId=value=>/^[A-Za-z0-9_-]{1,150}$/.test(clean(value));
function eligibleEmployee(row){
 return row&&row.identityType==='external'&&row.profileReviewStatus==='approved'&&
  row.accountStatus==='active'&&row.active!==false&&row.deleted!==true&&row.archived!==true&&
  row.hiddenFromActiveLists!==true&&(!row.employmentStatus||row.employmentStatus==='active')&&
  validId(row.coursePortalTeacherId)&&validId(row.externalTeacherProfileId||row.portalProfileId);
}
async function resolveDocuments(db,documents){
 const byTeacher=new Map();
 for(const doc of documents){const row=doc.data();if(!eligibleEmployee(row))continue;
  const id=clean(row.coursePortalTeacherId),rows=byTeacher.get(id)||[];rows.push({id:doc.id,row});byTeacher.set(id,rows);
 }
 const targets=await Promise.all([...byTeacher].map(async([teacherId,rows])=>{
  if(rows.length!==1)return null;
  const {id:employeeId,row:employee}=rows[0],profileId=clean(employee.externalTeacherProfileId||employee.portalProfileId);
  if(!validId(employeeId)||clean(employee.employeeId||employeeId)!==employeeId)return null;
  const snapshot=await db.collection('externalTeacherProfiles').doc(profileId).get();
  const profile=snapshot.exists?snapshot.data():null;
  if(!profile||profile.status!=='active'||profile.active===false||profile.deleted===true||profile.archived===true||
   clean(profile.employeeId)!==employeeId||clean(profile.coursePortalTeacherId)!==teacherId)return null;
  return {teacherId,employeeId,profileId,employee,profile};
 }));
 return targets.filter(Boolean);
}
async function approvedTeacherTargets(db){
 const snapshot=await db.collection('employees').where('profileReviewStatus','==','approved').get();
 return resolveDocuments(db,snapshot.docs);
}
async function approvedTeacherTarget(db,teacherId){
 if(!validId(teacherId))return null;
 const snapshot=await db.collection('employees').where('coursePortalTeacherId','==',clean(teacherId)).get();
 const targets=await resolveDocuments(db,snapshot.docs);
 return targets.find(row=>row.teacherId===clean(teacherId))||null;
}
module.exports={approvedTeacherTargets,approvedTeacherTarget};
