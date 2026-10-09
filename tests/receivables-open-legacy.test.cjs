const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../operations-phase1.js'),'utf8');
const snippet = source.slice(source.indexOf('  function isOpenReceivable('),source.indexOf('  function purchaseEntrySeriesTabs('));
function context(){
  const records=new Map([['customers/customer-1',{name:'Test customer',phone:'0900000000'}]]);
  const db={collection:name=>({doc:id=>({key:name+'/'+id})}),runTransaction:async run=>run({get:async ref=>({exists:records.has(ref.key),data:()=>records.get(ref.key)}),set:(ref,data)=>records.set(ref.key,data)})};
  const ctx={state:{db,receivables:[],customers:[],sales:[],incomes:[],receivablePayments:[],receivableSearch:''},COLLECTIONS:{customers:'customers',receivables:'receivables',audit:'audit'},FormData:class{constructor(form){this.data=form.data;}get(key){return this.data[key]||'';}},clean:v=>String(v||'').trim(),numberOrNull:v=>v===''?null:Number(v),serverTimestamp:()=>123,userLabel:()=> 'test',VERSION:'test',money:v=>String(v),closeDrawer:()=>{},toast:()=>{},loadAll:async()=>{},lower:v=>String(v||'').toLowerCase(),dateFrom:()=>0,escapeHtml:String,attr:String,formatNumber:String,sum:(rows,fn)=>rows.reduce((a,x)=>a+fn(x),0),kpi:()=>'',emptyHtml:()=> 'EMPTY'};
  vm.createContext(ctx);vm.runInContext(snippet,ctx);return {ctx,records};
}
test('only outstanding unpaid and partial balances are searchable; paid and zero rows remain stored',()=>{
  const {ctx}=context();
  ctx.state.receivables=[{id:'a',customerName:'Open',receivableNo:'OPEN',status:'unpaid',outstandingAmount:6000},{id:'b',customerName:'Paid',receivableNo:'PAID',status:'paid',outstandingAmount:0},{id:'c',customerName:'Zero',receivableNo:'ZERO',status:'unpaid',outstandingAmount:0},{id:'d',customerName:'Partial',receivableNo:'PARTIAL',status:'partial',outstandingAmount:100}];
  const html=ctx.renderReceivablesV5();assert.match(html,/OPEN/);assert.match(html,/PARTIAL/);assert.doesNotMatch(html,/PAID|ZERO/);
  ctx.state.receivableSearch='Paid';assert.match(ctx.renderReceivablesV5(),/EMPTY/);assert.equal(ctx.state.receivables.length,4);
});
test('legacy entry stores remaining debt once without generating sales or payment records',async()=>{
  const {ctx,records}=context(),form={dataset:{id:'AR-LEGACY-test'},data:{customerId:'customer-1',amount:'6000',note:'Old balance'}};
  await ctx.saveLegacyReceivable(form);await ctx.saveLegacyReceivable(form);
  const row=records.get('receivables/AR-LEGACY-test');assert.equal(row.outstandingAmount,6000);assert.equal(row.receivedAmount,0);assert.equal(row.sourceType,'legacy');assert.equal(row.saleId,'');assert.equal(row.status,'unpaid');assert.equal(records.size,3);
});
test('invalid balances or missing customers cannot write a receivable',async()=>{
  for(const amount of ['0','-1','1.5','abc','Infinity']){const {ctx,records}=context();await assert.rejects(ctx.saveLegacyReceivable({dataset:{id:'x'},data:{customerId:'customer-1',amount}}));assert.equal(records.size,1);}
  const {ctx,records}=context();await assert.rejects(ctx.saveLegacyReceivable({dataset:{id:'x'},data:{customerId:'missing',amount:'6000'}}));assert.equal(records.size,1);
});
