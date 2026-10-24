'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../operations-phase1.js'), 'utf8');
const start = source.indexOf('function renderOverviewV7(){');
const end = source.indexOf('function educationSessionTeacherKey(', start);
const renderSource = source.slice(start, end);
const date = day => new Date(day + 'T12:00:00+08:00');
const money = value => 'NT$ ' + Math.round(value).toLocaleString('zh-TW');
function fixture(options = {}) {
  const state = {
    incomes: [], rentals: [], sales: [], salesReturns: [], purchases: [],
    receivablePayments: [], educationDaily: [], platformOrders: [], receivables: [],
    catalog: [], diagnostics: [], overviewRange: 'month', overviewMonth: '2026-10',
    ...options.state
  };
  const context = {
    state,
    overviewBounds: () => ({
      start: new Date((options.from || '2026-10-01') + 'T00:00:00+08:00'),
      end: new Date((options.to || '2026-10-31') + 'T23:59:59.999+08:00'), label: '本月'
    }),
    dateFrom: value => value ? new Date(value) : null,
    rentalIsEstablished: () => false, rentalIncomeEvents: () => [],
    sum: (rows, getter) => rows.reduce((total, row) => total + Number(getter(row) || 0), 0),
    clean: value => String(value ?? '').trim(),
    selectEducationDaily: rows => rows,
    visiblePlatformOrders: rows => rows,
    platformOrderIsEffective: row => !row.cancelled && !row.returned,
    platformOrderNeedsAttention: () => false,
    platformFeeMetrics: rows => ({
      gross: 0, net: 0, cost: rows.reduce((n, row) => n + Number(row.costTotal || 0), 0),
      profit: 0, variableFees: 0
    }),
    operatingExpenseLedgerForBounds: () => [], overviewRangeControlsHtml: () => '',
    escapeHtml: value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    attr: String, formatNumber: String, money, isCompactMobile: () => options.mobile !== false
  };
  vm.createContext(context);
  vm.runInContext(renderSource, context);
  return {state, context, render: () => vm.runInContext('renderOverviewV7()', context)};
}
const sale = (id, costTotal, day = '2026-10-24', extra = {}) => ({id, soldAt: date(day), saleType:'sale', costTotal, total:costTotal*1.5, ...extra});
const purchase = (id, totalCost, day = '2026-10-24', extra = {}) => ({id, receivedAt: date(day), totalCost, ...extra});
const online = (id, costTotal, day = '2026-10-24', extra = {}) => ({id, orderedAt: date(day), platform:'EasyStore', externalOrderNo:id, costTotal, quantity:1, ...extra});
function example(mobile = true) {
  return fixture({mobile,state:{
    sales:[sale('store',125000)], salesReturns:[{createdAt:date('2026-10-24'),restockedCost:5000}],
    platformOrders:[online('web',80000)], purchases:[purchase('receipt',130000)]
  }});
}
module.exports = {fixture, example, date, sale, purchase, online, source};
