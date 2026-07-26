(function(){
  'use strict';

  var FORMAL_CACHE_KEY='youzi.courseScheduler.formalCache.v1';
  var PIN_KEY='youzi.injiaoyun.preview.pin';
  var state=null,formalState=null,currentView='calendar',currentStudentId='',currentTeacherId='',studentTab='profile';
  var entityContext={type:'',id:''},policyRoomId='',loadingMigration=false;
  var sandboxUndoStack=[],sandboxLastSnapshot=null;

  function $(id){return document.getElementById(id);}
  function qs(selector,root){return (root||document).querySelector(selector);}
  function $$(selector,root){return Array.from((root||document).querySelectorAll(selector));}
  function clean(value){return String(value==null?'':value).trim();}
  function numberOf(value){var n=Number(value);return Number.isFinite(n)?n:0;}
  function esc(value){return clean(value).replace(/[&<>'"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch];});}
  function uid(prefix){return (prefix||'id')+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);}
  function pad(value){return String(value).padStart(2,'0');}
  function dateKey(value){var date=value instanceof Date?value:new Date(clean(value).slice(0,10)+'T12:00:00');if(!Number.isFinite(date.getTime()))return '';return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate());}
  function todayKey(){return dateKey(new Date());}
  function shiftDate(key,days){var d=new Date(key+'T12:00:00');d.setDate(d.getDate()+Number(days||0));return dateKey(d);}
  function zhDate(key){var d=new Date(key+'T12:00:00');return d.getFullYear()+' 年 '+(d.getMonth()+1)+' 月 '+d.getDate()+' 日';}
  function weekdayName(key){return ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][new Date(key+'T12:00:00').getDay()];}
  function weekdayKey(key){return ['sun','mon','tue','wed','thu','fri','sat'][new Date(key+'T12:00:00').getDay()];}
  function timeToMin(value){var parts=clean(value||'00:00').split(':');return numberOf(parts[0])*60+numberOf(parts[1]);}
  function minToTime(value){value=((Number(value)%1440)+1440)%1440;return pad(Math.floor(value/60))+':'+pad(value%60);}
  function money(value){return '$'+Math.round(numberOf(value)).toLocaleString('zh-TW');}
  function unique(values){return Array.from(new Set((values||[]).map(clean).filter(Boolean)));}
  function debounce(fn,wait){var timer;return function(){var args=arguments,that=this;clearTimeout(timer);timer=setTimeout(function(){fn.apply(that,args);},wait||250);};}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function sum(values){return values.reduce(function(total,value){return total+numberOf(value);},0);}
  function bySort(a,b){return numberOf(a.sort)-numberOf(b.sort)||clean(a.name).localeCompare(clean(b.name),'zh-Hant');}

  function subjectById(id){return state.subjects.find(function(row){return row.id===id;})||{};}
  function teacherById(id){return state.teachers.find(function(row){return row.id===id;})||{};}
  function roomById(id){return state.rooms.find(function(row){return row.id===id;})||{};}
  function studentById(id){return state.students.find(function(row){return row.id===id;})||{};}
  function periodById(id){return state.tuitionPeriods.find(function(row){return row.id===id;})||{};}
  function feeById(id){return state.feePlans.find(function(row){return row.id===id;})||{};}
  function typeName(type){return {fixed:'固定課',single:'老師調課',rental:'教室租用',trial:'體驗課'}[type]||'課程';}
  function statusName(status){return {scheduled:'未簽到',attended:'已簽到',leave:'請假',absent:'曠課',cancelled:'註銷'}[status]||'未簽到';}
  function hiddenEventStatus(status){var value=clean(status).toLowerCase();return ['cancel','cancelled','canceled','suspended','stopped','inactive','取消','停課'].indexOf(value)>=0;}
  function isHiddenEvent(event){return hiddenEventStatus(event&&event.status);}
  function periodPaid(period){return sum((period.transactions||[]).map(function(row){return row.type==='refund'?-numberOf(row.amount):numberOf(row.amount);}));}
  function periodBalance(period){return Math.max(0,numberOf(period.expectedAmount)-numberOf(period.discount)-periodPaid(period));}
  function periodRemaining(period){return Math.max(0,numberOf(period.lessonCount)-numberOf(period.voidedLessonCount)-numberOf(period.usedCount));}
  function activeRooms(){return state.rooms.filter(function(row){return row.active!==false;}).sort(bySort);}
  function activeSubjects(){return state.subjects.filter(function(row){return row.active!==false;}).sort(bySort);}

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
      {id:'r9',name:'錄音室',publicName:'錄音室',note:'租 200 元',rentalFee:200,sort:9,active:true,policies:{}}
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
    return {version:3,currentDate:today,settings:{startHour:10,endHour:22,interval:30,defaultLessons:4},rooms:rooms,subjects:subjects,teachers:teachers,feePlans:feePlans,students:students,tuitionPeriods:tuitionPeriods,events:events,attendance:attendance,leaveReasons:[{id:'lr1',name:'生病',sort:1,active:true},{id:'lr2',name:'出遊',sort:2,active:true},{id:'lr3',name:'其他',sort:3,active:true}],teacherPayroll:[],teacherAdjustments:[],clipboard:null,readOnly:false,dataMode:'demo',dataMeta:{}};
  }

  function normalizeState(input){
    var fallback=defaultState(),next=input&&typeof input==='object'?input:{};
    next.version=3;next.currentDate=dateKey(next.currentDate)||todayKey();
    next.settings=Object.assign({startHour:10,endHour:22,interval:30,defaultLessons:4},next.settings||{});next.settings.interval=30;
    ['rooms','subjects','teachers','feePlans','students','tuitionPeriods','events','recurringRules','attendance','leaveReasons','teacherAdjustments'].forEach(function(key){if(!Array.isArray(next[key]))next[key]=[];});
    next.rooms=next.rooms.map(function(row,index){return Object.assign({id:uid('room'),name:'教室 '+(index+1),publicName:'',note:'',rentalFee:0,sort:index+1,active:true,policies:{}},row,{policies:row.policies&&typeof row.policies==='object'?row.policies:{}});});
    next.subjects=next.subjects.map(function(row,index){return typeof row==='string'?{id:'import_sub_'+index,name:row,sort:index+1,active:true}:Object.assign({id:uid('subject'),name:'未命名科目',sort:index+1,active:true},row);});
    next.teachers=next.teachers.map(function(row){return Object.assign({id:uid('teacher'),name:'未命名老師',phone:'',subjectIds:[],reward:0,deduction:0,note:'',active:true},row,{subjectIds:Array.isArray(row.subjectIds)?row.subjectIds:[]});});
    next.feePlans=next.feePlans.map(function(row,index){return Object.assign({id:uid('fee'),subjectId:'',name:'未命名方案',sort:index+1,amount:0,lessonCount:4,splitType:'ratio',splitValue:0,leaveNoDeduct:true,expiryDays:0,active:true,listed:true},row);});
    next.students=next.students.map(function(row){return Object.assign({id:uid('student'),name:'未命名學生',phone:'',line:null,note:'',active:true},row);});
    next.tuitionPeriods=next.tuitionPeriods.map(function(row){return Object.assign({id:uid('period'),studentId:'',subjectId:'',teacherId:'',planId:'',periodNo:1,startDate:'',expiryDate:'',lessonCount:4,usedCount:0,voidedLessonCount:0,expectedAmount:0,discount:0,status:'active',note:'',transactions:[],planSnapshot:{}},row,{transactions:Array.isArray(row.transactions)?row.transactions:[]});});
    next.events=next.events.map(function(row){return Object.assign({id:uid('event'),seriesId:'',date:next.currentDate,roomId:'',start:'',duration:60,type:'fixed',frequency:'once',studentIds:[],teacherId:'',subjectId:'',tuitionPeriodId:'',clientName:'',rentalFee:0,note:'',status:'scheduled'},row,{start:clean(row.start),studentIds:Array.isArray(row.studentIds)?row.studentIds:[]});}).filter(function(row){return row.start&&row.roomId&&row.date;});
    next.recurringRules=next.recurringRules.map(function(row){return Object.assign({id:uid('rule'),startDate:next.currentDate,endDate:'',intervalWeeks:1,roomId:'',start:'',duration:60,type:'fixed',studentIds:[],teacherId:'',subjectId:'',tuitionPeriodId:'',note:'',active:true},row,{startDate:dateKey(row.startDate)||next.currentDate,endDate:dateKey(row.endDate),intervalWeeks:numberOf(row.intervalWeeks)===2?2:1,start:clean(row.start),studentIds:Array.isArray(row.studentIds)?row.studentIds:[]});}).filter(function(row){return row.start&&row.roomId&&row.startDate;});
    next.readOnly=next.readOnly===true;
    if(next.dataMode==='sandbox')next.readOnly=false;
    else next.dataMode=next.readOnly?(next.dataMode==='review'?'review':'migration'):(next.dataMode||'demo');
    next.dataMeta=next.dataMeta||{};next.sandboxMeta=next.sandboxMeta&&typeof next.sandboxMeta==='object'?next.sandboxMeta:{};next.clipboard=null;
    if(!next.rooms.length)next.rooms=fallback.rooms;if(!next.subjects.length)next.subjects=fallback.subjects;
    return next;
  }

  function readLocalState(key){try{var saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&saved.version===3)return normalizeState(saved);}catch(_){}return null;}
  function loadFormalCache(){var cached=readLocalState(FORMAL_CACHE_KEY);if(cached){cached.readOnly=true;cached.dataMode=cached.dataMode==='review'?'review':'migration';formalState=cached;}return cached;}
  function loadInitialState(){
    var cached=loadFormalCache();
    if(cached)return cached;
    var starter=defaultState();starter.rooms=[];starter.subjects=[];starter.teachers=[];starter.feePlans=[];starter.students=[];starter.tuitionPeriods=[];starter.events=[];starter.attendance=[];starter.teacherPayroll=[];starter.teacherAdjustments=[];starter.readOnly=true;starter.dataMode='empty';return starter;
  }
  function isReadOnly(){return state&&state.readOnly===true;}
  function isSandbox(){return state&&state.dataMode==='sandbox'&&!isReadOnly();}
  function sandboxRunId(source){return clean((((source||{}).dataMeta||{}).runId)||(((source||{}).sandboxMeta||{}).baselineRunId));}
  function sandboxOperationLog(){return isSandbox()&&Array.isArray(state.sandboxMeta.operationLog)?state.sandboxMeta.operationLog:[];}
  function save(message){
    if(isSandbox()){
      if(message){
        if(sandboxLastSnapshot)sandboxUndoStack.push(clone(sandboxLastSnapshot));
        sandboxUndoStack=sandboxUndoStack.slice(-20);
        if(!state.sandboxMeta||typeof state.sandboxMeta!=='object')state.sandboxMeta={};
        if(!Array.isArray(state.sandboxMeta.operationLog))state.sandboxMeta.operationLog=[];
        state.sandboxMeta.operationLog.push({id:uid('log'),at:new Date().toISOString(),action:message});
        state.sandboxMeta.operationLog=state.sandboxMeta.operationLog.slice(-200);
        state.sandboxMeta.updatedAt=new Date().toISOString();
        sandboxLastSnapshot=clone(state);
      }
    }
    $('saveState').textContent=isReadOnly()?'正式資料唯讀・可查看明細':'✓ '+(message||'本次測試暫存中');
  }
  function writable(action){if(isSandbox())return true;toast('目前是正式資料',(action||'這項操作')+'只能在測試模式操作；正式資料仍可完整查看。','error');return false;}
  function toast(title,message,type){var node=document.createElement('div');node.className='toast'+(type==='error'?' error':'');node.innerHTML='<b>'+esc(title)+'</b><span>'+esc(message||'')+'</span>';$('toastStack').appendChild(node);setTimeout(function(){node.remove();},4000);}
  function openModal(id){$(id).classList.add('open');document.body.style.overflow='hidden';}
  function closeModal(id){$(id).classList.remove('open');if(!document.querySelector('.modal-backdrop.open'))document.body.style.overflow='';}

  function updateModeUI(){
    var actual=isReadOnly(),sandbox=isSandbox(),empty=state.dataMode==='empty',review=actual&&state.dataMode==='review',panel=$('dataModePanel');
    panel.classList.toggle('actual',actual&&!empty);panel.classList.toggle('sandbox',sandbox);document.body.classList.toggle('sandbox-mode',sandbox);
    $$('.sandbox-only').forEach(function(node){node.classList.toggle('hidden',!sandbox);});
    $('dataModeIcon').textContent=sandbox?'測':'正';
    $('sideModeBadge').textContent=sandbox?'測試模式・不影響正式資料':empty?'尚未載入正式資料':review?'核對課表・正式唯讀':'正式資料・唯讀';
    $('dataModeTitle').textContent=sandbox?'測試模式':empty?'尚未載入正式資料':review?'舊課表核對（正式唯讀）':'正式資料（唯讀）';
    $('dataModeDescription').textContent=sandbox?'以最新正式資料測試；返回正式或重新整理就會全部清除':empty?'請先載入音教雲同步資料':review?'可查看所有明細，不會寫回音教雲':'學生、學費、簽到與課表皆可查看';
    $('dataModeChip').textContent=sandbox?'測試':empty?'未載入':review?'核對':'正式';
    if(sandbox){
      var sandboxMeta=state.sandboxMeta||{},logs=sandboxOperationLog();
      $('dataModeMeta').textContent=state.students.length+' 位學生・'+state.events.length+' 筆正式課程紀錄・'+state.recurringRules.length+' 條固定課規則・'+logs.length+' 次本次測試操作'+(sandboxMeta.baselineRunId?'・底稿 '+sandboxMeta.baselineRunId:'');
      $('loadMigratedDataBtn').textContent='返回正式資料';
      $('undoSandboxBtn').disabled=sandboxUndoStack.length===0;
    }else if(empty){
      $('dataModeMeta').textContent='尚未載入音教雲同步資料';
      $('loadMigratedDataBtn').textContent='載入正式資料';
    }else if(review){
      $('dataModeMeta').textContent=state.students.length+' 位學生・最後有效課表・核對範圍 7/12～7/15';
      $('loadMigratedDataBtn').textContent='進入測試模式';
    }else{
      var meta=state.dataMeta||{},quality=meta.dataQuality||{},visible=quality.visibleEventWeekdays||{},unresolved=numberOf(quality.unresolvedTimeRecords),days='二 '+numberOf(visible.tue)+'・三 '+numberOf(visible.wed)+'・四 '+numberOf(visible.thu)+'・五 '+numberOf(visible.fri)+'・六 '+numberOf(visible.sat);
      $('dataModeMeta').textContent=state.students.length+' 位學生・'+state.events.length+' 筆課表・'+days+(unresolved?'・'+unresolved+' 筆時間待確認':'')+(meta.runId?'・來源 '+meta.runId:'');
      $('loadMigratedDataBtn').textContent='進入測試模式';
    }
    if($('syncInjiaoyunBtn'))$('syncInjiaoyunBtn').textContent=loadingMigration?'正在抓取並同步…':'抓取並同步本日音教雲';
    if($('syncInjiaoyunBtn'))$('syncInjiaoyunBtn').disabled=loadingMigration||sandbox;
    ['topNewEvent','sideNewEvent','calendarNewEvent','addStudentBtn','addTeacherBtn','saveSettingsBtn','addRoomBtn','addSubjectBtn','addFeePlanBtn','addLeaveReasonBtn'].forEach(function(id){if($(id))$(id).disabled=actual;});save();
  }

  function switchView(view){
    currentView=['calendar','students','teachers','settings'].indexOf(view)>=0?view:'calendar';
    $$('.view').forEach(function(node){node.classList.toggle('active',node.id===currentView+'Page');});$$('[data-view]').forEach(function(node){node.classList.toggle('active',node.dataset.view===currentView);});
    var meta={calendar:['課程日表','教室為欄、30 分鐘為一格；點空白格即可排課。'],students:['學生與學費','逐科目、逐期別查看堂數、付款、簽到、調課與請假。'],teachers:['老師與薪資','老師可授課科目會直接限制排課選項。'],settings:['系統設定','設定排課格線、教室時段規則、科目、收費方案與請假原因。']}[currentView];
    $('pageTitle').textContent=meta[0];$('pageSubtitle').textContent=meta[1];if(currentView==='calendar')renderCalendar();if(currentView==='students')renderStudents();if(currentView==='teachers')renderTeachers();if(currentView==='settings')renderSettings();window.scrollTo({top:0,behavior:'smooth'});
  }

  function slotPolicy(room,date,time){var day=weekdayKey(date),policies=room&&room.policies||{},dayPolicies=policies[day]||{};if(Object.prototype.hasOwnProperty.call(dayPolicies,time))return dayPolicies[time]||{};return day==='mon'?{blockSchedule:true,blockRental:true,subjectIds:[]}:{blockSchedule:false,blockRental:false,subjectIds:[]};}
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
    var ignored=new Set(ignoreIds||[]),reasons=[],start=timeToMin(candidate.start),end=start+numberOf(candidate.duration),room=roomById(candidate.roomId);
    crossedTimes(candidate.start,candidate.duration).forEach(function(time){var policy=slotPolicy(room,candidate.date,time);if(candidate.type==='rental'&&policy.blockRental)reasons.push(time+' 此教室禁止租用');if(candidate.type!=='rental'&&policy.blockSchedule)reasons.push(time+' 此教室禁止排課');if(candidate.type!=='rental'&&Array.isArray(policy.subjectIds)&&policy.subjectIds.length&&policy.subjectIds.indexOf(candidate.subjectId)<0)reasons.push(time+' 不允許此科目');});
    eventsForDate(candidate.date).forEach(function(other){if(ignored.has(other.id)||isHiddenEvent(other)||other.status==='leave'||other.status==='absent')return;var a=timeToMin(other.start),b=a+numberOf(other.duration);if(start>=b||end<=a)return;if(other.roomId===candidate.roomId)reasons.push('教室與「'+eventDisplayName(other)+'」重疊');if(candidate.teacherId&&other.teacherId===candidate.teacherId)reasons.push('老師與「'+eventDisplayName(other)+'」重疊');if((candidate.studentIds||[]).some(function(id){return (other.studentIds||[]).indexOf(id)>=0;}))reasons.push('學生與「'+eventDisplayName(other)+'」重疊');});
    return unique(reasons);
  }
  function eventDisplayName(event){if(event.type==='rental')return event.clientName||'教室租用';return (event.studentIds||[]).map(function(id){return studentById(id).name;}).filter(Boolean).join('、')||subjectById(event.subjectId).name||typeName(event.type);}
  function dayConflictIds(events){var ids={};events.forEach(function(event){if(eventConflictReasons(event,[event.id]).length)ids[event.id]=true;});return ids;}

  function renderCalendar(){
    var date=state.currentDate,rooms=activeRooms(),events=eventsForDate(date),conflicts=dayConflictIds(events),used=new Set(events.map(function(row){return row.roomId;}));
    $('calendarDate').value=date;$('dateTitle').textContent=zhDate(date);$('dateSubtitle').textContent=weekdayName(date)+(date===todayKey()?'・今天':'');$('kpiLessons').textContent=events.filter(function(row){return row.type!=='rental';}).length;$('kpiAttended').textContent=events.filter(function(row){return row.status==='attended';}).length;$('kpiRooms').textContent=used.size+' / '+rooms.length;$('kpiWarnings').textContent=Object.keys(conflicts).length+events.filter(function(row){return row.status==='leave'||row.status==='absent';}).length;$('calendarHint').textContent='30 分鐘／格・'+rooms.length+' 間啟用教室'+(isReadOnly()?'・正式唯讀':isSandbox()?'・測試操作不影響正式資料':'');
    if (isReadOnly() && state.dataMode === 'review') { var sourceStats = ((state.dataMeta || {}).sourceStatsByDate || {})[date] || {}; $('dataModeMeta').textContent = '原始學生紀錄 '+numberOf(sourceStats.studentRecords)+'・請假已定位 '+numberOf(sourceStats.leaveRecords)+'・固定課 '+numberOf(sourceStats.fixedRecords)+'・最後顯示 '+numberOf(sourceStats.visibleRecords)+(numberOf(sourceStats.unresolvedRecords) ? '・待人工核對 '+numberOf(sourceStats.unresolvedRecords) : ''); }
    var slots=[];for(var min=state.settings.startHour*60;min<state.settings.endHour*60;min+=30)slots.push(min);var start=state.settings.startHour*60,grid=$('scheduleGrid');grid.style.gridTemplateColumns='var(--time-col, 90px) repeat('+rooms.length+',var(--room-col, minmax(200px,1fr)))';grid.style.gridTemplateRows='var(--room-head-height, 64px) repeat('+slots.length+',var(--slot))';
    var html='<div class="grid-corner" style="grid-column:1;grid-row:1">時間</div>';
    rooms.forEach(function(room,index){html+='<div class="room-head" style="grid-column:'+(index+2)+';grid-row:1"><div>'+esc(room.name)+'<small>'+esc(room.note||'')+'</small></div></div>';});
    slots.forEach(function(min,index){var time=minToTime(min),hour=min%60===0?' hour':'';html+='<div class="time-label'+hour+'" style="grid-column:1;grid-row:'+(index+2)+'">'+time+'</div>';rooms.forEach(function(room,ri){var policy=slotPolicy(room,date,time),blocked=policy.blockSchedule&&policy.blockRental?' blocked':'';html+='<button type="button" class="slot'+hour+blocked+'" data-slot-room="'+esc(room.id)+'" data-slot-time="'+time+'" style="grid-column:'+(ri+2)+';grid-row:'+(index+2)+'" aria-label="'+esc(room.name+' '+time+' 新增排課')+'"></button>';});});
    events.forEach(function(event){var ri=rooms.findIndex(function(room){return room.id===event.roomId;}),si=Math.floor((timeToMin(event.start)-start)/30);if(ri<0||si<0||si>=slots.length)return;var span=Math.max(1,Math.ceil(numberOf(event.duration)/30)),status=event.status==='scheduled'?'':event.status,badge=event.status==='attended'?'✓':event.status==='leave'?'假':event.status==='absent'?'曠':'';html+='<button type="button" class="event '+esc(event.type)+' '+esc(status)+(conflicts[event.id]?' conflict':'')+'" data-event-id="'+esc(event.id)+'" style="grid-column:'+(ri+2)+';grid-row:'+(si+2)+'/span '+span+'"><span class="event-top"><span>'+esc(event.start)+'–'+esc(minToTime(timeToMin(event.start)+numberOf(event.duration)))+'</span><b>'+badge+'</b></span><span class="event-main">'+esc(eventDisplayName(event))+'</span><span class="event-sub">'+esc(subjectById(event.subjectId).name||typeName(event.type))+(teacherById(event.teacherId).name?'・'+esc(teacherById(event.teacherId).name):'')+'</span></button>';});
    if(!events.length)html+='<div class="empty-day"><b>這一天尚未排課</b><span>'+(isReadOnly()?'已移轉資料沒有這一天的課程':'點任一空白格即可新增')+'</span></div>';grid.innerHTML=html;
    $('clipboardBar').classList.toggle('hidden',!state.clipboard);if(state.clipboard){var source=findEvent(state.clipboard.eventId)||state.clipboard.event;$('clipboardText').textContent=(state.clipboard.mode==='cut'?'調課':'增加課程')+'：'+eventDisplayName(source||{})+'，請點新的空白格。';}
  }

  function fillSelect(node,rows,label,value,placeholder){node.innerHTML=(placeholder?'<option value="">'+esc(placeholder)+'</option>':'')+rows.map(function(row){return '<option value="'+esc(value(row))+'">'+esc(label(row))+'</option>';}).join('');}
  function refreshFormOptions(){
    var times=[];for(var min=state.settings.startHour*60;min<state.settings.endHour*60;min+=30)times.push({value:minToTime(min)});fillSelect($('eventStart'),times,function(row){return row.value;},function(row){return row.value;});fillSelect($('eventRoom'),activeRooms(),function(row){return row.name;},function(row){return row.id;},'請選擇教室');fillSelect($('eventStudent'),state.students.filter(function(row){return row.active!==false;}).sort(bySort),function(row){return row.name+'・'+(row.phone||'無電話');},function(row){return row.id;},'請搜尋或選擇學生');fillSelect($('eventSubject'),activeSubjects(),function(row){return row.name;},function(row){return row.id;},'請選擇科目');
    fillSelect($('tuitionStudent'),state.students.filter(function(row){return row.active!==false;}).sort(bySort),function(row){return row.name;},function(row){return row.id;},'請選擇學生');fillSelect($('tuitionSubject'),activeSubjects(),function(row){return row.name;},function(row){return row.id;},'請選擇科目');
  }
  function updateTeacherOptions(selected){var subjectId=$('eventSubject').value,rows=state.teachers.filter(function(row){return row.active!==false&&(!subjectId||row.subjectIds.indexOf(subjectId)>=0);}).sort(bySort);fillSelect($('eventTeacher'),rows,function(row){return row.name;},function(row){return row.id;},'請選擇老師');if(selected&&rows.some(function(row){return row.id===selected;}))$('eventTeacher').value=selected;$('teacherFilterHint').textContent=subjectId?'僅顯示可教授「'+(subjectById(subjectId).name||'此科目')+'」的老師':'先選科目後篩選老師';}
  function updateTuitionOptions(selected){var studentId=$('eventStudent').value,subjectId=$('eventSubject').value,rows=state.tuitionPeriods.filter(function(row){return row.studentId===studentId&&row.subjectId===subjectId&&row.status!=='cancelled';}).sort(function(a,b){return numberOf(b.periodNo)-numberOf(a.periodNo);});fillSelect($('eventTuitionPeriod'),rows,function(row){return '第 '+row.periodNo+' 期・剩 '+periodRemaining(row)+' / '+row.lessonCount+' 堂・'+(periodBalance(row)?'未繳 '+money(periodBalance(row)):'已繳清');},function(row){return row.id;},rows.length?'不扣指定期別':'找不到可用期別');if(selected&&rows.some(function(row){return row.id===selected;}))$('eventTuitionPeriod').value=selected;}
  function updateRentalFields(){var rental=$('eventType').value==='rental';$$('.rental-only').forEach(function(node){node.classList.toggle('hidden',!rental);});$('studentField').classList.toggle('hidden',rental);$('tuitionPeriodField').classList.toggle('hidden',rental);$('frequencyField').classList.toggle('hidden',rental);if(rental){var room=roomById($('eventRoom').value);if(!$('eventRentalFee').value)$('eventRentalFee').value=room.rentalFee||0;}}
  function updateScheduleConflict(){var event=formEvent(),reasons=eventConflictReasons(event,event.id?[event.id]:[]),box=$('conflictBox');box.classList.toggle('has-conflict',reasons.length>0);box.innerHTML=reasons.length?'<b>發現 '+reasons.length+' 項衝突</b><span>'+reasons.map(esc).join('<br>')+'</span>':'<b>尚未發現衝突</b><span>已檢查教室、老師、學生，以及教室每個跨越時段的規則。</span>';return reasons;}
  function clearScheduleForm(){
    $('scheduleForm').reset();$('eventId').value='';$('eventSeriesId').value='';$('eventDate').value=state.currentDate;$('eventDuration').value='60';$('eventType').value='fixed';$('eventFrequency').value='weekly';$('eventRepeatUntil').value='';$('repeatUntilField').classList.remove('hidden');$('eventNote').value='';$('eventClient').value='';$('eventRentalFee').value='';
  }
  function openSchedule(options){
    if(!writable('新增或編輯排課'))return;options=options||{};refreshFormOptions();clearScheduleForm();var source=options.event||options.copy||null;$('scheduleModalTitle').textContent=options.event?'編輯本次課程':options.copy?'增加課程':'新增排課';if(source){$('eventId').value=options.event?source.id:'';$('eventSeriesId').value=source.seriesId||'';$('eventDate').value=source.date;$('eventStart').value=source.start;$('eventDuration').value=String(source.duration||60);$('eventRoom').value=source.roomId;$('eventType').value=source.type;$('eventFrequency').value=options.event?'once':source.frequency||'once';$('eventStudent').value=(source.studentIds||[])[0]||'';$('eventSubject').value=source.subjectId||'';$('eventClient').value=source.clientName||'';$('eventRentalFee').value=source.rentalFee||'';$('eventNote').value=source.note||'';}
    else{$('eventDate').value=options.date||state.currentDate;$('eventStart').value=options.start||minToTime(state.settings.startHour*60);$('eventRoom').value=options.roomId||activeRooms()[0].id;}
    var selectedTeacher=source&&source.teacherId,selectedPeriod=source&&source.tuitionPeriodId;updateTeacherOptions(selectedTeacher);updateTuitionOptions(selectedPeriod);$('repeatUntilField').classList.toggle('hidden',$('eventFrequency').value==='once'||!!options.event);$('eventFrequency').disabled=!!options.event;updateRentalFields();updateScheduleConflict();openModal('scheduleModal');
  }
  function formEvent(){var rental=$('eventType').value==='rental';return {id:$('eventId').value,seriesId:$('eventSeriesId').value,date:$('eventDate').value,roomId:$('eventRoom').value,start:$('eventStart').value,duration:numberOf($('eventDuration').value),type:$('eventType').value,frequency:$('eventFrequency').value,studentIds:rental?[]:[$('eventStudent').value].filter(Boolean),teacherId:rental?'':$('eventTeacher').value,subjectId:rental?'':$('eventSubject').value,tuitionPeriodId:rental?'':$('eventTuitionPeriod').value,clientName:rental?$('eventClient').value.trim():'',rentalFee:rental?numberOf($('eventRentalFee').value):0,note:$('eventNote').value.trim(),status:'scheduled'};}
  function submitSchedule(event){
    event.preventDefault();if(!writable('儲存排課'))return;var row=formEvent(),reasons=updateScheduleConflict();if(reasons.length){toast('無法儲存','請先排除教室、老師、學生或時段規則衝突。','error');return;}if(row.type!=='rental'&&(!row.studentIds.length||!row.subjectId||!row.teacherId)){toast('資料未完成','請選擇學生、科目與可授課老師。','error');return;}
    if(row.id){var old=materializeEvent(findEvent(row.id)),index=state.events.findIndex(function(item){return item.id===old.id;});row.seriesId=old.seriesId;row.status=old.status;row.recurrenceKey=old.recurrenceKey||'';row.ruleId=old.ruleId||'';state.events[index]=Object.assign({},old,row,{dynamic:false});}
    else if(row.type==='fixed'&&$('eventFrequency').value!=='once'){
      state.recurringRules.push({id:uid('rule'),startDate:row.date,endDate:$('eventRepeatUntil').value||'',intervalWeeks:$('eventFrequency').value==='biweekly'?2:1,roomId:row.roomId,start:row.start,duration:row.duration,type:'fixed',studentIds:row.studentIds.slice(),teacherId:row.teacherId,subjectId:row.subjectId,tuitionPeriodId:row.tuitionPeriodId,note:row.note,active:true});
    }else state.events.push(Object.assign({},row,{id:uid('event'),seriesId:'',frequency:'once'}));
    save('排課已儲存');closeModal('scheduleModal');renderCalendar();toast('排課完成',row.type==='fixed'&&row.frequency!=='once'?'固定時段已保留；未預先建立未來課程，只有實際簽到才扣堂並計算老師薪資。':'建立或移動課程不會扣堂；簽到後才扣抵。');
  }

  function setAttendance(eventId,status,reasonId){
    if(!writable('更新簽到'))return;var event=materializeEvent(findEvent(eventId));if(!event)return;event.status=status;var studentId=(event.studentIds||[])[0],period=periodById(event.tuitionPeriodId),record=state.attendance.find(function(row){return row.eventId===event.id&&row.studentId===studentId;});var deducted=status==='attended';if(status==='scheduled'){state.attendance=state.attendance.filter(function(row){return !(row.eventId===event.id&&row.studentId===studentId);});}else if(record){Object.assign(record,{status:status,date:event.date,periodId:event.tuitionPeriodId,teacherId:event.teacherId,deducted:deducted,reasonId:reasonId||record.reasonId||''});}else if(studentId){state.attendance.push({id:uid('attendance'),eventId:event.id,studentId:studentId,periodId:event.tuitionPeriodId,status:status,date:event.date,lessonNo:0,teacherId:event.teacherId,deducted:deducted,reasonId:reasonId||''});}
    recalcPeriods();syncSandboxPayroll(event,status);save(eventDisplayName(event)+'・'+statusName(status));closeModal('eventModal');renderCalendar();toast('已更新為「'+statusName(status)+'」',deducted?'本堂已計入堂數扣抵。':'本堂未扣抵堂數。');
  }
  function recalcPeriods(){state.tuitionPeriods.forEach(function(period){period.usedCount=state.attendance.filter(function(row){return row.periodId===period.id&&row.deducted===true;}).length;var usable=Math.max(0,numberOf(period.lessonCount)-numberOf(period.voidedLessonCount));if(period.usedCount>=usable)period.status='completed';else if(period.status==='completed')period.status='active';});}
  function syncSandboxPayroll(event,status){
    if(!isSandbox()||!event||event.type==='rental')return;if(!Array.isArray(state.teacherPayroll))state.teacherPayroll=[];
    state.teacherPayroll=state.teacherPayroll.filter(function(row){return !(row.source==='sandbox'&&row.eventId===event.id);});
    if(status!=='attended')return;
    var period=periodById(event.tuitionPeriodId),plan=(period.planSnapshot&&Object.keys(period.planSnapshot).length?period.planSnapshot:feeById(period.planId))||{},lessonPrice=period.id&&numberOf(period.lessonCount)>0?(numberOf(period.expectedAmount)-numberOf(period.discount))/numberOf(period.lessonCount):0,teacherAmount=0;
    if(plan.splitType==='ratio')teacherAmount=lessonPrice*numberOf(plan.splitValue);
    else if(plan.splitType==='fixed')teacherAmount=numberOf(plan.splitValue);
    teacherAmount=Math.max(0,Math.round(teacherAmount));
    state.teacherPayroll.push({id:'sandbox_pay_'+event.id,eventId:event.id,source:'sandbox',teacherId:event.teacherId,date:event.date,occurredAt:event.date+'T'+event.start+':00',studentName:eventDisplayName(event),subject:subjectById(event.subjectId).name||'',lessonPrice:Math.round(lessonPrice),teacherAmount:teacherAmount,schoolShare:Math.max(0,Math.round(lessonPrice)-teacherAmount),allotRate:plan.splitType==='ratio'?numberOf(plan.splitValue):0,hourlyFee:plan.splitType==='fixed'?numberOf(plan.splitValue):0});
  }

  function eventDetails(event){
    var room=roomById(event.roomId),subject=subjectById(event.subjectId),teacher=teacherById(event.teacherId),student=studentById((event.studentIds||[])[0]),period=periodById(event.tuitionPeriodId),reasons=eventConflictReasons(event,[event.id]);$('eventTypeBadge').textContent=typeName(event.type);$('eventModalTitle').textContent=eventDisplayName(event);$('eventModalSubtitle').textContent=zhDate(event.date)+' '+weekdayName(event.date)+'・'+event.start+'–'+minToTime(timeToMin(event.start)+event.duration)+'・'+(room.name||'未設定教室');
    var html='<div class="detail-hero"><section class="detail-block"><h3>'+(event.type==='rental'?'租用資料':'學生與課程')+'</h3>'+(event.type==='rental'?detailLine('客戶',event.clientName||'未填')+detailLine('租用金額',money(event.rentalFee)):detailLine('學生',student.name||'未指定')+detailLine('電話',student.phone||'未填')+detailLine('科目',subject.name||'未設定')+detailLine('老師',teacher.name||'未設定'))+detailLine('狀態',statusName(event.status))+detailLine('備註',event.note||'無')+'</section><section class="detail-block"><h3>'+(event.type==='rental'?'教室使用':'本期學費勾稽')+'</h3>'+(event.type==='rental'?detailLine('教室',room.name||'未設定')+detailLine('是否簽退',event.status==='attended'?'已簽退':'尚未簽退'):(period.id?detailLine('期別','第 '+period.periodNo+' 期')+detailLine('堂數',period.usedCount+' / '+period.lessonCount+'（剩 '+periodRemaining(period)+(numberOf(period.voidedLessonCount)?'、註銷 '+numberOf(period.voidedLessonCount):'')+'）')+detailLine('應收',money(period.expectedAmount-period.discount))+detailLine('已收',money(periodPaid(period)))+detailLine('未收',money(periodBalance(period))):'<p>尚未指定學費期別；此堂簽到不會自動扣抵。</p>'))+'</section></div>';
    if(reasons.length)html+='<div class="validation-box has-conflict"><b>排課衝突</b><span>'+reasons.map(esc).join('<br>')+'</span></div>';
    if(event.type!=='rental')html+=(isReadOnly()?'<p class="formal-action-hint">以下操作可在測試模式實際執行，正式資料目前只供查看。</p>':'')+'<div class="status-actions"><button data-attendance="attended" '+(isReadOnly()?'disabled':'')+'>✓ 簽到</button><button data-attendance="scheduled" '+(isReadOnly()?'disabled':'')+'>取消簽到</button><button data-attendance="leave" '+(isReadOnly()?'disabled':'')+'>請假</button><button data-attendance="absent" '+(isReadOnly()?'disabled':'')+'>曠課</button></div>';
    else html+='<div class="status-actions"><button data-attendance="attended">✓ 簽退完成</button><button data-attendance="scheduled">恢復未簽退</button></div>';
    $('eventModalBody').innerHTML=html;
    var left=isReadOnly()?'':('<div><button class="btn outline" type="button" data-event-action="copy">增加課程</button> <button class="btn outline" type="button" data-event-action="cut">調課</button></div>'),right='<div>'+(student.id?'<button class="btn secondary" type="button" data-event-action="student">學生學費紀錄</button> ':'')+(isReadOnly()?'':'<button class="btn outline" type="button" data-event-action="edit">編輯</button> <button class="btn danger" type="button" data-event-action="delete">註銷本次</button>')+'</div>';$('eventModalFoot').innerHTML=left+right;$('eventModal').dataset.eventId=event.id;openModal('eventModal');
  }
  function detailLine(label,value){return '<div class="detail-line"><span>'+esc(label)+'</span><b>'+esc(value)+'</b></div>';}
  function eventAction(action){var event=findEvent($('eventModal').dataset.eventId);if(!event)return;if(action==='student'){closeModal('eventModal');openStudent((event.studentIds||[])[0]);return;}if(!writable('修改課程'))return;if(action==='edit'){closeModal('eventModal');openSchedule({event:event});}if(action==='copy'||action==='cut'){if(action==='cut'&&state.attendance.some(function(row){return row.eventId===event.id&&row.status==='attended';})){toast('目前不能調課','這堂已經簽到，請先取消簽到再調課。','error');return;}state.clipboard={mode:action,eventId:event.id,event:clone(event)};closeModal('eventModal');renderCalendar();toast(action==='cut'?'已選擇調課':'已選擇增加課程','請點新的教室與時間格；取消前不會改變原課程。');}if(action==='delete'){event=materializeEvent(event);if(state.attendance.some(function(row){return row.eventId===event.id&&row.status==='attended';})){toast('無法註銷本次課程','已有簽到紀錄，請先取消簽到。','error');return;}if(window.confirm('確定在測試資料中註銷這一次課程嗎？')){event.status='cancelled';syncSandboxPayroll(event,'cancelled');save(eventDisplayName(event)+'・註銷課程');closeModal('eventModal');renderCalendar();}}}
  function pasteToSlot(roomId,start){
    var clip=state.clipboard,source=clip&&(findEvent(clip.eventId)||clone(clip.event));if(!clip||!source)return false;var target=Object.assign({},source,{id:uid('event'),dynamic:false,recurrenceKey:'',seriesId:source.seriesId||'',date:state.currentDate,roomId:roomId,start:start,status:'scheduled',type:source.type==='rental'?'rental':'single',frequency:'once',movedFrom:source.date+' '+source.start});var reasons=eventConflictReasons(target,clip.mode==='cut'?[source.id]:[]);if(reasons.length){toast('無法放到這個格子',reasons.join('；'),'error');return true;}state.events.push(target);if(clip.mode==='cut'){source=materializeEvent(source);source.status='leave';var studentId=(source.studentIds||[])[0],record=state.attendance.find(function(row){return row.eventId===source.id&&row.studentId===studentId;});if(record)Object.assign(record,{status:'leave',date:source.date,periodId:source.tuitionPeriodId,teacherId:source.teacherId,deducted:false});else if(studentId)state.attendance.push({id:uid('attendance'),eventId:source.id,studentId:studentId,periodId:source.tuitionPeriodId,status:'leave',date:source.date,lessonNo:0,teacherId:source.teacherId,deducted:false,reasonId:''});syncSandboxPayroll(source,'leave');recalcPeriods();}state.clipboard=null;save(eventDisplayName(source)+'・'+(clip.mode==='copy'?'增加課程':'調課至 '+state.currentDate+' '+start));renderCalendar();toast(clip.mode==='copy'?'增加課程完成':'調課完成',clip.mode==='cut'?'只有原日期已標示請假並釋放教室；新日期尚未簽到，不扣堂也不計薪。':'新增課程尚未扣堂，實際簽到後才扣堂。');return true;
  }

  function latestPeriod(studentId){return state.tuitionPeriods.filter(function(row){return row.studentId===studentId;}).sort(function(a,b){return clean(b.startDate).localeCompare(clean(a.startDate))||numberOf(b.periodNo)-numberOf(a.periodNo);})[0]||{};}
  function nextEvent(studentId){for(var offset=0;offset<=180;offset++){var found=eventsForDate(shiftDate(todayKey(),offset)).find(function(row){return (row.studentIds||[]).indexOf(studentId)>=0&&!isHiddenEvent(row)&&row.status!=='leave'&&row.status!=='absent';});if(found)return found;}return {};}
  function renderStudents(){
    var search=clean($('studentSearch').value).toLowerCase(),filter=$('studentPaymentFilter').value,rows=state.students.filter(function(student){var periods=state.tuitionPeriods.filter(function(row){return row.studentId===student.id;}),hay=(student.name+' '+student.phone+' '+periods.map(function(row){return subjectById(row.subjectId).name;}).join(' ')).toLowerCase(),latest=latestPeriod(student.id);if(search&&hay.indexOf(search)<0)return false;if(filter==='due'&&!periods.some(function(row){return periodBalance(row)>0;}))return false;if(filter==='low'&&!(latest.id&&periodRemaining(latest)<=1))return false;if(filter==='active'&&student.active===false)return false;return true;}).sort(bySort);
    var dueStudents=state.students.filter(function(student){return state.tuitionPeriods.some(function(row){return row.studentId===student.id&&periodBalance(row)>0;});}).length,low=state.students.filter(function(student){var p=latestPeriod(student.id);return p.id&&periodRemaining(p)<=1;}).length;$('studentMetrics').innerHTML=metric('學生總數',state.students.length,'含停課資料')+metric('尚有未繳',dueStudents,'依每一期付款加總')+metric('剩 1 堂以下',low,'建議準備下一期');
    $('studentRows').innerHTML=rows.map(function(student){var period=latestPeriod(student.id),event=nextEvent(student.id),subject=subjectById(period.subjectId),teacher=teacherById(period.teacherId);return '<tr><td><b>'+esc(student.name)+'</b><small>'+(student.active===false?'已停課':'上課中')+'</small></td><td>'+esc(student.phone||'未填')+'<small>LINE：'+(student.line===true?'已綁定':student.line===false?'未綁定':'未確認')+'</small></td><td>'+esc(subject.name||'尚無學費期別')+'<small>'+esc(teacher.name||'未指定老師')+'</small></td><td>'+(period.id?'<b>'+period.usedCount+' / '+period.lessonCount+'</b><small>剩 '+periodRemaining(period)+' 堂</small>':'—')+'</td><td>'+(period.id?'<b>'+money(periodPaid(period))+' / '+money(period.expectedAmount-period.discount)+'</b><small>'+(periodBalance(period)?'尚欠 '+money(periodBalance(period)):'已繳清')+'</small>':'—')+'</td><td>'+(event.id?esc(event.date+' '+event.start):'尚未排課')+'</td><td><button class="btn small secondary" data-student-id="'+esc(student.id)+'">查看學費紀錄</button></td></tr>';}).join('')||'<tr><td colspan="7">沒有符合條件的學生。</td></tr>';
  }
  function metric(label,value,small){return '<article class="card metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(small)+'</small></article>';}

  function openStudent(id,tab){currentStudentId=id;studentTab=tab||'profile';var student=studentById(id);if(!student.id)return;$('studentModalTitle').textContent=student.name;$('studentModalSubtitle').textContent=(student.phone||'未填手機')+'・'+(student.active===false?'已停課':'上課中');renderStudentModal();openModal('studentModal');}
  function renderStudentModal(){
    var student=studentById(currentStudentId);$('studentTabs').innerHTML='';
    var periods=state.tuitionPeriods.filter(function(row){return row.studentId===student.id;}).sort(function(a,b){return clean(a.startDate||'9999').localeCompare(clean(b.startDate||'9999'))||numberOf(a.periodNo)-numberOf(b.periodNo);});
    var attendance=state.attendance.filter(function(row){return row.studentId===student.id;}).sort(function(a,b){return (clean(a.date)+numberOf(a.lessonNo)).localeCompare(clean(b.date)+numberOf(b.lessonNo));});
    var latest=periods.length?periods[periods.length-1]:{},html='<section class="student-overview compact"><div><span>狀態</span><b>'+(student.active===false?'已停課':'上課中')+'</b></div><div><span>電話</span><b>'+esc(student.phone||'未填')+'</b></div><div><span>目前課程</span><b>'+esc(subjectById(latest.subjectId).name||'尚未建立期別')+'</b></div><div><span>目前堂數</span><b>'+(latest.id?'剩 '+periodRemaining(latest)+'／'+latest.lessonCount+' 堂':'—')+'</b></div></section>';
    if(student.note)html+='<section class="student-note"><b>備註</b><p>'+esc(student.note)+'</p></section>';
    html+='<section class="student-section"><div class="student-record-heading"><div><h3>學費紀錄</h3><p>每一期濃縮成一列；點「查看」展開付款、退款與簽到明細。</p></div></div><div class="student-periods compact-periods">';
    html+=periods.map(function(period,index){
      var periodAttendance=attendance.filter(function(row){return row.periodId===period.id;});
      var transactions=(period.transactions||[]).slice().sort(function(a,b){return clean(a.date).localeCompare(clean(b.date));});
      var planName=clean((period.planSnapshot||{}).name)||clean(feeById(period.planId).name)||'既有收費方案';
      var attendanceHtml=periodAttendance.map(function(row,attendanceIndex){var ev=state.events.find(function(item){return item.id===row.eventId;})||{},reason=state.leaveReasons.find(function(item){return item.id===row.reasonId;})||{};return '<li><span>課堂 '+esc(row.lessonNo||attendanceIndex+1)+'</span><time>'+esc(row.date||'未填日期')+'</time><b>'+esc(statusName(row.status))+'</b><span>'+esc(teacherById(row.teacherId||ev.teacherId).name||'未指定老師')+(row.status==='leave'&&reason.name?'・'+esc(reason.name):'')+'</span></li>';}).join('')||'<li class="empty">尚無簽到、請假或曠課紀錄</li>';
      var transactionHtml=transactions.map(function(tx){var method=displayTransactionMethod(tx.method);return '<li><time>'+esc(tx.date||'未填日期')+'</time><b>'+esc(tx.type==='refund'?'退款':'付款')+'</b><span>'+money(tx.amount)+(method?'・'+esc(method):'')+(tx.operatorName?'・'+esc(tx.operatorName):'')+'</span></li>';}).join('')||'<li class="empty">尚無付款或退款紀錄</li>';
      var balance=periodBalance(period),paid=periodPaid(period),status=balance>0?'欠 '+money(balance):'已繳清';
      return '<details class="period-record'+(period.id===latest.id?' latest':'')+'"><summary><div class="period-summary"><b>第 '+esc(period.periodNo)+' 期</b><span class="period-plan">'+esc(planName)+'</span><span><small>應收</small>'+money(numberOf(period.expectedAmount)-numberOf(period.discount))+'</span><span><small>實收</small>'+money(paid)+'</span><span class="'+(balance>0?'due':'paid')+'">'+status+'</span><span><small>堂數</small>'+period.usedCount+'／'+period.lessonCount+(numberOf(period.voidedLessonCount)?'・註銷 '+numberOf(period.voidedLessonCount):'')+'</span><strong>查看</strong></div></summary><div class="period-details"><div class="period-detail-title"><span>'+esc(subjectById(period.subjectId).name||'未設定科目')+'・'+esc(teacherById(period.teacherId).name||'未指定老師')+'</span><small>開始日期 '+esc(period.startDate||'未填')+'</small></div><div class="period-columns"><section><h5>簽到紀錄</h5><ul class="period-list attendance-list">'+attendanceHtml+'</ul></section><section><h5>付款與退款</h5><ul class="period-list">'+transactionHtml+'</ul>'+(isSandbox()?'<button class="btn small secondary" data-period-pay="'+esc(period.id)+'">收費／退費</button>':'')+'</section></div></div></details>';
    }).join('')||'<p class="student-empty">尚未建立學費期別。</p>';
    html+='</div></section>';
    $('studentModalBody').innerHTML=html;$('studentModalFoot').innerHTML=isSandbox()?'<div><button class="btn outline" type="button" data-student-action="edit">編輯基本資料</button></div><div><button class="btn primary" type="button" data-student-action="tuition">＋ 延續／新增學費期別</button></div>':'<div class="formal-view-note">正式資料可查看所有明細；進入測試模式後可測試收費、退費與新增期別。</div>';
  }
  function displayTransactionMethod(value){var method=clean(value);return /^(未註明|未設定|N\/A|null|undefined|-+)$/i.test(method)?'':method;}
  function summary(label,value){return '<article><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></article>';}
  function timeline(rows,renderer){return '<div class="timeline">'+(rows.map(function(row){return '<article class="timeline-item">'+renderer(row)+'</article>';}).join('')||'<p>目前沒有紀錄。</p>')+'</div>';}

  function openTuition(studentId,id){
    if(!writable('新增或編輯學費'))return;refreshFormOptions();$('tuitionForm').reset();$('tuitionId').value=id||'';$('tuitionStudent').value=studentId||currentStudentId||'';var row=periodById(id);if(row.id){$('tuitionStudent').value=row.studentId;$('tuitionSubject').value=row.subjectId;$('tuitionPeriodNo').value=row.periodNo;$('tuitionLessonCount').value=row.lessonCount;$('tuitionAmount').value=row.expectedAmount;$('tuitionDiscount').value=row.discount;$('tuitionStartDate').value=row.startDate;$('tuitionExpiryDate').value=row.expiryDate;$('tuitionNote').value=row.note||'';}
    else{var previous=latestPeriod($('tuitionStudent').value),studentPeriods=state.tuitionPeriods.filter(function(p){return p.studentId===$('tuitionStudent').value;});$('tuitionModalTitle').textContent=previous.id?'延續／新增學費期別':'新增學費期別';if(previous.id){$('tuitionSubject').value=previous.subjectId;row={teacherId:previous.teacherId,planId:previous.planId};}$('tuitionPeriodNo').value=studentPeriods.reduce(function(max,p){return Math.max(max,numberOf(p.periodNo));},0)+1;$('tuitionStartDate').value=todayKey();$('tuitionDiscount').value=0;}
    updateTuitionForm(row);openModal('tuitionModal');
  }
  function updateTuitionForm(existing){
    var subjectId=$('tuitionSubject').value,teacherSelected=existing&&existing.teacherId||$('tuitionTeacher').value,planSelected=existing&&existing.planId||$('tuitionPlan').value,teachers=state.teachers.filter(function(row){return row.active!==false&&(!subjectId||row.subjectIds.indexOf(subjectId)>=0);}),plans=state.feePlans.filter(function(row){return row.active!==false&&row.listed!==false&&(!subjectId||row.subjectId===subjectId);}).sort(bySort);fillSelect($('tuitionTeacher'),teachers,function(row){return row.name;},function(row){return row.id;},'不指定固定老師');fillSelect($('tuitionPlan'),plans,function(row){return row.name+'・'+money(row.amount)+'／'+row.lessonCount+' 堂';},function(row){return row.id;},'請選擇收費方案');if(teacherSelected)$('tuitionTeacher').value=teacherSelected;if(planSelected)$('tuitionPlan').value=planSelected;renderTuitionSnapshot();
  }
  function renderTuitionSnapshot(){var plan=feeById($('tuitionPlan').value);if(!plan.id){$('tuitionSnapshot').innerHTML='<b>尚未選擇方案</b>選擇後會帶入金額、堂數、請假規則與老師拆帳。';return;}$('tuitionLessonCount').value=plan.lessonCount;$('tuitionAmount').value=plan.amount;$('tuitionSnapshot').innerHTML='<b>本期將保存方案快照</b>'+esc(plan.name)+'・'+money(plan.amount)+'／'+plan.lessonCount+' 堂・老師拆帳 '+splitLabel(plan)+'・請假'+(plan.leaveNoDeduct?'不扣堂':'照常扣堂');}
  function splitLabel(plan){if(plan.splitType==='ratio')return Math.round(numberOf(plan.splitValue)*100)+'%';if(plan.splitType==='fixed')return money(plan.splitValue)+'／堂';return '未設定';}
  function submitTuition(event){event.preventDefault();if(!writable('儲存學費期別'))return;var id=$('tuitionId').value,plan=feeById($('tuitionPlan').value),row={id:id||uid('period'),studentId:$('tuitionStudent').value,subjectId:$('tuitionSubject').value,teacherId:$('tuitionTeacher').value,planId:plan.id,periodNo:numberOf($('tuitionPeriodNo').value)||1,startDate:$('tuitionStartDate').value,expiryDate:$('tuitionExpiryDate').value,lessonCount:numberOf($('tuitionLessonCount').value)||plan.lessonCount,expectedAmount:numberOf($('tuitionAmount').value),discount:numberOf($('tuitionDiscount').value),usedCount:id?periodById(id).usedCount:0,status:'active',note:$('tuitionNote').value.trim(),transactions:id?(periodById(id).transactions||[]):[],planSnapshot:clone(plan)};if(!row.studentId||!row.subjectId||!row.planId){toast('資料未完成','請選擇學生、科目與收費方案。','error');return;}if(id)Object.assign(periodById(id),row);else state.tuitionPeriods.push(row);save(studentById(row.studentId).name+'・建立第 '+row.periodNo+' 期 '+plan.name);closeModal('tuitionModal');if(currentStudentId){studentTab='tuition';renderStudentModal();}renderStudents();toast('學費期別已建立','方案名稱、金額、堂數、拆帳與請假規則已保存快照。');}

  function openTransaction(periodId){if(!writable('新增付款或退款'))return;$('transactionForm').reset();$('transactionPeriodId').value=periodId;$('transactionDate').value=todayKey();renderRefundLessonOptions();openModal('transactionModal');}
  function renderRefundLessonOptions(){
    var refund=$('transactionType').value==='refund',period=periodById($('transactionPeriodId').value),rows=state.attendance.filter(function(row){return row.periodId===period.id&&row.status!=='cancelled';}).sort(function(a,b){return clean(a.date).localeCompare(clean(b.date));});
    $('refundLessonField').classList.toggle('hidden',!refund);$('transactionRefundAttendance').innerHTML='<option value="">只記錄退款金額，不註銷課堂</option>'+rows.map(function(row,index){var event=state.events.find(function(item){return item.id===row.eventId;})||{};return '<option value="'+esc(row.id)+'">課堂 '+esc(row.lessonNo||index+1)+'・'+esc(row.date||'未填日期')+'・'+esc(statusName(row.status))+(teacherById(row.teacherId||event.teacherId).name?'・'+esc(teacherById(row.teacherId||event.teacherId).name):'')+'</option>';}).join('');
  }
  function submitTransaction(event){
    event.preventDefault();if(!writable('儲存付款或退款'))return;var period=periodById($('transactionPeriodId').value),amount=numberOf($('transactionAmount').value),type=$('transactionType').value;if(!period.id||amount<=0){toast('資料不完整','請輸入正確金額。','error');return;}
    var attendanceId=type==='refund'?$('transactionRefundAttendance').value:'',attendanceRow=state.attendance.find(function(row){return row.id===attendanceId;}),voidedEvent=attendanceRow&&state.events.find(function(row){return row.id===attendanceRow.eventId;});
    period.transactions.push({id:uid('tx'),type:type,date:$('transactionDate').value,amount:amount,method:$('transactionMethod').value,note:$('transactionNote').value.trim(),voidedAttendanceId:attendanceId||''});
    if(attendanceRow){attendanceRow.status='cancelled';attendanceRow.deducted=false;if(!attendanceRow.voidedByRefund)period.voidedLessonCount=numberOf(period.voidedLessonCount)+1;attendanceRow.voidedByRefund=true;if(voidedEvent){voidedEvent.status='cancelled';syncSandboxPayroll(voidedEvent,'cancelled');}recalcPeriods();}
    save(studentById(period.studentId).name+'・第 '+period.periodNo+' 期'+(type==='refund'?'退款 ':'付款 ')+money(amount)+(attendanceRow?'・註銷 '+attendanceRow.date+' 課堂':''));
    closeModal('transactionModal');studentTab='tuition';renderStudentModal();renderStudents();renderTeachers();toast(type==='refund'?'退款紀錄完成':'付款紀錄完成',attendanceRow?'所選課堂已在測試資料中註銷，堂數與老師薪資已重新計算。':'未覆寫原金額，已新增一筆獨立異動。');
  }

  function renderTeachers(){
    var search=clean($('teacherSearch').value).toLowerCase(),monthKey=state.currentDate.slice(0,7),month=(state.teacherPayroll||[]).filter(function(row){return row.date.slice(0,7)===monthKey;}),adjustments=(state.teacherAdjustments||[]).filter(function(row){return row.date.slice(0,7)===monthKey;}),teachers=state.teachers.filter(function(row){var subjects=(row.subjectIds||[]).map(function(id){return subjectById(id).name;}).join(' ');return !search||(row.name+' '+row.phone+' '+subjects).toLowerCase().indexOf(search)>=0;}).sort(bySort);$('teacherMetrics').innerHTML=metric('老師總數',state.teachers.length,'含停用資料')+metric('本月完成課堂',month.length,'只計音教雲實際簽到')+metric('本月老師薪資',money(sum(month.map(function(row){return row.teacherAmount;}))+sum(adjustments.map(function(row){return row.type==='deduction'?-row.amount:row.amount;}))),'含獎勵與扣薪');$('teacherCards').innerHTML=teachers.map(function(row){var completed=month.filter(function(item){return item.teacherId===row.id;}),teacherAdjustments=adjustments.filter(function(item){return item.teacherId===row.id;}),pay=sum(completed.map(function(item){return item.teacherAmount;}))+sum(teacherAdjustments.map(function(item){return item.type==='deduction'?-item.amount:item.amount;})),subjects=(row.subjectIds||[]).map(function(id){return subjectById(id).name;}).filter(Boolean);return '<article class="card teacher-card"><div class="teacher-card-head"><div class="avatar">'+esc(row.name.slice(0,1))+'</div><div><h3>'+esc(row.name)+'</h3><p>'+esc(row.phone||'未填電話')+'</p><p>'+esc(subjects.join('、')||'尚未設定可授課科目')+'</p></div></div><div class="teacher-money"><span>本月完成 <b>'+completed.length+' 堂</b></span><strong>'+money(pay)+'</strong></div><button class="btn primary" data-teacher-payroll="'+row.id+'">查看上課拆帳與薪資</button>'+(state.readOnly?'':'<button class="btn outline" data-teacher-id="'+row.id+'">編輯老師與科目</button>')+'</article>';}).join('');
  }

  function splitText(row){if(numberOf(row.hourlyFee))return '每堂固定 '+money(row.hourlyFee);if(numberOf(row.allotRate))return '比例 '+Math.round(numberOf(row.allotRate)*10000)/100+'%';return '未設定';}
  function openTeacherPayroll(teacherId){currentTeacherId=teacherId;$('teacherPayrollMonth').value=state.currentDate.slice(0,7);renderTeacherPayroll();openModal('teacherPayrollModal');}
  function renderTeacherPayroll(){
    var teacher=teacherById(currentTeacherId),month=$('teacherPayrollMonth').value||state.currentDate.slice(0,7),rows=(state.teacherPayroll||[]).filter(function(row){return row.teacherId===currentTeacherId&&row.date.slice(0,7)===month;}).sort(function(a,b){return clean(a.occurredAt||a.date).localeCompare(clean(b.occurredAt||b.date));}),adjustments=(state.teacherAdjustments||[]).filter(function(row){return row.teacherId===currentTeacherId&&row.date.slice(0,7)===month;}),base=sum(rows.map(function(row){return row.teacherAmount;})),reward=sum(adjustments.filter(function(row){return row.type!=='deduction';}).map(function(row){return row.amount;})),deduction=sum(adjustments.filter(function(row){return row.type==='deduction';}).map(function(row){return row.amount;})),finalAmount=base+reward-deduction;
    $('teacherPayrollTitle').textContent=teacher.name+'・上課拆帳與薪資';$('teacherPayrollSubtitle').textContent=month+'｜只計入老師實際完成的音教雲簽到';
    var summary='<div class="metrics-grid">'+metric('實際簽到堂數',rows.length,'同日多堂逐堂計算')+metric('課堂拆帳',money(base),'逐堂套用老師或方案分成')+metric('獎勵／扣薪',money(reward-deduction),'獎勵 '+money(reward)+'・扣薪 '+money(deduction))+metric('本月薪資合計',money(finalAmount),'課堂拆帳＋獎勵－扣薪')+'</div>';
    var table='<div class="table-wrap"><table><thead><tr><th>日期</th><th>學生</th><th>課程</th><th>單堂學費</th><th>拆帳方式</th><th>老師分得</th><th>教室保留</th></tr></thead><tbody>'+rows.map(function(row){return '<tr><td>'+esc(row.date)+'</td><td>'+esc(row.studentName||'未命名學生')+'</td><td>'+esc(row.subject||'未標示課程')+'</td><td>'+money(row.lessonPrice)+'</td><td>'+esc(splitText(row))+'</td><td><b>'+money(row.teacherAmount)+'</b></td><td>'+money(row.schoolShare)+'</td></tr>';}).join('')+'</tbody></table></div>';
    $('teacherPayrollBody').innerHTML=summary+(rows.length?table:'<div class="empty-state"><h3>本月沒有實際簽到課程</h3><p>只有排課、沒有老師簽到，或已註銷的課程不會列入薪資。</p></div>');
  }

  function renderSettings(){
    populateTimeSettings();renderRoomRows();renderSubjectRows();renderFeeRows();renderLeaveRows();
  }
  function populateTimeSettings(){var options='';for(var hour=6;hour<=24;hour++)options+='<option value="'+hour+'">'+pad(hour%24)+':00</option>';$('startHour').innerHTML=options;$('endHour').innerHTML=options;$('startHour').value=state.settings.startHour;$('endHour').value=state.settings.endHour;$('defaultLessons').value=state.settings.defaultLessons;fillSelect($('feeSubjectFilter'),activeSubjects(),function(row){return row.name;},function(row){return row.id;});$('feeSubjectFilter').insertAdjacentHTML('afterbegin','<option value="all">全部科目</option>');}
  function renderRoomRows(){$('roomRows').innerHTML=state.rooms.slice().sort(bySort).map(function(row){return '<tr><td>'+row.sort+'</td><td><b>'+esc(row.name)+'</b><small>'+esc(row.note||'')+'</small></td><td>'+esc(row.publicName||'未設定')+'</td><td>'+money(row.rentalFee)+'</td><td><span class="tag '+(row.active!==false?'green':'gray')+'">'+(row.active!==false?'啟用':'停用')+'</span></td><td><button class="btn small secondary" data-room-policy="'+row.id+'">設定 30 分鐘規則</button></td><td><button class="btn small outline" data-room-edit="'+row.id+'">編輯</button></td></tr>';}).join('');}
  function renderSubjectRows(){$('subjectRows').innerHTML=state.subjects.slice().sort(bySort).map(function(row){var teachers=state.teachers.filter(function(t){return t.subjectIds.indexOf(row.id)>=0;}).map(function(t){return t.name;}),plans=state.feePlans.filter(function(p){return p.subjectId===row.id;});return '<tr><td>'+row.sort+'</td><td><b>'+esc(row.name)+'</b></td><td>'+esc(teachers.join('、')||'尚無')+'</td><td>'+plans.length+' 套</td><td><span class="tag '+(row.active!==false?'green':'gray')+'">'+(row.active!==false?'上架中':'停用')+'</span></td><td><button class="btn small outline" data-subject-edit="'+row.id+'">編輯</button></td></tr>';}).join('');}
  function renderFeeRows(){var filter=$('feeSubjectFilter').value||'all',rows=state.feePlans.filter(function(row){return filter==='all'||row.subjectId===filter;}).sort(function(a,b){return clean(subjectById(a.subjectId).name).localeCompare(clean(subjectById(b.subjectId).name),'zh-Hant')||bySort(a,b);});$('feePlanRows').innerHTML=rows.map(function(row){return '<tr><td>'+esc(subjectById(row.subjectId).name||'未設定')+'</td><td>'+row.sort+'</td><td><b>'+esc(row.name)+'</b></td><td>'+money(row.amount)+'／'+row.lessonCount+' 堂</td><td>'+splitLabel(row)+'</td><td>'+((row.leaveNoDeduct)?'請假不扣堂':'請假照常扣堂')+'</td><td><span class="tag '+(row.active!==false?'green':'gray')+'">'+(row.active!==false?'上架中':'停用')+'</span></td><td><button class="btn small outline" data-fee-edit="'+row.id+'">編輯</button></td></tr>';}).join('');}
  function renderLeaveRows(){$('leaveReasonRows').innerHTML=state.leaveReasons.slice().sort(bySort).map(function(row){return '<tr><td>'+row.sort+'</td><td>'+esc(row.name)+'</td><td><span class="tag '+(row.active!==false?'green':'gray')+'">'+(row.active!==false?'啟用':'停用')+'</span></td><td><button class="btn small outline" data-leave-edit="'+row.id+'">編輯</button></td></tr>';}).join('');}

  function openEntity(type,id){if(!writable('編輯設定'))return;entityContext={type:type,id:id||''};var row={};if(type==='student')row=studentById(id);if(type==='teacher')row=teacherById(id);if(type==='room')row=roomById(id);if(type==='subject')row=subjectById(id);if(type==='fee')row=feeById(id);if(type==='leave')row=state.leaveReasons.find(function(item){return item.id===id;})||{};var title={student:'學生',teacher:'老師',room:'教室',subject:'科目',fee:'收費方案',leave:'請假原因'}[type];$('entityModalTitle').textContent=(id?'編輯':'新增')+title;$('entityModalSubtitle').textContent=type==='teacher'?'勾選可授課科目後，排課只會顯示符合老師。':type==='fee'?'本設定會在建立學生學費期別時保存快照。':type==='room'?'已被歷史課程引用的教室建議停用，不直接刪除。':'';var html='';
    if(type==='student')html=formFields([{id:'entityName',label:'學生名稱',value:row.name,required:true},{id:'entityPhone',label:'手機號碼',value:row.phone},{id:'entityLine',label:'LINE 狀態',type:'select',value:String(row.line),options:[['null','未確認'],['true','已綁定'],['false','未綁定']]},{id:'entityActive',label:'狀態',type:'select',value:String(row.active!==false),options:[['true','上課中'],['false','停課']]},{id:'entityNote',label:'備註',type:'textarea',value:row.note,full:true}]);
    if(type==='teacher')html=formFields([{id:'entityName',label:'老師名稱',value:row.name,required:true},{id:'entityPhone',label:'手機號碼',value:row.phone},{id:'entityReward',label:'獎勵金額',type:'number',value:row.reward||0},{id:'entityDeduction',label:'扣薪金額',type:'number',value:row.deduction||0},{id:'entityActive',label:'狀態',type:'select',value:String(row.active!==false),options:[['true','啟用'],['false','停用']]},{id:'entityNote',label:'備註',type:'textarea',value:row.note,full:true}])+'<div class="field full"><label>可教授科目</label><div class="chip-list">'+activeSubjects().map(function(subject){return '<label class="check-label"><input type="checkbox" name="teacherSubject" value="'+subject.id+'" '+((row.subjectIds||[]).indexOf(subject.id)>=0?'checked':'')+'>'+esc(subject.name)+'</label>';}).join('')+'</div></div>';
    if(type==='room')html=formFields([{id:'entityName',label:'教室名稱',value:row.name,required:true},{id:'entityPublicName',label:'預約前台名稱',value:row.publicName},{id:'entitySort',label:'排序',type:'number',value:row.sort||state.rooms.length+1},{id:'entityRentalFee',label:'預設租金',type:'number',value:row.rentalFee||0},{id:'entityActive',label:'狀態',type:'select',value:String(row.active!==false),options:[['true','啟用'],['false','停用']]},{id:'entityNote',label:'教室備註',type:'textarea',value:row.note,full:true}]);
    if(type==='subject')html=formFields([{id:'entityName',label:'科目名稱',value:row.name,required:true},{id:'entitySort',label:'排序',type:'number',value:row.sort||state.subjects.length+1},{id:'entityActive',label:'狀態',type:'select',value:String(row.active!==false),options:[['true','上架中'],['false','停用']]}]);
    if(type==='leave')html=formFields([{id:'entityName',label:'請假原因',value:row.name,required:true},{id:'entitySort',label:'排序',type:'number',value:row.sort||state.leaveReasons.length+1},{id:'entityActive',label:'狀態',type:'select',value:String(row.active!==false),options:[['true','啟用'],['false','停用']]}]);
    if(type==='fee')html=formFields([{id:'entitySubject',label:'科目',type:'select',value:row.subjectId,required:true,options:activeSubjects().map(function(s){return [s.id,s.name];})},{id:'entitySort',label:'排序',type:'number',value:row.sort||state.feePlans.length+1},{id:'entityName',label:'方案名稱',value:row.name,required:true},{id:'entityAmount',label:'收費金額',type:'number',value:row.amount||0},{id:'entityLessons',label:'課堂數',type:'number',value:row.lessonCount||4},{id:'entitySplitType',label:'老師拆帳方式',type:'select',value:row.splitType||'ratio',options:[['ratio','比例'],['fixed','每堂固定金額'],['none','不計算']]},{id:'entitySplitValue',label:'拆帳數值',type:'number',value:row.splitValue||0},{id:'entityLeave',label:'請假規則',type:'select',value:String(row.leaveNoDeduct!==false),options:[['true','請假不扣堂'],['false','請假照常扣堂']]},{id:'entityExpiry',label:'有效天數（0 為不限）',type:'number',value:row.expiryDays||0},{id:'entityActive',label:'狀態',type:'select',value:String(row.active!==false),options:[['true','上架中'],['false','停用']]}]);
    $('entityModalBody').innerHTML='<div class="form-grid three">'+html+'</div>';openModal('entityModal');
  }
  function formFields(fields){return fields.map(function(field){var classes='field'+(field.full?' full':''),input='';if(field.type==='select')input='<select id="'+field.id+'">'+(field.options||[]).map(function(option){return '<option value="'+esc(option[0])+'" '+(String(field.value)===String(option[0])?'selected':'')+'>'+esc(option[1])+'</option>';}).join('')+'</select>';else if(field.type==='textarea')input='<textarea id="'+field.id+'">'+esc(field.value||'')+'</textarea>';else input='<input id="'+field.id+'" type="'+(field.type||'text')+'" value="'+esc(field.value||'')+'" '+(field.required?'required':'')+'>';return '<div class="'+classes+'"><label class="'+(field.required?'required':'')+'">'+esc(field.label)+'</label>'+input+'</div>';}).join('');}
  function submitEntity(event){event.preventDefault();var type=entityContext.type,id=entityContext.id,row={};if(type==='student'){row={id:id||uid('student'),name:$('entityName').value.trim(),phone:$('entityPhone').value.trim(),line:$('entityLine').value==='null'?null:$('entityLine').value==='true',active:$('entityActive').value==='true',note:$('entityNote').value.trim()};upsert(state.students,row);}if(type==='teacher'){row={id:id||uid('teacher'),name:$('entityName').value.trim(),phone:$('entityPhone').value.trim(),reward:numberOf($('entityReward').value),deduction:numberOf($('entityDeduction').value),active:$('entityActive').value==='true',note:$('entityNote').value.trim(),subjectIds:$$('input[name="teacherSubject"]',$('entityModalBody')).filter(function(box){return box.checked;}).map(function(box){return box.value;})};upsert(state.teachers,row);}if(type==='room'){var old=roomById(id);row={id:id||uid('room'),name:$('entityName').value.trim(),publicName:$('entityPublicName').value.trim(),sort:numberOf($('entitySort').value),rentalFee:numberOf($('entityRentalFee').value),active:$('entityActive').value==='true',note:$('entityNote').value.trim(),policies:old.policies||{}};upsert(state.rooms,row);}if(type==='subject'){row={id:id||uid('subject'),name:$('entityName').value.trim(),sort:numberOf($('entitySort').value),active:$('entityActive').value==='true'};upsert(state.subjects,row);}if(type==='leave'){row={id:id||uid('leave'),name:$('entityName').value.trim(),sort:numberOf($('entitySort').value),active:$('entityActive').value==='true'};upsert(state.leaveReasons,row);}if(type==='fee'){row={id:id||uid('fee'),subjectId:$('entitySubject').value,sort:numberOf($('entitySort').value),name:$('entityName').value.trim(),amount:numberOf($('entityAmount').value),lessonCount:numberOf($('entityLessons').value),splitType:$('entitySplitType').value,splitValue:numberOf($('entitySplitValue').value),leaveNoDeduct:$('entityLeave').value==='true',expiryDays:numberOf($('entityExpiry').value),active:$('entityActive').value==='true',listed:true};upsert(state.feePlans,row);}if(!row.name){toast('請填寫名稱','名稱不能空白。','error');return;}save('設定已儲存');closeModal('entityModal');renderSettings();renderTeachers();renderStudents();refreshFormOptions();}
  function upsert(collection,row){var index=collection.findIndex(function(item){return item.id===row.id;});if(index>=0)collection[index]=Object.assign({},collection[index],row);else collection.push(row);}

  function openPolicy(roomId){policyRoomId=roomId;var weekdays=[['mon','星期一'],['tue','星期二'],['wed','星期三'],['thu','星期四'],['fri','星期五'],['sat','星期六'],['sun','星期日']];$('policyWeekday').innerHTML=weekdays.map(function(row){return '<option value="'+row[0]+'">'+row[1]+'</option>';}).join('');$('policyModalTitle').textContent=roomById(roomId).name+'・時段規則';renderPolicy();openModal('policyModal');}
  function renderPolicy(){var room=roomById(policyRoomId),day=$('policyWeekday').value||'mon',dayPolicies=(room.policies||{})[day]||{},html='';for(var min=state.settings.startHour*60;min<state.settings.endHour*60;min+=30){var time=minToTime(min),explicit=Object.prototype.hasOwnProperty.call(dayPolicies,time),policy=dayPolicies[time]||{},allowSchedule=explicit?!policy.blockSchedule:day!=='mon',allowRental=explicit?!policy.blockRental:day!=='mon';html+='<div class="policy-row '+(min%60===0?'hour':'')+'"><strong>'+time+'</strong><label class="check-label"><input type="checkbox" data-policy-schedule="'+time+'" '+(allowSchedule?'checked':'')+'>可排課</label><label class="check-label"><input type="checkbox" data-policy-rental="'+time+'" '+(allowRental?'checked':'')+'>可租用</label><select class="control policy-subjects" data-policy-subjects="'+time+'" multiple size="2"><option value="">全部科目</option>'+activeSubjects().map(function(subject){return '<option value="'+subject.id+'" '+((policy.subjectIds||[]).indexOf(subject.id)>=0?'selected':'')+'>'+esc(subject.name)+'</option>';}).join('')+'</select></div>';}$('policyModalBody').innerHTML=html;}
  function savePolicy(){if(!writable('儲存教室時段規則'))return;var room=roomById(policyRoomId),day=$('policyWeekday').value,body=$('policyModalBody');if(!room.policies[day])room.policies[day]={};$$('[data-policy-schedule]',body).forEach(function(box){var time=box.dataset.policySchedule,rental=qs('[data-policy-rental="'+time+'"]',body),select=qs('[data-policy-subjects="'+time+'"]',body),subjectIds=Array.from(select.selectedOptions).map(function(option){return option.value;}).filter(Boolean);room.policies[day][time]={blockSchedule:!box.checked,blockRental:!rental.checked,subjectIds:subjectIds};});save('教室規則已儲存');closeModal('policyModal');renderCalendar();toast('時段規則已儲存','未勾選的時段不開放排課或租用。');}

  function migrationPin(){
    var value='';try{value=clean(sessionStorage.getItem(PIN_KEY));}catch(_){}
    if(value)return value;
    value=clean(window.prompt('請輸入音教雲「手動同步密碼」：')||'');
    if(!value)return '';
    if(value.length<12||value.length>64){toast('密碼格式不正確','手動同步密碼應為 12～64 碼。','error');return '';}
    try{sessionStorage.setItem(PIN_KEY,value);}catch(_){}
    return value;
  }

  function clearMigrationPin(){try{sessionStorage.removeItem(PIN_KEY);}catch(_){}}

  async function loadMigrationFromMirror(pin){
    if(!window.YouziCoursePreviewData||typeof window.YouziCoursePreviewData.load!=='function')throw new Error('音教雲同步元件尚未載入。');
    var loaded=await window.YouziCoursePreviewData.load({manualSyncPin:pin,anchorDate:state&&state.currentDate||todayKey()});
    formalState=normalizeState(loaded);formalState.readOnly=true;formalState.dataMode=formalState.dataMode==='review'?'review':'migration';
    localStorage.setItem(FORMAL_CACHE_KEY,JSON.stringify(formalState));
    state=clone(formalState);updateModeUI();refreshFormOptions();switchView('calendar');
    return loaded;
  }

  function createSandboxFromFormal(){
    var source=loadFormalCache()||formalState;
    if(!source||source.dataMode==='empty'){toast('尚無正式資料','請先載入音教雲同步資料，再建立測試模式。','error');return false;}
    var next=clone(source);next.readOnly=false;next.dataMode='sandbox';next.clipboard=null;next.sandboxMeta={createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),baselineRunId:sandboxRunId(source)||'本機正式底稿',baselineLoadedAt:clean((source.dataMeta||{}).loadedAt),operationLog:[]};
    state=normalizeState(next);state.readOnly=false;state.dataMode='sandbox';formalState=source;sandboxUndoStack=[];sandboxLastSnapshot=clone(state);
    updateModeUI();refreshFormOptions();switchView(currentView);toast('已進入測試模式','目前使用最新正式資料當底稿；返回正式或重新整理後，本次測試就會全部清除。');return true;
  }

  function enterSandbox(){
    var source=loadFormalCache()||formalState;
    if(!source||source.dataMode==='empty'){toast('尚無正式資料','請先載入音教雲同步資料。','error');return;}
    createSandboxFromFormal();
  }

  function returnToFormal(){
    var cached=loadFormalCache()||formalState;if(!cached){toast('找不到正式資料','請重新載入音教雲同步資料。','error');return;}
    state=clone(cached);state.readOnly=true;state.dataMode=state.dataMode==='review'?'review':'migration';sandboxUndoStack=[];sandboxLastSnapshot=null;updateModeUI();refreshFormOptions();switchView(currentView);toast('已返回正式資料','剛才的測試資料與操作紀錄已全部清除。');
  }

  function resetSandbox(){
    if(!isSandbox())return;if(!window.confirm('確定清除目前所有測試操作，並重新載入最新正式資料嗎？'))return;
    createSandboxFromFormal();toast('測試資料已重設','已重新複製最新正式資料；先前測試異動已清除。');
  }

  function undoSandbox(){
    if(!isSandbox())return;if(!sandboxUndoStack.length){toast('沒有可復原的操作','目前已回到最早的測試狀態。');return;}
    var restored=normalizeState(sandboxUndoStack.pop());restored.readOnly=false;restored.dataMode='sandbox';state=restored;sandboxLastSnapshot=clone(state);updateModeUI();refreshFormOptions();switchView(currentView);toast('已復原上一個測試操作','正式資料沒有受到影響。');
  }

  function showSandboxLog(){
    if(!isSandbox())return;var rows=sandboxOperationLog().slice().reverse(),meta=state.sandboxMeta||{};
    $('sandboxLogBody').innerHTML='<div class="sandbox-log-summary"><b>測試底稿</b><span>'+esc(meta.baselineRunId||'未標示')+'</span><small>建立時間：'+esc(formatDateTime(meta.createdAt))+'</small></div><div class="sandbox-log-list">'+(rows.map(function(row,index){return '<article><time>'+esc(formatDateTime(row.at))+'</time><b>'+esc(row.action||'測試操作')+'</b><span>操作 '+(rows.length-index)+'</span></article>';}).join('')||'<p class="student-empty">目前尚無測試操作。</p>')+'</div>';openModal('sandboxLogModal');
  }

  function formatDateTime(value){var date=new Date(value);if(!Number.isFinite(date.getTime()))return '—';return date.toLocaleString('zh-TW',{hour12:false});}

  async function toggleMigration(){
    if(loadingMigration)return;
    if(isSandbox()){returnToFormal();return;}
    if(isReadOnly()&&state.dataMode!=='empty'){enterSandbox();return;}
    var pin=migrationPin();if(!pin)return;
    loadingMigration=true;$('loadMigratedDataBtn').disabled=true;$('syncInjiaoyunBtn').disabled=true;updateModeUI();
    try{
      var loaded=await loadMigrationFromMirror(pin);
      toast('同步課表已載入','來源 '+clean((loaded.dataMeta||{}).runId)+'；音教雲欄位為唯讀。');
    }catch(error){
      var message=clean(error&&error.message||'無法讀取同步資料');
      if(message.indexOf('密碼')>=0||message.indexOf('permission-denied')>=0)clearMigrationPin();
      toast('載入失敗',message.slice(0,220),'error');
    }finally{loadingMigration=false;$('loadMigratedDataBtn').disabled=false;$('syncInjiaoyunBtn').disabled=false;updateModeUI();}
  }

  async function syncInjiaoyun(){
    if(loadingMigration)return;
    if(isSandbox()){toast('測試模式不直接同步','請先返回正式資料，再抓取並同步音教雲。','error');return;}
    var pin=migrationPin();if(!pin)return;
    if(!window.YouziCoursePreviewData||typeof window.YouziCoursePreviewData.sync!=='function'){toast('同步元件尚未載入','請重新整理頁面後再試。','error');return;}
    loadingMigration=true;$('loadMigratedDataBtn').disabled=true;$('syncInjiaoyunBtn').disabled=true;updateModeUI();
    try{
      var selectedDate=state.currentDate;
      var result=await window.YouziCoursePreviewData.sync({manualSyncPin:pin,refreshDate:selectedDate});
      var summary=result.summary||{};
      await loadMigrationFromMirror(pin);
      toast('抓取與同步完成',selectedDate+' 已重新抓取；新增 '+numberOf(summary.created)+'、更新 '+numberOf(summary.updated)+'、未變更 '+numberOf(summary.unchanged));
    }catch(error){
      var message=clean(error&&error.message||'音教雲同步失敗');
      if(message.indexOf('密碼')>=0||message.indexOf('permission-denied')>=0)clearMigrationPin();
      toast('同步失敗',message.slice(0,220),'error');
    }finally{loadingMigration=false;$('loadMigratedDataBtn').disabled=false;$('syncInjiaoyunBtn').disabled=false;updateModeUI();}
  }

  function bindEvents(){
    $$('[data-view]').forEach(function(node){node.addEventListener('click',function(){switchView(node.dataset.view);});});$$('[data-view-jump]').forEach(function(node){node.addEventListener('click',function(){switchView(node.dataset.viewJump);});});$$('[data-close-modal]').forEach(function(node){node.addEventListener('click',function(){closeModal(node.dataset.closeModal);});});$$('.modal-backdrop').forEach(function(node){node.addEventListener('click',function(event){if(event.target===node)closeModal(node.id);});});
    ['topNewEvent','sideNewEvent','calendarNewEvent'].forEach(function(id){$(id).addEventListener('click',function(){openSchedule({date:state.currentDate});});});$$('[data-day-step]').forEach(function(node){node.addEventListener('click',function(){state.currentDate=shiftDate(state.currentDate,numberOf(node.dataset.dayStep));renderCalendar();});});$('todayBtn').addEventListener('click',function(){state.currentDate=todayKey();renderCalendar();});$('calendarDate').addEventListener('change',function(){state.currentDate=this.value;renderCalendar();});$('scheduleForm').addEventListener('submit',submitSchedule);
    ['eventDate','eventStart','eventDuration','eventRoom','eventType','eventTeacher','eventTuitionPeriod'].forEach(function(id){$(id).addEventListener('change',function(){if(id==='eventRoom'||id==='eventType')updateRentalFields();updateScheduleConflict();});});$('eventSubject').addEventListener('change',function(){updateTeacherOptions();updateTuitionOptions();updateScheduleConflict();});$('eventStudent').addEventListener('change',function(){updateTuitionOptions();updateScheduleConflict();});$('eventFrequency').addEventListener('change',function(){$('repeatUntilField').classList.toggle('hidden',this.value==='once');});$('quickAddStudent').addEventListener('click',function(){closeModal('scheduleModal');openEntity('student','');});
    $('scheduleGrid').addEventListener('click',function(event){var eventButton=event.target.closest('[data-event-id]');if(eventButton){var row=findEvent(eventButton.dataset.eventId);if(row)eventDetails(row);return;}var slot=event.target.closest('[data-slot-room]');if(slot){if(isReadOnly()){toast('正式資料唯讀','請進入測試模式後再新增或調整課程。','error');return;}if(pasteToSlot(slot.dataset.slotRoom,slot.dataset.slotTime))return;openSchedule({date:state.currentDate,roomId:slot.dataset.slotRoom,start:slot.dataset.slotTime});}});$('cancelClipboard').addEventListener('click',function(){state.clipboard=null;renderCalendar();});
    $('eventModalBody').addEventListener('click',function(event){var button=event.target.closest('[data-attendance]');if(!button)return;var status=button.dataset.attendance,reason='';if(status==='leave'){var active=state.leaveReasons.filter(function(row){return row.active!==false;});reason=active.length?(window.prompt('請假原因（可填：'+active.map(function(row){return row.name;}).join('、')+'）')||''):'';var match=active.find(function(row){return row.name===reason;});reason=match?match.id:'';}setAttendance($('eventModal').dataset.eventId,status,reason);});$('eventModalFoot').addEventListener('click',function(event){var button=event.target.closest('[data-event-action]');if(button)eventAction(button.dataset.eventAction);});
    $('studentRows').addEventListener('click',function(event){var button=event.target.closest('[data-student-id]');if(button)openStudent(button.dataset.studentId);});$('studentTabs').addEventListener('click',function(event){var button=event.target.closest('[data-student-tab]');if(button){studentTab=button.dataset.studentTab;renderStudentModal();}});$('studentModalBody').addEventListener('click',function(event){var button=event.target.closest('[data-period-pay]');if(button)openTransaction(button.dataset.periodPay);});$('studentModalFoot').addEventListener('click',function(event){var button=event.target.closest('[data-student-action]');if(!button)return;if(button.dataset.studentAction==='edit'){closeModal('studentModal');openEntity('student',currentStudentId);}else openTuition(currentStudentId);});$('addStudentBtn').addEventListener('click',function(){openEntity('student','');});$('studentSearch').addEventListener('input',debounce(renderStudents,280));$('studentPaymentFilter').addEventListener('change',renderStudents);
    $('tuitionForm').addEventListener('submit',submitTuition);$('tuitionSubject').addEventListener('change',function(){updateTuitionForm();});$('tuitionPlan').addEventListener('change',renderTuitionSnapshot);$('transactionForm').addEventListener('submit',submitTransaction);$('transactionType').addEventListener('change',renderRefundLessonOptions);
    $('teacherCards').addEventListener('click',function(event){var payroll=event.target.closest('[data-teacher-payroll]'),edit=event.target.closest('[data-teacher-id]');if(payroll)openTeacherPayroll(payroll.dataset.teacherPayroll);if(edit)openEntity('teacher',edit.dataset.teacherId);});$('teacherPayrollMonth').addEventListener('change',renderTeacherPayroll);$('addTeacherBtn').addEventListener('click',function(){openEntity('teacher','');});$('teacherSearch').addEventListener('input',debounce(renderTeachers,280));
    $$('.settings-tabs button').forEach(function(button){button.addEventListener('click',function(){$$('.settings-tabs button').forEach(function(node){node.classList.toggle('active',node===button);});$$('.settings-panel').forEach(function(panel){panel.classList.toggle('active',panel.dataset.settingsPanel===button.dataset.settingsTab);});});});$('saveSettingsBtn').addEventListener('click',function(){if(!writable('儲存設定'))return;var start=numberOf($('startHour').value),end=numberOf($('endHour').value);if(end<=start){toast('時間設定錯誤','結束時間必須晚於開始時間。','error');return;}state.settings.startHour=start;state.settings.endHour=end;state.settings.defaultLessons=numberOf($('defaultLessons').value)||4;save('系統設定已儲存');renderCalendar();toast('設定完成','課程日表格線已重新整理。');});
    $('addRoomBtn').addEventListener('click',function(){openEntity('room','');});$('addSubjectBtn').addEventListener('click',function(){openEntity('subject','');});$('addFeePlanBtn').addEventListener('click',function(){openEntity('fee','');});$('addLeaveReasonBtn').addEventListener('click',function(){openEntity('leave','');});$('roomRows').addEventListener('click',function(event){var policy=event.target.closest('[data-room-policy]'),edit=event.target.closest('[data-room-edit]');if(policy)openPolicy(policy.dataset.roomPolicy);if(edit)openEntity('room',edit.dataset.roomEdit);});$('subjectRows').addEventListener('click',function(event){var button=event.target.closest('[data-subject-edit]');if(button)openEntity('subject',button.dataset.subjectEdit);});$('feePlanRows').addEventListener('click',function(event){var button=event.target.closest('[data-fee-edit]');if(button)openEntity('fee',button.dataset.feeEdit);});$('leaveReasonRows').addEventListener('click',function(event){var button=event.target.closest('[data-leave-edit]');if(button)openEntity('leave',button.dataset.leaveEdit);});$('feeSubjectFilter').addEventListener('change',renderFeeRows);$('entityForm').addEventListener('submit',submitEntity);$('policyWeekday').addEventListener('change',renderPolicy);$('savePolicyBtn').addEventListener('click',savePolicy);$('loadMigratedDataBtn').addEventListener('click',toggleMigration);$('syncInjiaoyunBtn').addEventListener('click',syncInjiaoyun);$('sandboxLogBtn').addEventListener('click',showSandboxLog);$('undoSandboxBtn').addEventListener('click',undoSandbox);$('resetSandboxBtn').addEventListener('click',resetSandbox);$('conflictBtn').addEventListener('click',function(){var count=Object.keys(dayConflictIds(eventsForDate(state.currentDate).filter(function(row){return row.status!=='leave'&&row.status!=='absent';}))).length;toast(count?'發現排課衝突':'今日沒有衝突',count?'共有 '+count+' 個課程需要調整。':'教室、老師、學生與教室規則均通過。',count?'error':'');});
  }

  function init(){
    try{localStorage.removeItem('youzi.courseScheduler.sandbox.v1');localStorage.removeItem('youzi.courseScheduler.sandboxUndo.v1');localStorage.removeItem('youzi.courseScheduler.lastMode.v1');}catch(_){}
    state=loadInitialState();if(!formalState&&state.readOnly&&state.dataMode!=='empty')formalState=clone(state);bindEvents();refreshFormOptions();updateModeUI();switchView('calendar');
    if(window.__YOUZI_COURSE_SCHEDULER_TEST__===true)window.YouziCourseSchedulerTest={snapshot:function(){return clone(state);},eventsForDate:function(date){return clone(eventsForDate(date));}};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
