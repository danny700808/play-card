const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('course-portal-common.js','utf8');
const fn=source.slice(source.indexOf('  function finishSessionResolution()'),source.indexOf('  async function exchangeAccess('));
function node(){const classes=new Set();return {classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},querySelector:()=>message};}
const message={textContent:''},bind=node(),app=node(),loading=node(),body=node();let timer,observe,disconnected=false;
vm.runInNewContext(fn+';beginSessionResolution();',{document:{body,querySelector:s=>s==='[data-auth-view]'?bind:app,getElementById:id=>id==='sessionLoading'?loading:null},MutationObserver:class{constructor(fn){observe=fn}observe(){}disconnect(){disconnected=true}},setTimeout:fn=>{timer=fn}});
timer();assert(!loading.classList.contains('hidden'),'Slow loading must remain visible after 15 seconds');assert(!disconnected);assert(message.textContent.includes('仍在讀取'));app.classList.remove('hidden');observe();assert(loading.classList.contains('hidden'));assert(disconnected);
const student=fs.readFileSync('student-course-portal.html','utf8');assert(student.includes('id="retryStudentLoad"'));assert(student.includes("document.getElementById('studentLoadError').classList.remove('hidden')"));
console.log('Session loading stays visible after 15 seconds and finishes only when the view is ready');
