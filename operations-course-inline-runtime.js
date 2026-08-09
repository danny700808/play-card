(function(){
  'use strict';

  var document=window.__YOUZI_COURSE_INLINE_DOCUMENT__||window.document;

  var FORMAL_CACHE_KEY='youzi.courseScheduler.formalCache.v1';
  var FORMAL_DB_NAME='youzi-course-scheduler';
  var FORMAL_DB_STORE='formalSnapshots';
  var FORMAL_DB_KEY='latest';
  var WORKSPACE_DB_KEY='workspace';
  var PIN_KEY='youzi.injiaoyun.preview.pin';
  var ROOM_ORDER_KEY='youzi.courseScheduler.roomOrder.v1';
  var FEE_ORDER_KEY='youzi.courseScheduler.feeOrder.v1';
  var GUZHENG_RESOURCE_ID='equipment:guzheng';
  var state=null,formalState=null,currentView='calendar',currentStudentId='',currentTeacherId='',studentTab='profile';
  var entityContext={type:'',id:''},policyRoomId='',loadingMigration=false,roomDragId='',roomDropSide='before',feeDragId='',feeDropSide='before';
  var workspaceSaveTimer=0,weekMode=false,weekAnchor='',scheduleDraftAfterStudent=null,returnToScheduleAfterStudent=false,operationRunning=false,embeddedMode=false;
  var teacherPayrollMonthRefreshes={};

  function $(id){return document.getElementById(id);}
  function qs(selector,root){return (root||document).querySelector(selector);}
  function $$(selector,root){return Array.from((root||document).querySelectorAll(selector));}
  function clean(value){return String(value==null?'':value).trim();}
  function numberOf(value){var n=Number(value);return Number.isFinite(n)?n:0;}
  function teacherShareRatio(value){var ratio=numberOf(value);return ratio>1&&ratio<=100?ratio/100:ratio;}
  function signedTeacherAdjustment(row){var type=clean(row&&row.type).toLowerCase(),amount=numberOf(row&&row.amount);return ['deduction','penalty','late_attendance_fee','attendance_cancellation_fee'].indexOf(type)>=0?-Math.abs(amount):amount;}
  function esc(value){return clean(value).replace(/[&<>'"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch];});}
  function uid(prefix){return (prefix||'id')+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);}
  function pad(value){return String(value).padStart(2,'0');}
  function dateKey(value){var date=value instanceof Date?value:new Date(clean(value).slice(0,10)+'T12:00:00');if(!Number.isFinite(date.getTime()))return '';return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());}
  function todayKey(){return dateKey(new Date());}
  function shiftDate(key,days){var d=new Date(key+'T12:00:00');d.setDate(d.getDate()+Number(days||0));return dateKey(d);}
  function zhDate(key){var d=new Date(key+'T12:00:00');return d.getFullYear()+' 年 '+(d.getMonth()+1)+' 月 '+d.getDate()+' 日';}
  function weekdayName(key){return ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][new Date(key+'T12:00:00').getDay()];}
  function weekdayKey(key){return ['sun','mon','tue','wed','thu','fri','sat'][new Date(key+'T12:00:00').getDay()];}
  function defaultDailyHours(){return {sun:{closed:false,start:'10:00',end:'21:00'},mon:{closed:false,start:'12:30',end:'21:00'},tue:{closed:false,start:'12:30',end:'21:00'},wed:{closed:false,start:'12:30',end:'21:00'},thu:{closed:false,start:'12:30',end:'21:00'},fri:{closed:false,start:'12:30',end:'21:00'},sat:{closed:false,start:'10:00',end:'21:00'}};}
  function normalizeDailyHours(input){var defaults=defaultDailyHours(),source=input&&typeof input==='object'?input:{},result={};['sun','mon','tue','wed','thu','fri','sat'].forEach(function(day){var fallback=defaults[day],row=source[day]&&typeof source[day]==='object'?source[day]:{},start=clean(row.start)||fallback.start,end=clean(row.end)||fallback.end,startMin=timeToMin(start),endMin=timeToMin(end);startMin=Math.max(360,Math.min(1410,Math.round(startMin/30)*30));endMin=Math.max(startMin+30,Math.min(1440,Math.round(endMin/30)*30));result[day]={closed:row.closed===true,start:minToTime(startMin),end:endMin===1440?'24:00':minToTime(endMin)};});return result;}
  function overallScheduleRange(hours){var source=normalizeDailyHours(hours),open=Object.keys(source).map(function(day){return source[day];}).filter(function(row){return !row.closed;});if(!open.length)return {start:600,end:1260};return {start:Math.min.apply(null,open.map(function(row){return timeToMin(row.start);})),end:Math.max.apply(null,open.map(function(row){return timeToMin(row.end);}))};}
  function scheduleHoursForDate(date){var hours=normalizeDailyHours(state&&state.settings&&state.settings.dailyHours),row=hours[weekdayKey(date)]||defaultDailyHours()[weekdayKey(date)];return {closed:row.closed===true,start:timeToMin(row.start),end:timeToMin(row.end),startText:row.start,endText:row.end};}
  function timeToMin(value){var parts=clean(value||'00:00').split(':');return numberOf(parts[0])*60+numberOf(parts[1]);}
  function minToTime(value){value=((Number(value)%1440)+1440)%1440;return pad(Math.floor(value/60))+':'+pad(value%60);}
  function money(value){return '$'+Math.round(numberOf(value)).toLocaleString('zh-TW');}
  function unique(values){return Array.from(new Set((values||[]).map(clean).filter(Boolean)));}
  function debounce(fn,wait){var timer;return function(){var args=arguments,that=this;clearTimeout(timer);timer=setTimeout(function(){fn.apply(that,args);},wait||250);};}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function sum(values){return values.reduce(function(total,value){return total+numberOf(value);},0);}
  function bySort(a,b){return numberOf(a.sort)-numberOf(b.sort)||clean(a.name).localeCompare(clean(b.name),'zh-Hant');}
  function chineseNameSort(a,b){return clean(a.name).localeCompare(clean(b.name),'zh-Hant-u-co-stroke');}
  function teacherSort(a,b){return (a.active===false?1:0)-(b.active===false?1:0)||chineseNameSort(a,b);}
  function readSavedOrder(key){try{var rows=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(rows)?rows:[];}catch(_){return [];}}
  function saveOrder(key,rows){try{localStorage.setItem(key,JSON.stringify(rows.map(function(row){return row.id;})));}catch(_){}}
  function applySavedOrder(rows,key){var order=readSavedOrder(key);if(!order.length)return rows;var rank={};order.forEach(function(id,index){rank[id]=index;});return rows.map(function(row,index){return Object.assign({},row,{sort:Object.prototype.hasOwnProperty.call(rank,row.id)?(rank[row.id]+1)*10:numberOf(row.sort)||10000+index});});}
  function urlOption(name){try{return clean(new URLSearchParams(window.location.search).get(name));}catch(_){return '';}}
  function requestedView(){var view=clean(window.__YOUZI_COURSE_INLINE_VIEW__)||urlOption('view');return ['calendar','students','teachers','settings'].indexOf(view)>=0?view:'calendar';}
  function requestPersistentStorage(){
    try{
      if(window.navigator&&window.navigator.storage&&typeof window.navigator.storage.persist==='function'){
        window.navigator.storage.persist().catch(function(){});
      }
    }catch(_){}
  }

  function subjectById(id){return state.subjects.find(function(row){return row.id===id;})||{};}
  function teacherById(id){return state.teachers.find(function(row){return row.id===id;})||{};}
  function roomById(id){return state.rooms.find(function(row){return row.id===id;})||{};}
  function studentById(id){return state.students.find(function(row){return row.id===id;})||{};}
  function periodById(id){return state.tuitionPeriods.find(function(row){return row.id===id;})||{};}
  function feeById(id){return state.feePlans.find(function(row){return row.id===id;})||{};}
  function typeName(type){return {fixed:'固定課',single:'老師調課',rental:'教室租用',trial:'體驗課'}[type]||'課程';}
  function eventSharedResourceIds(event){
    event=event||{};
    var ids=unique((Array.isArray(event.resourceIds)?event.resourceIds:[]).concat(Array.isArray(event.sharedResourceIds)?event.sharedResourceIds:[])),subject=subjectById(event.subjectId);
    var marker=[
      event.useType,event.rentalUseType,event.purposeType,event.useName,event.purpose,event.title,
      event.subjectId,event.subjectName,subject.id,subject.name
    ].map(clean).join(' ').toLowerCase();
    if(/guzheng|古箏/.test(marker))ids.push(GUZHENG_RESOURCE_ID);
    return unique(ids);
  }
  function sharedResourceLabel(resourceId){return resourceId===GUZHENG_RESOURCE_ID?'古箏':'共用設備';}
  function normalizedStatus(status){
    var value=clean(status).toLowerCase();
    if(['attended','checkin','checked-in','已簽到','簽到'].indexOf(value)>=0)return 'attended';
    if(['leave','請假','已請假'].indexOf(value)>=0)return 'leave';
    if(['absent','absence','曠課','缺席'].indexOf(value)>=0)return 'absent';
    if(['cancel','cancelled','canceled','註銷','取消','停課'].indexOf(value)>=0)return 'cancelled';
    return 'scheduled';
  }
  function statusName(status){return {scheduled:'未簽到',attended:'已簽到',leave:'請假',absent:'曠課',cancelled:'註銷',pending_conflict:'待補排'}[normalizedStatus(status)];}
  function rentalRoleName(role){return {student:'學生／家長',teacher:'老師',renter:'一般租用者'}[clean(role)]||'租用者';}
  function rentalPaymentName(status){status=clean(status).toLowerCase();if(['paid','received','已收款','已付款'].indexOf(status)>=0)return '已收款';if(['refunded','退款'].indexOf(status)>=0)return '已退款';return status==='onsite_unpaid'?'現場未收款':'未收款';}
  function rentalStatusName(event){if(event&&event.active===false||normalizedStatus(event&&event.status)==='cancelled')return '已取消';if(['completed','attended','finished'].indexOf(clean(event&&event.status).toLowerCase())>=0)return '已完成';return '預約成立';}
  function isNonOccupyingEvent(event){var status=normalizedStatus(event&&event.status);return status==='leave'||status==='cancelled'||status==='pending_conflict';}
  function hiddenEventStatus(status){var value=clean(status).toLowerCase();return ['cancel','cancelled','canceled','suspended','stopped','inactive','取消','停課'].indexOf(value)>=0;}
  function isHiddenEvent(event){return hiddenEventStatus(event&&event.status);}
  function periodRefunded(period){return sum((period.transactions||[]).filter(function(row){return row.type==='refund';}).map(function(row){return row.amount;}));}
  function periodPaid(period){return sum((period.transactions||[]).map(function(row){return row.type==='refund'?-numberOf(row.amount):numberOf(row.amount);}));}
  function periodNetExpectedAmount(period){var expected=Math.max(0,numberOf(period&&period.expectedAmount)),discount=Math.max(0,numberOf(period&&period.discount)),discountType=clean(period&&(period.discountType||period.planSnapshot&&period.planSnapshot.discountType)).toLowerCase();if(['ratio','amount'].indexOf(discountType)<0)discountType=discount>0&&discount<=1?'ratio':'amount';var discountAmount=discountType==='ratio'?expected*Math.min(1,discount):discount;return Math.max(0,expected-discountAmount);}
  function periodBalance(period){return Math.max(0,periodNetExpectedAmount(period)-periodRefunded(period)-periodPaid(period));}
  function periodRemaining(period){return Math.max(0,numberOf(period.lessonCount)-numberOf(period.voidedLessonCount)-numberOf(period.usedCount));}
  function activeRooms(){return state.rooms.filter(function(row){return row.active!==false;}).sort(bySort);}
  function activeSubjects(){return state.subjects.filter(function(row){return row.active!==false;}).sort(bySort);}
  function roomKindOf(room){var explicit=clean(room&&room.roomKind).toLowerCase(),name=clean(room&&room.name);if(['normal','video','holding'].indexOf(explicit)>=0)return explicit;if(/不定時/.test(name))return 'holding';if(/視訊/.test(name))return 'video';return 'normal';}
  function defaultRentalFeeForRoom(room){return /團練室|展演空間|平台鋼琴|5號鋼琴|五號鋼琴/.test(clean(room&&room.name))?200:100;}
  function applyBusinessRoomDefaults(room){
    if(room.businessPolicyVersion===2)return room;
    var explicitRules=numberOf(room.roomRulesVersion)===1,kind=roomKindOf(room),policies=room.policies&&typeof room.policies==='object'?room.policies:{};
    ['sun','mon','tue','wed','thu','fri','sat'].forEach(function(day){
      if(!policies[day])policies[day]={};
      for(var minute=600;minute<1260;minute+=30){
        var time=minToTime(minute),closed=false,existing=explicitRules&&Object.prototype.hasOwnProperty.call(policies[day],time)?policies[day][time]:null;
        if(!existing)policies[day][time]={blockSchedule:closed,blockRental:closed||kind!=='normal',subjectIds:[]};
      }
    });
    room.policies=policies;
    room.roomKind=kind;
    if(!explicitRules||typeof room.rentable!=='boolean')room.rentable=kind==='normal';
    if(!explicitRules||typeof room.teacherSchedulable!=='boolean')room.teacherSchedulable=true;
    if(!explicitRules)room.rentalFee=defaultRentalFeeForRoom(room);
    room.businessPolicyVersion=2;
    return room;
  }

  function defaultState(){
    var today=todayKey();
    var rooms=[
      {id:'r1',name:'團練室（傳統鼓）',publicName:'團練室',note:'租 200 元',rentalFee:200,sort:1,active:true,policies:{}},
      {id:'r2',name:'展演空間（電子鼓）',publicName:'展演空間',note:'租 200 元',rentalFee:200,sort:2,active:true,policies:{}},
      {id:'r3',name:'鼓教室（電子鼓）',publicName:'鼓教室',note:'租 100 元',rentalFee:100,sort:3,active:true,policies:{}},
      {id:'r4',name:'5號鋼琴＆表演教室',publicName:'5號教室',note:'租 200 元',rentalFee:200,sort:4,active:true,policies:{}},
      {id:'r5',name:'YAMAHA 平台鋼琴教室',publicName:'平台鋼琴教室',note:'租 200 元',rentalFee:200,sort:5,active:true,policies:{}},
      {id:'r6',name:'YAMAHA 直立鋼琴教室',publicName:'直立鋼琴教室',note:'租 100 元',rentalFee:100,sort:6,active:true,policies:{}},
      {id:'r7',name:'KAWAI 直立鋼琴教室',publicName:'KAWAI 教室',note:'租 100 元',rentalFee:100,sort:7,active:true,policies:{}},
      {id:'r8',name:'吉他教室',publicName:'吉他教室',note:'租 100 元',rentalFee:100,sort:8,active:true,policies:{}},
      {id:'r9',name:'錄音室',publicName:'錄音室',note:'租 100 元',rentalFee:100,sort:9,active:true,policies:{}}
    ];
    var subjects=['木吉他','鋼琴','電吉他','烏克麗麗','爵士鼓','小提琴','國樂','長笛'].map(function(name,index){return {id:'sub'+(index+1),name:name,sort:index+1,active:true};});
    var teachers=[
      {id:'t1',name:'陳老師',phone:'0922-000-001',subjectIds:['sub1','sub3','sub4'],reward:210,deduction:0,note:'',active:true},
      {id:'t2',name:'林老師',phone:'0922-000-002',subjectIds:['sub2'],reward:0,deduction:50,note:'',active:true},
      {id:'t3',name:'張老師',phone:'0922-000-003',subjectIds:['sub5'],reward:96,deduction:0,note:'',active:true},
      {id:'t4',name:'楊老師',phone:'0922-000-004',subjectIds:['sub2','sub6'],reward:0,deduction:0,note:'',active:true}
    ];
    var feePlans=[
      {id:'fp1',subjectId:'sub1',sort:1,name:'外聘（6/4）2800',amount:2800,lessonCount:4,splitType:'ratio',splitValue:.6,leaveNoDeduct:true,expiryDays:0,active:true,listed:true},
      {id:'fp2',subjectId:'sub1',sort:2,name:'外聘（7/3）3200',amount:3200,lessonCount:4,splitType:'ratio',splitValue:.7,leaveNoDeduct:true,expiryDays:0,active:true,listed:true},
      {id:'fp3',subjectId:'sub2',sort:1,name:'每期 2800',amount:2800,lessonCount:4,splitType:'ratio',splitValue:.6,leaveNoDeduct:true,expiryDays:0,active:true,listed:true},
      {id:'fp4',subjectId:'sub2',sort:2,name:'每期 3200',amount:3200,lessonCount:4,splitType:'ratio',splitValue:.6,leaveNoDeduct:true,expiryDays:0,active:true,listed:true},
      {id:'fp5',subjectId:'sub5',sort:1,name:'每期 2400',amount:2400,lessonCount:4,splitType:'ratio',splitValue:.6,leaveNoDeduct:false,expiryDays:0,active:true,listed:true},
      {id:'fp6',subjectId:'sub6',sort:1,name:'外聘（7/3）3600',amount:3600,lessonCount:4,splitType:'ratio',splitValue:.7,leaveNoDeduct:true,expiryDays:0,active:true,listed:true}
    ];
    var students=[
      {id:'s1',name:'示範學生 A',phone:'0917-000-001',line:true,note:'固定週三',active:true},
      {id:'s2',name:'示範學生 B',phone:'0917-000-002',line:false,note:'',active:true},
      {id:'s3',name:'示範學生 C',phone:'0917-000-003',line:true,note:'',active:true},
      {id:'s4',name:'示範學生 D',phone:'0917-000-004',line:null,note:'',active:true},
      {id:'s5',name:'示範學生 E',phone:'0917-000-005',line:true,note:'',active:true},
      {id:'s6',name:'示範學生 F',phone:'0917-000-006',line:false,note:'',active:true}
    ];
    var tuitionPeriods=[
      {id:'p1',studentId:'s1',subjectId:'sub2',teacherId:'t2',planId:'fp3',periodNo:1,startDate:shiftDate(today,-21),expiryDate:'',lessonCount:4,usedCount:3,expectedAmount:2800,discount:0,status:'active',note:'',planSnapshot:clone(feePlans[2]),transactions:[{id:'tx1',type:'payment',date:shiftDate(today,-25),amount:2800,method:'現金',note:''}]},
      {id:'p2',studentId:'s2',subjectId:'sub1',teacherId:'t1',planId:'fp1',periodNo:1,startDate:shiftDate(today,-14),expiryDate:'',lessonCount:4,usedCount:2,expectedAmount:2800,discount:0,status:'active',note:'',planSnapshot:clone(feePlans[0]),transactions:[{id:'tx2',type:'payment',date:shiftDate(today,-15),amount:2000,method:'轉帳',note:'尚欠 800'}]},
      {id:'p3',studentId:'s3',subjectId:'sub5',teacherId:'t3',planId:'fp5',periodNo:1,startDate:shiftDate(today,-28),expiryDate:'',lessonCount:4,usedCount:4,expectedAmount:2400,discount:0,status:'completed',note:'',planSnapshot:clone(feePlans[4]),transactions:[{id:'tx3',type:'payment',date:shiftDate(today,-30),amount:2400,method:'店面營收',note:''}]},
      {id:'p4',studentId:'s3',subjectId:'sub5',teacherId:'t3',planId:'fp5',periodNo:2,startDate:today,expiryDate:'',lessonCount:4,usedCount:1,expectedAmount:2400,discount:0,status:'active',note:'',planSnapshot:clone(feePlans[4]),transactions:[]},
      {id:'p5',studentId:'s4',subjectId:'sub6',teacherId:'t4',planId:'fp6',periodNo:1,startDate:shiftDate(today,-7),expiryDate:'',lessonCount:4,usedCount:1,expectedAmount:3600,discount:200,status:'active',note:'折扣 200',planSnapshot:clone(feePlans[5]),transactions:[{id:'tx5',type:'payment',date:shiftDate(today,-8),amount:3400,method:'刷卡',note:''}]},
      {id:'p6',studentId:'s5',subjectId:'sub2',teacherId:'t2',planId:'fp4',periodNo:1,startDate:today,expiryDate:'',lessonCount:4,usedCount:0,expectedAmount:3200,discount:0,status:'active',note:'',planSnapshot:clone(feePlans[3]),transactions:[]}
    ];
    var events=[],attendance=[];
    function addWeekly(base){
      [-21,-14,-7,0,7,14,21,28].forEach(function(offset,index){
        var id=base.id+'_'+offset,date=shiftDate(today,offset),status=offset<0?'attended':(offset===0?(base.todayStatus||'scheduled'):'scheduled');
        events.push(Object.assign({},base,{id:id,date:date,status:status,seriesId:base.id,frequency:'weekly'}));
        if(offset<0||status!=='scheduled')attendance.push({id:'att_'+id,eventId:id,studentId:base.studentIds[0],periodId:base.tuitionPeriodId,status:status,date:date,lessonNo:index+1,teacherId:base.teacherId,deducted:status==='attended'||status==='absent'});
      });
    }
    addWeekly({id:'ser1',roomId:'r2',start:'14:00',duration:60,type:'fixed',studentIds:['s1'],teacherId:'t2',subjectId:'sub2',tuitionPeriodId:'p1',note:'固定課程',todayStatus:'scheduled'});
    addWeekly({id:'ser2',roomId:'r8',start:'15:00',duration:60,type:'fixed',studentIds:['s2'],teacherId:'t1',subjectId:'sub1',tuitionPeriodId:'p2',note:'',todayStatus:'scheduled'});
    addWeekly({id:'ser3',roomId:'r3',start:'17:00',duration:60,type:'fixed',studentIds:['s3'],teacherId:'t3',subjectId:'sub5',tuitionPeriodId:'p4',note:'鼓課',todayStatus:'attended'});
    addWeekly({id:'ser4',roomId:'r6',start:'16:00',duration:60,type:'fixed',studentIds:['s5'],teacherId:'t2',subjectId:'sub2',tuitionPeriodId:'p6',note:'',todayStatus:'leave'});
    events.push({id:'rent1',seriesId:'',date:today,roomId:'r1',start:'13:00',duration:300,type:'rental',frequency:'once',studentIds:[],teacherId:'',subjectId:'',tuitionPeriodId:'',clientName:'示範租用客戶',rentalFee:1000,note:'團練空間租用',status:'scheduled'});
    events.push({id:'single1',seriesId:'ser4',date:today,roomId:'r5',start:'18:00',duration:60,type:'single',frequency:'once',studentIds:['s4'],teacherId:'t4',subjectId:'sub6',tuitionPeriodId:'p5',note:'由原時段調課',status:'scheduled',movedFrom:shiftDate(today,-1)});
    events.push({id:'trial1',seriesId:'',date:today,roomId:'r4',start:'19:00',duration:60,type:'trial',frequency:'once',studentIds:['s6'],teacherId:'t3',subjectId:'sub5',tuitionPeriodId:'',note:'第一次體驗',status:'scheduled'});
    return {version:3,currentDate:today,settings:{startHour:10,endHour:21,interval:30,defaultLessons:4,dailyHours:defaultDailyHours(),dailyHoursVersion:1},rooms:rooms,subjects:subjects,teachers:teachers,feePlans:feePlans,students:students,tuitionPeriods:tuitionPeriods,events:events,attendance:attendance,leaveReasons:[{id:'lr1',name:'生病',sort:1,active:true},{id:'lr2',name:'出遊',sort:2,active:true},{id:'lr3',name:'其他',sort:3,active:true}],teacherPayroll:[],teacherAdjustments:[],clipboard:null,readOnly:false,dataMode:'demo',dataMeta:{}};
  }

  function normalizeState(input){
    var fallback=defaultState(),next=input&&typeof input==='object'?input:{};
    next.version=3;next.currentDate=dateKey(next.currentDate)||todayKey();
    next.settings=Object.assign({startHour:10,endHour:21,interval:30,defaultLessons:4,dailyHours:defaultDailyHours()},next.settings||{});next.settings.interval=30;next.settings.dailyHours=normalizeDailyHours(next.settings.dailyHours);next.settings.dailyHoursVersion=1;var normalizedRange=overallScheduleRange(next.settings.dailyHours);next.settings.startHour=Math.floor(normalizedRange.start/60);next.settings.endHour=Math.ceil(normalizedRange.end/60);next.settings.businessHoursVersion=2;
    ['rooms','subjects','teachers','feePlans','students','tuitionPeriods','events','recurringRules','attendance','leaveReasons','teacherAdjustments'].forEach(function(key){if(!Array.isArray(next[key]))next[key]=[];});
    next.rooms=applySavedOrder(next.rooms.map(function(row,index){return applyBusinessRoomDefaults(Object.assign({id:uid('room'),name:'教室 '+(index+1),note:'',rentalFee:0,sort:index+1,active:true,allowedSubjectIds:[],policies:{}},row,{allowedSubjectIds:Array.isArray(row.allowedSubjectIds)?row.allowedSubjectIds:[],policies:row.policies&&typeof row.policies==='object'?row.policies:{}}));}),ROOM_ORDER_KEY);
    next.subjects=next.subjects.map(function(row,index){return typeof row==='string'?{id:'import_sub_'+index,name:row,sort:index+1,active:true}:Object.assign({id:uid('subject'),name:'未命名科目',sort:index+1,active:true},row);});
    next.teachers=next.teachers.map(function(row){return Object.assign({id:uid('teacher'),name:'未命名老師',phone:'',subjectIds:[],reward:0,deduction:0,note:'',active:true},row,{subjectIds:Array.isArray(row.subjectIds)?row.subjectIds:[]});});
    next.feePlans=applySavedOrder(next.feePlans.map(function(row,index){return Object.assign({id:uid('fee'),subjectId:'',name:'未命名方案',sort:index+1,amount:0,lessonCount:4,splitType:'ratio',splitValue:0,leaveNoDeduct:true,expiryDays:0,active:true,listed:true},row);}),FEE_ORDER_KEY);
    next.students=next.students.map(function(row){return Object.assign({id:uid('student'),name:'未命名學生',phone:'',line:null,note:'',active:true},row);});
    next.tuitionPeriods=next.tuitionPeriods.map(function(row){return Object.assign({id:uid('period'),studentId:'',subjectId:'',teacherId:'',planId:'',periodNo:1,startDate:'',expiryDate:'',lessonCount:4,usedCount:0,voidedLessonCount:0,expectedAmount:0,discount:0,status:'active',note:'',transactions:[],lessonAdjustments:[],planSnapshot:{}},row,{transactions:Array.isArray(row.transactions)?row.transactions:[],lessonAdjustments:Array.isArray(row.lessonAdjustments)?row.lessonAdjustments:[]});});
    next.events=next.events.map(function(row){return Object.assign({id:uid('event'),seriesId:'',date:next.currentDate,roomId:'',start:'',duration:60,type:'fixed',frequency:'once',studentIds:[],teacherId:'',subjectId:'',tuitionPeriodId:'',specialLesson:false,specialLessonPrice:0,specialTeacherPay:0,teacherPayAdjustment:0,teacherPayAdjustmentReason:'',clientName:'',rentalFee:0,note:'',status:'scheduled'},row,{start:clean(row.start),studentIds:Array.isArray(row.studentIds)?row.studentIds:[]});}).filter(function(row){return row.start&&row.roomId&&row.date;});
    next.recurringRules=next.recurringRules.map(function(row){return Object.assign({id:uid('rule'),startDate:next.currentDate,endDate:'',intervalWeeks:1,roomId:'',start:'',duration:60,type:'fixed',studentIds:[],teacherId:'',subjectId:'',tuitionPeriodId:'',note:'',active:true},row,{startDate:dateKey(row.startDate)||next.currentDate,endDate:dateKey(row.endDate),intervalWeeks:numberOf(row.intervalWeeks)===2?2:1,start:clean(row.start),studentIds:Array.isArray(row.studentIds)?row.studentIds:[]});}).filter(function(row){return row.start&&row.roomId&&row.startDate;});
    next.readOnly=next.readOnly===true;
    if(next.dataMode==='sandbox')next.readOnly=false;
    else next.dataMode=next.readOnly?(next.dataMode==='review'?'review':'migration'):(next.dataMode||'demo');
    next.dataMeta=next.dataMeta||{};next.sandboxMeta=next.sandboxMeta&&typeof next.sandboxMeta==='object'?next.sandboxMeta:{};next.clipboard=null;
    if(!next.rooms.length)next.rooms=fallback.rooms;if(!next.subjects.length)next.subjects=fallback.subjects;
    return next;
  }

  function readLocalState(key){try{var saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&saved.version===3)return normalizeState(saved);}catch(_){}return null;}
  function openFormalDatabase(){
    return new Promise(function(resolve,reject){
      if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return;}
      var request=window.indexedDB.open(FORMAL_DB_NAME,1);
      request.onupgradeneeded=function(){var db=request.result;if(!db.objectStoreNames.contains(FORMAL_DB_STORE))db.createObjectStore(FORMAL_DB_STORE);};
      request.onsuccess=function(){resolve(request.result);};
      request.onerror=function(){reject(request.error||new Error('IndexedDB open failed'));};
    });
  }
  async function readDatabaseSnapshot(key){
    try{
      var db=await openFormalDatabase();
      return await new Promise(function(resolve,reject){
        var transaction=db.transaction(FORMAL_DB_STORE,'readonly'),request=transaction.objectStore(FORMAL_DB_STORE).get(key);
        request.onsuccess=function(){resolve(request.result||null);};
        request.onerror=function(){reject(request.error||new Error('IndexedDB read failed'));};
        transaction.oncomplete=function(){db.close();};
      });
    }catch(_){return null;}
  }
  async function storeDatabaseSnapshot(key,source){
    try{
      var db=await openFormalDatabase();
      await new Promise(function(resolve,reject){
        var transaction=db.transaction(FORMAL_DB_STORE,'readwrite');
        transaction.objectStore(FORMAL_DB_STORE).put(source,key);
        transaction.oncomplete=resolve;
        transaction.onerror=function(){reject(transaction.error||new Error('IndexedDB write failed'));};
        transaction.onabort=function(){reject(transaction.error||new Error('IndexedDB write aborted'));};
      });
      db.close();requestPersistentStorage();return true;
    }catch(_){return false;}
  }
  function readFormalDatabase(){return readDatabaseSnapshot(FORMAL_DB_KEY);}
  function storeFormalDatabase(source){return storeDatabaseSnapshot(FORMAL_DB_KEY,source);}
  function readWorkspaceDatabase(){return readDatabaseSnapshot(WORKSPACE_DB_KEY);}
  function storeWorkspaceDatabase(source){return storeDatabaseSnapshot(WORKSPACE_DB_KEY,source);}
  async function storeSynchronizedDatabases(formal,workspace){
    try{
      var db=await openFormalDatabase();
      await new Promise(function(resolve,reject){
        var transaction=db.transaction(FORMAL_DB_STORE,'readwrite'),store=transaction.objectStore(FORMAL_DB_STORE);
        store.put(formal,FORMAL_DB_KEY);
        store.put(workspace,WORKSPACE_DB_KEY);
        transaction.oncomplete=resolve;
        transaction.onerror=function(){reject(transaction.error||new Error('IndexedDB synchronized write failed'));};
        transaction.onabort=function(){reject(transaction.error||new Error('IndexedDB synchronized write aborted'));};
      });
      db.close();requestPersistentStorage();return true;
    }catch(_){return false;}
  }
  function storeFormalCache(source){
    try{localStorage.setItem(FORMAL_CACHE_KEY,JSON.stringify(source));return true;}
    catch(_){try{localStorage.removeItem(FORMAL_CACHE_KEY);}catch(__){}return false;}
  }
  function loadFormalCache(){var cached=readLocalState(FORMAL_CACHE_KEY);if(cached){cached.readOnly=true;cached.dataMode=cached.dataMode==='review'?'review':'migration';formalState=cached;}return cached;}
  function loadInitialState(){
    var inlineState=window.__YOUZI_COURSE_INLINE_BOOTSTRAP_STATE__;
    if(inlineState&&inlineState.version===3){var prepared=normalizeState(clone(inlineState));prepared.readOnly=false;prepared.dataMode='sandbox';return prepared;}
    var cached=loadFormalCache();
    if(cached)return cached;
    var starter=defaultState();starter.rooms=[];starter.subjects=[];starter.teachers=[];starter.feePlans=[];starter.students=[];starter.tuitionPeriods=[];starter.events=[];starter.attendance=[];starter.teacherPayroll=[];starter.teacherAdjustments=[];starter.readOnly=true;starter.dataMode='empty';return starter;
  }
  function isReadOnly(){return state&&state.readOnly===true;}
  function isSandbox(){return state&&state.dataMode==='sandbox'&&!isReadOnly();}
  function sandboxRunId(source){return clean((((source||{}).dataMeta||{}).runId)||(((source||{}).sandboxMeta||{}).baselineRunId));}
  function scheduleWorkspaceSave(){
    if(!isSandbox())return;
    clearTimeout(workspaceSaveTimer);
    workspaceSaveTimer=setTimeout(async function(){
      var saved=await storeWorkspaceDatabase(state);
      if(!saved&&$('saveState'))$('saveState').textContent='儲存失敗・請重新整理後再試';
    },650);
  }
  function save(message){
    if(isSandbox()){
      if(!state.sandboxMeta||typeof state.sandboxMeta!=='object')state.sandboxMeta={};
      state.sandboxMeta.updatedAt=new Date().toISOString();
      scheduleWorkspaceSave();
    }
    $('saveState').textContent=isReadOnly()?'正在開啟資料':'✓ '+(message||'操作已自動儲存');
  }
  function writable(action){if(isSandbox())return true;toast('資料尚未載入',(action||'這項操作')+'要等同步資料開啟後才能使用。','error');return false;}
  function toast(title,message,type){var node=document.createElement('div');node.className='toast'+(type==='error'?' error':'');node.innerHTML='<b>'+esc(title)+'</b><span>'+esc(message||'')+'</span>';$('toastStack').appendChild(node);setTimeout(function(){node.remove();},4000);}
  function operationButton(button,busy,label){
    if(!button)return;if(busy){button.dataset.originalText=button.textContent;button.disabled=true;button.classList.add('busy');button.innerHTML='<span>'+esc(label||'正在處理')+'</span>';}
    else{button.disabled=false;button.classList.remove('busy');button.textContent=button.dataset.originalText||label||'完成';delete button.dataset.originalText;}
  }
  function runUiOperation(label,button,work){
    if(operationRunning)return false;operationRunning=true;operationButton(button,true,label);$('operationProgressText').textContent=label;$('operationProgress').classList.remove('hidden');
    function execute(){try{work();}catch(error){toast('操作失敗',clean(error&&error.message||error),'error');}finally{operationRunning=false;$('operationProgress').classList.add('hidden');operationButton(button,false);}}
    if(window.__YOUZI_COURSE_SCHEDULER_TEST__===true)execute();else setTimeout(execute,60);
    return true;
  }
  function openModal(id){$(id).classList.add('open');document.body.style.overflow='hidden';}
  function closeModal(id){$(id).classList.remove('open');if(!document.querySelector('.modal-backdrop.open'))document.body.style.overflow='';}

  function updateModeUI(){
    var empty=state.dataMode==='empty',meta=state.dataMeta||{},quality=meta.dataQuality||{},visible=quality.visibleEventWeekdays||{},unresolved=numberOf(quality.unresolvedTimeRecords);
    var days='二 '+numberOf(visible.tue)+'・三 '+numberOf(visible.wed)+'・四 '+numberOf(visible.thu)+'・五 '+numberOf(visible.fri)+'・六 '+numberOf(visible.sat);
    $('dataModePanel').classList.toggle('actual',false);
    $('dataModePanel').classList.toggle('sandbox',false);
    document.body.classList.toggle('sandbox-mode',false);
    $('dataModeIcon').textContent='同';
    if($('sideModeBadge'))$('sideModeBadge').textContent=empty?'資料尚未載入':'正式資料已保存';
    $('dataModeTitle').textContent=loadingMigration?'正在同步音教雲':(empty?'資料同步':'正式資料已保存');
    $('dataModeDescription').textContent=loadingMigration?'正在抓取課表、簽到、學費、租用與老師薪資，請保持頁面開啟。':(empty?'第一次按更新即可載入舊音教雲資料。':'開啟課務管理會直接顯示上次資料；只有要取得舊音教雲最新內容時才按更新。');
    $('dataModeChip').textContent=loadingMigration?'同步中':(empty?'尚未載入':'已保存');
    $('dataModeMeta').textContent=empty
      ? '按「更新音教雲最新資料」即可第一次載入全部資料'
      : state.students.length+' 位學生・'+state.events.length+' 筆課表・'+days+(unresolved?'・'+unresolved+' 筆時間待確認':'')+(meta.runId?'・來源 '+meta.runId:'');
    if($('syncInjiaoyunBtn')){
      $('syncInjiaoyunBtn').textContent=loadingMigration?'同步中，請稍候…':'更新音教雲最新資料';
      $('syncInjiaoyunBtn').disabled=loadingMigration;
    }
    ['topNewEvent','sideNewEvent','calendarNewEvent','addStudentBtn','addTeacherBtn','saveSettingsBtn','addRoomBtn','addSubjectBtn','addFeePlanBtn','addLeaveReasonBtn'].forEach(function(id){if($(id))$(id).disabled=empty||loadingMigration;});
    save();
  }

  function switchView(view){
    currentView=['calendar','students','teachers','settings'].indexOf(view)>=0?view:'calendar';
    $$('.view').forEach(function(node){node.classList.toggle('active',node.id===currentView+'Page');});$$('[data-view]').forEach(function(node){node.classList.toggle('active',node.dataset.view===currentView);});
    var meta={calendar:['課程日表','教室為欄、30 分鐘為一格；點空白格即可排課。'],students:['學生與學費','逐科目、逐期別查看堂數、付款、簽到、調課與請假。'],teachers:['老師與薪資','老師可授課科目會直接限制排課選項。'],settings:['系統設定','設定排課格線、教室時段規則、科目、收費方案與請假原因。']}[currentView];
    $('pageTitle').textContent=meta[0];$('pageSubtitle').textContent=meta[1];if(currentView==='calendar')renderCalendar();if(currentView==='students')renderStudents();if(currentView==='teachers'){renderTeachers();refreshTeacherPayrollMonth(teacherListMonthKey());}if(currentView==='settings')renderSettings();window.scrollTo({top:0,behavior:'smooth'});
    if(embeddedMode&&window.parent&&window.parent!==window){
      window.parent.postMessage({type:'youzi-course-view-change',view:currentView},window.location.origin);
    }
  }

  function slotPolicy(room,date,time){var day=weekdayKey(date),policies=room&&room.policies||{},dayPolicies=policies[day]||{};if(Object.prototype.hasOwnProperty.call(dayPolicies,time))return dayPolicies[time]||{};return {blockSchedule:false,blockRental:false,subjectIds:[]};}
  function crossedTimes(start,duration){var output=[];for(var minute=timeToMin(start),end=minute+numberOf(duration);minute<end;minute+=30)output.push(minToTime(minute));return output;}
  function recurrenceKey(ruleId,date){return clean(ruleId)+'@'+clean(date);}
  function recurringRuleOccurs(rule,date){
    if(!rule||rule.active===false||!date||date<rule.startDate||(rule.endDate&&date>rule.endDate))return false;
    var start=new Date(rule.startDate+'T12:00:00'),target=new Date(date+'T12:00:00'),days=Math.round((target-start)/86400000);
    return days>=0&&days%7===0&&Math.floor(days/7)%numberOf(rule.intervalWeeks||1)===0;
  }
  function recurringOccurrence(rule,date){
    var key=recurrenceKey(rule.id,date);
    return {id:'rec_'+key,recurrenceKey:key,ruleId:rule.id,dynamic:true,seriesId:rule.id,date:date,roomId:rule.roomId,start:rule.start,duration:rule.duration,type:'fixed',frequency:numberOf(rule.intervalWeeks)===2?'biweekly':'weekly',studentIds:(rule.studentIds||[]).slice(),teacherId:rule.teacherId,subjectId:rule.subjectId,tuitionPeriodId:rule.tuitionPeriodId,note:rule.note||'',status:'scheduled'};
  }
  function eventsForDate(date){
    var allStored=state.events.filter(function(row){return row.date===date;}),stored=allStored.filter(function(row){return !isHiddenEvent(row);}),overrides=new Set(allStored.map(function(row){return row.recurrenceKey;}).filter(Boolean));
    var dynamic=state.recurringRules.filter(function(rule){return recurringRuleOccurs(rule,date)&&!overrides.has(recurrenceKey(rule.id,date));}).map(function(rule){return recurringOccurrence(rule,date);});
    return stored.concat(dynamic).sort(function(a,b){return timeToMin(a.start)-timeToMin(b.start);});
  }
  function sameLessonPeople(a,b){
    var left=(a.studentIds||[]),right=(b.studentIds||[]);
    if(left.length||right.length)return left.some(function(id){return right.indexOf(id)>=0;});
    return a.type==='rental'&&b.type==='rental'&&clean(a.clientName)===clean(b.clientName);
  }
  function effectiveLayerKey(event){
    if(event.recurrenceKey)return 'recurrence:'+event.recurrenceKey;
    if(event.type==='rental')return 'rental:'+event.date+'|'+event.roomId+'|'+event.start+'|'+clean(event.clientName);
    return 'lesson:'+event.date+'|'+(event.studentIds||[]).slice().sort().join(',')+'|'+event.start;
  }
  function effectiveLayerScore(event,index){
    var score=event.dynamic?0:1000;
    if(normalizedStatus(event.status)!=='scheduled')score+=300;
    if(event.type==='single'||event.movedFrom)score+=500;
    return score+index/10000;
  }
  function eventsOverlap(left,right){
    var leftStart=timeToMin(left.start),leftEnd=leftStart+numberOf(left.duration),rightStart=timeToMin(right.start),rightEnd=rightStart+numberOf(right.duration);
    return leftStart<rightEnd&&leftEnd>rightStart;
  }
  function collapseFinalSlotLayers(rows){
    var footprints=new Map();
    rows.forEach(function(event,index){
      var key=[event.date,event.roomId,event.start,numberOf(event.duration)].join('|'),bucket=footprints.get(key)||[],score=effectiveLayerScore(event,index),sameIndex=bucket.findIndex(function(existing){
        return effectiveLayerKey(existing.event)===effectiveLayerKey(event)||sameLessonPeople(existing.event,event);
      });
      if(sameIndex<0)bucket.push({event:event,score:score});
      else if(score>=bucket[sameIndex].score)bucket[sameIndex]={event:event,score:score};
      footprints.set(key,bucket);
    });
    return Array.from(footprints.values()).reduce(function(all,bucket){return all.concat(bucket.map(function(row){return row.event;}));},[]).sort(function(a,b){return timeToMin(a.start)-timeToMin(b.start);});
  }
  function slotCoverageClass(events,roomId,slotMin){
    var fromPrevious=false,toNext=false,slotEnd=slotMin+30;
    events.forEach(function(event){
      if(event.roomId!==roomId)return;
      var eventStart=timeToMin(event.start),eventEnd=eventStart+numberOf(event.duration);
      if(eventStart<slotMin&&eventEnd>slotMin)fromPrevious=true;
      if(eventStart<slotEnd&&eventEnd>slotEnd)toNext=true;
    });
    return (fromPrevious?' event-from-prev':'')+(toNext?' event-to-next':'');
  }
  function effectiveEventsForDate(date){
    var rows=eventsForDate(date),superseded=new Set();
    rows.forEach(function(target){
      var movedFrom=clean(target.movedFrom);if(!movedFrom)return;
      rows.forEach(function(source){
        if(source.id===target.id||source.date+' '+source.start!==movedFrom||!sameLessonPeople(source,target))return;
        superseded.add(source.id);
      });
    });
    rows.forEach(function(source){
      if(normalizedStatus(source.status)!=='leave')return;
      var covered=rows.some(function(target){
        return target.id!==source.id&&target.roomId===source.roomId&&!sameLessonPeople(source,target)&&!isNonOccupyingEvent(target)&&eventsOverlap(source,target);
      });
      if(covered)superseded.add(source.id);
    });
    var layers=new Map();
    rows.forEach(function(event,index){
      if(superseded.has(event.id))return;
      var key=effectiveLayerKey(event),existing=layers.get(key),score=effectiveLayerScore(event,index);
      if(!existing||score>=existing.score)layers.set(key,{event:event,score:score});
    });
    return collapseFinalSlotLayers(Array.from(layers.values()).map(function(row){return row.event;}));
  }
  function findEvent(eventId){
    return state.events.find(function(row){return row.id===eventId;})||eventsForDate(state.currentDate).find(function(row){return row.id===eventId;})||null;
  }
  function materializeEvent(event){
    if(!event||!event.dynamic)return event;
    var stored=Object.assign({},clone(event),{dynamic:false});
    state.events.push(stored);
    return stored;
  }
  function eventConflictReasons(candidate,ignoreIds){
    if(state&&state.dataMode==='review')return [];
    if(isNonOccupyingEvent(candidate))return [];
    var ignored=new Set(ignoreIds||[]),reasons=[],start=timeToMin(candidate.start),end=start+numberOf(candidate.duration),room=roomById(candidate.roomId),businessHours=scheduleHoursForDate(candidate.date);if(businessHours.closed)reasons.push('這一天設定為不開放排課');else if(start<businessHours.start||end>businessHours.end)reasons.push('超出當天排課時間 '+businessHours.startText+'～'+businessHours.endText);
    if(candidate.type!=='rental'&&Array.isArray(room.allowedSubjectIds)&&room.allowedSubjectIds.length&&room.allowedSubjectIds.indexOf(candidate.subjectId)<0)reasons.push('這間教室不開放「'+(subjectById(candidate.subjectId).name||'此科目')+'」');
    crossedTimes(candidate.start,candidate.duration).forEach(function(time){var policy=slotPolicy(room,candidate.date,time);if(candidate.type==='rental'&&policy.blockRental)reasons.push(time+' 此教室禁止租用');if(candidate.type!=='rental'&&policy.blockSchedule)reasons.push(time+' 此教室禁止排課');if(candidate.type!=='rental'&&Array.isArray(policy.subjectIds)&&policy.subjectIds.length&&policy.subjectIds.indexOf(candidate.subjectId)<0)reasons.push(time+' 不允許此科目');});
    var requestedResources=eventSharedResourceIds(candidate);
    effectiveEventsForDate(candidate.date).forEach(function(other){if(ignored.has(other.id)||isHiddenEvent(other)||isNonOccupyingEvent(other))return;var a=timeToMin(other.start),b=a+numberOf(other.duration);if(start>=b||end<=a)return;if(other.roomId===candidate.roomId)reasons.push('教室與「'+eventDisplayName(other)+'」重疊');if(candidate.teacherId&&other.teacherId===candidate.teacherId)reasons.push('老師與「'+eventDisplayName(other)+'」重疊');if((candidate.studentIds||[]).some(function(id){return (other.studentIds||[]).indexOf(id)>=0;}))reasons.push('學生與「'+eventDisplayName(other)+'」重疊');requestedResources.filter(function(resourceId){return eventSharedResourceIds(other).indexOf(resourceId)>=0;}).forEach(function(resourceId){reasons.push(sharedResourceLabel(resourceId)+'與「'+eventDisplayName(other)+'」重疊');});});
    return unique(reasons);
  }
  function eventDisplayName(event){if(event.type==='rental')return event.clientName||'教室租用';if(event.type==='trial'&&event.trialName)return event.trialName;return (event.studentIds||[]).map(function(id){return studentById(id).name;}).filter(Boolean).join('、')||subjectById(event.subjectId).name||typeName(event.type);}
  function dayConflictIds(events){var ids={};events.forEach(function(event){if(eventConflictReasons(event,[event.id]).length)ids[event.id]=true;});return ids;}
  function calendarIssuesForDate(date){var issues=[],seen={};effectiveEventsForDate(date).forEach(function(event){var reasons=eventConflictReasons(event,[event.id]),status=normalizedStatus(event.status),base={event:event,title:eventDisplayName(event),time:event.start+'–'+minToTime(timeToMin(event.start)+numberOf(event.duration)),room:roomById(event.roomId).name||'未指定教室',teacher:teacherById(event.teacherId).name||'',subject:subjectById(event.subjectId).name||typeName(event.type)};if(reasons.length){var key='conflict:'+event.id;if(!seen[key]){seen[key]=true;issues.push(Object.assign({},base,{kind:'排課衝突',reasons:reasons}));}}if(status==='leave'||status==='absent'||status==='pending_conflict'){var label=status==='leave'?'請假':status==='absent'?'曠課':'待補排',statusKey=label+':'+event.id;if(!seen[statusKey]){seen[statusKey]=true;issues.push(Object.assign({},base,{kind:label,reasons:[status==='pending_conflict'?'目前沒有正式教室或時段，需要重新安排。':label+'紀錄需要確認後續處理。']}));}}});return issues;}
  function openCalendarIssues(){var issues=calendarIssuesForDate(state.currentDate);$('calendarIssuesTitle').textContent=zhDate(state.currentDate)+' 待處理明細';$('calendarIssuesSubtitle').textContent=issues.length?'共 '+issues.length+' 筆，點擊課程可直接查看。':'今天沒有衝突、請假、曠課或待補排。';$('calendarIssuesBody').innerHTML=issues.length?'<div class="calendar-issue-list">'+issues.map(function(issue){return '<button type="button" class="calendar-issue-row" data-issue-event="'+esc(issue.event.id)+'"><span class="tag red">'+esc(issue.kind)+'</span><b>'+esc(issue.title)+'</b><small>'+esc(issue.time+'｜'+issue.room+(issue.teacher?'｜'+issue.teacher:'')+(issue.subject?'｜'+issue.subject:''))+'</small><em>'+issue.reasons.map(esc).join('；')+'</em></button>';}).join('')+'</div>':'<div class="calendar-issue-empty"><b>目前沒有待處理事項</b><span>這一天的課程沒有衝突，也沒有請假、曠課或待補排。</span></div>';openModal('calendarIssuesModal');}
  function clearRoomDropMarks(){
    $$('.room-head',$('scheduleGrid')).forEach(function(node){node.classList.remove('drag-source','drop-before','drop-after');});
  }
  function reorderRoomColumns(sourceId,targetId,after){
    if(!isSandbox()||!sourceId||!targetId||sourceId===targetId)return false;
    var ordered=activeRooms(),source=ordered.find(function(room){return room.id===sourceId;});
    if(!source)return false;
    ordered=ordered.filter(function(room){return room.id!==sourceId;});
    var targetIndex=ordered.findIndex(function(room){return room.id===targetId;});
    if(targetIndex<0)return false;
    ordered.splice(targetIndex+(after?1:0),0,source);
    ordered.forEach(function(room,index){room.sort=(index+1)*10;});
    saveOrder(ROOM_ORDER_KEY,state.rooms.slice().sort(bySort));
    save('教室排列：'+source.name);
    renderCalendar();
    toast('教室排列已更新',source.name+' 已移到新的位置；下次進入仍會沿用此排列。');
    return true;
  }
  function bindRoomReorder(){
    var grid=$('scheduleGrid');if(!grid)return;
    grid.addEventListener('dragstart',function(event){
      var head=event.target.closest('[data-room-drag]');
      if(!head||!isSandbox()){if(head&&event.preventDefault)event.preventDefault();return;}
      roomDragId=head.dataset.roomDrag;head.classList.add('drag-source');
      if(event.dataTransfer){event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',roomDragId);}
    });
    grid.addEventListener('dragover',function(event){
      var head=event.target.closest('[data-room-drag]');
      if(!roomDragId||!head||head.dataset.roomDrag===roomDragId)return;
      if(event.preventDefault)event.preventDefault();
      clearRoomDropMarks();var rect=head.getBoundingClientRect?head.getBoundingClientRect():null;
      roomDropSide=rect&&numberOf(event.clientX)>rect.left+rect.width/2?'after':'before';
      head.classList.add(roomDropSide==='after'?'drop-after':'drop-before');
      if(event.dataTransfer)event.dataTransfer.dropEffect='move';
    });
    grid.addEventListener('drop',function(event){
      var head=event.target.closest('[data-room-drag]');
      if(event.preventDefault)event.preventDefault();
      var targetId=head&&head.dataset.roomDrag,sourceId=roomDragId;
      roomDragId='';clearRoomDropMarks();
      reorderRoomColumns(sourceId,targetId,roomDropSide==='after');
    });
    grid.addEventListener('dragend',function(){roomDragId='';clearRoomDropMarks();});
  }
  function reorderFeePlans(sourceId,targetId,after){
    if(!isSandbox()||!sourceId||!targetId||sourceId===targetId)return false;
    var ordered=state.feePlans.slice().sort(bySort),source=ordered.find(function(plan){return plan.id===sourceId;});if(!source)return false;
    ordered=ordered.filter(function(plan){return plan.id!==sourceId;});var targetIndex=ordered.findIndex(function(plan){return plan.id===targetId;});if(targetIndex<0)return false;
    ordered.splice(targetIndex+(after?1:0),0,source);ordered.forEach(function(plan,index){plan.sort=(index+1)*10;});saveOrder(FEE_ORDER_KEY,ordered);save('收費方案排列：'+source.name);renderFeeRows();toast('方案排列已更新',source.name+' 已移到新的位置。');return true;
  }
  function bindFeeReorder(){
    var body=$('feePlanRows');if(!body)return;
    body.addEventListener('dragstart',function(event){var row=event.target.closest('[data-fee-drag]');if(!row||!isSandbox()){if(event.preventDefault)event.preventDefault();return;}feeDragId=row.dataset.feeDrag;row.classList.add('drag-source');if(event.dataTransfer){event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',feeDragId);}});
    body.addEventListener('dragover',function(event){var row=event.target.closest('[data-fee-drag]');if(!feeDragId||!row||row.dataset.feeDrag===feeDragId)return;if(event.preventDefault)event.preventDefault();$$('[data-fee-drag]',body).forEach(function(node){node.classList.remove('drop-before','drop-after');});var rect=row.getBoundingClientRect?row.getBoundingClientRect():null;feeDropSide=rect&&numberOf(event.clientY)>rect.top+rect.height/2?'after':'before';row.classList.add(feeDropSide==='after'?'drop-after':'drop-before');});
    body.addEventListener('drop',function(event){var row=event.target.closest('[data-fee-drag]');if(event.preventDefault)event.preventDefault();var target=row&&row.dataset.feeDrag,source=feeDragId;feeDragId='';$$('[data-fee-drag]',body).forEach(function(node){node.classList.remove('drag-source','drop-before','drop-after');});reorderFeePlans(source,target,feeDropSide==='after');});
    body.addEventListener('dragend',function(){feeDragId='';$$('[data-fee-drag]',body).forEach(function(node){node.classList.remove('drag-source','drop-before','drop-after');});});
  }

  function weekStartKey(key){
    var date=new Date((key||todayKey())+'T12:00:00'),day=date.getDay(),offset=day===0?-6:1-day;
    date.setDate(date.getDate()+offset);return dateKey(date);
  }
  function setWeekMode(enabled){
    weekMode=!!enabled;$('weekSchedulePanel').classList.toggle('hidden',!weekMode);$('dailyKpis').classList.toggle('hidden',weekMode);$('dailyLegend').classList.remove('hidden');$('dailySchedule').classList.toggle('hidden',weekMode);$('weekScheduleBtn').classList.toggle('active',weekMode);
    if(weekMode){weekAnchor=weekAnchor||state.currentDate||todayKey();renderWeekSchedule();}
  }
  function uniqueWeekEvents(rows){
    var seen={};return rows.filter(function(event){var key=[event.id,event.start,event.teacherId,event.roomId].join('|');if(seen[key])return false;seen[key]=true;return true;});
  }
  function weekOverlapGroups(rows){
    var groups=[],sorted=uniqueWeekEvents(rows).slice().sort(function(a,b){return timeToMin(a.start)-timeToMin(b.start)||(timeToMin(a.start)+numberOf(a.duration))-(timeToMin(b.start)+numberOf(b.duration));});
    sorted.forEach(function(event){var eventStart=timeToMin(event.start),eventEnd=eventStart+numberOf(event.duration),last=groups[groups.length-1];if(!last||eventStart>=last.endMin)groups.push({events:[event],startMin:eventStart,endMin:eventEnd});else{last.events.push(event);last.endMin=Math.max(last.endMin,eventEnd);}});
    return groups;
  }
  function weekEventCard(event,date,conflict){
    var studentCount=(event.studentIds||[]).length,groupLabel=studentCount>2?'團體課':studentCount===2?'雙人課':'',end=minToTime(timeToMin(event.start)+numberOf(event.duration)),status=normalizedStatus(event.status),statusClass=status==='scheduled'?'':status;
    return '<button type="button" class="week-event '+esc(event.type)+' '+esc(statusClass)+(event.specialLesson?' special':'')+(conflict?' week-conflict-event':'')+'" data-week-event-id="'+esc(event.id)+'" data-week-event-date="'+date+'"><time>'+esc(event.start)+'–'+esc(end)+'</time><b>'+esc(eventDisplayName(event))+'</b><span>'+(groupLabel?'<em>'+groupLabel+'</em>':'')+(event.specialLesson?'贈送／特殊加課・':'')+esc(subjectById(event.subjectId).name||typeName(event.type))+'・'+esc(roomById(event.roomId).name||'未設定教室')+'</span></button>';
  }
  function renderWeekSchedule(){
    if(!weekMode)return;var start=weekStartKey(weekAnchor||state.currentDate),end=shiftDate(start,6),selected=$('weekTeacher').value,teachers=state.teachers.filter(function(row){return row.active!==false;}).sort(teacherSort);
    fillSelect($('weekTeacher'),teachers,function(row){return row.name;},function(row){return row.id;},'請選擇老師');
    if(selected&&teachers.some(function(row){return row.id===selected;}))$('weekTeacher').value=selected;else if(teachers.length)$('weekTeacher').value=teachers[0].id;
    var teacherId=$('weekTeacher').value;$('weekRange').textContent=start.replace(/-/g,'/')+' ～ '+end.replace(/-/g,'/');
    var dates=[],eventsByDate={};for(var offset=0;offset<7;offset++){var date=shiftDate(start,offset);dates.push(date);eventsByDate[date]=uniqueWeekEvents(effectiveEventsForDate(date).filter(function(event){return event.teacherId===teacherId&&event.type!=='rental'&&!isHiddenEvent(event);}));}
    var overallRange=overallScheduleRange(state.settings.dailyHours),scheduleStart=overallRange.start,slots=[];for(var min=scheduleStart;min<overallRange.end;min+=30)slots.push(min);
    var html='<div class="teacher-week-grid"><div class="teacher-week-corner" style="grid-column:1;grid-row:1">時間</div>';
    dates.forEach(function(date,dateIndex){html+='<header class="teacher-week-day-head'+(date===todayKey()?' today':'')+'" style="grid-column:'+(dateIndex+2)+';grid-row:1"><b>'+weekdayName(date)+'</b><time>'+date.replace(/-/g,'/')+'</time></header>';});
    slots.forEach(function(slotMin,slotIndex){
      var gridRow=slotIndex+2,slotTime=minToTime(slotMin);html+='<div class="teacher-week-time'+(slotMin%60===0?' hour':'')+'" style="grid-column:1;grid-row:'+gridRow+'">'+slotTime+'</div>';
      dates.forEach(function(date,dateIndex){
        var rows=eventsByDate[date].filter(function(event){var eventStart=timeToMin(event.start),eventEnd=eventStart+numberOf(event.duration);return eventStart<slotMin+30&&eventEnd>slotMin;});
        html+='<div class="teacher-week-slot'+(slotMin%60===0?' hour':'')+'" style="grid-column:'+(dateIndex+2)+';grid-row:'+gridRow+'">';
        if(!rows.length)html+='<span class="teacher-week-empty">空堂</span>';
        html+='</div>';
      });
    });
    dates.forEach(function(date,dateIndex){
      weekOverlapGroups(eventsByDate[date]).forEach(function(group){
        var visibleStart=Math.max(group.startMin,scheduleStart),visibleEnd=Math.min(group.endMin,state.settings.endHour*60);if(visibleEnd<=visibleStart)return;
        var rowStart=2+Math.max(0,Math.floor((visibleStart-scheduleStart)/30)),rowSpan=Math.max(1,Math.ceil((visibleEnd-visibleStart)/30)),placement='grid-column:'+(dateIndex+2)+';grid-row:'+rowStart+'/span '+rowSpan;
        if(group.events.length===1)html+='<div class="teacher-week-event-placement" style="'+placement+'">'+weekEventCard(group.events[0],date,false)+'</div>';
        else{html+='<div class="teacher-week-event-placement teacher-week-overlap-placement" style="'+placement+'"><span class="teacher-week-overlap">⚠ 同時 '+group.events.length+' 堂</span><div class="teacher-week-event-stack">';group.events.forEach(function(event){html+=weekEventCard(event,date,true);});html+='</div></div>';}
      });
    });
    html+='</div>';
    $('weekScheduleDays').innerHTML=html;
  }

  function renderCalendar(){
    var date=state.currentDate,rooms=activeRooms(),events=effectiveEventsForDate(date),conflicts=dayConflictIds(events),issues=calendarIssuesForDate(date),hours=scheduleHoursForDate(date),used=new Set(events.map(function(row){return row.roomId;}));
    $('calendarDate').value=date;$('dateTitle').textContent=zhDate(date);$('dateSubtitle').textContent=weekdayName(date)+(date===todayKey()?'・今天':'');$('kpiLessons').textContent=events.filter(function(row){return row.type!=='rental';}).length;$('kpiAttended').textContent=events.filter(function(row){return normalizedStatus(row.status)==='attended';}).length;$('kpiRooms').textContent=used.size+' / '+rooms.length;$('kpiWarnings').textContent=issues.length;$('calendarHint').textContent='30 分鐘／格・'+rooms.length+' 間啟用教室'+(isReadOnly()?'・資料尚未載入':isSandbox()?'・操作自動儲存':'');
    if (isReadOnly() && state.dataMode === 'review') { var sourceStats = ((state.dataMeta || {}).sourceStatsByDate || {})[date] || {}; $('dataModeMeta').textContent = '原始學生紀錄 '+numberOf(sourceStats.studentRecords)+'・請假已定位 '+numberOf(sourceStats.leaveRecords)+'・固定課 '+numberOf(sourceStats.fixedRecords)+'・最後顯示 '+numberOf(sourceStats.visibleRecords)+(numberOf(sourceStats.unresolvedRecords) ? '・待人工核對 '+numberOf(sourceStats.unresolvedRecords) : ''); }
    var slots=[];if(!hours.closed){for(var min=hours.start;min<hours.end;min+=30)slots.push(min);}var start=hours.start,grid=$('scheduleGrid');grid.style.gridTemplateColumns='var(--time-col, 90px) repeat('+rooms.length+',var(--room-col, minmax(200px,1fr)))';grid.style.gridTemplateRows='var(--room-head-height, 64px) repeat('+slots.length+',var(--slot))';
    var html='<div class="grid-corner" style="grid-column:1;grid-row:1">時間</div>';
    rooms.forEach(function(room,index){var drag=isSandbox()?' draggable="true" data-room-drag="'+esc(room.id)+'" title="按住教室名稱後左右拖曳可調整順序"':'';html+='<div class="room-head"'+drag+' style="grid-column:'+(index+2)+';grid-row:1"><div>'+esc(room.name)+'<small>'+esc(room.note||'')+'</small></div></div>';});
    slots.forEach(function(min,index){var time=minToTime(min),hour=min%60===0?' hour':'';html+='<div class="time-label'+hour+'" style="grid-column:1;grid-row:'+(index+2)+'">'+time+'</div>';rooms.forEach(function(room,ri){var coverage=slotCoverageClass(events,room.id,min);html+='<button type="button" class="slot'+hour+coverage+'" data-slot-room="'+esc(room.id)+'" data-slot-time="'+time+'" style="grid-column:'+(ri+2)+';grid-row:'+(index+2)+'" aria-label="'+esc(room.name+' '+time+' 新增排課')+'"></button>';});});
    events.forEach(function(event){
      var ri=rooms.findIndex(function(room){return room.id===event.roomId;}),si=Math.floor((timeToMin(event.start)-start)/30);
      if(ri<0||si<0||si>=slots.length)return;
      var span=Math.max(1,Math.ceil(numberOf(event.duration)/30)),normalized=normalizedStatus(event.status),status=normalized==='scheduled'?'':normalized,badge=normalized==='attended'?'✓':normalized==='leave'?'假':normalized==='absent'?'曠':normalized==='pending_conflict'?'待':'',studentCount=(event.studentIds||[]).length,groupLabel=studentCount>2?'團體課':studentCount===2?'雙人課':'';
      html+='<button type="button" class="event '+esc(event.type)+' '+esc(status)+(event.specialLesson?' special':'')+(groupLabel?' group-lesson':'')+(conflicts[event.id]?' conflict':'')+'" data-event-id="'+esc(event.id)+'" style="grid-column:'+(ri+2)+';grid-row:'+(si+2)+'/span '+span+'"><span class="event-top"><span>'+esc(event.start)+'–'+esc(minToTime(timeToMin(event.start)+numberOf(event.duration)))+'</span><b>'+badge+'</b></span><span class="event-main">'+esc(eventDisplayName(event))+'</span><span class="event-sub">'+(groupLabel?'<em>'+groupLabel+'</em>':'')+(event.specialLesson?'贈送加課・':'')+esc(subjectById(event.subjectId).name||typeName(event.type))+(teacherById(event.teacherId).name?'・'+esc(teacherById(event.teacherId).name):'')+'</span></button>';
    });
    if(hours.closed)html+='<div class="empty-day"><b>這一天設定為不開放排課</b><span>可到系統設定調整星期別的顯示時間。</span></div>';else if(!events.length)html+='<div class="empty-day"><b>這一天尚未排課</b><span>'+(isReadOnly()?'已移轉資料沒有這一天的課程':'點任一空白格即可新增')+'</span></div>';grid.innerHTML=html;
    $('clipboardBar').classList.toggle('hidden',!state.clipboard);if(state.clipboard){var source=findEvent(state.clipboard.eventId)||state.clipboard.event;$('clipboardText').textContent=(state.clipboard.mode==='cut'?'調課':'增加課程')+'：'+eventDisplayName(source||{})+'，請點新的空白格。';}
    if(weekMode)renderWeekSchedule();
  }

  function fillSelect(node,rows,label,value,placeholder){node.innerHTML=(placeholder?'<option value="">'+esc(placeholder)+'</option>':'')+rows.map(function(row){return '<option value="'+esc(value(row))+'">'+esc(label(row))+'</option>';}).join('');}
  function updateEventStartOptionsForDate(date,selected){var range=scheduleHoursForDate(date||state.currentDate),times=[];if(!range.closed){for(var min=range.start;min<range.end;min+=30)times.push({value:minToTime(min)});}fillSelect($('eventStart'),times,function(row){return row.value;},function(row){return row.value;},range.closed?'當日不開放排課':'請選擇時間');if(selected&&times.some(function(row){return row.value===selected;}))$('eventStart').value=selected;else if(times.length)$('eventStart').value=times[0].value;}
  function refreshFormOptions(){
    var overallRange=overallScheduleRange(state.settings.dailyHours),times=[];for(var min=overallRange.start;min<overallRange.end;min+=30)times.push({value:minToTime(min)});fillSelect($('eventStart'),times,function(row){return row.value;},function(row){return row.value;});fillSelect($('eventStudent'),state.students.filter(function(row){return row.active!==false;}).sort(bySort),function(row){return row.name+'・'+(row.phone||'無電話');},function(row){return row.id;},'請搜尋或選擇學生');fillSelect($('eventSubject'),activeSubjects(),function(row){return row.name;},function(row){return row.id;},'請選擇科目');updateRoomOptions();
    fillSelect($('tuitionStudent'),state.students.filter(function(row){return row.active!==false;}).sort(bySort),function(row){return row.name;},function(row){return row.id;},'請選擇學生');fillSelect($('tuitionSubject'),activeSubjects(),function(row){return row.name;},function(row){return row.id;},'請選擇科目');
  }
  function roomAllowsSubject(room,subjectId){return !subjectId||!Array.isArray(room.allowedSubjectIds)||!room.allowedSubjectIds.length||room.allowedSubjectIds.indexOf(subjectId)>=0;}
  function updateRoomOptions(selected){var current=selected||$('eventRoom').value,type=$('eventType').value,subjectId=$('eventSubject').value,rows=activeRooms().filter(function(room){return type==='rental'||roomAllowsSubject(room,subjectId);});fillSelect($('eventRoom'),rows,function(row){return row.name;},function(row){return row.id;},'請選擇教室');if(current&&rows.some(function(row){return row.id===current;}))$('eventRoom').value=current;else if(rows.length)$('eventRoom').value=rows[0].id;}
  function updateTeacherOptions(selected){var subjectId=$('eventSubject').value,rows=state.teachers.filter(function(row){return row.active!==false&&(!subjectId||row.subjectIds.indexOf(subjectId)>=0);}).sort(teacherSort);fillSelect($('eventTeacher'),rows,function(row){return row.name;},function(row){return row.id;},'請選擇老師');if(selected&&rows.some(function(row){return row.id===selected;}))$('eventTeacher').value=selected;$('teacherFilterHint').textContent=subjectId?'僅顯示可教授「'+(subjectById(subjectId).name||'此科目')+'」的啟用老師':'先選科目後篩選老師';}
  function updateTuitionOptions(selected){var studentId=$('eventStudent').value,subjectId=$('eventSubject').value,rows=state.tuitionPeriods.filter(function(row){return row.studentId===studentId&&row.subjectId===subjectId&&row.status!=='cancelled';}).sort(function(a,b){return numberOf(b.periodNo)-numberOf(a.periodNo);});fillSelect($('eventTuitionPeriod'),rows,function(row){return '第 '+row.periodNo+' 期・剩 '+periodRemaining(row)+' / '+row.lessonCount+' 堂・'+(periodBalance(row)?'未繳 '+money(periodBalance(row)):'已繳清');},function(row){return row.id;},rows.length?'不扣指定期別':'找不到可用期別');if(selected&&rows.some(function(row){return row.id===selected;}))$('eventTuitionPeriod').value=selected;}
  function selectScheduleStudent(studentId,autofill){
    var student=studentById(studentId);$('eventStudent').value=student.id||'';$('eventStudentMatches').classList.add('hidden');
    if(!student.id){$('eventStudentSelected').classList.add('hidden');$('eventStudentSelected').innerHTML='';return;}
    var period=latestPeriod(student.id),subject=subjectById(period.subjectId),teacher=teacherById(period.teacherId);$('eventStudentSearch').value=student.name;
    $('eventStudentSelected').innerHTML='<b>已選擇：'+esc(student.name)+'</b><span>'+(student.phone?esc(student.phone)+'・':'')+esc(subject.name||'尚無課程')+'・'+esc(teacher.name||'未指定老師')+(period.id?'・第 '+period.periodNo+' 期剩 '+periodRemaining(period)+' 堂':'')+'</span><button type="button" data-clear-schedule-student>重新選擇</button>';$('eventStudentSelected').classList.remove('hidden');
    if(autofill&&period.id){$('eventSubject').value=period.subjectId;updateTeacherOptions(period.teacherId);updateTuitionOptions(period.id);updateRoomOptions();}else updateTuitionOptions();
    updateSpecialLessonFields(autofill);
    updateScheduleConflict();
  }
  function renderScheduleStudentMatches(){
    var query=clean($('eventStudentSearch').value).toLowerCase(),box=$('eventStudentMatches');if(!query){box.classList.add('hidden');box.innerHTML='';return;}
    var rows=state.students.filter(function(student){return student.active!==false&&(student.name+' '+(student.phone||'')).toLowerCase().indexOf(query)>=0;}).sort(bySort).slice(0,12);
    box.innerHTML=rows.map(function(student){var period=latestPeriod(student.id);return '<button type="button" data-schedule-student-id="'+esc(student.id)+'"><b>'+esc(student.name)+'</b><span>'+esc(student.phone||'未填電話')+(period.id?'・'+esc(subjectById(period.subjectId).name||'未設定課程')+'・剩 '+periodRemaining(period)+' 堂':'・尚無期別')+'</span></button>';}).join('')||'<p>找不到學生，可按下方「新增學生」。</p>';box.classList.remove('hidden');
  }
  function setScheduleKind(type,roomChanged){
    type=['fixed','single','rental','trial'].indexOf(type)>=0?type:'fixed';$('eventType').value=type;var rental=type==='rental',trial=type==='trial',studentCourse=type==='fixed'||type==='single';
    $$('[data-schedule-kind]',$('scheduleTypeTabs')).forEach(function(button){button.classList.toggle('active',button.dataset.scheduleKind===type);});
    $$('.rental-only').forEach(function(node){node.classList.toggle('hidden',!rental);});$$('.trial-only').forEach(function(node){node.classList.toggle('hidden',!trial);});$$('.student-course-only').forEach(function(node){node.classList.toggle('hidden',!studentCourse);});$$('.learning-only').forEach(function(node){node.classList.toggle('hidden',rental);});$$('.single-only').forEach(function(node){node.classList.toggle('hidden',type!=='single');});
    $('tuitionPeriodField').classList.toggle('hidden',!studentCourse);$('frequencyField').classList.toggle('hidden',type!=='fixed');$('repeatUntilField').classList.toggle('hidden',type!=='fixed'||$('eventFrequency').value==='once'||!!$('eventId').value);
    if(type!=='fixed')$('eventFrequency').value='once';else if(!$('eventId').value&&$('eventFrequency').value==='once')$('eventFrequency').value='weekly';
    updateRoomOptions();
    updateSpecialLessonFields(false);
    if(rental){var room=roomById($('eventRoom').value);if(roomChanged||!$('eventRentalFee').value)$('eventRentalFee').value=room.rentalFee||0;}
  }
  function updateSpecialLessonFields(resetValues){
    var special=$('eventType').value==='single'&&$('eventSingleKind').value==='special';$$('.special-only').forEach(function(node){node.classList.toggle('hidden',!special);});$('tuitionPeriodField').classList.toggle('hidden',!($('eventType').value==='fixed'||$('eventType').value==='single')||special);
    if(!special)return;var period=periodById($('eventTuitionPeriod').value),studentId=$('eventStudent').value,subjectId=$('eventSubject').value;if(!period.id)period=state.tuitionPeriods.filter(function(row){return row.studentId===studentId&&(!subjectId||row.subjectId===subjectId);}).sort(function(a,b){return numberOf(b.periodNo)-numberOf(a.periodNo);})[0]||{};var plan=(period.planSnapshot&&Object.keys(period.planSnapshot).length?period.planSnapshot:feeById(period.planId))||{},price=period.id?Math.round(periodNetExpectedAmount(period)/Math.max(1,numberOf(period.lessonCount))):0,pay=plan.splitType==='fixed'?numberOf(plan.splitValue):Math.round(price*teacherShareRatio(plan.splitValue));if(resetValues||!$('eventSpecialLessonPrice').value)$('eventSpecialLessonPrice').value=price;if(resetValues||!$('eventSpecialTeacherPay').value)$('eventSpecialTeacherPay').value=pay;
  }
  function updateRentalFields(roomChanged){setScheduleKind($('eventType').value,roomChanged);}
  function updateScheduleConflict(){var event=formEvent(),reasons=eventConflictReasons(event,event.id?[event.id]:[]),box=$('conflictBox');box.classList.toggle('has-conflict',reasons.length>0);box.innerHTML=reasons.length?'<b>發現 '+reasons.length+' 項衝突</b><span>'+reasons.map(esc).join('<br>')+'</span>':'<b>尚未發現衝突</b><span>已檢查教室、老師、學生，以及教室每個跨越時段的規則。</span>';return reasons;}
  function clearScheduleForm(){
    $('scheduleForm').reset();$('eventId').value='';$('eventSeriesId').value='';$('eventDate').disabled=false;$('eventStart').disabled=false;$('eventRoom').disabled=false;$('eventDate').value=state.currentDate;$('eventDuration').value='60';$('eventType').value='fixed';$('eventFrequency').value='weekly';$('eventRepeatUntil').value='';$('eventSingleKind').value='normal';$('eventSpecialLessonPrice').value='';$('eventSpecialTeacherPay').value='';$('repeatUntilField').classList.remove('hidden');$('eventNote').value='';$('eventClient').value='';$('eventClientPhone').value='';$('eventRentalFee').value='';$('eventRentalPaymentStatus').value='unpaid';$('eventTrialName').value='';$('eventTrialPhone').value='';$('eventTrialFee').value='';$('eventStudentSearch').value='';$('eventStudentSelected').innerHTML='';$('eventStudentSelected').classList.add('hidden');$('eventStudentMatches').classList.add('hidden');
  }
  function openSchedule(options){
    if(!writable('新增或編輯排課'))return;options=options||{};refreshFormOptions();clearScheduleForm();var source=options.event||options.copy||options.draft||null;$('scheduleModalTitle').textContent=options.event?'編輯這一次課程（日期、時間與教室請使用調課）':options.copy?'增加課程':'快速排課';if(source){$('eventId').value=options.event?source.id:'';$('eventSeriesId').value=source.seriesId||'';$('eventDate').value=source.date;$('eventStart').value=source.start;$('eventDuration').value=String(source.duration||60);$('eventRoom').value=source.roomId;$('eventType').value=source.type;$('eventFrequency').value=options.event?'once':source.frequency||'once';$('eventRepeatUntil').value=source.endDate||'';$('eventSingleKind').value=source.specialLesson?'special':'normal';$('eventSpecialLessonPrice').value=Object.prototype.hasOwnProperty.call(source,'specialLessonPrice')?source.specialLessonPrice:'';$('eventSpecialTeacherPay').value=Object.prototype.hasOwnProperty.call(source,'specialTeacherPay')?source.specialTeacherPay:'';$('eventStudent').value=options.newStudentId||(source.studentIds||[])[0]||'';$('eventSubject').value=source.subjectId||'';$('eventClient').value=source.clientName||'';$('eventClientPhone').value=source.clientPhone||'';$('eventRentalFee').value=Object.prototype.hasOwnProperty.call(source,'rentalFee')?source.rentalFee:'';$('eventRentalPaymentStatus').value=source.rentalPaymentStatus||'unpaid';$('eventTrialName').value=source.trialName||'';$('eventTrialPhone').value=source.trialPhone||'';$('eventTrialFee').value=source.trialFee||'';$('eventNote').value=source.note||'';if(options.event){$('eventDate').disabled=true;$('eventStart').disabled=true;$('eventRoom').disabled=true;}}
    else{$('eventDate').value=options.date||state.currentDate;$('eventStart').value=options.start||minToTime(state.settings.startHour*60);$('eventRoom').value=options.roomId||activeRooms()[0].id;}
    updateEventStartOptionsForDate($('eventDate').value,$('eventStart').value);var selectedTeacher=source&&source.teacherId,selectedPeriod=source&&source.tuitionPeriodId;updateTeacherOptions(selectedTeacher);updateTuitionOptions(selectedPeriod);updateRoomOptions(source&&source.roomId);$('eventFrequency').disabled=!!options.event;setScheduleKind($('eventType').value);if($('eventStudent').value)selectScheduleStudent($('eventStudent').value,false);updateSpecialLessonFields(!source);updateScheduleConflict();openModal('scheduleModal');
  }
  function formEvent(){var type=$('eventType').value,rental=type==='rental',trial=type==='trial',studentCourse=type==='fixed'||type==='single',special=type==='single'&&$('eventSingleKind').value==='special';return {id:$('eventId').value,seriesId:$('eventSeriesId').value,date:$('eventDate').value,roomId:$('eventRoom').value,start:$('eventStart').value,duration:numberOf($('eventDuration').value),type:type,frequency:type==='fixed'?$('eventFrequency').value:'once',studentIds:studentCourse?[$('eventStudent').value].filter(Boolean):[],teacherId:rental?'':$('eventTeacher').value,subjectId:rental?'':$('eventSubject').value,tuitionPeriodId:studentCourse&&!special?$('eventTuitionPeriod').value:'',specialLesson:special,specialLessonPrice:special?numberOf($('eventSpecialLessonPrice').value):0,specialTeacherPay:special?numberOf($('eventSpecialTeacherPay').value):0,clientName:rental?$('eventClient').value.trim():'',clientPhone:rental?$('eventClientPhone').value.trim():'',rentalFee:rental?numberOf($('eventRentalFee').value):0,rentalPaymentStatus:rental?$('eventRentalPaymentStatus').value:'',trialName:trial?$('eventTrialName').value.trim():'',trialPhone:trial?$('eventTrialPhone').value.trim():'',trialFee:trial?numberOf($('eventTrialFee').value):0,note:$('eventNote').value.trim(),status:'scheduled'};}
  function submitSchedule(event){
    event.preventDefault();if(!writable('儲存排課'))return;var row=formEvent(),kind=roomKindOf(roomById(row.roomId)),warning=kind==='video'?'視訊教室不是實體教室，老師需自行安排實際上課地點。確定要使用嗎？':kind==='holding'?'不定時教室只供暫時放置，之後仍需重新安排正式教室。確定要使用嗎？':'';if(warning&&!window.confirm(warning))return;var reasons=updateScheduleConflict();if(reasons.length){toast('無法儲存','請先排除教室、老師、學生或時段規則衝突。','error');return;}if((row.type==='fixed'||row.type==='single')&&(!row.studentIds.length||!row.subjectId||!row.teacherId)){toast('資料未完成','請搜尋並確認學生、科目與可授課老師。','error');return;}if(row.type==='trial'&&(!row.trialName||!row.subjectId||!row.teacherId)){toast('資料未完成','請填寫體驗者姓名、科目與老師。','error');return;}if(row.type==='rental'&&!row.clientName){toast('資料未完成','請填寫租用客戶或團體名稱。','error');return;}
    runUiOperation(row.id?'正在儲存課程…':'正在建立課程…',$('scheduleSubmitBtn'),function(){
      if(row.id){var old=materializeEvent(findEvent(row.id)),index=state.events.findIndex(function(item){return item.id===old.id;});row.date=old.date;row.start=old.start;row.roomId=old.roomId;row.seriesId=old.seriesId;row.status=old.status;row.recurrenceKey=old.recurrenceKey||'';row.ruleId=old.ruleId||'';state.events[index]=Object.assign({},old,row,{dynamic:false});}
      else if(row.type==='fixed'&&$('eventFrequency').value!=='once'){state.recurringRules.push({id:uid('rule'),startDate:row.date,endDate:$('eventRepeatUntil').value||'',intervalWeeks:$('eventFrequency').value==='biweekly'?2:1,roomId:row.roomId,start:row.start,duration:row.duration,type:'fixed',studentIds:row.studentIds.slice(),teacherId:row.teacherId,subjectId:row.subjectId,tuitionPeriodId:row.tuitionPeriodId,note:row.note,active:true});}
      else state.events.push(Object.assign({},row,{id:uid('event'),seriesId:'',frequency:'once'}));
      save('排課已儲存');closeModal('scheduleModal');renderCalendar();toast('排課完成',row.type==='fixed'&&row.frequency!=='once'?'固定時段已保留；只有實際簽到才扣堂並計算老師薪資。':'建立或移動課程不會扣堂；簽到後才扣抵。');
    });
  }

  function nextPeriodNumber(studentId){return state.tuitionPeriods.filter(function(period){return period.studentId===studentId;}).reduce(function(max,period){return Math.max(max,numberOf(period.periodNo));},0)+1;}
  function ensureAttendancePeriod(event,studentId,record){
    var current=periodById(record&&record.periodId||event.tuitionPeriodId);
    if(!current.id)current=latestPeriod(studentId);
    if(!current.id)return {period:{},created:false};
    var alreadyDeducted=record&&record.deducted===true,usable=Math.max(0,numberOf(current.lessonCount)-numberOf(current.voidedLessonCount));
    if(alreadyDeducted||numberOf(current.usedCount)<usable)return {period:current,created:false};
    var next=state.tuitionPeriods.filter(function(period){return period.studentId===studentId&&period.subjectId===current.subjectId&&numberOf(period.periodNo)>numberOf(current.periodNo);}).sort(function(a,b){return numberOf(a.periodNo)-numberOf(b.periodNo);})[0];
    var created=false;
    if(!next){
      next={id:uid('period'),studentId:studentId,subjectId:current.subjectId||event.subjectId,teacherId:current.teacherId||event.teacherId,planId:current.planId,periodNo:nextPeriodNumber(studentId),startDate:event.date,expiryDate:'',lessonCount:numberOf(current.lessonCount)||4,expectedAmount:numberOf(current.expectedAmount),discount:numberOf(current.discount),discountType:clean(current.discountType||current.planSnapshot&&current.planSnapshot.discountType),usedCount:0,voidedLessonCount:0,status:'active',note:'系統於超過上一期堂數時自動延續',transactions:[],lessonAdjustments:[],planSnapshot:clone(current.planSnapshot||feeById(current.planId)||{})};
      state.tuitionPeriods.push(next);created=true;
    }
    event.tuitionPeriodId=next.id;
    state.recurringRules.forEach(function(rule){if(rule.id===event.ruleId||rule.id===event.seriesId)rule.tuitionPeriodId=next.id;});
    state.events.forEach(function(item){if(item.id!==event.id&&item.tuitionPeriodId===current.id&&item.date>=event.date&&normalizedStatus(item.status)==='scheduled'&&(item.ruleId===event.ruleId||item.seriesId===event.seriesId))item.tuitionPeriodId=next.id;});
    return {period:next,created:created};
  }
  function setAttendance(eventId,status,reasonId){
    if(!writable('更新簽到'))return;var event=materializeEvent(findEvent(eventId));if(!event)return;var studentId=(event.studentIds||[])[0],record=state.attendance.find(function(row){return row.eventId===event.id&&row.studentId===studentId;}),rollover={period:periodById(event.tuitionPeriodId),created:false};if(status==='attended'&&!event.specialLesson)rollover=ensureAttendancePeriod(event,studentId,record);event.status=status;var deducted=status==='attended'&&!event.specialLesson,period=rollover.period.id?rollover.period:periodById(event.tuitionPeriodId);if(status==='scheduled'){state.attendance=state.attendance.filter(function(row){return !(row.eventId===event.id&&row.studentId===studentId);});}else if(record){Object.assign(record,{status:status,date:event.date,periodId:event.specialLesson?'':period.id||event.tuitionPeriodId,teacherId:event.teacherId,deducted:deducted,lessonNo:event.specialLesson?0:record.lessonNo||numberOf(period.usedCount)+1,reasonId:reasonId||record.reasonId||'',specialLesson:event.specialLesson===true});}else if(studentId){state.attendance.push({id:uid('attendance'),eventId:event.id,studentId:studentId,periodId:event.specialLesson?'':period.id||event.tuitionPeriodId,status:status,date:event.date,lessonNo:deducted?numberOf(period.usedCount)+1:0,teacherId:event.teacherId,deducted:deducted,reasonId:reasonId||'',specialLesson:event.specialLesson===true});}
    recalcPeriods();syncSandboxPayroll(event,status);save(eventDisplayName(event)+'・'+statusName(status)+(rollover.created?'・自動延續第 '+rollover.period.periodNo+' 期':'')+(event.specialLesson?'・特殊加課不扣堂':''));closeModal('eventModal');renderCalendar();toast(rollover.created?'已自動延續第 '+rollover.period.periodNo+' 期':'已更新為「'+statusName(status)+'」',rollover.created?'上一期已滿；本堂已歸入新一期，新一期目前顯示未繳費。':event.specialLesson&&status==='attended'?'本堂不扣學生期數，已依設定計入老師薪資。':deducted?'本堂已計入堂數扣抵。':'本堂未扣抵堂數。');
  }
  function recalcPeriods(){state.tuitionPeriods.forEach(function(period){period.usedCount=state.attendance.filter(function(row){return row.periodId===period.id&&row.deducted===true;}).length;var usable=Math.max(0,numberOf(period.lessonCount)-numberOf(period.voidedLessonCount));if(period.usedCount>=usable)period.status='completed';else if(period.status==='completed')period.status='active';});}
  function syncSandboxPayroll(event,status){
    if(!isSandbox()||!event||event.type==='rental')return;if(!Array.isArray(state.teacherPayroll))state.teacherPayroll=[];
    state.teacherPayroll=state.teacherPayroll.filter(function(row){return !(row.source==='sandbox'&&row.eventId===event.id);});
    if(status!=='attended')return;
    var period=periodById(event.tuitionPeriodId),plan=(period.planSnapshot&&Object.keys(period.planSnapshot).length?period.planSnapshot:feeById(period.planId))||{},lessonPrice=event.specialLesson?numberOf(event.specialLessonPrice):period.id&&numberOf(period.lessonCount)>0?periodNetExpectedAmount(period)/numberOf(period.lessonCount):0,teacherAmount=0;
    if(event.specialLesson)teacherAmount=numberOf(event.specialTeacherPay);
    else if(plan.splitType==='ratio')teacherAmount=lessonPrice*teacherShareRatio(plan.splitValue);
    else if(plan.splitType==='fixed')teacherAmount=numberOf(plan.splitValue);
    var baseTeacherAmount=Math.max(0,Math.round(teacherAmount)),payAdjustment=numberOf(event.teacherPayAdjustment);teacherAmount=Math.max(0,baseTeacherAmount+payAdjustment);
    state.teacherPayroll.push({id:'sandbox_pay_'+event.id,eventId:event.id,source:'sandbox',teacherId:event.teacherId,studentId:(event.studentIds||[])[0]||'',date:event.date,occurredAt:event.date+'T'+event.start+':00',studentName:eventDisplayName(event),subject:subjectById(event.subjectId).name||'',lessonPrice:Math.round(lessonPrice),collectedAmount:event.specialLesson?0:Math.round(lessonPrice),baseTeacherAmount:baseTeacherAmount,teacherPayAdjustment:payAdjustment,teacherPayAdjustmentReason:clean(event.teacherPayAdjustmentReason),teacherAmount:teacherAmount,schoolShare:Math.max(0,Math.round(lessonPrice)-teacherAmount),allotRate:event.specialLesson&&lessonPrice?baseTeacherAmount/lessonPrice:plan.splitType==='ratio'?teacherShareRatio(plan.splitValue):0,hourlyFee:event.specialLesson?baseTeacherAmount:plan.splitType==='fixed'?numberOf(plan.splitValue):0,specialLesson:event.specialLesson===true});
  }

  function eventDetails(event){
    var room=roomById(event.roomId),subject=subjectById(event.subjectId),teacher=teacherById(event.teacherId),student=studentById((event.studentIds||[])[0]),period=periodById(event.tuitionPeriodId),reasons=eventConflictReasons(event,[event.id]);$('eventTypeBadge').textContent=event.specialLesson?'贈送／特殊加課':typeName(event.type);$('eventModalTitle').textContent=eventDisplayName(event);$('eventModalSubtitle').textContent=zhDate(event.date)+' '+weekdayName(event.date)+'・'+event.start+'–'+minToTime(timeToMin(event.start)+event.duration)+'・'+(room.name||'未設定教室');
    var html='<div class="event-compact-summary">'+(event.type==='rental'?'<div><small>租用人</small><b>'+esc(event.clientName||'未提供')+'</b></div><div><small>預約身分</small><b>'+esc(rentalRoleName(event.rentalRole))+'</b></div><div><small>聯絡電話</small><b>'+esc(event.clientPhone||'未提供')+'</b></div><div><small>租用用途</small><b>'+esc(event.useName||typeName(event.type))+'</b></div><div><small>教室</small><b>'+esc(room.name||'未設定')+'</b></div><div><small>租用金額</small><b>'+money(event.rentalFee)+'</b></div><div><small>收款</small><b>'+esc(rentalPaymentName(event.rentalPaymentStatus))+'</b></div><div><small>預約狀態</small><b>'+esc(rentalStatusName(event))+'</b></div>':event.type==='trial'?'<div><small>體驗者</small><b>'+esc(event.trialName||'未填')+'</b></div><div><small>聯絡電話</small><b>'+esc(event.trialPhone||'未填')+'</b></div><div><small>科目</small><b>'+esc(subject.name||'未設定')+'</b></div><div><small>老師</small><b>'+esc(teacher.name||'未設定')+'</b></div><div><small>體驗費</small><b>'+money(event.trialFee)+'</b></div><div><small>狀態</small><b>'+esc(statusName(event.status))+'</b></div>':event.specialLesson?'<div><small>學生</small><b>'+esc(student.name||'未指定')+'</b></div><div><small>科目</small><b>'+esc(subject.name||'未設定')+'</b></div><div><small>老師</small><b>'+esc(teacher.name||'未設定')+'</b></div><div><small>本堂原價</small><b>'+money(event.specialLessonPrice)+'</b></div><div><small>學生收費</small><b>$0・不扣堂</b></div><div><small>老師實領</small><b>'+money(event.specialTeacherPay)+'</b></div>':'<div><small>學生</small><b>'+esc(student.name||'未指定')+'</b></div><div><small>科目</small><b>'+esc(subject.name||'未設定')+'</b></div><div><small>固定老師</small><b>'+esc(teacher.name||'未設定')+'</b></div><div><small>本次狀態</small><b>'+esc(statusName(event.status))+'</b></div><div><small>目前期別</small><b>'+(period.id?'第 '+esc(period.periodNo)+' 期':'未指定')+'</b></div><div><small>繳費</small><b>'+(period.id?(periodBalance(period)?'<span class="tuition-due">未繳 '+money(periodBalance(period))+'</span>':'<span class="tuition-paid">已繳清</span>'):'—')+'</b></div>')+'</div>';
    if(event.type!=='rental')html='<div class="status-actions event-command-row">'+(!isReadOnly()&&student.id?'<button type="button" data-event-new-period="'+esc(student.id)+'">增加期數</button>':'')+(!isReadOnly()?'<button type="button" data-event-action="copy">增加課程</button><button type="button" data-event-action="cut">調課</button>':'')+'<button data-attendance="attended" '+(isReadOnly()?'disabled':'')+'>✓ 簽到</button><button data-attendance="scheduled" '+(isReadOnly()?'disabled':'')+'>取消簽到</button><button data-attendance="leave" '+(isReadOnly()?'disabled':'')+'>請假</button><button data-attendance="absent" '+(isReadOnly()?'disabled':'')+'>曠課</button></div>'+html;
    if(event.note)html+='<p class="event-note"><b>備註：</b>'+esc(event.note)+'</p>';
    if(event.type!=='rental'&&!event.specialLesson){var adjustment=numberOf(event.teacherPayAdjustment),adjustmentText=adjustment>0?'增加 '+money(adjustment):adjustment<0?'減少 '+money(Math.abs(adjustment)):'尚未設定';html+='<section class="event-pay-override '+(adjustment?'configured':'')+'"><div><small>本堂特殊老師費用</small><b>'+esc(adjustmentText)+'</b><span>'+(adjustment?esc(event.teacherPayAdjustmentReason||'未填原因'):'可在上課前先設定，簽到後才計入薪資。')+'</span></div>'+(!isReadOnly()?'<button class="btn small secondary" type="button" data-teacher-pay-override="'+esc(event.id)+'">'+(adjustment?'修改設定':'預先設定')+'</button>':'')+'</section>';}
    if(reasons.length)html+='<div class="validation-box has-conflict"><b>排課衝突</b><span>'+reasons.map(esc).join('<br>')+'</span></div>';
    if(event.type!=='rental'&&isReadOnly())html+='<p class="formal-action-hint">請先同步音教雲資料，再進行課程操作。</p>';
    else if(event.type==='rental')html+='<div class="status-actions rental-actions">'+(!isReadOnly()?'<button data-event-action="edit">修改租用金額／資料</button>':'')+(event.source==='course-portal'&&event.portalBookingId&&event.canAdminCancel!==false&&event.active!==false?'<button class="danger" data-portal-rental-cancel="'+esc(event.portalBookingId)+'">強制取消租用</button>':'')+'<button data-attendance="attended" '+(isReadOnly()?'disabled':'')+'>✓ 簽退完成</button><button data-attendance="scheduled" '+(isReadOnly()?'disabled':'')+'>恢復未簽退</button></div>';
    if(student.id)html+='<section class="event-tuition-section"><div class="student-record-heading"><div><h3>學生學費紀錄</h3><p>不必再進第二層；每一期與四堂簽到直接顯示在這裡。</p></div></div>'+tuitionTableHtml(student.id,{eventId:event.id,currentPeriodId:event.tuitionPeriodId,fallbackTeacherId:event.teacherId})+'</section>';
    $('eventModalBody').innerHTML=html;
    $('eventModalFoot').innerHTML='<div class="formal-view-note">'+(isReadOnly()?'資料尚未載入。':'點「第幾期／課程方案」會直接編輯本期期別。')+'</div>';$('eventModal').dataset.eventId=event.id;openModal('eventModal');
  }
  function detailLine(label,value){return '<div class="detail-line"><span>'+esc(label)+'</span><b>'+esc(value)+'</b></div>';}
  function teacherPayBase(event){
    var period=periodById(event.tuitionPeriodId),plan=(period.planSnapshot&&Object.keys(period.planSnapshot).length?period.planSnapshot:feeById(period.planId))||{},lessonPrice=period.id&&numberOf(period.lessonCount)>0?periodNetExpectedAmount(period)/numberOf(period.lessonCount):0,amount=0;
    if(plan.splitType==='ratio')amount=lessonPrice*teacherShareRatio(plan.splitValue);else if(plan.splitType==='fixed')amount=numberOf(plan.splitValue);return Math.max(0,Math.round(amount));
  }
  function renderTeacherPayOverridePreview(){
    var event=findEvent($('teacherPayOverrideEventId').value),base=teacherPayBase(event||{}),type=$('teacherPayOverrideType').value,amount=numberOf($('teacherPayOverrideAmount').value),signed=type==='increase'?amount:type==='decrease'?-amount:0;$('teacherPayOverrideAmount').disabled=type==='none';$('teacherPayOverrideReason').disabled=type==='none';$('teacherPayOverridePreview').innerHTML='<b>簽到後薪資預覽</b><span>原拆帳 '+money(base)+(signed>0?' ＋ '+money(signed):signed<0?' － '+money(Math.abs(signed)):'')+' ＝ 老師本堂所得 '+money(Math.max(0,base+signed))+'</span>';
  }
  function openTeacherPayOverride(eventId){
    if(!writable('設定本堂特殊老師費用'))return;var event=findEvent(eventId);if(!event)return;$('teacherPayOverrideEventId').value=event.id;var adjustment=numberOf(event.teacherPayAdjustment);$('teacherPayOverrideType').value=adjustment>0?'increase':adjustment<0?'decrease':'none';$('teacherPayOverrideAmount').value=Math.abs(adjustment);$('teacherPayOverrideReason').value=event.teacherPayAdjustmentReason||'';$('teacherPayOverrideTitle').textContent=eventDisplayName(event)+'・本堂特殊老師費用';renderTeacherPayOverridePreview();closeModal('eventModal');openModal('teacherPayOverrideModal');
  }
  function submitTeacherPayOverride(event){
    event.preventDefault();if(!writable('儲存本堂特殊老師費用'))return;var row=materializeEvent(findEvent($('teacherPayOverrideEventId').value)),type=$('teacherPayOverrideType').value,amount=numberOf($('teacherPayOverrideAmount').value),reason=$('teacherPayOverrideReason').value.trim(),signed=type==='increase'?amount:type==='decrease'?-amount:0;if(type!=='none'&&(!amount||!reason)){toast('資料未完成','設定增加或減少時，必須填寫金額與原因。','error');return;}row.teacherPayAdjustment=signed;row.teacherPayAdjustmentReason=signed?reason:'';if(normalizedStatus(row.status)==='attended')syncSandboxPayroll(row,'attended');save(eventDisplayName(row)+'・預設本堂老師費用 '+(signed>0?'+':'')+signed);closeModal('teacherPayOverrideModal');renderCalendar();toast('本堂薪資設定已儲存',signed?'目前只先預設；老師實際簽到後才會計入薪資。':'已取消本堂特殊調整。');}
  function eventAction(action){var event=findEvent($('eventModal').dataset.eventId);if(!event)return;if(!writable('修改課程'))return;if(action==='edit'){closeModal('eventModal');openSchedule({event:event});}if(action==='copy'||action==='cut'){if(action==='cut'&&state.attendance.some(function(row){return row.eventId===event.id&&normalizedStatus(row.status)==='attended';})){toast('目前不能調課','這堂已經簽到，請先取消簽到再調課。','error');return;}state.clipboard={mode:action,eventId:event.id,event:clone(event)};closeModal('eventModal');renderCalendar();toast(action==='cut'?'已選擇調課':'已選擇增加課程','請點新的教室與時間格；取消前不會改變原課程。');}if(action==='delete'){event=materializeEvent(event);if(state.attendance.some(function(row){return row.eventId===event.id&&normalizedStatus(row.status)==='attended';})){toast('無法刪除這一次課程','已有簽到紀錄，請先取消簽到再刪除。','error');return;}if(window.confirm('確定只刪除這一次課程嗎？固定課規則與其他日期不受影響。')){event.status='cancelled';syncSandboxPayroll(event,'cancelled');save(eventDisplayName(event)+'・刪除這一次課程');closeModal('eventModal');renderCalendar();toast('已刪除這一次課程','固定課的其他日期仍會照常保留。');}}}
  function pasteToSlot(roomId,start){
    var clip=state.clipboard,source=clip&&(findEvent(clip.eventId)||clone(clip.event));if(!clip||!source)return false;var target=Object.assign({},source,{id:uid('event'),dynamic:false,recurrenceKey:'',seriesId:source.seriesId||'',date:state.currentDate,roomId:roomId,start:start,status:'scheduled',type:source.type==='rental'?'rental':'single',frequency:'once',movedFrom:source.date+' '+source.start}),reasons=eventConflictReasons(target,clip.mode==='cut'?[source.id]:[]);if(reasons.length){toast('無法放到這個格子',reasons.join('；'),'error');return true;}
    runUiOperation(clip.mode==='cut'?'正在調課…':'正在增加課程…',null,function(){state.events.push(target);if(clip.mode==='cut'){source=materializeEvent(source);source.status='leave';var studentId=(source.studentIds||[])[0],record=state.attendance.find(function(row){return row.eventId===source.id&&row.studentId===studentId;});if(record)Object.assign(record,{status:'leave',date:source.date,periodId:source.tuitionPeriodId,teacherId:source.teacherId,deducted:false});else if(studentId)state.attendance.push({id:uid('attendance'),eventId:source.id,studentId:studentId,periodId:source.tuitionPeriodId,status:'leave',date:source.date,lessonNo:0,teacherId:source.teacherId,deducted:false,reasonId:''});syncSandboxPayroll(source,'leave');recalcPeriods();}state.clipboard=null;save(eventDisplayName(source)+'・'+(clip.mode==='copy'?'增加課程':'調課至 '+state.currentDate+' '+start));renderCalendar();toast(clip.mode==='copy'?'增加課程完成':'調課完成',clip.mode==='cut'?'只有原日期已標示請假並釋放教室；新日期尚未簽到，不扣堂也不計薪。':'新增課程尚未扣堂，實際簽到後才扣堂。');});return true;
  }

  function latestPeriod(studentId){return state.tuitionPeriods.filter(function(row){return row.studentId===studentId;}).sort(function(a,b){return clean(b.startDate).localeCompare(clean(a.startDate))||numberOf(b.periodNo)-numberOf(a.periodNo);})[0]||{};}
  function studentPageIndex(){
    var meta=state.sandboxMeta||{},dataMeta=state.dataMeta||{},today=todayKey();
    var key=[today,state.students.length,state.tuitionPeriods.length,state.events.length,state.recurringRules.length,state.attendance.length,clean(meta.updatedAt),clean(dataMeta.runId)].join('|');
    if(studentPageIndex.cache&&studentPageIndex.key===key)return studentPageIndex.cache;
    var periodsByStudent=new Map(),latestByStudent=new Map(),dueByStudent=new Set(),lowByStudent=new Set();
    state.tuitionPeriods.forEach(function(period){
      var studentId=clean(period.studentId),list=periodsByStudent.get(studentId)||[];list.push(period);periodsByStudent.set(studentId,list);
      if(periodBalance(period)>0)dueByStudent.add(studentId);
      var prior=latestByStudent.get(studentId),newer=!prior||clean(period.startDate).localeCompare(clean(prior.startDate))>0||(clean(period.startDate)===clean(prior.startDate)&&numberOf(period.periodNo)>numberOf(prior.periodNo));
      if(newer)latestByStudent.set(studentId,period);
    });
    latestByStudent.forEach(function(period,studentId){if(period.id&&periodRemaining(period)<=1)lowByStudent.add(studentId);});
    var subjectMap=new Map(state.subjects.map(function(row){return [row.id,row];})),teacherMap=new Map(state.teachers.map(function(row){return [row.id,row];}));
    var scheduledStudentIds=new Set(),end=shiftDate(today,180);
    state.events.forEach(function(event){var date=dateKey(event.date);if(date<today||date>end||isHiddenEvent(event)||isNonOccupyingEvent(event))return;(event.studentIds||[]).forEach(function(id){scheduledStudentIds.add(id);});});
    state.recurringRules.forEach(function(rule){if(rule.active===false||(rule.endDate&&rule.endDate<today))return;(rule.studentIds||[]).forEach(function(id){scheduledStudentIds.add(id);});});
    var nextByStudent=new Map();
    for(var offset=0;offset<=180&&nextByStudent.size<scheduledStudentIds.size;offset++){
      effectiveEventsForDate(shiftDate(today,offset)).forEach(function(event){
        if(isHiddenEvent(event)||isNonOccupyingEvent(event))return;
        (event.studentIds||[]).forEach(function(id){if(!nextByStudent.has(id))nextByStudent.set(id,event);});
      });
    }
    var rows=state.students.map(function(student){
      var periods=periodsByStudent.get(student.id)||[],latest=latestByStudent.get(student.id)||{},subject=subjectMap.get(latest.subjectId)||{},teacher=teacherMap.get(latest.teacherId)||{};
      return {student:student,periods:periods,latest:latest,subject:subject,teacher:teacher,event:nextByStudent.get(student.id)||{},due:dueByStudent.has(student.id),low:lowByStudent.has(student.id),hay:(student.name+' '+(student.phone||'')+' '+periods.map(function(row){return (subjectMap.get(row.subjectId)||{}).name||'';}).join(' ')).toLowerCase()};
    });
    var result={rows:rows,latestByStudent:latestByStudent,dueByStudent:dueByStudent,lowByStudent:lowByStudent,nextByStudent:nextByStudent};
    studentPageIndex.key=key;studentPageIndex.cache=result;return result;
  }
  function nextEvent(studentId){return studentPageIndex().nextByStudent.get(studentId)||{};}
  function renderStudents(){
    var index=studentPageIndex(),search=clean($('studentSearch').value).toLowerCase(),filter=$('studentPaymentFilter').value;
    var rows=index.rows.filter(function(item){if(search&&item.hay.indexOf(search)<0)return false;if(filter==='due'&&!item.due)return false;if(filter==='low'&&!item.low)return false;if(filter==='active'&&item.student.active===false)return false;return true;}).sort(function(a,b){return bySort(a.student,b.student);});
    $('studentMetrics').innerHTML=metric('學生總數',state.students.length,'含停課資料')+metric('尚有未繳',index.dueByStudent.size,'依每一期付款加總')+metric('剩 1 堂以下',index.lowByStudent.size,'建議準備下一期');
    $('studentRows').innerHTML=rows.map(function(item){var student=item.student,period=item.latest,event=item.event,subject=item.subject,teacher=item.teacher;return '<tr><td><b>'+esc(student.name)+'</b><small>'+(student.active===false?'已停課':'上課中')+'</small></td><td>'+esc(student.phone||'未填')+'<small>LINE：'+(student.line===true?'已綁定':student.line===false?'未綁定':'未確認')+'</small></td><td>'+esc(subject.name||'尚無學費期別')+'<small>'+esc(teacher.name||'未指定老師')+'</small></td><td>'+(period.id?'<b>'+period.usedCount+' / '+period.lessonCount+'</b><small>剩 '+periodRemaining(period)+' 堂</small>':'—')+'</td><td>'+(period.id?'<b>'+money(periodPaid(period))+' / '+money(periodNetExpectedAmount(period))+'</b><small>'+(periodBalance(period)?'尚欠 '+money(periodBalance(period)):'已繳清')+'</small>':'—')+'</td><td>'+(event.id?esc(event.date+' '+event.start):'尚未排課')+'</td><td><button class="btn small secondary" data-student-id="'+esc(student.id)+'">查看學費紀錄</button></td></tr>';}).join('')||'<tr><td colspan="7">沒有符合條件的學生。</td></tr>';
  }
  function metric(label,value,small){return '<article class="card metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(small)+'</small></article>';}

  function openStudent(id,tab){currentStudentId=id;studentTab=tab||'profile';var student=studentById(id);if(!student.id)return;$('studentModalTitle').textContent=student.name;$('studentModalSubtitle').textContent=(student.phone||'未填手機')+'・'+(student.active===false?'已停課':'上課中');renderStudentModal();openModal('studentModal');}
  function periodLessonSlots(period){
    var attended=state.attendance.filter(function(row){return row.periodId===period.id&&normalizedStatus(row.status)==='attended';}).sort(function(a,b){return clean(a.date).localeCompare(clean(b.date))||numberOf(a.lessonNo)-numberOf(b.lessonNo);}),adjustments=period.lessonAdjustments||[],count=Math.max(1,numberOf(period.lessonCount)||4),html='<div class="lesson-slots">';
    for(var index=0;index<count;index++){var slotNo=index+1,adjustment=adjustments.find(function(row){return numberOf(row.slotNo)===slotNo;}),row=attended.find(function(item){return numberOf(item.lessonNo)===slotNo;})||attended[index],date=row&&clean(row.date).replace(/-/g,'/'),kind=adjustment?(adjustment.type==='refund'?' refunded':' voided'):row?' completed':' pending',label=adjustment?(adjustment.type==='refund'?'已退款':'已作廢'):row?'已上課':'尚未上課';html+='<button type="button" class="lesson-slot'+kind+'" data-lesson-period="'+esc(period.id)+'" data-lesson-slot="'+slotNo+'" '+(isSandbox()?'':'disabled')+'><small>第 '+slotNo+' 堂</small><b>'+(adjustment?esc(clean(adjustment.date).replace(/-/g,'/')||'—'):row?esc(date):'—')+'</b><em>'+label+'</em></button>';}
    return html+'</div>';
  }
  function tuitionTableHtml(studentId,options){
    options=options||{};
    var periods=state.tuitionPeriods.filter(function(row){return row.studentId===studentId;}).sort(function(a,b){return numberOf(a.periodNo)-numberOf(b.periodNo);}),latest=periods.length?periods[periods.length-1]:{},rows=periods.map(function(period){
      var transactions=(period.transactions||[]).map(function(tx,index){return {row:tx,index:index};}).sort(function(a,b){return clean(a.row.date).localeCompare(clean(b.row.date));}),payments=transactions.filter(function(entry){return entry.row.type!=='refund';}),latestPayment=payments.length?payments[payments.length-1]:null,receiptButton=function(entry){if(!entry)return '';var tx=entry.row,receiptUrl=clean(tx.receiptImageUrl);return '<button type="button" class="btn small outline tuition-receipt-button" data-tuition-receipt-url="'+esc(receiptUrl)+'" data-tuition-receipt-period="'+esc(period.id)+'" data-tuition-receipt-transaction="'+esc(tx.id)+'" data-tuition-receipt-index="'+entry.index+'">收據</button>';},transactionHtml=transactions.map(function(entry){var tx=entry.row,method=displayTransactionMethod(tx.method);return '<span class="payment-line"><time>'+esc(tx.date||'未填日期')+'</time><b>'+esc(tx.type==='refund'?'退款':'收費')+' '+money(tx.amount)+'</b>'+(method?'<small>'+esc(method)+'</small>':'')+'</span>';}).join('')||'<small class="no-payment">尚無收退款紀錄</small>',planName=clean((period.planSnapshot||{}).name)||clean(feeById(period.planId).name)||'既有收費方案',balance=periodBalance(period),paymentStatus=balance>0?'<b class="tuition-due">未繳 '+money(balance)+'</b>':'<span class="tuition-paid">已繳清</span>',payment='<span class="payment-summary">'+paymentStatus+receiptButton(latestPayment)+'</span>',current=options.eventId&&period.id===options.currentPeriodId,actions=current&&isSandbox()?'<div class="period-course-actions"><button type="button" class="btn small outline" data-event-action="edit">編輯這一次課程</button><button type="button" class="btn small danger" data-event-action="delete">刪除這一次課程</button></div>':'';
      return '<tr class="tuition-period-row'+(period.id===latest.id?' latest':'')+'"><td><button type="button" class="period-course-button" '+(isSandbox()?'data-period-edit="'+esc(period.id)+'"':'disabled')+'><b>第 '+esc(period.periodNo)+' 期・'+esc(subjectById(period.subjectId).name||'未設定科目')+'</b><small>'+esc(planName)+'</small></button>'+actions+'</td><td><div class="payment-status-cell">'+payment+transactionHtml+'</div></td><td>'+(isSandbox()?'<button type="button" class="btn small secondary" data-period-pay="'+esc(period.id)+'">收費／退款</button>':'<span class="tuition-readonly">尚未載入</span>')+'</td><td>'+periodLessonSlots(period)+'</td></tr>';
    }).join('')||'<tr><td colspan="4" class="student-empty">尚未建立學費期別。</td></tr>';
    return '<div class="tuition-table-wrap"><table class="tuition-record-table"><thead><tr><th>期別／課程方案</th><th>繳費狀態與紀錄</th><th>收費／退款</th><th>上課紀錄</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }
  function openTuitionReceiptPlaceholder(){
    var viewer=window.open('','_blank');if(!viewer){toast('無法開啟收據','瀏覽器阻擋彈出式視窗，請允許後再試。','error');return null;}
    viewer.opener=null;
    viewer.document.write('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>建立收據中</title><style>body{display:grid;min-height:100vh;margin:0;place-items:center;background:#f4f7f5;color:#395d52;font-family:sans-serif;font-size:18px;font-weight:700}</style></head><body>建立收據中…</body></html>');
    viewer.document.close();return viewer;
  }
  function openTuitionReceipt(imageUrl,viewer){
    imageUrl=clean(imageUrl);if(!/^https:\/\//i.test(imageUrl)){if(viewer&&!viewer.closed)viewer.close();toast('無法開啟收據','收據圖片網址不正確，請重新整理資料。','error');return null;}
    viewer=viewer||window.open('','_blank');if(!viewer){toast('無法開啟收據','瀏覽器阻擋彈出式視窗，請允許後再試。','error');return null;}
    viewer.opener=null;
    viewer.document.open();
    viewer.document.write('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>學費收據</title><style>@page{size:15cm 10cm;margin:0}*{box-sizing:border-box}body{margin:0;background:#262a26;font-family:sans-serif}.tools{display:flex;justify-content:center;gap:12px;padding:14px}.tools button{border:0;border-radius:8px;padding:10px 18px;font-size:16px;font-weight:700}.receipt{display:block;width:min(15cm,100vw);height:auto;margin:0 auto 20px;background:#eef4a8}@media print{body{background:#fff;width:15cm;height:10cm}.tools{display:none}.receipt{width:15cm;height:10cm;margin:0;object-fit:fill}}</style></head><body><div class="tools"><button onclick="window.print()">列印 15 × 10 公分收據</button><button onclick="window.close()">關閉</button></div><img class="receipt" src="'+esc(imageUrl)+'" alt="學費收據"></body></html>');
    viewer.document.close();return viewer;
  }
  async function ensureAndOpenTuitionReceipt(button){
    var imageUrl=clean(button&&button.dataset.tuitionReceiptUrl);
    if(imageUrl){openTuitionReceipt(imageUrl);return;}
    var viewer=openTuitionReceiptPlaceholder();if(!viewer)return;
    var pin=migrationPin();if(!pin){if(!viewer.closed)viewer.close();return;}
    var period=periodById(button.dataset.tuitionReceiptPeriod),index=numberOf(button.dataset.tuitionReceiptIndex),transaction=(period.transactions||[])[index];
    if(!period.id||!transaction){if(!viewer.closed)viewer.close();toast('找不到收費紀錄','請重新整理資料後再試。','error');return;}
    var originalText=button.textContent;button.disabled=true;button.textContent='建立收據中…';
    try{
      var result=await window.YouziCoursePreviewData.ensureTuitionReceipt({manualSyncPin:pin,periodId:period.id,transactionId:transaction.id,transactionIndex:index,paymentDate:transaction.date,amount:transaction.amount,method:transaction.method});
      transaction.receiptId=clean(result.receiptId);transaction.receiptNo=clean(result.receiptNo);transaction.receiptImageUrl=clean(result.receiptImageUrl);
      button.dataset.tuitionReceiptUrl=transaction.receiptImageUrl;button.textContent='收據';
      openTuitionReceipt(transaction.receiptImageUrl,viewer);
    }catch(error){
      if(!viewer.closed)viewer.close();
      var message=clean(error&&error.message||'收據建立失敗');
      if(message.indexOf('密碼')>=0||message.indexOf('permission-denied')>=0)clearMigrationPin();
      button.textContent=originalText;toast('無法建立收據',message.slice(0,220),'error');
    }finally{button.disabled=false;}
  }
  function renderStudentModal(){
    var student=studentById(currentStudentId);$('studentTabs').innerHTML='';
    var periods=state.tuitionPeriods.filter(function(row){return row.studentId===student.id;}).sort(function(a,b){return numberOf(a.periodNo)-numberOf(b.periodNo);}),latest=periods.length?periods[periods.length-1]:{},html='<section class="student-overview compact"><div><span>狀態</span><b>'+(student.active===false?'已停課':'上課中')+'</b></div><div><span>電話</span><b>'+esc(student.phone||'未填')+'</b></div><div><span>目前課程</span><b>'+esc(subjectById(latest.subjectId).name||'尚未建立期別')+'</b></div><div><span>目前堂數</span><b>'+(latest.id?'剩 '+periodRemaining(latest)+'／'+latest.lessonCount+' 堂':'—')+'</b></div></section>';
    if(student.note)html+='<section class="student-note"><b>備註</b><p>'+esc(student.note)+'</p></section>';
    html+='<section class="student-section"><div class="student-record-heading"><div><h3>學費紀錄</h3><p>每一期維持同一排；四堂實際簽到日期直接顯示，未繳金額以紅色標示。</p></div></div>'+tuitionTableHtml(student.id)+'</section>';
    $('studentModalBody').innerHTML=html;$('studentModalFoot').innerHTML=isSandbox()?'<div><button class="btn outline" type="button" data-student-action="edit">編輯基本資料</button></div><div><button class="btn primary" type="button" data-student-action="tuition">＋ 延續／新增學費期別</button></div>':'<div class="formal-view-note">請先同步音教雲資料，再進行收費、退費或新增期別。</div>';
  }
  function displayTransactionMethod(value){var method=clean(value);return /^(未註明|未設定|N\/A|null|undefined|-+)$/i.test(method)?'':method;}
  function summary(label,value){return '<article><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></article>';}
  function timeline(rows,renderer){return '<div class="timeline">'+(rows.map(function(row){return '<article class="timeline-item">'+renderer(row)+'</article>';}).join('')||'<p>目前沒有紀錄。</p>')+'</div>';}

  function openTuition(studentId,id){
    if(!writable('新增或編輯學費'))return;refreshFormOptions();$('tuitionForm').reset();$('tuitionId').value=id||'';$('tuitionPurchasePeriods').value='1';$('tuitionPurchasePeriods').disabled=!!id;$('tuitionStudent').value=studentId||currentStudentId||'';$('tuitionPaymentDate').value=todayKey();$('tuitionCollectNow').checked=!id;$('tuitionPaymentMethod').value='現金';var row=periodById(id);
    if(row.id){$('tuitionModalTitle').textContent='編輯學費期別';$('tuitionModalSubtitle').textContent='只修改第 '+row.periodNo+' 期的課程、金額與老師；既有收退款紀錄不會改變。';$('tuitionStudent').value=row.studentId;$('tuitionSubject').value=row.subjectId;$('tuitionPeriodNo').value=row.periodNo;$('tuitionLessonCount').value=row.lessonCount;$('tuitionAmount').value=row.expectedAmount;$('tuitionDiscount').value=row.discount;$('tuitionStartDate').value=row.startDate;$('tuitionExpiryDate').value=row.expiryDate;$('tuitionNote').value=row.note||'';}
    else{var previous=latestPeriod($('tuitionStudent').value),studentPeriods=state.tuitionPeriods.filter(function(p){return p.studentId===$('tuitionStudent').value;});$('tuitionModalTitle').textContent=previous.id?'增加下一期':'新增第 1 期';$('tuitionModalSubtitle').textContent=previous.id?'沿用上一期方案與固定老師；可在建立時同時登記本次收費。':'建立第一期，並可同時登記本次收費。';if(previous.id){$('tuitionSubject').value=previous.subjectId;row={teacherId:previous.teacherId,planId:previous.planId};}$('tuitionPeriodNo').value=studentPeriods.reduce(function(max,p){return Math.max(max,numberOf(p.periodNo));},0)+1;$('tuitionStartDate').value=todayKey();$('tuitionDiscount').value=0;}
    updateTuitionCollectionFields();updateTuitionForm(row);updateTuitionPurchaseSummary(true);openModal('tuitionModal');
  }
  function updateTuitionForm(existing){
    var subjectId=$('tuitionSubject').value,teacherSelected=existing&&existing.teacherId||$('tuitionTeacher').value,planSelected=existing&&existing.planId||$('tuitionPlan').value,teachers=state.teachers.filter(function(row){return row.id===teacherSelected||row.active!==false&&(!subjectId||(row.subjectIds||[]).indexOf(subjectId)>=0);}).sort(bySort),plans=state.feePlans.filter(function(row){return row.active!==false&&row.listed!==false&&(!subjectId||row.subjectId===subjectId);}).sort(bySort);fillSelect($('tuitionTeacher'),teachers,function(row){return row.name;},function(row){return row.id;},'不指定固定老師');fillSelect($('tuitionPlan'),plans,function(row){return row.name+'・'+money(row.amount)+'／'+row.lessonCount+' 堂';},function(row){return row.id;},'請選擇收費方案');if(teacherSelected&&teachers.some(function(row){return row.id===teacherSelected;}))$('tuitionTeacher').value=teacherSelected;if(planSelected)$('tuitionPlan').value=planSelected;renderTuitionSnapshot();
  }
  function tuitionPurchaseCount(){return $('tuitionId').value?1:Math.max(1,Math.min(24,numberOf($('tuitionPurchasePeriods').value)||1));}
  function updateTuitionPurchaseSummary(resetPayment){var count=tuitionPurchaseCount();$('tuitionPurchasePeriods').value=String(count);$('tuitionSubmitBtn').textContent=$('tuitionId').value?'儲存本期':'儲存 '+count+' 期';if(!$('tuitionId').value&&resetPayment!==false)$('tuitionPaymentAmount').value=0;}
  function updateTuitionCollectionFields(){var editing=!!$('tuitionId').value,show=!editing&&$('tuitionCollectNow').checked;$('tuitionCollectField').classList.toggle('hidden',editing);['tuitionPaymentDateField','tuitionPaymentAmountField','tuitionPaymentMethodField'].forEach(function(id){$(id).classList.toggle('hidden',!show);});}
  function renderTuitionSnapshot(){var plan=feeById($('tuitionPlan').value);if(!plan.id){$('tuitionSnapshot').innerHTML='<b>尚未選擇方案</b>選擇後會帶入金額、堂數、請假規則與老師拆帳。';return;}$('tuitionLessonCount').value=plan.lessonCount;$('tuitionAmount').value=plan.amount;updateTuitionPurchaseSummary(true);$('tuitionSnapshot').innerHTML='<b>將建立 '+tuitionPurchaseCount()+' 期並保存方案快照</b>'+esc(plan.name)+'・每期 '+money(plan.amount)+'／'+plan.lessonCount+' 堂・老師拆帳 '+splitLabel(plan)+'・請假'+(plan.leaveNoDeduct?'不扣堂':'照常扣堂');}
  function splitLabel(plan){if(plan.splitType==='ratio')return Math.round(teacherShareRatio(plan.splitValue)*100)+'%';if(plan.splitType==='fixed')return money(plan.splitValue)+'／堂';return '未設定';}
  function submitTuition(event){
    event.preventDefault();if(!writable('儲存學費期別'))return;var id=$('tuitionId').value,plan=feeById($('tuitionPlan').value),studentId=$('tuitionStudent').value,existing=id?periodById(id):{},count=tuitionPurchaseCount(),nextPeriodNo=state.tuitionPeriods.filter(function(period){return period.studentId===studentId;}).reduce(function(max,period){return Math.max(max,numberOf(period.periodNo));},0)+1,paymentTotal=numberOf($('tuitionPaymentAmount').value),collectNow=!id&&$('tuitionCollectNow').checked&&paymentTotal>0,perExpected=numberOf($('tuitionAmount').value),perDiscount=numberOf($('tuitionDiscount').value),perNet=Math.max(0,perExpected-perDiscount);
    if(!studentId||!$('tuitionSubject').value||!plan.id){toast('資料未完成','請選擇學生、科目與收費方案。','error');return;}
    runUiOperation(id?'正在儲存本期期別…':'正在建立 '+count+' 個期別…',$('tuitionSubmitBtn'),function(){var created=[],remaining=paymentTotal;
      for(var index=0;index<count;index++){var editing=id&&index===0,base=editing?existing:{},allocation=0;if(collectNow&&remaining>0){allocation=index===count-1?remaining:Math.min(perNet,remaining);remaining=Math.max(0,remaining-allocation);}var transactions=editing?(base.transactions||[]):[];if(allocation>0)transactions.push({id:uid('tx'),type:'payment',date:$('tuitionPaymentDate').value||todayKey(),amount:allocation,method:$('tuitionPaymentMethod').value,note:'新增 '+count+' 期時同時收費'});var row={id:editing?base.id:uid('period'),studentId:studentId,subjectId:$('tuitionSubject').value,teacherId:$('tuitionTeacher').value,planId:plan.id,periodNo:editing?numberOf(base.periodNo):nextPeriodNo+index,startDate:editing?base.startDate:todayKey(),expiryDate:editing?base.expiryDate:'',lessonCount:numberOf($('tuitionLessonCount').value)||plan.lessonCount,expectedAmount:perExpected,discount:perDiscount,usedCount:editing?base.usedCount:0,status:'active',note:$('tuitionNote').value.trim(),transactions:transactions,lessonAdjustments:editing?(base.lessonAdjustments||[]):[],planSnapshot:clone(plan)};if(editing)Object.assign(base,row);else state.tuitionPeriods.push(row);created.push(row);}
      save(studentById(studentId).name+'・'+(id?'編輯第 '+existing.periodNo+' 期':'建立第 '+nextPeriodNo+'～'+(nextPeriodNo+count-1)+' 期')+(collectNow?'・收費 '+money(paymentTotal):''));closeModal('tuitionModal');if($('studentModal').classList.contains('open')&&currentStudentId===studentId){studentTab='tuition';renderStudentModal();}if(currentView==='students')renderStudents();toast(id?'學費期別已更新':'學費期別已建立',id?'本期資料已更新；原有收退款紀錄保持不變。':'已新增 '+count+' 期'+(collectNow?'，並分配收費總額 '+money(paymentTotal):'；目前均顯示未繳費')+'。');
    });
  }

  function availableRefundSlots(period){var adjusted=new Set((period.lessonAdjustments||[]).map(function(row){return numberOf(row.slotNo);})),count=Math.max(1,numberOf(period.lessonCount)||4);return Array.from({length:count},function(_,index){return index+1;}).filter(function(slotNo){return !adjusted.has(slotNo);});}
  function attendanceAtSlot(periodId,slotNo){var rows=state.attendance.filter(function(row){return row.periodId===periodId;}).sort(function(a,b){return clean(a.date).localeCompare(clean(b.date))||numberOf(a.lessonNo)-numberOf(b.lessonNo);});return rows.find(function(row){return numberOf(row.lessonNo)===numberOf(slotNo);})||rows[numberOf(slotNo)-1]||null;}
  function addLessonAdjustment(period,slotNo,type,date,amount){if(!Array.isArray(period.lessonAdjustments))period.lessonAdjustments=[];if(period.lessonAdjustments.some(function(row){return numberOf(row.slotNo)===numberOf(slotNo);}))return false;period.lessonAdjustments.push({id:uid('lesson_adjustment'),slotNo:numberOf(slotNo),type:type,date:date||todayKey(),amount:numberOf(amount)});period.voidedLessonCount=numberOf(period.voidedLessonCount)+1;return true;}
  function openLessonAction(periodId,slotNo){if(!writable('處理單堂課程'))return;var period=periodById(periodId),adjustment=(period.lessonAdjustments||[]).find(function(row){return numberOf(row.slotNo)===numberOf(slotNo);}),attendance=attendanceAtSlot(periodId,slotNo);$('lessonActionPeriodId').value=periodId;$('lessonActionSlotNo').value=slotNo;$('lessonActionTitle').textContent='第 '+slotNo+' 堂課程處理';$('lessonActionBody').innerHTML='<div class="lesson-action-summary">'+detailLine('期別','第 '+period.periodNo+' 期')+detailLine('課程',subjectById(period.subjectId).name||'未設定')+detailLine('日期',attendance&&attendance.date||'尚未上課')+detailLine('目前狀態',adjustment?(adjustment.type==='refund'?'已退款':'已作廢'):attendance?statusName(attendance.status):'尚未上課')+detailLine('單堂金額',money(periodNetExpectedAmount(period)/Math.max(1,numberOf(period.lessonCount))) )+'</div>';$('lessonActionFoot').classList.toggle('hidden',!!adjustment);openModal('lessonActionModal');}
  function voidLessonSlot(periodId,slotNo){var period=periodById(periodId);if(!period.id||!addLessonAdjustment(period,slotNo,'void',todayKey(),0))return;var attendance=attendanceAtSlot(periodId,slotNo),event=attendance&&state.events.find(function(row){return row.id===attendance.eventId;});if(attendance){attendance.status='cancelled';attendance.deducted=false;}if(event){event.status='cancelled';syncSandboxPayroll(event,'cancelled');}recalcPeriods();save(studentById(period.studentId).name+'・第 '+period.periodNo+' 期第 '+slotNo+' 堂作廢');closeModal('lessonActionModal');if(currentStudentId)renderStudentModal();renderStudents();renderCalendar();toast('已作廢第 '+slotNo+' 堂','這一堂仍占本期堂數，學費金額沒有改變。');}
  function openTransaction(periodId,preferredSlotNo){if(!writable('新增收費或退款'))return;$('transactionForm').reset();$('transactionPeriodId').value=periodId;$('transactionPreferredSlot').value=preferredSlotNo||'';$('transactionDate').value=todayKey();$('transactionType').value=preferredSlotNo?'refund':'payment';renderRefundLessonOptions();openModal('transactionModal');}
  function renderRefundLessonOptions(){
    var refund=$('transactionType').value==='refund',period=periodById($('transactionPeriodId').value),slots=availableRefundSlots(period),preferred=numberOf($('transactionPreferredSlot').value),lessonPrice=Math.round(periodNetExpectedAmount(period)/Math.max(1,numberOf(period.lessonCount)));
    $('refundLessonField').classList.toggle('hidden',!refund);if(!refund)return;$('transactionLessonPrice').value=money(lessonPrice);$('transactionRefundCount').innerHTML=slots.map(function(_,index){return '<option value="'+(index+1)+'">'+(index+1)+' 堂</option>';}).join('');$('transactionRefundCount').value=slots.length?'1':'';var ordered=preferred&&slots.indexOf(preferred)>=0?[preferred].concat(slots.filter(function(slot){return slot!==preferred;})):slots;$('refundSlotChoices').innerHTML=ordered.map(function(slotNo,index){var attendance=attendanceAtSlot(period.id,slotNo);return '<label class="refund-slot-choice"><input type="checkbox" data-refund-slot="'+slotNo+'" '+(index===0?'checked':'')+'><span><b>第 '+slotNo+' 堂</b><small>'+(attendance&&attendance.date||'尚未上課')+'</small></span></label>';}).join('')||'<p>本期已沒有可退款的堂數。</p>';$('transactionAmount').value=slots.length?lessonPrice:0;
  }
  function syncRefundSelection(fromCount){var period=periodById($('transactionPeriodId').value),lessonPrice=Math.round(periodNetExpectedAmount(period)/Math.max(1,numberOf(period.lessonCount))),boxes=$$('[data-refund-slot]',$('refundSlotChoices'));if(fromCount){var count=numberOf($('transactionRefundCount').value);boxes.forEach(function(box,index){box.checked=index<count;});}var selected=boxes.filter(function(box){return box.checked;});if(!fromCount&&selected.length)$('transactionRefundCount').value=String(selected.length);$('transactionAmount').value=lessonPrice*selected.length;}
  function submitTransaction(event){
    event.preventDefault();if(!writable('儲存付款或退款'))return;var period=periodById($('transactionPeriodId').value),amount=numberOf($('transactionAmount').value),type=$('transactionType').value;if(!period.id||amount<=0){toast('資料不完整','請輸入正確金額。','error');return;}
    var selectedSlots=type==='refund'?$$('[data-refund-slot]',$('refundSlotChoices')).filter(function(box){return box.checked;}).map(function(box){return numberOf(box.dataset.refundSlot);}):[];if(type==='refund'&&!selectedSlots.length){var fallback=numberOf($('transactionPreferredSlot').value)||availableRefundSlots(period)[0];if(fallback)selectedSlots=[fallback];}period.transactions.push({id:uid('tx'),type:type,date:$('transactionDate').value,amount:amount,method:$('transactionMethod').value,note:$('transactionNote').value.trim(),lessonSlots:selectedSlots.slice(),lessonCount:selectedSlots.length});
    selectedSlots.forEach(function(slotNo){if(!addLessonAdjustment(period,slotNo,'refund',$('transactionDate').value,amount/selectedSlots.length))return;var attendance=attendanceAtSlot(period.id,slotNo),voidedEvent=attendance&&state.events.find(function(row){return row.id===attendance.eventId;});if(attendance){attendance.status='cancelled';attendance.deducted=false;attendance.voidedByRefund=true;}if(voidedEvent){voidedEvent.status='cancelled';syncSandboxPayroll(voidedEvent,'cancelled');}});
    recalcPeriods();save(studentById(period.studentId).name+'・第 '+period.periodNo+' 期'+(type==='refund'?'退款 ':'收費 ')+money(amount)+(selectedSlots.length?'・'+selectedSlots.length+' 堂':''));
    closeModal('transactionModal');studentTab='tuition';if(currentStudentId)renderStudentModal();if(currentView==='students')renderStudents();if(currentView==='teachers')renderTeachers();toast(type==='refund'?'退款紀錄完成':'收費紀錄完成',selectedSlots.length?'已標示 '+selectedSlots.length+' 堂退款；退款不會被重新算成欠費。':'未覆寫原金額，已新增一筆獨立異動。');
  }

  function normalizedMonthKey(value){value=clean(value);return /^\d{4}-(0[1-9]|1[0-2])$/.test(value)?value:'';}
  function shiftMonthKey(key,amount){var parts=(normalizedMonthKey(key)||todayKey().slice(0,7)).split('-'),total=numberOf(parts[0])*12+numberOf(parts[1])-1+numberOf(amount),year=Math.floor(total/12),month=total-year*12+1;return year+'-'+pad(month);}
  function teacherListMonthKey(){var input=$('teacherListMonth'),current=todayKey().slice(0,7),selected=normalizedMonthKey(input&&input.value)||current;if(selected>current)selected=current;if(input){input.max=current;if(input.value!==selected)input.value=selected;}return selected;}
  function teacherMonthLabel(key){var parts=(normalizedMonthKey(key)||todayKey().slice(0,7)).split('-');return numberOf(parts[0])+' 年 '+numberOf(parts[1])+' 月';}
  function setTeacherPayrollSyncState(status,message){var panel=$('teacherPayrollSyncPanel'),label=$('teacherPayrollSyncState'),button=$('teacherPayrollRefreshBtn');if(!panel||!label)return;panel.classList.remove('loading','success','error');if(status)panel.classList.add(status);label.textContent=message||'';if(button)button.disabled=status==='loading';}
  function setTeacherListMonth(key){var input=$('teacherListMonth'),current=todayKey().slice(0,7),selected=normalizedMonthKey(key)||current;if(selected>current)selected=current;if(input)input.value=selected;renderTeachers();refreshTeacherPayrollMonth(selected);}
  async function refreshTeacherPayrollMonth(monthKey){
    monthKey=normalizedMonthKey(monthKey);if(!monthKey)return false;
    if(teacherPayrollMonthRefreshes[monthKey])return teacherPayrollMonthRefreshes[monthKey];
    if(!window.YouziCoursePreviewData||typeof window.YouziCoursePreviewData.loadTeacherPayrollMonth!=='function')return false;
    var task=(async function(){
      try{
        setTeacherPayrollSyncState('loading','正在讀取 '+teacherMonthLabel(monthKey)+' 正式薪資…');
        if($('saveState'))$('saveState').textContent='正在更新 '+teacherMonthLabel(monthKey)+'薪資…';
        var result=await window.YouziCoursePreviewData.loadTeacherPayrollMonth({month:monthKey,manualSyncPin:storedMigrationPin()});
        state.teacherPayroll=(state.teacherPayroll||[]).filter(function(row){return clean(row.date).slice(0,7)!==monthKey;}).concat(result.teacherPayroll||[]);
        state.teacherAdjustments=(state.teacherAdjustments||[]).filter(function(row){return clean(row.date).slice(0,7)!==monthKey;}).concat(result.teacherAdjustments||[]);
        if(!state.dataMeta||typeof state.dataMeta!=='object')state.dataMeta={};
        if(!state.dataMeta.teacherPayrollMonths||typeof state.dataMeta.teacherPayrollMonths!=='object')state.dataMeta.teacherPayrollMonths={};
        state.dataMeta.teacherPayrollMonths[monthKey]={loadedAt:result.loadedAt,runId:result.runId,count:(result.teacherPayroll||[]).length};
        save(teacherMonthLabel(monthKey)+'薪資已更新');
        setTeacherPayrollSyncState('success',teacherMonthLabel(monthKey)+'已與雲端同步：'+(result.teacherPayroll||[]).length+' 堂');
        if(currentView==='teachers'&&teacherListMonthKey()===monthKey)renderTeachers();
        if($('teacherPayrollModal').classList.contains('open')&&normalizedMonthKey($('teacherPayrollMonth').value)===monthKey)renderTeacherPayroll();
        return true;
      }catch(error){
        delete teacherPayrollMonthRefreshes[monthKey];
        setTeacherPayrollSyncState('error',teacherMonthLabel(monthKey)+'尚未更新，請按右側「更新薪資」重試');
        toast('薪資更新未完成','目前先顯示已保存資料；'+clean(error&&error.message||error).slice(0,160),'error');
        return false;
      }
    })();
    teacherPayrollMonthRefreshes[monthKey]=task;return task;
  }
  function renderTeachers(){
    var search=clean($('teacherSearch').value).toLowerCase(),monthKey=teacherListMonthKey(),monthLabel=teacherMonthLabel(monthKey),month=(state.teacherPayroll||[]).filter(function(row){return clean(row.date).slice(0,7)===monthKey;}),adjustments=(state.teacherAdjustments||[]).filter(function(row){return clean(row.date).slice(0,7)===monthKey;}),teachers=state.teachers.filter(function(row){var subjects=(row.subjectIds||[]).map(function(id){return subjectById(id).name;}).join(' ');return !search||(row.name+' '+row.phone+' '+subjects).toLowerCase().indexOf(search)>=0;}).sort(teacherSort),nextButton=$('teacherListMonthNext'),currentButton=$('teacherListMonthCurrent'),basePay=sum(month.map(function(row){return row.teacherAmount;})),adjustmentPay=sum(adjustments.map(signedTeacherAdjustment)),finalPay=basePay+adjustmentPay;if(nextButton)nextButton.disabled=monthKey>=todayKey().slice(0,7);if(currentButton)currentButton.disabled=monthKey===todayKey().slice(0,7);$('teacherMetrics').innerHTML=metric('老師總數',state.teachers.length,'啟用 '+state.teachers.filter(function(row){return row.active!==false;}).length+' 位')+metric(monthLabel+'完成課堂',month.length,'只計實際簽到')+metric(monthLabel+'課堂拆帳',money(basePay),'不含獎勵與扣薪')+metric(monthLabel+'獎勵／扣薪',(adjustmentPay>0?'＋':adjustmentPay<0?'－':'')+money(Math.abs(adjustmentPay)),'另外列示，不混入課堂拆帳')+metric(monthLabel+'實際薪資合計',money(finalPay),'課堂拆帳＋獎勵－扣薪');
    $('teacherCards').innerHTML='<div class="teacher-list-head"><span>老師／電話</span><span>主要教授科目</span><span>狀態</span><span>完成堂數</span><span>課堂拆帳</span><span>獎勵／扣薪</span><span>實際合計</span><span>操作</span></div>'+teachers.map(function(row){var completed=month.filter(function(item){return item.teacherId===row.id;}),teacherAdjustments=adjustments.filter(function(item){return item.teacherId===row.id;}),basePay=sum(completed.map(function(item){return item.teacherAmount;})),adjustmentPay=sum(teacherAdjustments.map(signedTeacherAdjustment)),finalPay=basePay+adjustmentPay,subjects=(row.subjectIds||[]).map(function(id){return subjectById(id);}).filter(function(subject){return subject.id&&subject.active!==false;}).sort(bySort),shown=subjects.slice(0,2).map(function(subject){return subject.name;}),more=subjects.length>2?' ＋'+(subjects.length-2):'';return '<article class="teacher-list-row'+(row.active===false?' inactive':'')+'"><div class="teacher-list-cell teacher-list-identity" data-label="老師／電話"><b>'+esc(row.name)+'</b><small>'+esc(row.phone||'未填電話')+'</small></div><div class="teacher-list-cell teacher-list-subjects teacher-subject-summary" data-label="主要教授科目">'+esc(shown.join('、')||'尚未設定')+esc(more)+'</div><div class="teacher-list-cell teacher-list-status" data-label="狀態"><span class="tag '+(row.active===false?'gray':'green')+'">'+(row.active===false?'停用':'啟用')+'</span></div><div class="teacher-list-cell teacher-list-completed" data-label="完成堂數"><b>'+completed.length+' 堂</b></div><div class="teacher-list-cell teacher-list-base-pay" data-label="課堂拆帳"><b>'+money(basePay)+'</b></div><div class="teacher-list-cell teacher-list-adjustment-pay" data-label="獎勵／扣薪"><b>'+(adjustmentPay>0?'＋':adjustmentPay<0?'－':'')+money(Math.abs(adjustmentPay))+'</b></div><div class="teacher-list-cell teacher-list-final-pay" data-label="實際合計"><b>'+money(finalPay)+'</b></div><div class="teacher-list-actions"><button class="btn small primary" data-teacher-payroll="'+row.id+'">查看上課拆帳與薪資</button><button class="btn small secondary" data-teacher-adjustment="'+row.id+'">＋獎勵／扣薪</button>'+(state.readOnly?'':'<button class="btn small outline" data-teacher-id="'+row.id+'">編輯老師與科目</button>')+'</div></article>';}).join('');
  }

  function splitText(row){if(numberOf(row.hourlyFee))return '每堂固定 '+money(row.hourlyFee);if(numberOf(row.allotRate))return '比例 '+Math.round(numberOf(row.allotRate)*10000)/100+'%';return '未設定';}
  function openTeacherPayroll(teacherId){currentTeacherId=teacherId;$('teacherPayrollMonth').value=teacherListMonthKey();renderTeacherPayroll();openModal('teacherPayrollModal');refreshTeacherPayrollMonth($('teacherPayrollMonth').value);}
  function teacherAdjustmentLabel(row){var type=clean(row&&row.type).toLowerCase();if(type==='reward')return '獎勵';if(type==='deduction')return '扣薪';if(type==='teacher_bonus')return '老師獎金';if(type==='late_attendance_fee')return '補簽行政扣款';if(type==='attendance_cancellation_fee')return '取消簽到扣款';return signedTeacherAdjustment(row)<0?'扣薪':'獎勵';}
  function renderTeacherPayroll(){
    var teacher=teacherById(currentTeacherId),month=normalizedMonthKey($('teacherPayrollMonth').value)||teacherListMonthKey(),rows=(state.teacherPayroll||[]).filter(function(row){return row.teacherId===currentTeacherId&&clean(row.date).slice(0,7)===month;}).sort(function(a,b){return clean(a.occurredAt||a.date).localeCompare(clean(b.occurredAt||b.date));}),adjustments=(state.teacherAdjustments||[]).filter(function(row){return row.teacherId===currentTeacherId&&clean(row.date).slice(0,7)===month;}).sort(function(a,b){return clean(b.date).localeCompare(clean(a.date))||clean(b.id).localeCompare(clean(a.id));}),base=sum(rows.map(function(row){return row.teacherAmount;})),signedAdjustments=adjustments.map(signedTeacherAdjustment),reward=sum(signedAdjustments.filter(function(amount){return amount>0;})),deduction=-sum(signedAdjustments.filter(function(amount){return amount<0;})),finalAmount=base+reward-deduction;
    $('teacherPayrollMonth').value=month;$('teacherPayrollTitle').textContent=teacher.name+'・上課拆帳與薪資';$('teacherPayrollSubtitle').textContent=teacherMonthLabel(month)+'｜課堂拆帳與獎勵／扣薪完整歷史';
    var summary='<div class="metrics-grid">'+metric('實際簽到堂數',rows.length,'同日多堂逐堂計算')+metric('課堂拆帳',money(base),'逐堂套用老師或方案分成')+metric('獎勵／扣薪',money(reward-deduction),'獎勵 '+money(reward)+'・扣薪 '+money(deduction))+metric('所選月份薪資合計',money(finalAmount),'課堂拆帳＋獎勵－扣薪')+'</div>';
    var previousDate='',table='<div class="table-wrap"><table class="payroll-detail-table"><thead><tr><th>日期</th><th>學生</th><th>課程</th><th>本堂學費</th><th>實際收費</th><th>拆帳方式</th><th>老師實領</th></tr></thead><tbody>'+rows.map(function(row){var dayStart=previousDate&&previousDate!==row.date,studentId=row.studentId||(state.students.find(function(student){return student.name===row.studentName;})||{}).id||'',student=studentId?'<button type="button" class="student-link" data-payroll-student="'+esc(studentId)+'">'+esc(row.studentName||studentById(studentId).name||'未命名學生')+'</button>':esc(row.studentName||'未命名學生'),collected=Object.prototype.hasOwnProperty.call(row,'collectedAmount')?numberOf(row.collectedAmount):numberOf(row.lessonPrice),payAdjustment=numberOf(row.teacherPayAdjustment),payDetail=payAdjustment?'<small class="payroll-special-adjustment">原拆帳 '+money(numberOf(row.baseTeacherAmount))+(payAdjustment>0?' ＋ ':' － ')+money(Math.abs(payAdjustment))+'<br>'+esc(row.teacherPayAdjustmentReason||'本堂特殊調整')+'</small>':'';previousDate=row.date;return '<tr class="'+(dayStart?'payroll-day-start':'')+'"><td>'+esc(row.date)+'</td><td>'+student+'</td><td>'+esc(row.specialLesson?'贈送／特殊加課・'+(row.subject||'未標示課程'):row.subject||'未標示課程')+'</td><td>'+money(row.lessonPrice)+'</td><td>'+money(collected)+'</td><td>'+esc(splitText(row))+'</td><td><b>'+money(row.teacherAmount)+'</b>'+payDetail+'</td></tr>';}).join('')+'</tbody></table></div>';
    var adjustmentTable='<section class="settings-card teacher-adjustment-history"><h3>獎勵／扣薪紀錄</h3><p>選擇上方月份即可查看過去資料；每筆原因與金額都會保留。</p>'+(adjustments.length?'<div class="table-wrap"><table class="payroll-detail-table"><thead><tr><th>日期</th><th>類型</th><th>原因</th><th>金額</th></tr></thead><tbody>'+adjustments.map(function(row){var signed=signedTeacherAdjustment(row);return '<tr><td>'+esc(row.date)+'</td><td><span class="tag '+(signed<0?'red':'green')+'">'+esc(teacherAdjustmentLabel(row))+'</span></td><td>'+esc(row.note||'未填原因')+'</td><td><b>'+(signed<0?'－':'＋')+money(Math.abs(signed))+'</b></td></tr>';}).join('')+'</tbody></table></div>':'<div class="empty-state"><h3>這個月份沒有獎勵或扣薪</h3><p>新增後會在這裡保留明細。</p></div>')+'</section>';
    $('teacherPayrollBody').innerHTML=summary+(rows.length?table:'<div class="empty-state"><h3>這個月份沒有實際簽到課程</h3><p>只有排課、沒有老師簽到，或已註銷的課程不會列入課堂薪資。</p></div>')+adjustmentTable;
  }

  function openTeacherAdjustment(teacherId){
    var teacher=teacherById(teacherId);if(!teacher.id){toast('找不到老師','請重新整理資料後再試。','error');return;}
    $('teacherAdjustmentForm').reset();$('teacherAdjustmentTeacherId').value=teacher.id;$('teacherAdjustmentRequestId').value=uid('teacher_adjustment');
    var selectedMonth=$('teacherPayrollModal').classList.contains('open')&&$('teacherPayrollMonth').value?$('teacherPayrollMonth').value:'',today=todayKey();
    $('teacherAdjustmentDate').value=selectedMonth&&selectedMonth!==today.slice(0,7)?selectedMonth+'-01':today;$('teacherAdjustmentType').value='reward';
    $('teacherAdjustmentTitle').textContent=teacher.name+'・新增獎勵／扣薪';$('teacherAdjustmentSubtitle').textContent='可補登過去日期；儲存後會列入該月份薪資並永久保留。';openModal('teacherAdjustmentModal');
  }

  async function submitTeacherAdjustment(event){
    event.preventDefault();if(operationRunning)return;
    var teacherId=$('teacherAdjustmentTeacherId').value,date=$('teacherAdjustmentDate').value,type=$('teacherAdjustmentType').value,amount=numberOf($('teacherAdjustmentAmount').value),note=$('teacherAdjustmentNote').value.trim(),teacher=teacherById(teacherId),pin=storedMigrationPin()||migrationPin();
    if(!pin)return;if(!teacher.id||!date||['reward','deduction'].indexOf(type)<0||amount<=0||Math.floor(amount)!==amount||note.length<2){toast('資料未完成','請確認日期、類型、整數金額與至少 2 個字的原因。','error');return;}
    if(!window.YouziCoursePreviewData||typeof window.YouziCoursePreviewData.saveTeacherAdjustment!=='function'){toast('薪資元件尚未載入','請重新整理頁面後再試。','error');return;}
    operationRunning=true;operationButton($('teacherAdjustmentSubmitBtn'),true,'正在儲存…');$('operationProgressText').textContent='正在儲存老師獎勵／扣薪…';$('operationProgress').classList.remove('hidden');
    try{
      var result=await window.YouziCoursePreviewData.saveTeacherAdjustment({manualSyncPin:pin,requestId:$('teacherAdjustmentRequestId').value,teacherId:teacherId,date:date,type:type,amount:amount,note:note}),row=result.adjustment;
      upsert(state.teacherAdjustments,row);save(teacher.name+'・'+(type==='deduction'?'扣薪 ':'獎勵 ')+money(amount));closeModal('teacherAdjustmentModal');
      if($('teacherPayrollModal').classList.contains('open')&&currentTeacherId===teacherId){$('teacherPayrollMonth').value=date.slice(0,7);renderTeacherPayroll();}renderTeachers();
      toast(result.duplicate?'沒有重複新增':'薪資異動已儲存',(type==='deduction'?'扣薪 ':'獎勵 ')+money(amount)+' 已列入 '+date.slice(0,7)+' 薪資。');
    }catch(error){var message=clean(error&&error.message||'老師薪資異動儲存失敗');if(message.indexOf('密碼')>=0||message.indexOf('permission-denied')>=0)clearMigrationPin();toast('儲存失敗',message.slice(0,220),'error');}
    finally{operationRunning=false;$('operationProgress').classList.add('hidden');operationButton($('teacherAdjustmentSubmitBtn'),false);}
  }

  function renderSettings(){
    populateTimeSettings();renderRoomRows();renderSubjectRows();renderFeeRows();renderLeaveRows();
  }
  function populateTimeSettings(){var labels={mon:'星期一',tue:'星期二',wed:'星期三',thu:'星期四',fri:'星期五',sat:'星期六',sun:'星期日'},hours=normalizeDailyHours(state.settings.dailyHours),options='';for(var min=360;min<=1440;min+=30){var value=min===1440?'24:00':minToTime(min);options+='<option value="'+value+'">'+value+'</option>';}$('dailyHoursRows').innerHTML=['mon','tue','wed','thu','fri','sat','sun'].map(function(day){var row=hours[day];return '<div class="daily-hours-row" data-daily-hours="'+day+'"><b>'+labels[day]+'</b><label class="daily-hours-closed"><input type="checkbox" data-day-closed '+(row.closed?'checked':'')+'>不開放</label><label>開始<select data-day-start>'+options+'</select></label><label>結束<select data-day-end>'+options+'</select></label></div>';}).join('');$$('[data-daily-hours]').forEach(function(container){var day=container.dataset.dailyHours,row=hours[day],closed=qs('[data-day-closed]',container),start=qs('[data-day-start]',container),end=qs('[data-day-end]',container);start.value=row.start;end.value=row.end;function sync(){start.disabled=closed.checked;end.disabled=closed.checked;container.classList.toggle('closed',closed.checked);}closed.addEventListener('change',sync);sync();});fillSelect($('feeSubjectFilter'),activeSubjects(),function(row){return row.name;},function(row){return row.id;});$('feeSubjectFilter').insertAdjacentHTML('afterbegin','<option value="all">全部科目</option>');}
  function renderRoomRows(){$('roomRows').innerHTML=state.rooms.slice().sort(bySort).map(function(row){var restricted=Array.isArray(row.allowedSubjectIds)&&row.allowedSubjectIds.length,allowed=restricted?row.allowedSubjectIds.map(function(id){return subjectById(id).name;}).filter(Boolean).join('、'):'全部啟用科目';if(restricted&&!allowed)allowed='沒有開放科目';return '<tr><td><b>'+esc(row.name)+'</b><small>'+esc(row.note||'')+'</small></td><td>'+money(row.rentalFee)+'</td><td>'+esc(allowed)+'</td><td><span class="tag '+(row.active!==false?'green':'gray')+'">'+(row.active!==false?'啟用':'停用')+'</span></td><td><button class="btn small secondary" data-room-policy="'+row.id+'">教室設定</button></td></tr>';}).join('');}
  function renderSubjectRows(){$('subjectRows').innerHTML=state.subjects.slice().sort(bySort).map(function(row){var teachers=state.teachers.filter(function(t){return t.subjectIds.indexOf(row.id)>=0;}).map(function(t){return t.name;}),plans=state.feePlans.filter(function(p){return p.subjectId===row.id;});return '<tr><td>'+row.sort+'</td><td><b>'+esc(row.name)+'</b></td><td>'+esc(teachers.join('、')||'尚無')+'</td><td>'+plans.length+' 套</td><td><span class="tag '+(row.active!==false?'green':'gray')+'">'+(row.active!==false?'上架中':'停用')+'</span></td><td><button class="btn small outline" data-subject-edit="'+row.id+'">編輯</button></td></tr>';}).join('');}
  function renderFeeRows(){var filter=$('feeSubjectFilter').value||'all',rows=state.feePlans.filter(function(row){return filter==='all'||row.subjectId===filter;}).sort(bySort);$('feePlanRows').innerHTML=rows.map(function(row){return '<tr '+(isSandbox()?'draggable="true"':'')+' data-fee-drag="'+row.id+'" class="'+(row.active===false?'inactive-row':'')+'"><td><span class="drag-handle" title="按住後上下拖曳">↕</span></td><td>'+esc(subjectById(row.subjectId).name||'未設定')+'</td><td><b>'+esc(row.name)+'</b></td><td>'+money(row.amount)+'／'+row.lessonCount+' 堂</td><td>'+splitLabel(row)+'</td><td>'+((row.leaveNoDeduct)?'請假不扣堂':'請假照常扣堂')+'</td><td><span class="tag '+(row.active!==false?'green':'gray')+'">'+(row.active!==false?'上架中':'停用')+'</span></td><td><button class="btn small outline" data-fee-edit="'+row.id+'">編輯</button></td></tr>';}).join('');}
  function renderLeaveRows(){$('leaveReasonRows').innerHTML=state.leaveReasons.slice().sort(bySort).map(function(row){return '<tr><td>'+row.sort+'</td><td>'+esc(row.name)+'</td><td><span class="tag '+(row.active!==false?'green':'gray')+'">'+(row.active!==false?'啟用':'停用')+'</span></td><td><button class="btn small outline" data-leave-edit="'+row.id+'">編輯</button></td></tr>';}).join('');}

  function openEntity(type,id){if(!writable('編輯設定'))return;entityContext={type:type,id:id||''};var row={};if(type==='student')row=studentById(id);if(type==='teacher')row=teacherById(id);if(type==='room')row=roomById(id);if(type==='subject')row=subjectById(id);if(type==='fee')row=feeById(id);if(type==='leave')row=state.leaveReasons.find(function(item){return item.id===id;})||{};var title={student:'學生',teacher:'老師',room:'教室',subject:'科目',fee:'收費方案',leave:'請假原因'}[type];$('entityModalTitle').textContent=(id?'編輯':'新增')+title;$('entityModalSubtitle').textContent=type==='teacher'?'勾選可授課科目後，排課只會顯示符合老師。':type==='fee'?'本設定會在建立學生學費期別時保存快照。':type==='room'?'已被歷史課程引用的教室建議停用，不直接刪除。':'';var html='';
    if(type==='student')html=formFields([{id:'entityName',label:'學生名稱',value:row.name,required:true},{id:'entityPhone',label:'手機號碼',value:row.phone},{id:'entityLine',label:'LINE 狀態',type:'select',value:String(row.line),options:[['null','未確認'],['true','已綁定'],['false','未綁定']]},{id:'entityActive',label:'狀態',type:'select',value:String(row.active!==false),options:[['true','上課中'],['false','停課']]},{id:'entityNote',label:'備註',type:'textarea',value:row.note,full:true}]);
    if(type==='teacher')html=formFields([{id:'entityName',label:'老師名稱',value:row.name,required:true},{id:'entityPhone',label:'手機號碼',value:row.phone},{id:'entityActive',label:'狀態',type:'select',value:String(row.active!==false),options:[['true','啟用'],['false','停用']]},{id:'entityNote',label:'備註',type:'textarea',value:row.note,full:true}])+'<div class="field full compact-subject-field"><label>可教授科目</label><small>只顯示系統目前啟用的科目；排課時會依這裡自動篩選老師。</small><div class="compact-check-grid">'+activeSubjects().map(function(subject){return '<label class="check-label"><input type="checkbox" name="teacherSubject" value="'+subject.id+'" '+((row.subjectIds||[]).indexOf(subject.id)>=0?'checked':'')+'>'+esc(subject.name)+'</label>';}).join('')+'</div></div>';
    if(type==='room')html=formFields([{id:'entityName',label:'教室名稱',value:row.name,required:true},{id:'entityRentalFee',label:'預設租金',type:'number',value:row.rentalFee||0},{id:'entityActive',label:'狀態',type:'select',value:String(row.active!==false),options:[['true','啟用'],['false','停用']]},{id:'entityNote',label:'教室備註',type:'textarea',value:row.note,full:true}]);
    if(type==='subject')html=formFields([{id:'entityName',label:'科目名稱',value:row.name,required:true},{id:'entitySort',label:'排序',type:'number',value:row.sort||state.subjects.length+1},{id:'entityActive',label:'狀態',type:'select',value:String(row.active!==false),options:[['true','上架中'],['false','停用']]}]);
    if(type==='leave')html=formFields([{id:'entityName',label:'請假原因',value:row.name,required:true},{id:'entitySort',label:'排序',type:'number',value:row.sort||state.leaveReasons.length+1},{id:'entityActive',label:'狀態',type:'select',value:String(row.active!==false),options:[['true','啟用'],['false','停用']]}]);
    if(type==='fee')html=formFields([{id:'entitySubject',label:'科目',type:'select',value:row.subjectId,required:true,options:activeSubjects().map(function(s){return [s.id,s.name];})},{id:'entityName',label:'方案名稱',value:row.name,required:true},{id:'entityAmount',label:'收費金額',type:'number',value:row.amount||0},{id:'entityLessons',label:'課堂數',type:'number',value:row.lessonCount||4},{id:'entitySplitType',label:'老師拆帳方式',type:'select',value:row.splitType||'ratio',options:[['ratio','比例'],['fixed','每堂固定金額'],['none','不計算']]},{id:'entitySplitValue',label:'拆帳數值',type:'number',value:row.splitValue||0},{id:'entityLeave',label:'請假規則',type:'select',value:String(row.leaveNoDeduct!==false),options:[['true','請假不扣堂'],['false','請假照常扣堂']]},{id:'entityExpiry',label:'有效天數（0 為不限）',type:'number',value:row.expiryDays||0},{id:'entityActive',label:'狀態',type:'select',value:String(row.active!==false),options:[['true','上架中'],['false','停用']]}]);
    $('entityModalBody').innerHTML='<div class="form-grid three">'+html+'</div>';openModal('entityModal');
  }
  function formFields(fields){return fields.map(function(field){var classes='field'+(field.full?' full':''),input='';if(field.type==='select')input='<select id="'+field.id+'">'+(field.options||[]).map(function(option){return '<option value="'+esc(option[0])+'" '+(String(field.value)===String(option[0])?'selected':'')+'>'+esc(option[1])+'</option>';}).join('')+'</select>';else if(field.type==='textarea')input='<textarea id="'+field.id+'">'+esc(field.value||'')+'</textarea>';else input='<input id="'+field.id+'" type="'+(field.type||'text')+'" value="'+esc(field.value||'')+'" '+(field.required?'required':'')+'>';return '<div class="'+classes+'"><label class="'+(field.required?'required':'')+'">'+esc(field.label)+'</label>'+input+'</div>';}).join('');}
  function submitEntity(event){event.preventDefault();var type=entityContext.type,id=entityContext.id,row={},old={},nextSort=function(collection){return collection.reduce(function(max,item){return Math.max(max,numberOf(item.sort));},0)+10;};if(type==='student'){row={id:id||uid('student'),name:$('entityName').value.trim(),phone:$('entityPhone').value.trim(),line:$('entityLine').value==='null'?null:$('entityLine').value==='true',active:$('entityActive').value==='true',note:$('entityNote').value.trim()};upsert(state.students,row);}if(type==='teacher'){old=teacherById(id);row={id:id||uid('teacher'),name:$('entityName').value.trim(),phone:$('entityPhone').value.trim(),reward:numberOf(old.reward),deduction:numberOf(old.deduction),active:$('entityActive').value==='true',note:$('entityNote').value.trim(),subjectIds:$$('input[name="teacherSubject"]',$('entityModalBody')).filter(function(box){return box.checked;}).map(function(box){return box.value;})};upsert(state.teachers,row);}if(type==='room'){old=roomById(id);row={id:id||uid('room'),name:$('entityName').value.trim(),sort:numberOf(old.sort)||nextSort(state.rooms),rentalFee:numberOf($('entityRentalFee').value),active:$('entityActive').value==='true',note:$('entityNote').value.trim(),allowedSubjectIds:Array.isArray(old.allowedSubjectIds)?old.allowedSubjectIds:[],policies:old.policies||{}};upsert(state.rooms,row);}if(type==='subject'){row={id:id||uid('subject'),name:$('entityName').value.trim(),sort:numberOf($('entitySort').value),active:$('entityActive').value==='true'};upsert(state.subjects,row);}if(type==='leave'){row={id:id||uid('leave'),name:$('entityName').value.trim(),sort:numberOf($('entitySort').value),active:$('entityActive').value==='true'};upsert(state.leaveReasons,row);}if(type==='fee'){old=feeById(id);row={id:id||uid('fee'),subjectId:$('entitySubject').value,sort:numberOf(old.sort)||nextSort(state.feePlans),name:$('entityName').value.trim(),amount:numberOf($('entityAmount').value),lessonCount:numberOf($('entityLessons').value),splitType:$('entitySplitType').value,splitValue:numberOf($('entitySplitValue').value),leaveNoDeduct:$('entityLeave').value==='true',expiryDays:numberOf($('entityExpiry').value),active:$('entityActive').value==='true',listed:true};upsert(state.feePlans,row);}if(!row.name){toast('請填寫名稱','名稱不能空白。','error');return;}save('設定已儲存');closeModal('entityModal');refreshFormOptions();if(type==='student'&&returnToScheduleAfterStudent){var draft=scheduleDraftAfterStudent;returnToScheduleAfterStudent=false;scheduleDraftAfterStudent=null;openSchedule({draft:draft,newStudentId:row.id});toast('學生已新增','已返回排課並自動選擇 '+row.name+'。');return;}if(currentView==='settings')renderSettings();if(currentView==='teachers')renderTeachers();if(currentView==='students')renderStudents();}
  function upsert(collection,row){var index=collection.findIndex(function(item){return item.id===row.id;});if(index>=0)collection[index]=Object.assign({},collection[index],row);else collection.push(row);}

  function roomPianoType(room){
    var explicit=clean(room&&room.pianoType).toLowerCase(),equipment=Array.isArray(room&&room.rentalEquipment)?room.rentalEquipment:[],name=clean(room&&room.name);
    if(['digital_piano','grand_piano','upright_piano','none'].indexOf(explicit)>=0)return explicit;
    if(equipment.indexOf('digital_piano')>=0)return 'digital_piano';
    if(equipment.indexOf('grand_piano')>=0)return 'grand_piano';
    if(equipment.indexOf('upright_piano')>=0)return 'upright_piano';
    if(/展演|團練/.test(name))return 'digital_piano';
    if(/YAMAHA.*平台|平台.*YAMAHA|5號鋼琴|五號鋼琴/i.test(name))return 'grand_piano';
    if(/KAWAI|卡哇伊|YAMAHA.*直立|直立.*YAMAHA/i.test(name))return 'upright_piano';
    return 'none';
  }
  function openPolicy(roomId){
    policyRoomId=roomId;
    var room=roomById(roomId),weekdays=[['mon','星期一'],['tue','星期二'],['wed','星期三'],['thu','星期四'],['fri','星期五'],['sat','星期六'],['sun','星期日']],allowed=Array.isArray(room.allowedSubjectIds)?room.allowedSubjectIds:[],useOptions=[['piano','彈鋼琴'],['drums','練鼓'],['band','團練'],['guzheng','古箏'],['recording','錄音室'],['other','其他用途']],pianoOptions=[['none','無鋼琴'],['digital_piano','電鋼琴'],['grand_piano','平台鋼琴'],['upright_piano','直立鋼琴']],equipmentOptions=[['acoustic_drums','傳統鼓'],['electronic_drums','電子鼓']],hasExplicitRoomUses=room.roomRulesVersion===1&&Object.prototype.hasOwnProperty.call(room,'rentalUseTypes')&&Array.isArray(room.rentalUseTypes),roomUses=hasExplicitRoomUses?room.rentalUseTypes.slice():[],roomEquipment=Array.isArray(room.rentalEquipment)?room.rentalEquipment:[],pianoType=roomPianoType(room),name=clean(room.name);
    if(roomUses.indexOf('guitar')>=0||roomUses.indexOf('teaching')>=0)roomUses.push('other');
    roomUses=Array.from(new Set(roomUses.filter(function(value){return useOptions.some(function(option){return option[0]===value;});})));
    if(!hasExplicitRoomUses){
      roomUses=['other'];
      if(/鋼琴|平台|琴房|piano|yamaha|kawai|卡哇伊|展演|團練/i.test(name))roomUses.push('piano');
      if(/鼓|展演|團練/.test(name))roomUses.push('drums');
      if(/展演|團練|表演/.test(name))roomUses.push('band');
      if(/展演|kawai|卡哇伊/i.test(name))roomUses.push('guzheng');
      if(/錄音室|錄音/.test(name))roomUses.push('recording');
      roomUses=Array.from(new Set(roomUses));
    }
    if(!roomEquipment.length){if(/傳統鼓|爵士鼓|團練/.test(name))roomEquipment.push('acoustic_drums');if(/電子鼓/.test(name))roomEquipment.push('electronic_drums');}
    $('policyWeekday').innerHTML=weekdays.map(function(row){return '<option value="'+row[0]+'">'+row[1]+'</option>';}).join('');
    $('policyModalTitle').textContent=room.name+'・教室設定';
    $('policyRoomName').value=room.name||'';
    $('policyRentalFee').value=numberOf(room.rentalFee);
    $('policyRoomCapacity').value=Math.max(1,numberOf(room.capacity)||(/展演|團練|表演/.test(name)?8:3));
    $('policyRoomActive').value=String(room.active!==false);
    $('policyRoomNote').value=room.note||'';
    $('policyRentalUseChoices').innerHTML=useOptions.map(function(option){return '<label class="check-label"><input type="checkbox" data-policy-rental-use="'+option[0]+'" '+(roomUses.indexOf(option[0])>=0?'checked':'')+'>'+option[1]+'</label>';}).join('');
    $('policyRentalEquipmentChoices').innerHTML=pianoOptions.map(function(option){return '<label class="check-label"><input type="radio" name="policyPianoType" value="'+option[0]+'" '+(pianoType===option[0]?'checked':'')+'>'+option[1]+'</label>';}).join('')+equipmentOptions.map(function(option){return '<label class="check-label"><input type="checkbox" data-policy-rental-equipment="'+option[0]+'" '+(roomEquipment.indexOf(option[0])>=0?'checked':'')+'>'+option[1]+'</label>';}).join('');
    $('policySubjectChoices').innerHTML=activeSubjects().map(function(subject){var checked=!allowed.length||allowed.indexOf(subject.id)>=0;return '<label class="check-label"><input type="checkbox" data-policy-room-subject="'+subject.id+'" '+(checked?'checked':'')+'>'+esc(subject.name)+'</label>';}).join('');
    renderPolicy();openModal('policyModal');
  }
  function renderPolicy(){var room=roomById(policyRoomId),day=$('policyWeekday').value||'mon',dayPolicies=(room.policies||{})[day]||{},html='';for(var min=overallScheduleRange(state.settings.dailyHours).start;min<overallScheduleRange(state.settings.dailyHours).end;min+=30){var time=minToTime(min),explicit=Object.prototype.hasOwnProperty.call(dayPolicies,time),policy=dayPolicies[time]||{},allowSchedule=explicit?!policy.blockSchedule:true,allowRental=explicit?!policy.blockRental:true;html+='<div class="policy-row simple '+(min%60===0?'hour':'')+'"><strong>'+time+'</strong><label class="check-label"><input type="checkbox" data-policy-schedule="'+time+'" '+(allowSchedule?'checked':'')+'>可排課</label><label class="check-label"><input type="checkbox" data-policy-rental="'+time+'" '+(allowRental?'checked':'')+'>可租用</label><span>'+(allowSchedule&&allowRental?'全部開放':allowSchedule?'只可排課':allowRental?'只可租用':'不開放')+'</span></div>';}$('policyModalBody').innerHTML=html;}
  function applyPolicyBulk(mode){var body=$('policyModalBody');$$('[data-policy-schedule]',body).forEach(function(box){var rental=qs('[data-policy-rental="'+box.dataset.policySchedule+'"]',body);box.checked=mode!=='close';rental.checked=mode==='open';});}
  async function savePolicy(){
    if(!writable('儲存教室設定'))return;
    var room=roomById(policyRoomId),day=$('policyWeekday').value,body=$('policyModalBody'),selected=$$('[data-policy-room-subject]',$('policySubjectChoices')).filter(function(box){return box.checked;}).map(function(box){return box.dataset.policyRoomSubject;}),allCount=activeSubjects().length,pianoChoice=qs('input[name="policyPianoType"]:checked',$('policyRentalEquipmentChoices')),pianoType=pianoChoice?pianoChoice.value:'none';
    room.name=$('policyRoomName').value.trim()||room.name;
    room.rentalFee=numberOf($('policyRentalFee').value);
    room.capacity=Math.max(1,numberOf($('policyRoomCapacity').value)||1);
    room.rentalUseTypes=$$('[data-policy-rental-use]',$('policyRentalUseChoices')).filter(function(box){return box.checked;}).map(function(box){return box.dataset.policyRentalUse;});
    room.roomRulesVersion=1;
    room.pianoType=pianoType;
    room.rentalEquipment=$$('[data-policy-rental-equipment]',$('policyRentalEquipmentChoices')).filter(function(box){return box.checked;}).map(function(box){return box.dataset.policyRentalEquipment;});
    if(pianoType!=='none')room.rentalEquipment.push('piano',pianoType);
    room.rentalEquipment=Array.from(new Set(room.rentalEquipment));
    room.active=$('policyRoomActive').value==='true';
    room.note=$('policyRoomNote').value.trim();
    room.allowedSubjectIds=selected.length===allCount?[]:selected.length?selected:['__none__'];
    if(!room.policies)room.policies={};
    if(!room.policies[day])room.policies[day]={};
    $$('[data-policy-schedule]',body).forEach(function(box){var time=box.dataset.policySchedule,rental=qs('[data-policy-rental="'+time+'"]',body);room.policies[day][time]={blockSchedule:!box.checked,blockRental:!rental.checked,subjectIds:[]};});
    save('教室設定已儲存');
    closeModal('policyModal');refreshFormOptions();renderSettings();renderCalendar();
    var pin=storedMigrationPin()||migrationPin();
    if(!pin){toast('教室設定已儲存','本機設定已保存；下次輸入同步密碼後會再套用到租用入口。');return;}
    try{
      if(!window.YouziCoursePreviewData||typeof window.YouziCoursePreviewData.saveRoomSettings!=='function')throw new Error('教室設備同步元件尚未載入。');
      await window.YouziCoursePreviewData.saveRoomSettings({
        manualSyncPin:pin,
        roomId:room.id,
        publicName:room.name,
        note:room.note,
        rentalFee:room.rentalFee,
        capacity:room.capacity,
        active:room.active!==false,
        rentable:room.rentable!==false,
        teacherSchedulable:room.teacherSchedulable!==false,
        allowedSubjectIds:room.allowedSubjectIds,
        rentalUseTypes:room.rentalUseTypes,
        policies:room.policies,
        pianoType:room.pianoType,
        equipment:room.rentalEquipment
      });
      toast('教室設定已儲存','教室用途、設備、鋼琴種類、科目與開放時段都已同步；排課與租用會共用同一套條件。');
    }catch(error){
      var message=clean(error&&error.message||'教室設備同步失敗');
      if(message.indexOf('密碼')>=0||message.indexOf('permission-denied')>=0)clearMigrationPin();
      toast('本機設定已保存，租用入口尚未同步',message.slice(0,220),'error');
    }
  }

  function storedMigrationPin(){
    var value='';try{value=clean(sessionStorage.getItem(PIN_KEY));}catch(_){}
    return value;
  }

  function migrationPin(){
    var value=storedMigrationPin();
    if(value)return value;
    value=clean(window.prompt('請輸入音教雲「手動同步密碼」：')||'');
    if(!value)return '';
    if(value.length<12||value.length>64){toast('密碼格式不正確','手動同步密碼應為 12～64 碼。','error');return '';}
    try{sessionStorage.setItem(PIN_KEY,value);}catch(_){}
    return value;
  }

  function clearMigrationPin(){try{sessionStorage.removeItem(PIN_KEY);}catch(_){}}

  function mergePortalRentals(target,result){
    if(!target||target.version!==3)return target;
    result=result||{};
    var bookingIds=new Set((result.bookingIds||[]).map(clean).filter(Boolean));
    target.events=(target.events||[]).filter(function(row){
      if(row.type!=='rental')return true;
      if(clean(row.source)==='course-portal')return false;
      return !bookingIds.has(clean(row.id));
    }).concat(clone(result.events||[]));
    if(!target.dataMeta||typeof target.dataMeta!=='object')target.dataMeta={};
    target.dataMeta.portalBookingsUpdatedAt=clean(result.updatedAt)||new Date().toISOString();
    return normalizeState(target);
  }

  async function refreshPortalRentals(){
    var pin=storedMigrationPin();
    if(!pin||!state||!window.YouziCoursePreviewData||typeof window.YouziCoursePreviewData.loadPortalRentals!=='function')return false;
    try{
      var result=await window.YouziCoursePreviewData.loadPortalRentals({manualSyncPin:pin});
      if(formalState&&formalState.version===3){
        formalState=mergePortalRentals(formalState,result);
        formalState.readOnly=true;
        formalState.dataMode='migration';
      }
      state=mergePortalRentals(state,result);
      if(state.dataMode==='sandbox')state.readOnly=false;
      if(formalState&&formalState.version===3)await storeSynchronizedDatabases(formalState,state);
      else await storeWorkspaceDatabase(state);
      updateModeUI();
      if(currentView==='calendar')renderCalendar();
      return true;
    }catch(error){
      var message=clean(error&&error.message);
      if(message.indexOf('密碼')>=0||message.indexOf('permission-denied')>=0)clearMigrationPin();
      return false;
    }
  }

  async function forceCancelPortalRental(button){
    var event=findEvent($('eventModal').dataset.eventId),bookingId=clean(button&&button.dataset.portalRentalCancel||event&&event.portalBookingId);
    if(!event||!bookingId)return;
    if(!window.confirm('確定要強制取消「'+eventDisplayName(event)+'」這筆教室租用嗎？取消後會立即釋放教室時段。'))return;
    var entered=window.prompt('取消原因（可以留白）：','管理者取消');
    if(entered===null)return;
    var pin=migrationPin();
    if(!pin)return;
    if(!window.YouziCoursePreviewData||typeof window.YouziCoursePreviewData.cancelPortalRental!=='function'){toast('取消功能尚未載入','請重新整理頁面後再試。','error');return;}
    button.disabled=true;
    try{
      var result=await window.YouziCoursePreviewData.cancelPortalRental({manualSyncPin:pin,bookingId:bookingId,reason:clean(entered)});
      closeModal('eventModal');
      await refreshPortalRentals();
      toast('租用已取消',clean(result&&result.message)||'教室時段已釋放。');
    }catch(error){
      var message=clean(error&&error.message||'取消租用失敗');
      if(message.indexOf('密碼')>=0||message.indexOf('permission-denied')>=0)clearMigrationPin();
      toast('取消租用失敗',message,'error');
    }finally{button.disabled=false;}
  }

  function preserveWorkspaceConfiguration(target,previous){
    if(!previous||previous.dataMode==='empty')return target;
    target.settings=clone(previous.settings||target.settings||{});
    var previousRooms={};(previous.rooms||[]).forEach(function(row){previousRooms[row.id]=row;});
    target.rooms=(target.rooms||[]).map(function(room){
      var prior=previousRooms[room.id];if(!prior)return room;
      ['publicName','note','rentalFee','sort','active','allowedSubjectIds','policies','rentalUseTypes','rentalEquipment','pianoType','capacity','roomRulesVersion','roomKind','rentable','teacherSchedulable'].forEach(function(key){
        if(Object.prototype.hasOwnProperty.call(prior,key))room[key]=prior[key]&&typeof prior[key]==='object'?clone(prior[key]):prior[key];
      });
      return room;
    });
    var previousFees={};(previous.feePlans||[]).forEach(function(row){previousFees[row.id]=row;});
    target.feePlans=(target.feePlans||[]).map(function(row){
      var prior=previousFees[row.id];if(prior){row.sort=prior.sort;row.listed=prior.listed;}return row;
    });
    var previousSubjects={};(previous.subjects||[]).forEach(function(row){previousSubjects[row.id]=row;});
    target.subjects=(target.subjects||[]).map(function(row){if(previousSubjects[row.id])row.sort=previousSubjects[row.id].sort;return row;});
    return target;
  }

  function workspaceFromFormal(source,previous,preserveConfiguration){
    var next=clone(source);
    if(preserveConfiguration)next=preserveWorkspaceConfiguration(next,previous);
    next.currentDate=dateKey(previous&&previous.currentDate)||dateKey(next.currentDate)||todayKey();
    next.readOnly=false;next.dataMode='sandbox';next.clipboard=null;
    next.sandboxMeta={
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString(),
      baselineRunId:sandboxRunId(source)||'音教雲同步資料',
      baselineLoadedAt:clean((source.dataMeta||{}).loadedAt)
    };
    next=normalizeState(next);next.readOnly=false;next.dataMode='sandbox';
    return next;
  }

  async function applyFormalState(source,options){
    options=options||{};
    var previous=options.previousWorkspace||state;
    var nextFormal=normalizeState(clone(source));nextFormal.readOnly=true;nextFormal.dataMode='migration';
    var nextWorkspace=workspaceFromFormal(nextFormal,previous,options.preserveConfiguration===true);
    var stored=await storeSynchronizedDatabases(nextFormal,nextWorkspace);
    if(!stored)throw new Error('最新資料無法安全寫入本機，原資料未變更。');
    formalState=nextFormal;
    state=nextWorkspace;
    updateModeUI();refreshFormOptions();switchView(options.keepView===false?'calendar':currentView);
    return state;
  }

  async function restoreFormalDatabase(){
    var cached=formalState&&formalState.dataMode!=='empty'?formalState:await readFormalDatabase();
    if(cached&&cached.version===3){
      formalState=normalizeState(cached);formalState.readOnly=true;formalState.dataMode='migration';
      var workspace=await readWorkspaceDatabase();
      if(
        workspace&&workspace.version===3&&
        clean((workspace.sandboxMeta||{}).baselineRunId)===sandboxRunId(formalState)
      ){
        state=normalizeState(workspace);state.readOnly=false;state.dataMode='sandbox';
      }else{
        state=workspaceFromFormal(formalState,null,false);
        await storeWorkspaceDatabase(state);
      }
      await storeFormalDatabase(formalState);
      try{localStorage.removeItem(FORMAL_CACHE_KEY);}catch(_){}
      updateModeUI();refreshFormOptions();switchView(currentView);
      toast('資料已自動開啟','上次操作已保留；要取得舊系統最新內容時再按同步。');
      return true;
    }
    var pin=storedMigrationPin();
    if(!pin)return false;
    loadingMigration=true;updateModeUI();
    try{
      await loadMigrationFromMirror(pin,{preserveConfiguration:false});
      toast('資料已自動載入','之後開啟課程日表會直接顯示，不需要重複載入。');
      return true;
    }catch(error){
      var message=clean(error&&error.message||'無法自動讀取同步資料');
      if(message.indexOf('密碼')>=0||message.indexOf('permission-denied')>=0)clearMigrationPin();
      return false;
    }finally{loadingMigration=false;updateModeUI();}
  }

  async function loadMigrationFromMirror(pin,options){
    options=options||{};
    if(!window.YouziCoursePreviewData||typeof window.YouziCoursePreviewData.load!=='function')throw new Error('音教雲同步元件尚未載入。');
    var previous=state;
    var loaded=await window.YouziCoursePreviewData.load({manualSyncPin:pin,anchorDate:state&&state.currentDate||todayKey()});
    if(!loaded.dataMeta||typeof loaded.dataMeta!=='object')loaded.dataMeta={};
    await applyFormalState(loaded,{
      previousWorkspace:previous,
      preserveConfiguration:options.preserveConfiguration===true,
      keepView:true
    });
    try{localStorage.removeItem(FORMAL_CACHE_KEY);}catch(_){}
    return state;
  }

  async function syncInjiaoyun(){
    if(loadingMigration)return;
    if(!window.confirm('更新後，新版目前測試中的課務、調課、簽到與款項紀錄會由舊音教雲最新資料覆蓋；教室排列與新版系統設定會保留。確定更新嗎？'))return;
    var pin=migrationPin();if(!pin)return;
    if(!window.YouziCoursePreviewData||typeof window.YouziCoursePreviewData.sync!=='function'){toast('同步元件尚未載入','請重新整理頁面後再試。','error');return;}
    loadingMigration=true;operationRunning=true;$('syncInjiaoyunBtn').disabled=true;$('operationProgressText').textContent='正在同步課表、簽到、學費、租用與老師薪資…';$('operationProgress').classList.remove('hidden');updateModeUI();
    try{
      var refreshDate=todayKey();
      var result=await window.YouziCoursePreviewData.sync({manualSyncPin:pin,refreshDate:refreshDate});
      var summary=result.summary||{};
      await loadMigrationFromMirror(pin,{preserveConfiguration:true});
      toast('全部同步完成',(result.refreshStartDate||refreshDate)+'～'+refreshDate+' 已更新課表、簽到、學費、租用與薪資；新增 '+numberOf(summary.created)+'、更新 '+numberOf(summary.updated)+'。');
    }catch(error){
      var message=clean(error&&error.message||'音教雲同步失敗');
      if(message.indexOf('密碼')>=0||message.indexOf('permission-denied')>=0)clearMigrationPin();
      toast('同步失敗，原資料已保留',message.slice(0,220),'error');
    }finally{loadingMigration=false;operationRunning=false;$('operationProgress').classList.add('hidden');$('syncInjiaoyunBtn').disabled=false;updateModeUI();}
  }

  function bindEvents(){
    bindRoomReorder();
    bindFeeReorder();
    $$('[data-view]').forEach(function(node){node.addEventListener('click',function(){switchView(node.dataset.view);});});$$('[data-view-jump]').forEach(function(node){node.addEventListener('click',function(){switchView(node.dataset.viewJump);});});$$('[data-close-modal]').forEach(function(node){node.addEventListener('click',function(){closeModal(node.dataset.closeModal);});});$$('.modal-backdrop').forEach(function(node){node.addEventListener('click',function(event){if(event.target===node)closeModal(node.id);});});
    ['topNewEvent','sideNewEvent','calendarNewEvent'].forEach(function(id){var node=$(id);if(node)node.addEventListener('click',function(){openSchedule({date:state.currentDate});});});$$('[data-day-step]').forEach(function(node){node.addEventListener('click',function(){state.currentDate=shiftDate(state.currentDate,numberOf(node.dataset.dayStep));if(weekMode)weekAnchor=state.currentDate;renderCalendar();});});$('todayBtn').addEventListener('click',function(){state.currentDate=todayKey();weekAnchor=state.currentDate;renderCalendar();});$('calendarDate').addEventListener('change',function(){state.currentDate=this.value;weekAnchor=this.value;renderCalendar();});$('weekScheduleBtn').addEventListener('click',function(){weekAnchor=state.currentDate;setWeekMode(true);});$('closeWeekBtn').addEventListener('click',function(){setWeekMode(false);});$('thisWeekBtn').addEventListener('click',function(){weekAnchor=todayKey();renderWeekSchedule();});$$('[data-week-step]').forEach(function(button){button.addEventListener('click',function(){weekAnchor=shiftDate(weekStartKey(weekAnchor||state.currentDate),numberOf(button.dataset.weekStep)*7);renderWeekSchedule();});});$('weekTeacher').addEventListener('change',renderWeekSchedule);$('weekScheduleDays').addEventListener('click',function(event){var button=event.target.closest('[data-week-event-id]');if(!button)return;var date=button.dataset.weekEventDate,row=eventsForDate(date).find(function(item){return item.id===button.dataset.weekEventId;});if(row){state.currentDate=date;$('calendarDate').value=date;eventDetails(row);}});$('scheduleForm').addEventListener('submit',submitSchedule);
    $$('[data-schedule-kind]',$('scheduleTypeTabs')).forEach(function(button){button.addEventListener('click',function(){setScheduleKind(button.dataset.scheduleKind);updateScheduleConflict();});});$('eventStudentSearch').addEventListener('input',debounce(renderScheduleStudentMatches,120));$('eventStudentMatches').addEventListener('click',function(event){var button=event.target.closest('[data-schedule-student-id]');if(button)selectScheduleStudent(button.dataset.scheduleStudentId,true);});$('eventStudentSelected').addEventListener('click',function(event){if(event.target.closest('[data-clear-schedule-student]')){selectScheduleStudent('',false);$('eventStudentSearch').value='';$('eventStudentSearch').focus();}});['eventDate','eventStart','eventDuration','eventRoom','eventType','eventTeacher','eventTuitionPeriod'].forEach(function(id){$(id).addEventListener('change',function(){if(id==='eventDate')updateEventStartOptionsForDate(this.value,$('eventStart').value);if(id==='eventRoom')updateRentalFields(true);else if(id==='eventType')updateRentalFields(false);if(id==='eventTuitionPeriod')updateSpecialLessonFields(true);updateScheduleConflict();});});$('eventSubject').addEventListener('change',function(){updateTeacherOptions();updateTuitionOptions();updateRoomOptions();updateSpecialLessonFields(true);updateScheduleConflict();});$('eventStudent').addEventListener('change',function(){selectScheduleStudent(this.value,false);});$('eventSingleKind').addEventListener('change',function(){updateSpecialLessonFields(true);updateScheduleConflict();});$('eventFrequency').addEventListener('change',function(){$('repeatUntilField').classList.toggle('hidden',this.value==='once'||$('eventType').value!=='fixed');});$('quickAddStudent').addEventListener('click',function(){scheduleDraftAfterStudent=formEvent();scheduleDraftAfterStudent.frequency=$('eventFrequency').value;scheduleDraftAfterStudent.endDate=$('eventRepeatUntil').value;returnToScheduleAfterStudent=true;closeModal('scheduleModal');openEntity('student','');});
    $('scheduleGrid').addEventListener('click',function(event){var eventButton=event.target.closest('[data-event-id]');if(eventButton){var row=findEvent(eventButton.dataset.eventId);if(row)eventDetails(row);return;}var slot=event.target.closest('[data-slot-room]');if(slot){if(isReadOnly()){toast('資料尚未載入','請先同步音教雲資料。','error');return;}if(pasteToSlot(slot.dataset.slotRoom,slot.dataset.slotTime))return;openSchedule({date:state.currentDate,roomId:slot.dataset.slotRoom,start:slot.dataset.slotTime});}});$('cancelClipboard').addEventListener('click',function(){state.clipboard=null;renderCalendar();});
    $('eventModalBody').addEventListener('click',function(event){var rentalCancel=event.target.closest('[data-portal-rental-cancel]');if(rentalCancel){forceCancelPortalRental(rentalCancel);return;}var receipt=event.target.closest('[data-tuition-receipt-period]');if(receipt){ensureAndOpenTuitionReceipt(receipt);return;}var override=event.target.closest('[data-teacher-pay-override]');if(override){openTeacherPayOverride(override.dataset.teacherPayOverride);return;}var newPeriod=event.target.closest('[data-event-new-period]');if(newPeriod){closeModal('eventModal');openTuition(newPeriod.dataset.eventNewPeriod);return;}var action=event.target.closest('[data-event-action]');if(action){eventAction(action.dataset.eventAction);return;}var editPeriod=event.target.closest('[data-period-edit]');if(editPeriod){closeModal('eventModal');openTuition('',editPeriod.dataset.periodEdit);return;}var lesson=event.target.closest('[data-lesson-period]');if(lesson){openLessonAction(lesson.dataset.lessonPeriod,lesson.dataset.lessonSlot);return;}var pay=event.target.closest('[data-period-pay]');if(pay){closeModal('eventModal');openTransaction(pay.dataset.periodPay);return;}var button=event.target.closest('[data-attendance]');if(!button)return;var status=button.dataset.attendance,reason='';if(status==='leave'){var active=state.leaveReasons.filter(function(row){return row.active!==false;});reason=active.length?(window.prompt('請假原因（可填：'+active.map(function(row){return row.name;}).join('、')+'）')||''):'';var match=active.find(function(row){return row.name===reason;});reason=match?match.id:'';}setAttendance($('eventModal').dataset.eventId,status,reason);});$('eventModalFoot').addEventListener('click',function(event){var button=event.target.closest('[data-event-action]');if(button)eventAction(button.dataset.eventAction);});
    $('teacherPayOverrideType').addEventListener('change',renderTeacherPayOverridePreview);$('teacherPayOverrideAmount').addEventListener('input',renderTeacherPayOverridePreview);$('teacherPayOverrideForm').addEventListener('submit',submitTeacherPayOverride);
    $('studentRows').addEventListener('click',function(event){var button=event.target.closest('[data-student-id]');if(button)openStudent(button.dataset.studentId);});$('studentTabs').addEventListener('click',function(event){var button=event.target.closest('[data-student-tab]');if(button){studentTab=button.dataset.studentTab;renderStudentModal();}});$('studentModalBody').addEventListener('click',function(event){var receipt=event.target.closest('[data-tuition-receipt-period]');if(receipt){ensureAndOpenTuitionReceipt(receipt);return;}var editPeriod=event.target.closest('[data-period-edit]');if(editPeriod){closeModal('studentModal');openTuition('',editPeriod.dataset.periodEdit);return;}var lesson=event.target.closest('[data-lesson-period]');if(lesson){openLessonAction(lesson.dataset.lessonPeriod,lesson.dataset.lessonSlot);return;}var button=event.target.closest('[data-period-pay]');if(button)openTransaction(button.dataset.periodPay);});$('studentModalFoot').addEventListener('click',function(event){var button=event.target.closest('[data-student-action]');if(!button)return;if(button.dataset.studentAction==='edit'){closeModal('studentModal');openEntity('student',currentStudentId);}else openTuition(currentStudentId);});$('addStudentBtn').addEventListener('click',function(){openEntity('student','');});$('studentSearch').addEventListener('input',debounce(renderStudents,280));$('studentPaymentFilter').addEventListener('change',renderStudents);
    $('lessonActionFoot').addEventListener('click',function(event){var button=event.target.closest('[data-lesson-action]');if(!button)return;var periodId=$('lessonActionPeriodId').value,slotNo=numberOf($('lessonActionSlotNo').value);if(button.dataset.lessonAction==='void'){if(window.confirm('確定作廢第 '+slotNo+' 堂嗎？學費不會改變。'))voidLessonSlot(periodId,slotNo);}else{closeModal('lessonActionModal');openTransaction(periodId,slotNo);}});
    $('tuitionForm').addEventListener('submit',submitTuition);$('tuitionSubject').addEventListener('change',function(){updateTuitionForm();});$('tuitionPlan').addEventListener('change',renderTuitionSnapshot);$('tuitionPurchasePeriods').addEventListener('input',function(){updateTuitionPurchaseSummary(true);renderTuitionSnapshot();});$('tuitionAmount').addEventListener('input',function(){updateTuitionPurchaseSummary(true);});$('tuitionCollectNow').addEventListener('change',updateTuitionCollectionFields);$('transactionForm').addEventListener('submit',submitTransaction);$('transactionType').addEventListener('change',renderRefundLessonOptions);$('transactionRefundCount').addEventListener('change',function(){syncRefundSelection(true);});$('refundSlotChoices').addEventListener('change',function(){syncRefundSelection(false);});
    $('teacherCards').addEventListener('click',function(event){var adjustment=event.target.closest('[data-teacher-adjustment]'),payroll=event.target.closest('[data-teacher-payroll]'),edit=event.target.closest('[data-teacher-id]');if(adjustment){openTeacherAdjustment(adjustment.dataset.teacherAdjustment);return;}if(payroll)openTeacherPayroll(payroll.dataset.teacherPayroll);if(edit)openEntity('teacher',edit.dataset.teacherId);});$('teacherListMonth').addEventListener('change',function(){setTeacherListMonth(this.value);});$('teacherListMonthPrev').addEventListener('click',function(){setTeacherListMonth(shiftMonthKey(teacherListMonthKey(),-1));});$('teacherListMonthNext').addEventListener('click',function(){setTeacherListMonth(shiftMonthKey(teacherListMonthKey(),1));});$('teacherListMonthCurrent').addEventListener('click',function(){setTeacherListMonth(todayKey().slice(0,7));});$('teacherPayrollRefreshBtn').addEventListener('click',function(){var month=teacherListMonthKey();delete teacherPayrollMonthRefreshes[month];refreshTeacherPayrollMonth(month);});$('teacherPayrollMonth').addEventListener('change',function(){renderTeacherPayroll();refreshTeacherPayrollMonth(this.value);});$('teacherPayrollAdjustmentBtn').addEventListener('click',function(){openTeacherAdjustment(currentTeacherId);});$('teacherAdjustmentForm').addEventListener('submit',submitTeacherAdjustment);$('teacherPayrollBody').addEventListener('click',function(event){var student=event.target.closest('[data-payroll-student]');if(student){closeModal('teacherPayrollModal');openStudent(student.dataset.payrollStudent);}});$('addTeacherBtn').addEventListener('click',function(){openEntity('teacher','');});$('teacherSearch').addEventListener('input',debounce(renderTeachers,280));
    $$('.settings-tabs button').forEach(function(button){button.addEventListener('click',function(){$$('.settings-tabs button').forEach(function(node){node.classList.toggle('active',node===button);});$$('.settings-panel').forEach(function(panel){panel.classList.toggle('active',panel.dataset.settingsPanel===button.dataset.settingsTab);});});});$('saveSettingsBtn').addEventListener('click',function(){if(!writable('儲存設定'))return;var daily={},invalid='';$$('[data-daily-hours]').forEach(function(container){var day=container.dataset.dailyHours,closed=qs('[data-day-closed]',container).checked,start=qs('[data-day-start]',container).value,end=qs('[data-day-end]',container).value;if(!closed&&timeToMin(end)<=timeToMin(start))invalid=day;daily[day]={closed:closed,start:start,end:end};});if(invalid){toast('時間設定錯誤','每一天的結束時間都必須晚於開始時間。','error');return;}state.settings.dailyHours=normalizeDailyHours(daily);state.settings.dailyHoursVersion=1;var range=overallScheduleRange(state.settings.dailyHours);state.settings.startHour=Math.floor(range.start/60);state.settings.endHour=Math.ceil(range.end/60);save('系統設定已儲存');renderCalendar();toast('設定完成','課程日表會依星期顯示設定時段。');});
    $('addRoomBtn').addEventListener('click',function(){openEntity('room','');});$('addSubjectBtn').addEventListener('click',function(){openEntity('subject','');});$('addFeePlanBtn').addEventListener('click',function(){openEntity('fee','');});$('addLeaveReasonBtn').addEventListener('click',function(){openEntity('leave','');});$('roomRows').addEventListener('click',function(event){var policy=event.target.closest('[data-room-policy]');if(policy)openPolicy(policy.dataset.roomPolicy);});$('subjectRows').addEventListener('click',function(event){var button=event.target.closest('[data-subject-edit]');if(button)openEntity('subject',button.dataset.subjectEdit);});$('feePlanRows').addEventListener('click',function(event){var button=event.target.closest('[data-fee-edit]');if(button)openEntity('fee',button.dataset.feeEdit);});$('leaveReasonRows').addEventListener('click',function(event){var button=event.target.closest('[data-leave-edit]');if(button)openEntity('leave',button.dataset.leaveEdit);});$('feeSubjectFilter').addEventListener('change',renderFeeRows);$('entityForm').addEventListener('submit',submitEntity);$('policyWeekday').addEventListener('change',renderPolicy);$$('[data-policy-bulk]').forEach(function(button){button.addEventListener('click',function(){applyPolicyBulk(button.dataset.policyBulk);});});$('savePolicyBtn').addEventListener('click',savePolicy);$('syncInjiaoyunBtn').addEventListener('click',syncInjiaoyun);var conflictButton=$('conflictBtn');if(conflictButton)conflictButton.addEventListener('click',openCalendarIssues);$('calendarIssuesBtn').addEventListener('click',openCalendarIssues);$('calendarIssuesBody').addEventListener('click',function(event){var button=event.target.closest('[data-issue-event]');if(!button)return;var row=findEvent(button.dataset.issueEvent);if(row){closeModal('calendarIssuesModal');eventDetails(row);}});
    window.addEventListener('message',function(event){
      if(event.origin!==window.location.origin)return;
      var data=event.data||{};
      if(data.type==='youzi-course-view'){if(data.view==='calendar'){state.currentDate=todayKey();weekAnchor=state.currentDate;if(weekMode)setWeekMode(false);}switchView(data.view);}
    });
  }

  function init(){
    try{localStorage.removeItem('youzi.courseScheduler.sandbox.v1');localStorage.removeItem('youzi.courseScheduler.sandboxUndo.v1');localStorage.removeItem('youzi.courseScheduler.lastMode.v1');}catch(_){}
    embeddedMode=window.__YOUZI_COURSE_INLINE_MODE__===true||urlOption('embed')==='1';document.body.classList.toggle('embedded-in-operations',embeddedMode);requestPersistentStorage();
    state=loadInitialState();if(!formalState&&state.readOnly&&state.dataMode!=='empty')formalState=clone(state);bindEvents();refreshFormOptions();updateModeUI();switchView(requestedView());
    refreshPortalRentals();
    if(window.__YOUZI_COURSE_SCHEDULER_TEST__===true)window.YouziCourseSchedulerTest={snapshot:function(){return clone(state);},eventsForDate:function(date){return clone(eventsForDate(date));},effectiveEventsForDate:function(date){return clone(effectiveEventsForDate(date));},storeFormalCache:function(source){return storeFormalCache(source);},readFormalDatabase:readFormalDatabase,storeFormalDatabase:storeFormalDatabase,readWorkspaceDatabase:readWorkspaceDatabase,storeWorkspaceDatabase:storeWorkspaceDatabase,restoreFormalDatabase:restoreFormalDatabase};
  }
  if(window.__YOUZI_COURSE_INLINE_MODE__)init();else if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
