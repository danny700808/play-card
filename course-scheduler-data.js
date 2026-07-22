(function(global){
  'use strict';

  var FUNCTION_REGION='us-central1';
  var FUNCTION_NAME='loadInjiaoyunEducationPreview';

  function clean(value){return String(value==null?'':value).trim();}
  function numberOf(value){var parsed=Number(value);return Number.isFinite(parsed)?parsed:0;}
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
  function timeToMin(value){var parts=clean(value||'00:00').split(':');return numberOf(parts[0])*60+numberOf(parts[1]);}
  function unique(values){return Array.from(new Set((values||[]).map(clean).filter(Boolean)));}
  function safeId(prefix,value,index){return clean(value)||(prefix+'_'+String(index+1));}

  function teacherPayFor(charge){
    var allot=numberOf(charge&&charge.allot),lessons=Math.max(1,numberOf(charge&&charge.lessons)),tuition=numberOf(charge&&charge.tuition);
    if(allot>0&&allot<=1)return Math.round((tuition/lessons)*allot);
    return Math.round(allot>1?allot:0);
  }

  function chargeLookup(charges){
    var result=new Map();
    (charges||[]).forEach(function(charge){
      var subject=clean(charge.subject);if(!subject)return;
      var existing=result.get(subject);
      if(!existing||numberOf(charge.lessons)>numberOf(existing.lessons))result.set(subject,charge);
    });
    return result;
  }

  function fixedCourseEvents(course,rangeStart,rangeEnd,charges){
    var events=[],start=dateKey(course.date),step=numberOf(course.frequencyWeeks)>=2?14:7,statuses=course.statusByDate||{};
    if(!start||!clean(course.start)||!clean(course.roomId))return events;
    var statusDates=Object.keys(statuses).filter(function(key){return key>=rangeStart&&key<=rangeEnd;}).sort();
    var stop=course.active===false?(statusDates[statusDates.length-1]||''):rangeEnd;
    if(course.active===false&&!stop){
      if(start>=rangeStart&&start<=rangeEnd)stop=start;else return events;
    }
    var cursor=start,guard=0;
    while(cursor<rangeStart&&guard<1500){cursor=shiftDate(cursor,step);guard++;}
    while(cursor<=rangeEnd&&(!stop||cursor<=stop)&&guard<1700){
      events.push(courseEvent(course,cursor,statuses[cursor]||'scheduled',charges));
      cursor=shiftDate(cursor,step);guard++;
    }
    statusDates.forEach(function(key){
      if(!events.some(function(event){return event.date===key;}))events.push(courseEvent(course,key,statuses[key],charges));
    });
    return events;
  }

  function courseEvent(course,date,status,charges){
    var subject=clean(course.subjectName)||'未設定科目',charge=charges.get(subject)||{},studentNames=unique(course.studentNames),student=studentNames.join('、');
    return {
      id:safeId('course',course.id,0)+'@'+date,
      sourceCourseId:clean(course.id),date:date,roomId:clean(course.roomId),start:clean(course.start)||'10:00',
      duration:Math.max(30,numberOf(course.duration)||60),type:clean(course.type)||'fixed',
      frequency:numberOf(course.frequencyWeeks)>=2?'biweekly':course.type==='fixed'?'weekly':'once',
      student:student||'未指定學生',studentIds:Array.isArray(course.studentIds)?course.studentIds:[],
      teacher:clean(course.teacherName),teacherId:clean(course.teacherId),subject:subject,subjectId:clean(course.subjectId),
      status:clean(status)||'scheduled',fee:Math.round(numberOf(charge.tuition)/Math.max(1,numberOf(charge.lessons))),
      salary:teacherPayFor(charge),note:clean(course.note),readOnly:true,createdAt:''
    };
  }

  function oneOffCourseEvent(course,charges){
    return courseEvent(Object.assign({},course,{frequencyWeeks:0}),dateKey(course.date),
      clean(course.statusByDate&&course.statusByDate[dateKey(course.date)])||'scheduled',charges);
  }

  function rentalEvent(row,index){
    return {
      id:safeId('rental',row.id,index)+'@'+dateKey(row.date),date:dateKey(row.date),roomId:clean(row.roomId),
      start:clean(row.start)||'10:00',duration:Math.max(30,numberOf(row.duration)||60),type:'rental',frequency:'once',
      student:clean(row.clientName)||'教室租用',teacher:'',subject:'教室租用',status:clean(row.status)||'scheduled',
      fee:numberOf(row.amount),salary:0,note:clean(row.note),readOnly:true,createdAt:''
    };
  }

  function buildState(payload,anchorDate){
    payload=payload&&typeof payload==='object'?payload:{};
    var anchor=dateKey(anchorDate)||todayKey(),rangeStart=shiftDate(anchor,-240),rangeEnd=shiftDate(anchor,420);
    var charges=chargeLookup(payload.charges||[]),events=[];
    (payload.fixedCourses||[]).forEach(function(course){events=events.concat(fixedCourseEvents(course,rangeStart,rangeEnd,charges));});
    (payload.temporaryCourses||[]).forEach(function(course){
      var date=dateKey(course.date);if(date&&date>=rangeStart&&date<=rangeEnd)events.push(oneOffCourseEvent(course,charges));
    });
    (payload.roomRentals||[]).forEach(function(row,index){
      var date=dateKey(row.date);if(date&&date>=rangeStart&&date<=rangeEnd)events.push(rentalEvent(row,index));
    });

    var rooms=(payload.rooms||[]).map(function(room,index){return {id:safeId('room',room.id,index),name:clean(room.name)||('教室 '+(index+1)),note:clean(room.note)};});
    var roomIds=new Set(rooms.map(function(room){return room.id;}));
    (payload.fixedCourses||[]).concat(payload.temporaryCourses||[],payload.roomRentals||[]).forEach(function(row,index){
      var id=clean(row.roomId);if(!id||roomIds.has(id))return;roomIds.add(id);rooms.push({id:id,name:clean(row.roomName)||('未命名教室 '+(index+1)),note:''});
    });

    var students=(payload.students||[]).map(function(row,index){
      return {id:safeId('student',row.id,index),name:clean(row.name)||'未命名學生',phone:clean(row.phone),line:row.line===true?true:row.line===false?false:null,
        active:row.active!==false,subject:clean(row.subject),teacher:clean(row.teacher),remaining:numberOf(row.remaining),tuition:numberOf(row.tuition),paid:numberOf(row.paid),expiry:clean(row.expiry),note:clean(row.note)};
    });
    var teachers=(payload.teachers||[]).map(function(row,index){
      return {id:safeId('teacher',row.id,index),name:clean(row.name)||'未命名老師',phone:clean(row.phone),subjects:unique(row.subjects),active:row.active!==false,
        reward:numberOf(row.reward),deduction:numberOf(row.deduction),note:clean(row.note)};
    });
    var chargePlans=(payload.charges||[]).map(function(row,index){
      return {id:safeId('charge',row.id,index),subject:clean(row.subject)||'未分類',name:clean(row.name)||'未命名方案',lessons:numberOf(row.lessons),tuition:numberOf(row.tuition),teacherPay:teacherPayFor(row)};
    });
    var subjects=unique((payload.subjects||[]).concat(chargePlans.map(function(row){return row.subject;}),events.map(function(row){return row.subject==='教室租用'?'':row.subject;})));
    if(!subjects.length)subjects=['木吉他','鋼琴','電吉他','爵士鼓'];
    if(!rooms.length)rooms=[{id:'room_fallback',name:'未設定教室',note:''}];

    events=events.filter(function(row){return row.date&&row.roomId&&row.start;}).sort(function(left,right){return (left.date+left.start+left.roomId).localeCompare(right.date+right.start+right.roomId);});
    var earliest=events.reduce(function(value,row){return Math.min(value,timeToMin(row.start));},10*60);
    var latest=events.reduce(function(value,row){return Math.max(value,timeToMin(row.start)+numberOf(row.duration));},22*60);
    var startHour=Math.max(6,Math.min(10,Math.floor(earliest/60))),endHour=Math.min(23,Math.max(22,Math.ceil(latest/60)));

    return {
      version:1,currentDate:anchor,settings:{startHour:startHour,endHour:endHour,interval:30},rooms:rooms,subjects:subjects,
      leaveReasons:unique(payload.leaveReasons).length?unique(payload.leaveReasons):['生病','出遊','其他'],chargePlans:chargePlans,
      students:students,teachers:teachers,events:events,logs:[],readOnly:true,dataMode:'migration',
      dataMeta:{runId:clean(payload.runId),loadedAt:clean(payload.loadedAt),version:clean(payload.version),counts:payload.counts||{},rangeStart:rangeStart,rangeEnd:rangeEnd}
    };
  }

  function firebaseFunctions(){
    if(!global.firebase||typeof global.firebase.initializeApp!=='function')throw new Error('Firebase 元件尚未載入，請重新整理後再試。');
    var config=global.APP_CONFIG&&global.APP_CONFIG.FIREBASE_CONFIG;
    if(!config||!config.projectId)throw new Error('找不到 Firebase 專案設定。');
    if(!global.firebase.apps.length)global.firebase.initializeApp(config);
    return global.firebase.app().functions(FUNCTION_REGION);
  }

  async function load(options){
    options=options||{};var pin=clean(options.manualSyncPin);
    if(!pin)throw new Error('請輸入音教雲手動同步密碼。');
    var callable=firebaseFunctions().httpsCallable(FUNCTION_NAME);
    var result=await callable({source:'course-scheduler-preview',manualSyncPin:pin});
    var payload=result&&result.data||{};
    if(!payload.ok)throw new Error('課務資料讀取未完成。');
    return buildState(payload,options.anchorDate);
  }

  global.YouziCoursePreviewData={load:load,buildState:buildState};
})(window);
