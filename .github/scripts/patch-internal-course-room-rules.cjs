'use strict';
const fs=require('fs');
const path='course-scheduler.js';
let source=fs.readFileSync(path,'utf8');
function replaceRequired(oldValue,newValue,label){if(!source.includes(oldValue))throw new Error('Missing '+label);source=source.replace(oldValue,newValue);}
replaceRequired("{id:'r9',name:'錄音室',publicName:'錄音室',note:'租 200 元',rentalFee:200","{id:'r9',name:'錄音室',publicName:'錄音室',note:'租 100 元',rentalFee:100",'recording room fee');
source=source.replace(/endHour:22/g,'endHour:21');
replaceRequired(
"  function activeSubjects(){return state.subjects.filter(function(row){return row.active!==false;}).sort(bySort);}",
`  function activeSubjects(){return state.subjects.filter(function(row){return row.active!==false;}).sort(bySort);}\n  function roomKindOf(room){var explicit=clean(room&&room.roomKind).toLowerCase(),name=clean(room&&room.name);if(['normal','video','holding'].indexOf(explicit)>=0)return explicit;if(/不定時/.test(name))return 'holding';if(/視訊/.test(name))return 'video';return 'normal';}\n  function defaultRentalFeeForRoom(room){return /團練室|展演空間|平台鋼琴|5號鋼琴|五號鋼琴/.test(clean(room&&room.name))?200:100;}\n  function applyBusinessRoomDefaults(room){if(room.businessPolicyVersion===1)return room;var kind=roomKindOf(room),policies=room.policies&&typeof room.policies==='object'?room.policies:{};['sun','mon','tue','wed','thu','fri','sat'].forEach(function(day){if(!policies[day])policies[day]={};for(var minute=600;minute<1260;minute+=30){var time=minToTime(minute),closed=day==='mon'||(['tue','wed','thu','fri'].indexOf(day)>=0&&minute<750),existing=Object.prototype.hasOwnProperty.call(policies[day],time)?policies[day][time]:null;if(!existing)policies[day][time]={blockSchedule:closed,blockRental:closed||kind!=='normal',subjectIds:[]};}});room.policies=policies;room.roomKind=kind;room.rentable=kind==='normal';room.teacherSchedulable=true;room.rentalFee=defaultRentalFeeForRoom(room);room.businessPolicyVersion=1;return room;}`,
'room default helpers');
replaceRequired(
"    next.settings=Object.assign({startHour:10,endHour:21,interval:30,defaultLessons:4},next.settings||{});next.settings.interval=30;",
"    next.settings=Object.assign({startHour:10,endHour:21,interval:30,defaultLessons:4},next.settings||{});next.settings.interval=30;if(next.settings.businessHoursVersion!==1){next.settings.startHour=10;next.settings.endHour=21;next.settings.businessHoursVersion=1;}",
'settings migration');
replaceRequired(
"    next.rooms=applySavedOrder(next.rooms.map(function(row,index){return Object.assign({id:uid('room'),name:'教室 '+(index+1),note:'',rentalFee:0,sort:index+1,active:true,allowedSubjectIds:[],policies:{}},row,{allowedSubjectIds:Array.isArray(row.allowedSubjectIds)?row.allowedSubjectIds:[],policies:row.policies&&typeof row.policies==='object'?row.policies:{}});}),ROOM_ORDER_KEY);",
"    next.rooms=applySavedOrder(next.rooms.map(function(row,index){return applyBusinessRoomDefaults(Object.assign({id:uid('room'),name:'教室 '+(index+1),note:'',rentalFee:0,sort:index+1,active:true,allowedSubjectIds:[],policies:{}},row,{allowedSubjectIds:Array.isArray(row.allowedSubjectIds)?row.allowedSubjectIds:[],policies:row.policies&&typeof row.policies==='object'?row.policies:{}}));}),ROOM_ORDER_KEY);",
'room defaults migration');
replaceRequired(
"    event.preventDefault();if(!writable('儲存排課'))return;var row=formEvent(),reasons=updateScheduleConflict();if(reasons.length){toast('無法儲存','請先排除教室、老師、學生或時段規則衝突。','error');return;}",
"    event.preventDefault();if(!writable('儲存排課'))return;var row=formEvent(),kind=roomKindOf(roomById(row.roomId)),warning=kind==='video'?'視訊教室不是實體教室，老師需自行安排實際上課地點。確定要使用嗎？':kind==='holding'?'不定時教室只供暫時放置，之後仍需重新安排正式教室。確定要使用嗎？':'';if(warning&&!window.confirm(warning))return;var reasons=updateScheduleConflict();if(reasons.length){toast('無法儲存','請先排除教室、老師、學生或時段規則衝突。','error');return;}",
'special room confirmation');
fs.writeFileSync(path,source);
console.log('Internal course room rules installed.');