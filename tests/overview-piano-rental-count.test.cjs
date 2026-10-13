'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'operations-phase1.js'), 'utf8');
const start = source.indexOf('function renderOverviewV7(){');
const end = source.indexOf('function educationSessionTeacherKey(', start);
assert.ok(start >= 0 && end > start);
const renderSource = source.slice(start, end);
const date = day => new Date(day + 'T12:00:00+08:00');
const piano = (id, day, amount = 3600) => ({
  id, category: '電鋼琴租用收入', occurredAt: date(day), receivedAmount: amount
});

function render({ incomes = [], rentals = [], range = 'today', from = '2026-10-13', to = from, mobile = false } = {}) {
  const context = {
    state: {
      incomes, rentals, overviewRange: range, overviewMonth: '2026-10',
      sales: [], salesReturns: [], receivablePayments: [], educationDaily: [],
      platformOrders: [], receivables: [], catalog: []
    },
    overviewBounds: () => ({ start: date(from), end: date(to), label: '測試' }),
    dateFrom: value => value ? new Date(value) : null,
    rentalIsEstablished: row => row.established,
    rentalIncomeEvents: row => row.events,
    sum: (rows, getter) => rows.reduce((total, row) => total + Number(getter(row) || 0), 0),
    clean: value => String(value ?? '').trim(),
    selectEducationDaily: rows => rows,
    visiblePlatformOrders: rows => rows,
    platformFeeMetrics: () => ({ gross: 0, net: 0, cost: 0, profit: 0, variableFees: 0 }),
    operatingExpenseLedgerForBounds: () => [],
    overviewRangeControlsHtml: () => '',
    escapeHtml: String, attr: String, formatNumber: String,
    money: value => '$' + Number(value).toLocaleString('en-US'),
    isCompactMobile: () => mobile
  };
  vm.createContext(context);
  return vm.runInContext(renderSource + '\nrenderOverviewV7()', context);
}

function expectRental(html, count, amount) {
  const card = html.match(/<section class="ops-card ops-v8-channel-card ops-v8-channel-rental">[\s\S]*?<\/section>/)?.[0];
  assert.ok(card, 'rental summary must render');
  assert.match(card, new RegExp('租賃收入</span><b>\\$' + amount + '</b>'));
  assert.match(card, new RegExp('租賃收入筆數</span><b>' + count + ' 筆</b>'));
}

test('two POS piano rental entries show $7,200 and two rental income records', () => {
  expectRental(render({ incomes: [piano('a', '2026-10-13'), piano('b', '2026-10-13')] }), 2, '7,200');
});

test('initial and renewal events add to direct piano entries, excluding pending contracts', () => {
  expectRental(render({
    incomes: [piano('a', '2026-10-13'), piano('b', '2026-10-13')],
    rentals: [
      { established: true, events: [
        { kind: 'initial', amount: 3200, occurredAt: date('2026-10-13') },
        { kind: 'renewal', amount: 2400, occurredAt: date('2026-10-13') }
      ] },
      { established: false, events: [{ kind: 'initial', amount: 1000, occurredAt: date('2026-10-13') }] }
    ]
  }), 4, '12,800');
});

test('empty rental period remains zero and other income categories do not count', () => {
  expectRental(render({ incomes: [
    { ...piano('repair', '2026-10-13'), category: '維修收入' },
    { ...piano('other', '2026-10-13'), category: '其他收入' }
  ] }), 0, '0');
});

test('today, month, year and custom ranges count only piano entries within their bounds', () => {
  const incomes = [piano('a', '2026-10-13'), piano('b', '2026-10-14'), piano('c', '2026-09-01'), piano('d', '2025-10-13')];
  for (const [range, from, to, count, amount] of [
    ['today', '2026-10-13', '2026-10-13', 1, '3,600'],
    ['month', '2026-10-01', '2026-10-31', 2, '7,200'],
    ['year', '2026-01-01', '2026-12-31', 3, '10,800'],
    ['custom', '2026-09-01', '2026-10-13', 2, '7,200']
  ]) expectRental(render({ incomes, range, from, to }), count, amount);
});

test('mobile report template uses the same corrected count', () => {
  expectRental(render({ mobile: true, incomes: [piano('a', '2026-10-13'), piano('b', '2026-10-13')] }), 2, '7,200');
});
