'use strict';
const crypto=require('node:crypto');
const {findAccount}=require('./employeeAuth');
function createEmployeeRegistration({db,FieldValue,notify}){
  return async data=>{
    const clean=value=>String(value==null?'':value).trim(),email=clean(data.email).toLowerCase(),name=clean(data.name);
    if(!name||!/^\S+@\S+\.\S+$/.test(email)||JSON.stringify(data).length>30000)throw Error('請完整填寫姓名與 Email。');
    if(await findAccount(db,email))return {ok:false,message:'這個 Email 已有帳號或申請，請登入或聯絡管理者確認。'};
    const employeeId='EMP_'+crypto.randomBytes(12).toString('hex'),identityType=data.identityType==='parttime'||data.isPartTime===true?'parttime':'staff';
    const row={employeeId,name,email,role:'staff',identityType,isPartTime:identityType==='parttime',accountStatus:'pending',password:'',lineUserId:'',lineNotifyEnabled:false,createdAt:FieldValue.serverTimestamp(),source:'employee-registration-server'};
    for(const field of ['idNumber','birthDate','mobilePhone','emergencyContact','emergencyPhone'])row[field]=clean(data[field]).slice(0,500);
    row.address=clean(data.contactAddress||data.address).slice(0,1000);row.hireDate=clean(data.hireDate||data.joinDate).slice(0,30);
    // A separate email reservation makes concurrent submissions create one account.
    const reservation=db.collection('employeeRegistrationKeys').doc(crypto.createHash('sha256').update(email).digest('hex'));
    await db.runTransaction(async tx=>{if((await tx.get(reservation)).exists)throw Error('註冊申請已送出，請勿重複提交。');tx.create(reservation,{employeeId,createdAt:FieldValue.serverTimestamp()});tx.create(db.collection('employees').doc(employeeId),row);
      await notify({title:'新員工註冊申請',body:'姓名：'+name+'\n請至員工管理審核。',source:'employee-registration'},tx);
    });
    return {ok:true,message:'註冊申請已送出，待主管審核。'};
  };
}
module.exports={createEmployeeRegistration};
