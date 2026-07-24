(function(global){
  'use strict';

  var FUNCTION_REGION='us-central1';
  var LOAD_FUNCTION_NAME='loadInjiaoyunEducationMirror';
  var SYNC_FUNCTION_NAME='syncInjiaoyunEducationMirrorNow';

  function clean(value){return String(value==null?'':value).trim();}
  function numberOf(value){var parsed=Number(value);return Number.isFinite(parsed)?parsed:0;}
  function array(value){return Array.isArray(value)?value:[];}
  function unique(values){return Array.from(new Set(array(values).map(clean).filter(Boolean)));}
  function safeId(prefix,value,index){return clean(value)||(prefix+'_'+String(index+1));}
  function dateKey(value){
    var text=clean(value),match=text.match(/^(\d{4}-\d{2}-\d{2})/);
    if(match)return match[1];
    var date=new Date(value);if(!Number.isFinite(date.getTime()))return '';
    return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  }
  function shiftDate(key,days){
    var date=new Date(key+'T12:00:00');date.setDate(date.getDate()+Number(days||0));
    return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  }
  function todayKey(){return dateKey(new Date());}
  function weekdayKey(value){var key=dateKey(value),date=new Date(key+'T12:00:00'),names=['sun','mon','tue','wed','thu','fri','sat'];return key&&Number.isFinite(date.getTime())?names[date.getDay()]:'';}
  function recurringAnchorDate(sourceDate,statusDates){
    var dates=array(statusDates).map(dateKey).filter(Boolean).sort(),source=dateKey(sourceDate);if(!dates.length)return source;
    var counts={};dates.forEach(function(date){var day=weekdayKey(date);if(day)counts[day]=(counts[day]||0)+1;});
    var dominant=Object.keys(counts).sort(function(left,right){return counts[right]-counts[left];})[0]||'';
    if(source&&weekdayKey(source)===dominant)return source;
    return dates.find(function(date){return weekdayKey(date)===dominant;})||source||dates[0];
  }
  function timeToMin(value){var parts=clean(value||'00:00').split(':');return numberOf(parts[0])*60+numberOf(parts[1]);}
  function clone(value){return JSON.parse(JSON.stringify(value==null?{}:value));}

  function makeSubjectRows(payload){
    var rows=[],byId=new Map(),byName=new Map();
    function add(value,index){
      var source=typeof value==='string'?{name:value}:value||{},name=clean(source.name||source.subject),id=safeId('subject',source.id,index);
      if(!name)return null;
      if(byId.has(id))return byId.get(id);
      if(byName.has(name))return byName.get(name);
      var row={id:id,name:name,sort:numberOf(source.sort)||rows.length+1,active:source.active!==false};
      rows.push(row);byId.set(id,row);byName.set(name,row);return row;
    }
    array(payload.subjects).forEach(add);
    array(payload.feePlans||payload.charges).forEach(function(row,index){add({id:row.subjectId,name:row.subjectName||row.subject},1000+index);});
    array(payload.fixedCourses).concat(array(payload.temporaryCourses)).forEach(function(row,index){add({id:row.subjectId,name:row.subjectName},2000+index);});
    return {rows:rows,byId:byId,byName:byName,ensure:add};
  }

  function normalizeFeePlans(payload,subjects){
    var source=array(payload.feePlans).length?payload.feePlans:array(payload.charges);
    return source.map(function(row,index){
      var subject=subjects.byId.get(clean(row.subjectId))||subjects.byName.get(clean(row.subjectName||row.subject))||subjects.ensure({id:row.subjectId,name:row.subjectName||row.subject},3000+index);
      var lessons=numberOf(row.lessonCount||row.lessons||row.courseNumber)||4;
      var amount=numberOf(row.amount||row.tuition||row.money),splitValue=numberOf(row.splitValue!=null?row.splitValue:row.allot);
      return {
        id:safeId('fee',row.id,index),subjectId:subject?subject.id:'',sort:numberOf(row.sort)||index+1,
        name:clean(row.name)||'未命名方案',amount:amount,lessonCount:lessons,
        splitType:clean(row.splitType)||(splitValue>0&&splitValue<=1?'ratio':'fixed'),splitValue:splitValue,
        leaveNoDeduct:row.leaveNoDeduct!=null?row.leaveNoDeduct===true:row.leaveDelay!==false,
        expiryDays:numberOf(row.expiryDays),active:row.active!==false&&row.off!==true,listed:row.listed!==false
      };
    });
  }

  function normalizeTeachers(payload,subjects){
    return array(payload.teachers).map(function(row,index){
      var ids=unique(row.subjectIds);
      array(row.subjects).forEach(function(value,subjectIndex){
        var item=typeof value==='string'?subjects.byName.get(clean(value)):subjects.byId.get(clean(value&&value.id));
        if(!item)item=subjects.ensure(typeof value==='string'?{name:value}:value,4000+index*100+subjectIndex);
        if(item)ids.push(item.id);
      });
      return {id:safeId('teacher',row.id,index),name:clean(row.name)||'未命名老師',phone:clean(row.phone),subjectIds:unique(ids),reward:numberOf(row.reward),deduction:numberOf(row.deduction),note:clean(row.note),active:row.active!==false};
    });
  }

  function normalizeRooms(payload){
    var rows=[],seen=new Set();
    function add(room,index){
      room=room||{};var id=safeId('room',room.id,index);if(seen.has(id))return;seen.add(id);
      rows.push({id:id,name:clean(room.name)||('教室 '+(index+1)),publicName:clean(room.publicName),note:clean(room.note),rentalFee:numberOf(room.rentalFee),sort:numberOf(room.sort)||rows.length+1,active:room.active!==false,policies:room.policies&&typeof room.policies==='object'?room.policies:{}});
    }
    array(payload.rooms).forEach(add);
    array(payload.fixedCourses).concat(array(payload.temporaryCourses),array(payload.roomRentals)).forEach(function(row,index){if(clean(row.roomId)&&!seen.has(clean(row.roomId)))add({id:row.roomId,name:row.roomName},1000+index);});
    if(!rows.length)add({id:'room_fallback',name:'未設定教室'},0);
    return rows;
  }

  function normalizeStudents(payload){
    return array(payload.students).map(function(row,index){
      return {id:safeId('student',row.id,index),name:clean(row.name)||'未命名學生',phone:clean(row.phone),line:row.line===true?true:row.line===false?false:null,note:clean(row.note),active:row.active!==false};
    });
  }

  function planSnapshot(row,feeById){
    if(row.planSnapshot&&typeof row.planSnapshot==='object'&&Object.keys(row.planSnapshot).length)return clone(row.planSnapshot);
    var plan=feeById.get(clean(row.planId));
    return plan?clone(plan):{name:clean(row.planName||row.chargeName),amount:numberOf(row.expectedAmount||row.amount),lessonCount:numberOf(row.lessonCount)||4,splitType:clean(row.splitType),splitValue:numberOf(row.splitValue),leaveNoDeduct:row.leaveNoDeduct!==false};
  }

  function normalizeTransactions(rows,periodId){
    return array(rows).map(function(row,index){return {id:safeId('transaction',row.id,index),type:clean(row.type)==='refund'?'refund':'payment',date:dateKey(row.date||row.created),amount:Math.abs(numberOf(row.amount||row.money)),method:clean(row.method||row.payType||row.paymentMethod)||'未註明',note:clean(row.note||row.remark),periodId:periodId};});
  }

  function normalizePeriods(payload,feePlans){
    var feeById=new Map(feePlans.map(function(row){return [row.id,row];}));
    var source=array(payload.tuitionPeriods);
    if(!source.length){
      source=array(payload.students).filter(function(row){return clean(row.id)&&(numberOf(row.tuition)||numberOf(row.remaining));}).map(function(row,index){return {id:'legacy_period_'+index,studentId:row.id,subjectId:row.subjectId,subjectName:row.subject,teacherId:row.teacherId,periodNo:1,lessonCount:numberOf(row.lessonCount)||numberOf(row.remaining),usedCount:0,expectedAmount:numberOf(row.tuition),transactions:numberOf(row.paid)?[{id:'legacy_pay_'+index,type:'payment',amount:row.paid,date:row.updated,method:'既有資料'}]:[]};});
    }
    return source.map(function(row,index){
      var id=safeId('period',row.id,index),snapshot=planSnapshot(row,feeById),lessons=numberOf(row.lessonCount)||numberOf(snapshot.lessonCount)||4;
      return {id:id,sourcePaymentId:clean(row.sourcePaymentId||row.paymentId||row.id),studentId:clean(row.studentId),subjectId:clean(row.subjectId),teacherId:clean(row.teacherId),planId:clean(row.planId),periodNo:numberOf(row.periodNo)||index+1,startDate:dateKey(row.startDate||row.created),expiryDate:dateKey(row.expiryDate),lessonCount:lessons,usedCount:numberOf(row.usedCount),expectedAmount:numberOf(row.expectedAmount||row.amount||snapshot.amount),discount:numberOf(row.discount),status:clean(row.status)||'active',note:clean(row.note),transactions:normalizeTransactions(row.transactions,id),planSnapshot:snapshot};
    });
  }

  function periodResolver(periods){
    var bySource=new Map(),byStudentSubject=new Map();
    function isNewer(row,prior){
      if(!prior)return true;
      var periodDiff=numberOf(row.periodNo)-numberOf(prior.periodNo);
      if(periodDiff!==0)return periodDiff>0;
      var dateDiff=dateKey(row.startDate).localeCompare(dateKey(prior.startDate));
      if(dateDiff!==0)return dateDiff>0;
      return clean(row.id).localeCompare(clean(prior.id))>0;
    }
    periods.forEach(function(row){
      if(row.sourcePaymentId)bySource.set(row.sourcePaymentId,row);
      var key=row.studentId+'|'+row.subjectId,prior=byStudentSubject.get(key);
      if(isNewer(row,prior))byStudentSubject.set(key,row);
    });
    return function(course){
      var ids=unique(array(course.studentPaymentIds).concat([course.studentPaymentId])),matched=[];
      ids.forEach(function(id){if(bySource.has(id))matched.push(bySource.get(id));});
      matched.sort(function(a,b){return isNewer(a,b)?-1:isNewer(b,a)?1:0;});
      if(matched.length)return matched[0].id;
      var studentId=array(course.studentIds)[0]||'',key=studentId+'|'+clean(course.subjectId),fallback=byStudentSubject.get(key);return fallback&&fallback.id||'';
    };
  }

  function courseEvent(course,date,status,resolvePeriod){
    return {id:safeId('course',course.id,0)+'@'+date,sourceCourseId:clean(course.id),seriesId:clean(course.id),date:date,roomId:clean(course.roomId),start:clean(course.start),duration:Math.max(30,numberOf(course.duration)||60),type:clean(course.type)||'fixed',frequency:numberOf(course.frequencyWeeks)>=2?'biweekly':course.type==='fixed'?'weekly':'once',studentIds:unique(course.studentIds),teacherId:clean(course.teacherId),subjectId:clean(course.subjectId),tuitionPeriodId:resolvePeriod(course),clientName:'',rentalFee:0,status:clean(status)||'scheduled',note:clean(course.note),readOnly:true,source:'injiaoyun-migration'};
  }

  // 請假要保留成半透明藍色固定課；只有真正取消／停課才不顯示。
  function cancelledCourseStatus(status){
    var value=clean(status).toLowerCase();
    return ['cancel','cancelled','canceled','suspended','stopped','inactive','取消','停課'].indexOf(value)>=0;
  }

  function fixedCourseEvents(course,rangeStart,rangeEnd,resolvePeriod){
    var events=[],statuses=course.statusByDate||{},allStatusDates=Object.keys(statuses).map(dateKey).filter(Boolean).sort(),start=recurringAnchorDate(course.date,allStatusDates),step=numberOf(course.frequencyWeeks)>=2?14:7;
    if(!start||!clean(course.start)||!clean(course.roomId))return events;
    var recurrenceEnd=dateKey(course.recurrenceEndDate),stop=recurrenceEnd||(
      course.active===false?(dateKey(course.stopDate)||allStatusDates[allStatusDates.length-1]||start):rangeEnd
    ),cursor=start,guard=0;
    if(stop<start)stop=start;
    while(cursor<rangeStart&&guard<1500){cursor=shiftDate(cursor,step);guard++;}
    while(cursor<=rangeEnd&&cursor<=stop&&guard<1700){
      var status=statuses[cursor]||'scheduled';
      if(!cancelledCourseStatus(status))events.push(courseEvent(course,cursor,status,resolvePeriod));
      cursor=shiftDate(cursor,step);guard++;
    }
    return events;
  }

  function normalizeEvents(payload,periods,rangeStart,rangeEnd){
    var resolvePeriod=periodResolver(periods),events=[];
    array(payload.fixedCourses).forEach(function(row){events=events.concat(fixedCourseEvents(row,rangeStart,rangeEnd,resolvePeriod));});
    array(payload.temporaryCourses).filter(function(row){return row.active!==false;}).forEach(function(row){var date=dateKey(row.date);if(date&&clean(row.start)&&clean(row.roomId)&&date>=rangeStart&&date<=rangeEnd)events.push(courseEvent(row,date,clean(row.statusByDate&&row.statusByDate[date])||'scheduled',resolvePeriod));});
    array(payload.roomRentals).forEach(function(row,index){var date=dateKey(row.date);if(date&&clean(row.start)&&clean(row.roomId)&&date>=rangeStart&&date<=rangeEnd)events.push({id:safeId('rental',row.id,index)+'@'+date,seriesId:'',date:date,roomId:clean(row.roomId),start:clean(row.start),duration:Math.max(30,numberOf(row.duration)||60),type:'rental',frequency:'once',studentIds:[],teacherId:'',subjectId:'',tuitionPeriodId:'',clientName:clean(row.clientName)||'教室租用',rentalFee:numberOf(row.amount||row.rentalFee),status:clean(row.status)||'scheduled',note:clean(row.note),readOnly:true});});
    var auditedEvents=array(payload.events).map(function(row,index){var normalized=Object.assign({id:safeId('event',row.id,index),seriesId:'',date:'',roomId:'',start:'',duration:60,type:'fixed',frequency:'once',studentIds:[],teacherId:'',subjectId:'',tuitionPeriodId:'',clientName:'',rentalFee:0,note:'',status:'scheduled',readOnly:true},row,{date:dateKey(row.date),start:clean(row.start),studentIds:unique(row.studentIds)});if(!clean(normalized.tuitionPeriodId))normalized.tuitionPeriodId=resolvePeriod(normalized);return normalized;});
    var coveredDates=unique(array(payload.dataQuality&&payload.dataQuality.auditCoveredDates).map(dateKey).filter(Boolean));
    if(!coveredDates.length&&auditedEvents.length)coveredDates=unique(auditedEvents.map(function(row){return row.date;}));
    if(coveredDates.length){
      var coveredSet=new Set(coveredDates);
      events=events.filter(function(row){return !coveredSet.has(row.date);}).concat(auditedEvents);
    }
    events=events.filter(function(row){return row.date&&row.roomId&&row.start&&row.date>=rangeStart&&row.date<=rangeEnd&&!cancelledCourseStatus(row.status);});
    // 有效固定課即使被請假、單堂或租用覆蓋仍保留；只在畫面上重疊，不可從資料刪除。
    return events.sort(function(left,right){return (left.date+left.start+left.roomId).localeCompare(right.date+right.start+right.roomId);});
  }

  function normalizeAttendance(payload,events,periods){
    var eventBySourceDate=new Map();events.forEach(function(event){eventBySourceDate.set(clean(event.sourceCourseId)+'|'+event.date,event);});
    var rows=array(payload.attendance).map(function(row,index){
      var event=eventBySourceDate.get(clean(row.sourceCourseId)+'|'+dateKey(row.date)),periodId=clean(row.periodId||row.tuitionPeriodId)||(event&&event.tuitionPeriodId)||'',period=periods.find(function(item){return item.id===periodId;})||{},status=clean(row.status)||'attended';
      return {id:safeId('attendance',row.id,index),eventId:clean(row.eventId)||(event&&event.id)||'',studentId:clean(row.studentId)||(event&&event.studentIds[0])||'',periodId:periodId,status:status,date:dateKey(row.date)||(event&&event.date)||'',lessonNo:numberOf(row.lessonNo),teacherId:clean(row.teacherId)||(event&&event.teacherId)||'',deducted:row.deducted!=null?row.deducted===true:(status==='attended'||status==='absent'||(status==='leave'&&period.id&&!(period.planSnapshot||{}).leaveNoDeduct)),reasonId:clean(row.reasonId)};
    });
    if(!rows.length)events.filter(function(event){return event.type!=='rental'&&event.status!=='scheduled'&&event.status!=='cancelled';}).forEach(function(event,index){rows.push({id:'derived_attendance_'+index,eventId:event.id,studentId:event.studentIds[0]||'',periodId:event.tuitionPeriodId,status:event.status,date:event.date,lessonNo:0,teacherId:event.teacherId,deducted:event.status==='attended'||event.status==='absent',reasonId:''});});
    return rows;
  }

  function normalizeLeaveReasons(payload){
    var source=array(payload.leaveReasons);if(!source.length)source=['生病','出遊','其他'];
    return source.map(function(row,index){return typeof row==='string'?{id:'leave_'+index,name:row,sort:index+1,active:true}:{id:safeId('leave',row.id,index),name:clean(row.name)||'其他',sort:numberOf(row.sort)||index+1,active:row.active!==false};});
  }

  function buildState(payload,anchorDate){
    payload=payload&&typeof payload==='object'?payload:{};
    var anchor=dateKey(anchorDate)||todayKey(),rangeStart=shiftDate(anchor,-240),rangeEnd=shiftDate(anchor,420),subjects=makeSubjectRows(payload),feePlans=normalizeFeePlans(payload,subjects),students=normalizeStudents(payload),teachers=normalizeTeachers(payload,subjects),rooms=normalizeRooms(payload),periods=normalizePeriods(payload,feePlans),events=normalizeEvents(payload,periods,rangeStart,rangeEnd),attendance=normalizeAttendance(payload,events,periods);
    periods.forEach(function(period){period.usedCount=attendance.filter(function(row){return row.periodId===period.id&&row.deducted===true;}).length;});
    var earliest=events.reduce(function(value,row){return Math.min(value,timeToMin(row.start));},10*60),latest=events.reduce(function(value,row){return Math.max(value,timeToMin(row.start)+numberOf(row.duration));},22*60);
    var visibleWeekdays=events.reduce(function(counts,row){var date=new Date(row.date+'T12:00:00'),day=['sun','mon','tue','wed','thu','fri','sat'][date.getDay()];counts[day]=(counts[day]||0)+1;return counts;},{sun:0,mon:0,tue:0,wed:0,thu:0,fri:0,sat:0});
    return {version:3,currentDate:anchor,settings:{startHour:Math.max(6,Math.min(10,Math.floor(earliest/60))),endHour:Math.min(24,Math.max(22,Math.ceil(latest/60))),interval:30,defaultLessons:4},rooms:rooms,subjects:subjects.rows,teachers:teachers,feePlans:feePlans,students:students,tuitionPeriods:periods,events:events,attendance:attendance,leaveReasons:normalizeLeaveReasons(payload),teacherAdjustments:array(payload.teacherAdjustments),clipboard:null,readOnly:true,dataMode:'migration',dataMeta:{runId:clean(payload.runId),loadedAt:clean(payload.loadedAt),version:clean(payload.version),counts:payload.counts||{},dataQuality:Object.assign({},payload.dataQuality||{},{visibleEventWeekdays:visibleWeekdays}),rangeStart:rangeStart,rangeEnd:rangeEnd}};
  }

  function firebaseFunctions(){
    if(!global.firebase||typeof global.firebase.initializeApp!=='function')throw new Error('Firebase 元件尚未載入，請重新整理後再試。');
    var config=global.APP_CONFIG&&global.APP_CONFIG.FIREBASE_CONFIG;if(!config||!config.projectId)throw new Error('找不到 Firebase 專案設定。');
    if(!global.firebase.apps.length)global.firebase.initializeApp(config);return global.firebase.app().functions(FUNCTION_REGION);
  }

  async function call(name,data,options){
    var callable=firebaseFunctions().httpsCallable(name,options||{}),result=await callable(data);
    return result&&result.data||{};
  }

  async function load(options){
    options=options||{};var pin=clean(options.manualSyncPin);if(!pin)throw new Error('請輸入音教雲手動同步密碼。');
    var payload=await call(LOAD_FUNCTION_NAME,{source:'course-scheduler',manualSyncPin:pin});
    if(!payload.ok)throw new Error('課務資料讀取未完成。');return buildState(payload,options.anchorDate);
  }

  async function sync(options){
    options=options||{};var pin=clean(options.manualSyncPin);if(!pin)throw new Error('請輸入音教雲手動同步密碼。');
    var refreshDate=dateKey(options.refreshDate||options.date);
    var result=await call(SYNC_FUNCTION_NAME,{source:'course-scheduler',manualSyncPin:pin,refreshDate:refreshDate},{timeout:600000});
    if(!result.ok)throw new Error('課務同步未完成。');
    return result;
  }

  global.YouziCoursePreviewData={load:load,sync:sync,buildState:buildState};
})(window);
