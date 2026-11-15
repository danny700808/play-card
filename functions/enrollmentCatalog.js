'use strict';
const {mergeSubjectRows}=require('./courseSubjectCatalog');
const clean=v=>String(v==null?'':v).trim();
// Public course content only. Personnel, commissions and registration records
// are deliberately outside this reader. Every offering references one shared ID.
function createEnrollmentCatalog({db}){
 return async function read(){
  const [mirror,catalog,offerings]=await Promise.all([
   db.collection('opsEducationMirrorSubjects').where('sourceActive','==',true).get(),
   db.collection('coursePortalSubjectCatalog').get(),
   db.collection('coursePortalEnrollmentCourses').where('active','==',true).get()
  ]);
  const subjects=new Map(mergeSubjectRows(mirror.docs.map(d=>({...d.data().source})),catalog.docs)
   .filter(s=>s.active!==false&&s.name!=='鼓').map(s=>[s.id,s]));
  const courses=offerings.docs.map(doc=>{
   const row=doc.data(),subject=subjects.get(clean(row.subjectId));
   if(!subject)return null;
   const options=(Array.isArray(row.options)?row.options:[]).map(p=>({
    id:clean(p.id),name:clean(p.name),price:clean(p.price),lessons:Number(p.lessons),people:Number(p.people)
   })).filter(p=>p.id&&p.name&&/^\d+(?:～\d+)?$/.test(p.price)&&p.lessons>0&&Number.isInteger(p.lessons)&&p.people>0);
   const image=clean(row.image);
   if(!options.length||!/^assets\/course-\d{2}\.jpg$/.test(image))return null;
   return {id:Number(row.id),subjectId:subject.id,subjectName:subject.name,name:clean(row.name)||subject.name,
    category:clean(row.category),image,options,trial:row.trial===true,sort:Number(row.sort||0)};
  }).filter(Boolean).sort((a,b)=>a.sort-b.sort||a.id-b.id);
  return {ok:true,schemaVersion:1,bindingRequired:true,courses};
 };
}
module.exports={createEnrollmentCatalog};
