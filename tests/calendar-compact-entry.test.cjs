'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../operations-course-inline.js'),'utf8');
const start=source.indexOf('      function fitDesktopCalendar(){');
const code=source.slice(start,source.indexOf('      var layoutFrame=0;',start));
function fit({hash='',active=true,scrollY=0,mobile=false}={}){
  const properties=new Map();
  const grid={dataset:{slotCount:'22'},style:{setProperty:(k,v)=>properties.set(k,v),removeProperty:k=>properties.delete(k)}};
  const scroll={getClientRects:()=>[{}],getBoundingClientRect:()=>({top:200-scrollY})};
  const nodes={'#scheduleGrid':grid,'#scheduleScroll':scroll,'#calendarPage.active':active?{}:null};
  const context={global:{location:{hash},innerHeight:856,scrollY,matchMedia:q=>({matches:mobile?q.includes('max-width'):q.includes('min-width')})},inlineBody:{},host:{isConnected:true},shadow:{querySelector:s=>nodes[s]||null}};
  vm.runInNewContext(code+'\nfitDesktopCalendar();',context);
  return properties;
}
test('default portal entry fits the same compact calendar as the explicit route',()=>{
  const direct=fit(),route=fit({hash:'#course-calendar'});
  assert.deepEqual(direct,route);
  assert.equal(direct.get('--slot'),'27px');
  assert.equal(direct.get('--room-col'),'minmax(0,1fr)');
  assert(36+22*parseFloat(direct.get('--slot'))<=856-200-16);
});
test('scrolling before a resize does not enlarge the calendar',()=>{
  assert.deepEqual(fit({scrollY:400}),fit());
});
test('inactive calendar and mobile retain their own layout',()=>{
  assert.equal(fit({active:false}).size,0);
  assert.equal(fit({mobile:true}).size,0);
});
