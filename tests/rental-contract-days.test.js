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
