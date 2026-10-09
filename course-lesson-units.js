(function(root){
  'use strict';
  function unitMinutes(period){var snapshot=period&&period.planSnapshot||{},explicit=Number(period&&period.lessonUnitMinutes||snapshot.lessonUnitMinutes);return explicit===30||explicit===60?explicit:/半小時|半小时/.test(snapshot.name||period&&period.planName||'')?30:60;}
  function units(row){return Number(row&&row.lessonUnits)>0?Number(row.lessonUnits):1;}
  function allocations(row){return Array.isArray(row.periodAllocations)&&row.periodAllocations.length?row.periodAllocations:[{periodId:row.periodId,lessonUnits:units(row)}];}
  function periodRows(rows,periodId){return (rows||[]).flatMap(function(row){return allocations(row).filter(function(a){return a.periodId===periodId;}).map(function(a){return Object.assign({},row,a);});});}
  function slots(period,rows){
    var count=Math.max(1,Number(period.lessonCount)||4), result=Array.from({length:count},function(){return [];}), ordered=(rows||[]).slice().sort(function(a,b){return String((a.late===true&&a.attendanceRecordedAt)||((a.date||'')+' '+(a.startTime||'00:00'))).localeCompare(String((b.late===true&&b.attendanceRecordedAt)||((b.date||'')+' '+(b.startTime||'00:00'))))||Number(a.lessonNo||0)-Number(b.lessonNo||0);});
    var known=ordered.reduce(function(sum,row){return sum+units(row);},0),cursor=Math.max(0,Number(period.usedCount||0)-known);
    ordered.forEach(function(row){var left=units(row);if(row.slotNo)cursor=Number(row.slotNo)-1;else if(row.lessonNo&&Number.isInteger(cursor))cursor=Math.max(cursor,Number(row.lessonNo)-1);while(left>0&&cursor<count){var index=Math.floor(cursor),take=Math.min(left,1-(cursor-index));result[index].push(Object.assign({},row,{slotUnits:take}));cursor+=take;left-=take;}});
    return result;
  }
  var api={unitMinutes:unitMinutes,units:units,allocations:allocations,periodRows:periodRows,slots:slots};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.YouziLessonUnits=api;
})(typeof globalThis==='object'?globalThis:this);
