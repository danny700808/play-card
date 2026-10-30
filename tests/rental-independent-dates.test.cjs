const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'rental-admin.html'), 'utf8');
const fields = {contractId:'test-only', rentalType:'digitalPiano', periods:'1',
  startDate:'2026-11-03', endDate:'2027-01-31', deliveryDate:'2026-11-02',
  shippingMethod:'到府安裝', customerName:'Test', customerIdNumber:'test', rentFee:'2900'};
const saved = [], alerts = [], errors = [];
const ctx = {window:{}, document:{getElementById:()=>null}, localStorage:{getItem:()=>null}, console, Date};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'rental-common.js'), 'utf8'), ctx);
const R = ctx.window.YZRental;
Object.assign(R, {val:k=>fields[k]||'', setVal:(k,v)=>fields[k]=v, qs:()=>({}), toast:()=>{},
  db:()=>({collection:()=>({doc:()=>({set:async p=>saved.push(p)})})}),
  officialContractUrl:()=> 'https://example.test/contract', get:async()=>null});
Object.assign(ctx, {R, selected:{}, rentalDateManual:{start:false,end:false},
  isFinalConfirmStage:()=>true, readEquipmentItems:()=>[{name:'Piano'}],
  readInternalRentalCountPayload:()=>({}), notifyPref:()=> 'email',
  adminDeliveryMethod:()=>fields.shippingMethod, adminDeliveryMethodType:()=>fields.shippingMethod,
  adminNormalizeFloorNote:x=>x, adminFloorExtraFee:()=>0, adminFloorFeeText:()=>'',
  adminDeliveryDateLabel:()=> '確認安裝日期', validateInternalRentalCountFor:()=>true,
  hasSignatureAsset:()=>true, hasIdImageAsset:()=>true,
  alert:text=>alerts.push(text), confirm:text=>{assert(text.includes(fields.startDate));return true;},
  showRentalProgress:()=>{}, updateRentalProgress:()=>{}, completeRentalProgress:()=>{},
  failRentalProgress:text=>errors.push(text), ensureRentalContractAssetsStored:async()=>({}),
  generatePdfBlob:async p=>{assert.equal(p.startDate,'2026-11-03');return {};},
  uploadOfficialPdf:async()=>({url:'test.pdf',path:'test.pdf'}),
  sanitizeRentalContractForFirestore:p=>p, queueOfficialContractLine:async()=>({count:0}),
  notificationResultText:()=>'', loadAll:async()=>{}, renderContract:()=>{}});
for (const [start,end] of [
  ['    function officializeContract','    function editorHtml'],
  ['    function collect()','    function applyDeliveryMethodUi'],
  ['    window.markDelivered=','    window.cancelApplication=']
]) vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)),ctx);

const original = {...fields};
for(const type of ['digitalPiano','electronicDrum','other']) {
  fields.rentalType=type;
  for(const manuallyEdited of [false,true]) {
    ctx.rentalDateManual={start:manuallyEdited,end:manuallyEdited};
    fields.deliveryDate='2026-11-01'; ctx.syncRentalDatesFromDelivery('deliveryDate');
    assert.equal(fields.startDate,original.startDate);
    assert.equal(fields.endDate,original.endDate);
    fields.deliveryDate=''; ctx.syncRentalDatesFromDelivery('startDate');
    assert.equal(fields.deliveryDate,'','Changing start must not fill installation');
    const blankDelivery=ctx.collect(); assert.equal(blankDelivery.deliveryDate,'');
    fields.deliveryDate='2026-11-02';
    const payload=ctx.collect();
    assert.equal(payload.startDate,original.startDate);
    assert.equal(payload.deliveryDate,'2026-11-02');
    const html=R.renderContractHtml(payload,{officialView:true});
    assert(html.includes('安裝時間：2026-11-02'));
    assert(html.includes('2026-11-03'));
  }
}
Object.assign(fields,original);
ctx.rentalDateManual={start:false,end:false};
fields.periods='2'; ctx.syncRentalDatesFromDelivery('periods');
assert.equal(fields.endDate,R.calcEndDate(fields.startDate,2,'digitalPiano'));
assert.equal(fields.deliveryDate,original.deliveryDate);
Object.assign(fields,original);
(async()=>{
  await ctx.window.markDelivered();
  assert.deepEqual(errors,[]);
  assert.equal(saved[0].startDate,'2026-11-03');
  assert.equal(saved[0].officialStartDate,'2026-11-03');
  assert.equal(saved[0].confirmedDeliveryDate,'2026-11-02');
  assert.equal(saved[0].rentDays,90);
  fields.startDate='';
  assert.equal(ctx.collect().startDate,'','Installation must not replace a missing rental start');
  const count=saved.length;
  await ctx.window.markDelivered();
  assert.equal(saved.length,count);
  assert(alerts.at(-1).includes('正式起租日'));
  console.log('PASS: independent inputs, blank dates, preview, term calculation and formal confirmation');
})().catch(e=>{console.error(e);process.exitCode=1;});
