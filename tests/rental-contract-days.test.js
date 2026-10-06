const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const commonSource = fs.readFileSync(path.join(root, 'rental-common.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'rental-admin.html'), 'utf8');
const context = {
  window: {
    location: { origin: 'https://example.test', pathname: '/play-card/rental-admin.html' },
  },
  document: { getElementById() { return null; } },
  localStorage: { getItem() { return null; } },
  alert() {},
  console,
  Date,
  Math,
  Number,
  String,
  JSON,
  encodeURIComponent,
};

vm.runInNewContext(commonSource, context, { filename: 'rental-common.js' });
const rental = context.window.YZRental;

assert.strictEqual(rental.inclusiveDays('2026-08-03', '2026-09-10'), 39,
  '手動租期應包含起租日及到期日，共 39 天');
assert.strictEqual(rental.inclusiveDays('2026-08-03', '2026-08-03'), 1,
  '同一天起訖應計為 1 天');
assert.strictEqual(rental.inclusiveDays('2026-09-10', '2026-08-03'), 0,
  '到期日早於起租日應視為無效');

const initialDateLink = rental.syncLinkedRentalDates({
  changedId: 'deliveryDate',
  type: 'digitalPiano',
  periods: 1,
  deliveryDate: '2026-08-03',
  startDate: '',
  endDate: '',
  startDateManuallyEdited: false,
  endDateManuallyEdited: false,
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(initialDateLink)), {
  deliveryDate: '2026-08-03',
  startDate: '2026-08-03',
  endDate: '2026-10-31',
}, '第一次選擇安裝日仍應自動帶入起租日及一期 90 天到期日');

const manualDateLink = rental.syncLinkedRentalDates({
  changedId: 'deliveryDate',
  type: 'digitalPiano',
  periods: 1,
  deliveryDate: '2026-08-08',
  startDate: '2026-08-03',
  endDate: '2026-09-10',
  startDateManuallyEdited: true,
  endDateManuallyEdited: true,
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(manualDateLink)), {
  deliveryDate: '2026-08-08',
  startDate: '2026-08-03',
  endDate: '2026-09-10',
}, '手動修改起訖日後，再選安裝日不得覆蓋已選日期');

const manualEndOnly = rental.syncLinkedRentalDates({
  changedId: 'deliveryDate',
  type: 'digitalPiano',
  periods: 1,
  deliveryDate: '2026-08-05',
  startDate: '2026-08-03',
  endDate: '2026-09-10',
  startDateManuallyEdited: false,
  endDateManuallyEdited: true,
});
assert.deepStrictEqual(JSON.parse(JSON.stringify(manualEndOnly)), {
  deliveryDate: '2026-08-05',
  startDate: '2026-08-05',
  endDate: '2026-09-10',
}, '只手動修改到期日時，安裝日可更新起租日但不得把到期日改回 90 天');

const customPeriodHtml = rental.renderContractHtml({
  rentalType: 'digitalPiano',
  equipmentName: 'KAWAI ES-120G',
  periods: 1,
  periodDays: 90,
  rentDays: 90,
  startDate: '2026-08-03',
  endDate: '2026-09-10',
  rentalMethod: '實體租用',
});
assert(customPeriodHtml.includes('<td>2026-08-03</td><td>2026-09-10</td><td>39 天</td>'),
  '合約明細應以實際起訖日期顯示 39 天，而不是舊的 90 天');

const standardEnd = rental.calcEndDate('2026-08-03', 1, 'digitalPiano', 90);
assert.strictEqual(standardEnd, '2026-10-31');
assert.strictEqual(rental.inclusiveDays('2026-08-03', standardEnd), 90,
  '未手動調整時仍維持一期 90 天');

assert(adminSource.includes("const chosenEndDate=R.clean(R.val('endDate'))"),
  '正式確認前應保留管理者手動設定的到期日');
assert(adminSource.includes('payload.rentDays=R.inclusiveDays(payload.startDate,payload.endDate)'),
  '正式成立資料應重新儲存實際租賃天數');
assert(adminSource.includes('rawPayload.rentDays=actualRentDays'),
  '草稿及客戶連結資料也應儲存實際租賃天數');

console.log('rental contract date synchronization tests passed');

const renewed={rentalType:'electronicDrum',periods:1,startDate:'2026-07-08',endDate:'2027-01-03',rentFee:3200,
  initialStartDate:'2026-07-08',initialEndDate:'2026-10-05',
  renewalEntries:[{startDate:'2026-10-06',endDate:'2027-01-03',rentFee:3000,periods:1}]};
const before=JSON.stringify(renewed);
const renewedHtml=rental.renderContractHtml(renewed);
assert(renewedHtml.includes('<td>2026-07-08</td><td>2026-10-05</td><td>90 天</td>'));
assert(renewedHtml.includes('<td>2026-10-06</td><td>2027-01-03</td><td>90 天</td>'));
assert(!renewedHtml.includes('180 天'));
assert(renewedHtml.includes('3,200 元') && renewedHtml.includes('3,000 元'));
assert.strictEqual(JSON.stringify(renewed),before,'Rendering must not change money, dates or renewal records');

const legacy={...renewed};delete legacy.initialStartDate;delete legacy.initialEndDate;
assert(rental.renderContractHtml(legacy).includes('<td>2026-07-08</td><td>2026-10-05</td><td>90 天</td>'));
const secondCustomer={...legacy,startDate:'2026-06-16',endDate:'2026-12-12',rentFee:2900,
  renewalEntries:[{startDate:'2026-09-14',endDate:'2026-12-12',rentFee:2800}]};
assert(rental.renderContractHtml(secondCustomer).includes('<td>2026-06-16</td><td>2026-09-13</td><td>90 天</td>'));

const repeated={...legacy,endDate:'2027-04-03',renewalEntries:[
  {startDate:'2027-01-04',endDate:'2027-04-03'},...legacy.renewalEntries]};
assert(rental.renderContractHtml(repeated).includes('<td>2026-07-08</td><td>2026-10-05</td><td>90 天</td>'));

const customInitial={...renewed,initialEndDate:'2026-09-30'};
assert(rental.renderContractHtml(customInitial).includes('<td>2026-07-08</td><td>2026-09-30</td><td>85 天</td>'),
  'An explicitly agreed initial end takes precedence over inference from a later renewal');
const pendingOnly={...legacy,renewalEntries:[],pendingRenewal:{startDate:'2026-10-06',endDate:'2027-01-03'}};
assert(rental.renderContractHtml(pendingOnly).includes('<td>2026-07-08</td><td>2027-01-03</td><td>180 天</td>'),
  'Unconfirmed applications must not alter an existing rental term');
const twoPeriods={rentalType:'digitalPiano',periods:2,startDate:'2026-06-28',endDate:'2026-12-24'};
assert(rental.renderContractHtml(twoPeriods).includes('初次租用 2 期（180 天）'));
assert(rental.renderContractHtml({rentalType:'other',startDate:'2026-06-27',endDate:'2026-08-08'}).includes('<td>43 天</td>'));
console.log('initial rental terms stay separate from confirmed and pending renewals');
