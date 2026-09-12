(function(root){
  'use strict';
  function units(row){return Number(row&&row.lessonUnits)>0?Number(row.lessonUnits):1;}
  function allocations(row){return Array.isArray(row.periodAllocations)&&row.periodAllocations.length?row.periodAllocations:[{periodId:row.periodId,lessonUnits:units(row)}];}
  function periodRows(rows,periodId){return (rows||[]).flatMap(function(row){return allocations(row).filter(function(a){return a.periodId===periodId;}).map(function(a){return Object.assign({},row,a);});});}
  function slots(period,rows){
    var count=Math.max(1,Number(period.lessonCount)||4), result=Array.from({length:count},function(){return [];}), ordered=(rows||[]).slice().sort(function(a,b){return String(a.date||'').localeCompare(String(b.date||''))||String(a.startTime||'').localeCompare(String(b.startTime||''))||Number(a.lessonNo||0)-Number(b.lessonNo||0);});
    var known=ordered.reduce(function(sum,row){return sum+units(row);},0),cursor=Math.max(0,Number(period.usedCount||0)-known);
    ordered.forEach(function(row){var left=units(row);if(row.slotNo)cursor=Number(row.slotNo)-1;else if(row.lessonNo&&Number.isInteger(cursor))cursor=Math.max(cursor,Number(row.lessonNo)-1);while(left>0&&cursor<count){var index=Math.floor(cursor),take=Math.min(left,1-(cursor-index));result[index].push(Object.assign({},row,{slotUnits:take}));cursor+=take;left-=take;}});
    return result;
  }
  var api={units:units,allocations:allocations,periodRows:periodRows,slots:slots};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.YouziLessonUnits=api;
})(typeof globalThis==='object'?globalThis:this);
