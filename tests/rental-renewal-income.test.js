'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const adminSource = fs.readFileSync('rental-admin.html', 'utf8');
const operationsSource = fs.readFileSync('operations-phase1.js', 'utf8');

function functionBody(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const openingBrace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '\`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openingBrace + 1, index);
    }
  }
  assert.fail('unterminated function ' + name);
}

test('rental manager actions follow the selected renewal or return path', () => {
  const actionButtons = Function(
    'R',
    'hasFormalSubmittedData',
    'source',
    'c',
    functionBody(adminSource, 'actionButtons')
  ).bind(null, { clean(value) { return String(value == null ? '' : value).trim(); } }, () => false);

  const renewal = actionButtons('contract', {
    status: '續約待確認',
    pendingRenewal: { startDate: '2026-09-09' }
  });
  assert.match(renewal, /confirmRenewal\(\).*確認續約成立/);
  assert.doesNotMatch(renewal, /sendRenewalReturnLink|確認退租完成/);

  const active = actionButtons('contract', { status: '租賃中' });
  assert.match(active, /sendRenewalReturnLink\(\).*傳送續約 \/ 退租連結給客人/);
  assert.doesNotMatch(active, /confirmRenewal|確認退租完成/);

  const returning = actionButtons('contract', {
    status: '退租待安排',
    returnRequest: { status: '退租待安排' }
  });
  assert.match(returning, /completeReturn\(\).*確認退租完成/);
  assert.doesNotMatch(returning, /sendRenewalReturnLink|confirmRenewal/);
});

test('rental income events keep initial and confirmed renewal payments separate', () => {
  const rentalIncomeNumber = Function('value', functionBody(operationsSource, 'rentalIncomeNumber'));
  const rentalIncomeEventsRaw = Function(
    'rentalIncomeNumber',
    'rental',
    functionBody(operationsSource, 'rentalIncomeEvents')
  );
  const events = rentalIncomeEventsRaw(rentalIncomeNumber, {
    incomeAmount: 3200,
    incomeRecognizedAt: '2026-06-16 10:00:00',
    raw: {
      renewalEntries: [
        { renewalNo: 1, rentFee: '2,400 元', confirmedAt: '2026-09-08 09:30:00' },
        { renewalNo: 2, incomeAmount: 2600, incomeRecognizedAt: '2026-12-07 15:00:00' }
      ],
      pendingRenewal: { rentFee: 3000 }
    }
  });

  assert.deepEqual(events, [
    { kind: 'initial', amount: 3200, occurredAt: '2026-06-16 10:00:00', renewalNo: 0 },
    { kind: 'renewal', amount: 2400, occurredAt: '2026-09-08 09:30:00', renewalNo: 1 },
    { kind: 'renewal', amount: 2600, occurredAt: '2026-12-07 15:00:00', renewalNo: 2 }
  ]);
  assert.equal(events.reduce((total, event) => total + event.amount, 0), 8200);
});

test('confirming a renewal stores the payment audit fields used by operations', () => {
  const confirmStart = adminSource.indexOf('window.confirmRenewal=async function(){');
  const confirmEnd = adminSource.indexOf('window.completeReturn=async function()', confirmStart);
  assert.notEqual(confirmStart, -1, 'missing confirmRenewal action');
  assert.notEqual(confirmEnd, -1, 'missing end of confirmRenewal action');
  const confirmRenewalBody = adminSource.slice(confirmStart, confirmEnd);
  assert.match(confirmRenewalBody, /incomeRecognizedAt:confirmedAt/);
  assert.match(confirmRenewalBody, /receivedAt:confirmedAt/);
  assert.match(confirmRenewalBody, /incomeReceived:true/);
  assert.match(confirmRenewalBody, /renewalIncomeAmountTotal/);
  assert.match(confirmRenewalBody, /rentalIncomeTotalAmount:initialRentalIncomeAmount\+renewalIncomeAmountTotal/);
  assert.match(operationsSource, /初次租約收入/);
  assert.match(operationsSource, /續約收入/);
  assert.match(operationsSource, /初約依成立日、續約依收款確認日統計/);
});
