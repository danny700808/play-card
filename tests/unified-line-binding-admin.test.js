'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { _test } = require('../functions/unifiedLineBindingAdmin');

assert.deepStrictEqual(
  _test.lineIds({ lineUserId: 'U123', customerLineUserId: 'U123', targetLineUserId: 'U456' }),
  ['U123', 'U456']
);
assert.strictEqual(_test.mask('U12345678901234567890'), 'U1234••••••••67890');
assert.strictEqual(_test.inactive({ employmentStatus: '已離職' }), true);
assert.strictEqual(_test.inactive({ status: 'active' }), false);
assert.strictEqual(
  _test.activeSource({ collection: 'employees' }, { status: 'active', lineNotifyEnabled: true }),
  true
);
assert.strictEqual(
  _test.activeSource({ collection: 'employees' }, { status: 'active', lineNotifyEnabled: false }),
  false
);
assert.strictEqual(_test.first({ employeeId: 'EMP001' }, ['employeeId']), 'EMP001');

const page = fs.readFileSync(path.join(__dirname, '..', 'line-binding-admin.html'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '..', 'line-binding-admin.js'), 'utf8');
const link = fs.readFileSync(path.join(__dirname, '..', 'unified-line-binding-link-v1.js'), 'utf8');
assert(page.includes('統一 LINE 綁定管理'));
assert(client.includes('coursePortalAdminUnifiedLineData'));
assert(client.includes('coursePortalAdminUnifiedLineAction'));
assert(client.includes('完全解除 LINE'));
assert(link.includes('line-binding-admin.html'));

console.log('unified-line-binding-admin tests passed');
