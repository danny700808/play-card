'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// Keep these unit tests runnable without installing the Functions SDK. The production
// module is still syntax-checked separately and CI also loads it with real dependencies.
const originalLoad = Module._load;
const fakeFieldValue = {
  serverTimestamp: () => ({ __serverTimestamp: true }),
  delete: () => ({ __delete: true })
};
function fakeFirestore() {
  return {
    collection() {
      throw new Error('Unexpected Firestore access from a pure inventory test');
    }
  };
}
fakeFirestore.FieldValue = fakeFieldValue;
fakeFirestore.FieldPath = { documentId: () => '__name__' };
Module._load = function loadWithFirebaseStubs(request, parent, isMain) {
  if (request === 'firebase-functions/v2/https') {
    return {
      onCall: (_options, handler) => handler,
      HttpsError: class HttpsError extends Error {
        constructor(code, message) {
          super(message);
          this.code = code;
        }
      }
    };
  }
  if (request === 'firebase-admin') {
    return { apps: [{}], initializeApp() {}, firestore: fakeFirestore };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let bindingModule;
try {
  bindingModule = require('../functions/unifiedLineBindingAdmin');
} finally {
  Module._load = originalLoad;
}
const { _test } = bindingModule;
const specByCollection = new Map(_test.SOURCES.map((spec) => [spec.collection, spec]));

function source(collection, id, row) {
  const spec = specByCollection.get(collection);
  assert(spec, `Unknown source collection: ${collection}`);
  return { spec, id, row: row || {}, ref: { path: `${collection}/${id}` } };
}

function rowFor(data, lineUserId) {
  const row = data.rows.find((candidate) => candidate.lineUserId === lineUserId);
  assert(row, `Missing inventory row for ${lineUserId}`);
  return row;
}

async function main() {
  assert.deepStrictEqual(
    _test.lineIds({ lineUserId: 'U123', customerLineUserId: 'U123', targetLineUserId: 'U456' }),
    ['U123', 'U456']
  );
  assert.strictEqual(_test.mask('U12345678901234567890'), 'U1234••••••••67890');
  assert.strictEqual(_test.inactive({ employmentStatus: '已離職' }), true);
  assert.strictEqual(_test.inactive({ status: 'active' }), false);
  assert.strictEqual(_test.inactive({ status: '解除申請待審核' }), false);
  assert.strictEqual(_test.inactive({ status: 'extended' }), false);
  assert.strictEqual(
    _test.activeSource({ collection: 'employees' }, { status: 'active', lineNotifyEnabled: true }),
    true
  );
  assert.strictEqual(
    _test.activeSource({ collection: 'employees' }, { status: 'active', lineNotifyEnabled: false }),
    false
  );
  assert.strictEqual(_test.first({ employeeId: 'EMP001' }, ['employeeId']), 'EMP001');

  // A converted application and its contract are two visible business records but one
  // effective equipment-rental identity, even if the contract only links back through
  // the application's linkedContractId.
  const rental = _test.buildInventory([
    source('rentalApplications', 'APP-1', {
      applicationId: 'APP-1', linkedContractId: 'CON-1', customerName: '租用客人',
      lineUserId: 'U-RENTAL', lineLinkStatus: 'linked', status: '已轉正式契約',
      updatedAtText: '2026-08-01T10:00:00+08:00'
    }),
    source('rentalContracts', 'CON-1', {
      contractId: 'CON-1', customerName: '租用客人', lineUserId: 'U-RENTAL',
      lineLinkStatus: 'linked', status: '租用中', updatedAtText: '2026-08-02T10:00:00+08:00'
    })
  ]);
  const rentalRow = rowFor(rental, 'U-RENTAL');
  assert.strictEqual(rentalRow.sourceCount, 2);
  assert.strictEqual(rentalRow.activeRecordCount, 2);
  assert.strictEqual(rentalRow.activeSourceCount, 1);
  assert.strictEqual(rentalRow.staleSourceCount, 0);
  assert.strictEqual(rentalRow.multiIdentity, false);
  assert.deepStrictEqual(rentalRow.identities, ['equipment-rental|APP-1']);
  assert.deepStrictEqual(
    rentalRow.sources.map((item) => item.canonicalIdentityId),
    ['APP-1', 'APP-1']
  );
  assert(rentalRow.sources.every((item) => !item.stale && !item.duplicate));

  // Two separate applications from the same LINE customer are two business events,
  // not two people. They count as one effective equipment-rental LINE identity.
  const repeatRental = _test.buildInventory([
    source('rentalApplications', 'APP-A', {
      applicationId: 'APP-A', customerName: '同一租用客人', lineUserId: 'U-REPEAT-RENTAL',
      lineLinkStatus: 'linked', status: '租用中'
    }),
    source('rentalApplications', 'APP-B', {
      applicationId: 'APP-B', customerName: '同一租用客人', lineUserId: 'U-REPEAT-RENTAL',
      lineLinkStatus: 'linked', status: '租用中'
    })
  ]);
  const repeatRentalRow = rowFor(repeatRental, 'U-REPEAT-RENTAL');
  assert.strictEqual(repeatRentalRow.sourceCount, 2);
  assert.strictEqual(repeatRentalRow.activeRecordCount, 2);
  assert.strictEqual(repeatRentalRow.activeSourceCount, 1);
  assert.strictEqual(repeatRentalRow.multiIdentity, false);
  assert.strictEqual(repeatRentalRow.needsAttention, false);

  // External-teacher indexes/profile/contract mirrors use their shared employeeId as
  // one canonical role identity. The compatibility employeeLineBindings mirror is also
  // classified as external rather than creating a false employee conflict.
  const external = _test.buildInventory([
    source('employees', 'EMP-EXT-1', {
      employeeId: 'EMP-EXT-1', identityType: 'external', status: 'active', lineUserId: 'U-EXTERNAL'
    }),
    source('externalTeacherLineBindings', 'EXT-CODE', {
      employeeId: 'EMP-EXT-1', teacherId: 'EXT-CON-1', lineUserId: 'U-EXTERNAL', status: 'bound'
    }),
    source('employeeLineBindings', 'EXT-CODE', {
      employeeId: 'EMP-EXT-1', externalTeacherContractId: 'EXT-CON-1',
      targetCollection: 'externalTeacherContracts', lineUserId: 'U-EXTERNAL', status: 'bound'
    }),
    source('externalTeacherProfiles', 'EXT-CON-1', {
      employeeId: 'EMP-EXT-1', teacherId: 'EXT-CON-1', lineUserId: 'U-EXTERNAL', status: 'active'
    }),
    source('externalTeacherContracts', 'EXT-CON-1', {
      employeeId: 'EMP-EXT-1', contractId: 'EXT-CON-1', lineUserId: 'U-EXTERNAL', status: 'active'
    })
  ]);
  const externalRow = rowFor(external, 'U-EXTERNAL');
  assert.strictEqual(externalRow.sourceCount, 5);
  assert.strictEqual(externalRow.activeRecordCount, 5);
  assert.strictEqual(externalRow.activeSourceCount, 1);
  assert.strictEqual(externalRow.multiIdentity, false);
  assert.strictEqual(externalRow.staleSourceCount, 0);
  assert.deepStrictEqual(externalRow.identities, ['external|EMP-EXT-1']);
  assert(externalRow.sources.every((item) => item.canonicalIdentityId === 'EMP-EXT-1'));
  assert.strictEqual(
    _test.sourceKind(specByCollection.get('employees'), { isExternalTeacher: true }),
    'external'
  );

  // Annual profiles/contracts are legitimate business history mirrors. They must not
  // be auto-deduplicated or become cleanup targets merely because they share employeeId.
  const annualExternal = _test.buildInventory([
    source('employees', 'EMP-ANNUAL', {
      employeeId: 'EMP-ANNUAL', identityType: 'external', status: 'active'
    }),
    source('externalTeacherContracts', 'CONTRACT-2025', {
      employeeId: 'EMP-ANNUAL', contractId: 'CONTRACT-2025', lineUserId: 'U-ANNUAL',
      status: 'active', updatedAtText: '2025-01-01T00:00:00Z'
    }),
    source('externalTeacherContracts', 'CONTRACT-2026', {
      employeeId: 'EMP-ANNUAL', contractId: 'CONTRACT-2026', lineUserId: 'U-ANNUAL',
      status: 'active', updatedAtText: '2026-01-01T00:00:00Z'
    })
  ]);
  const annualExternalRow = rowFor(annualExternal, 'U-ANNUAL');
  assert.strictEqual(annualExternalRow.sourceCount, 2);
  assert.strictEqual(annualExternalRow.activeSourceCount, 1);
  assert.strictEqual(annualExternalRow.staleSourceCount, 0);
  assert.strictEqual(annualExternalRow.manualReviewSourceCount, 0);
  assert(annualExternalRow.sources.every((item) => !item.stale && !item.duplicate));

  // Inactive business history may need review, but automatic cleanup must preserve it.
  const cancelledRental = _test.buildInventory([
    source('rentalApplications', 'APP-CANCELLED', {
      applicationId: 'APP-CANCELLED', lineUserId: 'U-CANCELLED',
      lineLinkStatus: 'linked', status: '已取消'
    })
  ]);
  const cancelledRentalRow = rowFor(cancelledRental, 'U-CANCELLED');
  assert.strictEqual(cancelledRentalRow.staleSourceCount, 0);
  assert.strictEqual(cancelledRentalRow.manualReviewSourceCount, 1);
  assert.strictEqual(cancelledRentalRow.sources[0].stale, false);
  assert.strictEqual(cancelledRentalRow.sources[0].manualReview, true);
  assert.match(cancelledRentalRow.sources[0].status, /^保留歷史：/);

  const orphanExternal = _test.buildInventory([
    source('externalTeacherLineBindings', 'ORPHAN-CODE', {
      employeeId: 'MISSING-EMPLOYEE', teacherId: 'MISSING-TEACHER',
      lineUserId: 'U-ORPHAN', status: 'bound'
    })
  ]);
  assert.strictEqual(
    rowFor(orphanExternal, 'U-ORPHAN').sources[0].staleReason,
    '找不到對應外聘老師資料'
  );

  // Multiple roles are not themselves a conflict. A real conflict remains visible when
  // the same role kind has two distinct active canonical ids for one LINE account.
  const roles = _test.buildInventory([
    source('coursePortalTeacherBindings', 'TB-1', {
      teacherId: 'TEACHER-1', lineUserId: 'U-ROLES', status: 'active', approvalStatus: 'approved'
    }),
    source('coursePortalStudentBindings', 'SB-1', {
      studentId: 'STUDENT-1', lineUserId: 'U-ROLES', status: 'active', approvalStatus: 'approved'
    }),
    source('coursePortalStudentBindings', 'SB-FAMILY-1', {
      studentId: 'CHILD-1', lineUserId: 'U-FAMILY', status: 'active', approvalStatus: 'approved'
    }),
    source('coursePortalStudentBindings', 'SB-FAMILY-2', {
      studentId: 'CHILD-2', lineUserId: 'U-FAMILY', status: 'active', approvalStatus: 'approved'
    }),
    source('coursePortalTeacherBindings', 'TB-2', {
      teacherId: 'TEACHER-1', lineUserId: 'U-CONFLICT', status: 'active', approvalStatus: 'approved'
    }),
    source('coursePortalTeacherBindings', 'TB-3', {
      teacherId: 'TEACHER-2', lineUserId: 'U-CONFLICT', status: 'active', approvalStatus: 'approved'
    })
  ]);
  const rolesRow = rowFor(roles, 'U-ROLES');
  assert.strictEqual(rolesRow.activeSourceCount, 2);
  assert.strictEqual(rolesRow.multiIdentity, false);
  const familyRow = rowFor(roles, 'U-FAMILY');
  assert.strictEqual(familyRow.activeSourceCount, 2);
  assert.strictEqual(familyRow.multiIdentity, false);
  assert.strictEqual(familyRow.needsAttention, false);
  const conflictRow = rowFor(roles, 'U-CONFLICT');
  assert.strictEqual(conflictRow.activeSourceCount, 2);
  assert.strictEqual(conflictRow.multiIdentity, true);
  assert.strictEqual(conflictRow.needsAttention, true);
  assert.strictEqual(conflictRow.staleSourceCount, 0);

  // Duplicate retention is independent of Firestore read order: valid, active and then
  // newest wins. Only the older binding mirror is offered to cleanup.
  const employee = source('employees', 'EMP-DUP', { employeeId: 'EMP-DUP', status: 'active' });
  const oldBinding = source('employeeLineBindings', 'B-OLD', {
    employeeId: 'EMP-DUP', lineUserId: 'U-DUP', status: 'bound',
    updatedAtText: '2026-07-01T00:00:00Z'
  });
  const newBinding = source('employeeLineBindings', 'B-NEW', {
    employeeId: 'EMP-DUP', lineUserId: 'U-DUP', status: 'bound',
    updatedAtText: '2026-08-01T00:00:00Z'
  });
  for (const input of [
    [employee, oldBinding, newBinding],
    [newBinding, employee, oldBinding]
  ]) {
    const duplicateRow = rowFor(_test.buildInventory(input), 'U-DUP');
    const kept = duplicateRow.sources.find((item) => !item.stale);
    const duplicate = duplicateRow.sources.find((item) => item.duplicate);
    assert.strictEqual(kept.sourceId, 'B-NEW');
    assert.strictEqual(duplicate.sourceId, 'B-OLD');
    assert.strictEqual(duplicate.staleReason, '同一身分有重複綁定資料');
    assert.strictEqual(duplicateRow.activeSourceCount, 1);
  }

  const activeBeatsNewerPending = _test.buildInventory([
    source('coursePortalTeacherBindings', 'TEACHER-ACTIVE', {
      teacherId: 'TEACHER-SAME', lineUserId: 'U-ACTIVE-FIRST',
      status: 'active', approvalStatus: 'approved', updatedAtText: '2026-07-01T00:00:00Z'
    }),
    source('coursePortalTeacherBindings', 'TEACHER-PENDING', {
      teacherId: 'TEACHER-SAME', lineUserId: 'U-ACTIVE-FIRST',
      status: 'pending', approvalStatus: 'pending', updatedAtText: '2026-08-01T00:00:00Z'
    })
  ]);
  const activeFirstRow = rowFor(activeBeatsNewerPending, 'U-ACTIVE-FIRST');
  assert.strictEqual(activeFirstRow.sources.find((item) => !item.stale).sourceId, 'TEACHER-ACTIVE');
  assert.strictEqual(activeFirstRow.sources.find((item) => item.duplicate).sourceId, 'TEACHER-PENDING');

  // Pending binding indexes are not active. A newer pending row must never displace a
  // currently bound row and cause cleanup to revoke the valid binding.
  const boundBeatsPending = _test.buildInventory([
    source('employees', 'EMP-BOUND-FIRST', {
      employeeId: 'EMP-BOUND-FIRST', status: 'active'
    }),
    source('employeeLineBindings', 'BOUND-OLD', {
      employeeId: 'EMP-BOUND-FIRST', lineUserId: 'U-BOUND-FIRST', status: 'bound',
      updatedAtText: '2026-07-01T00:00:00Z'
    }),
    source('employeeLineBindings', 'PENDING-NEW', {
      employeeId: 'EMP-BOUND-FIRST', lineUserId: 'U-BOUND-FIRST', status: 'pending',
      updatedAtText: '2026-08-01T00:00:00Z'
    })
  ]);
  const boundFirstRow = rowFor(boundBeatsPending, 'U-BOUND-FIRST');
  assert.strictEqual(boundFirstRow.sources.find((item) => !item.stale).sourceId, 'BOUND-OLD');
  assert.strictEqual(boundFirstRow.sources.find((item) => item.duplicate).sourceId, 'PENDING-NEW');
  assert.strictEqual(boundFirstRow.sources.find((item) => !item.stale).active, true);

  // If legacy fields inside one document disagree, the document is shared by multiple
  // LINE ids. It must be surfaced for manual review and excluded from auto cleanup.
  const conflictingLineFields = _test.buildInventory([
    source('rentalApplications', 'APP-LINE-CONFLICT', {
      applicationId: 'APP-LINE-CONFLICT', lineUserId: 'U-LINE-NEW',
      customerLineUserId: 'U-LINE-OLD', lineLinkStatus: 'linked', status: '租用中'
    })
  ]);
  for (const lineUserId of ['U-LINE-NEW', 'U-LINE-OLD']) {
    const conflict = rowFor(conflictingLineFields, lineUserId);
    assert.strictEqual(conflict.lineIdConflict, true);
    assert.strictEqual(conflict.needsAttention, true);
    assert.strictEqual(conflict.staleSourceCount, 0);
    assert.strictEqual(conflict.manualReviewSourceCount, 1);
    assert.strictEqual(conflict.sources[0].destructiveBlocked, true);
    assert.match(conflict.sources[0].status, /^需人工確認：/);
  }

  assert.deepStrictEqual(
    _test.lineIds({ line: { userId: 'U-NESTED' } }),
    ['U-NESTED']
  );
  assert.deepStrictEqual(
    _test.lineIds({ line: { userId: 'U-NESTED-A', lineUserId: 'U-NESTED-B' } }),
    ['U-NESTED-A', 'U-NESTED-B']
  );
  const nestedClear = _test.clearPatch({
    collection: 'rentalApplications',
    row: { line: { userId: 'U-NESTED', lineUserId: 'U-NESTED', metadata: 'keep' } }
  }, '主管', '測試');
  assert.deepStrictEqual(nestedClear['line.userId'], { __delete: true });
  assert.deepStrictEqual(nestedClear['line.lineUserId'], { __delete: true });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(nestedClear, 'line'), false);
  assert.strictEqual(_test.queueCanBeCancelled({ status: '待發送' }), true);
  assert.strictEqual(_test.queueCanBeCancelled({ status: 'retry' }), true);
  assert.strictEqual(_test.queueCanBeCancelled({ status: '發送失敗' }), true);
  assert.strictEqual(_test.queueCanBeCancelled({ status: 'temporary error' }), true);
  assert.strictEqual(_test.queueCanBeCancelled({ status: '已發送' }), false);
  assert.strictEqual(_test.queueCanBeCancelled({ status: 'completed' }), false);
  assert.strictEqual(_test.queueCanBeCancelled({ status: '發送中' }), false);
  assert.strictEqual(_test.queueCanBeCancelled({}), true);
  const queueClear = _test.queueCancelPatch({
    line: { userId: 'U-NESTED', metadata: 'keep' },
    target: { lineUserId: 'U-NESTED', role: 'customer' }
  }, 'U-NESTED', '主管', '測試');
  assert.deepStrictEqual(queueClear['line.userId'], { __delete: true });
  assert.deepStrictEqual(queueClear['line.lineUserId'], { __delete: true });
  assert.deepStrictEqual(queueClear['target.lineUserId'], { __delete: true });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(queueClear, 'line'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(queueClear, 'target'), false);

  // Pagination reads every deterministic page instead of silently stopping at 2,500.
  const pageOne = Array.from({ length: 500 }, (_, index) => ({
    id: `D-${String(index).padStart(3, '0')}`,
    ref: { path: `employees/D-${String(index).padStart(3, '0')}` },
    updateTime: { seconds: 1000 + index },
    data: () => ({ employeeId: `D-${index}` })
  }));
  const pageTwo = [{
    id: 'D-500', ref: { path: 'employees/D-500' }, data: () => ({ employeeId: 'D-500' })
  }];
  let getCount = 0;
  let startAfterCount = 0;
  const query = {
    orderBy(field) { assert.strictEqual(field, '__name__'); return this; },
    limit(size) { assert.strictEqual(size, 500); return this; },
    startAfter(cursor) { assert.strictEqual(cursor, pageOne[499]); startAfterCount += 1; return this; },
    async get() { getCount += 1; return { docs: getCount === 1 ? pageOne : pageTwo }; }
  };
  const paged = await _test.readSource(specByCollection.get('employees'), {
    collection(name) { assert.strictEqual(name, 'employees'); return query; }
  });
  assert.strictEqual(paged.length, 501);
  assert.deepStrictEqual(paged[0].updateTime, { seconds: 1000 });
  assert.strictEqual(getCount, 2);
  assert.strictEqual(startAfterCount, 1);

  let destructivePage = 0;
  const destructiveQuery = {
    where() { return this; },
    orderBy() { return this; },
    limit() { return this; },
    startAfter() { return this; },
    async get() {
      destructivePage += 1;
      if (destructivePage === 1) return { docs: pageOne };
      throw new Error('simulated second-page failure');
    }
  };
  const oldConsoleError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      _test.queryEq('coursePortalSessions', 'lineUserId', 'U-FAIL', {
        collection() { return destructiveQuery; }
      }),
      /simulated second-page failure/
    );
  } finally {
    console.error = oldConsoleError;
  }

  // Destructive writes are one atomic batch per LINE account. Over-limit groups are
  // rejected before batch creation, while duplicate paths count only once.
  const writes = [];
  let commitCount = 0;
  const updateTime = { seconds: 123 };
  const atomicDatabase = {
    batch() {
      return {
        update(...args) { writes.push(['update', ...args]); return this; },
        delete(...args) { writes.push(['delete', ...args]); return this; },
        set(...args) { writes.push(['set', ...args]); return this; },
        async commit() { commitCount += 1; }
      };
    }
  };
  const duplicateRef = { path: 'employeeLineBindings/SAME' };
  const atomicCount = await _test.commitAtomic([
    { action: 'update', ref: duplicateRef, data: { status: 'first' } },
    { action: 'update', ref: duplicateRef, data: { status: 'last' }, updateTime }
  ], atomicDatabase);
  assert.strictEqual(atomicCount, 1);
  assert.strictEqual(commitCount, 1);
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0][2].status, 'last');
  assert.deepStrictEqual(writes[0][3], { lastUpdateTime: updateTime });

  let batchCreatedForOversize = false;
  await assert.rejects(
    _test.commitAtomic(Array.from({ length: _test.MAX_ATOMIC_WRITES + 1 }, (_, index) => ({
      action: 'update', ref: { path: `employeeLineBindings/OVER-${index}` }, data: { index }
    })), {
      batch() { batchCreatedForOversize = true; throw new Error('must not create batch'); }
    }),
    /超過單次安全上限/
  );
  assert.strictEqual(batchCreatedForOversize, false);

  const page = fs.readFileSync(path.join(__dirname, '..', 'line-binding-admin.html'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '..', 'line-binding-admin.js'), 'utf8');
  const link = fs.readFileSync(path.join(__dirname, '..', 'unified-line-binding-link-v1.js'), 'utf8');
  assert(page.includes('統一 LINE 綁定管理'));
  assert(page.includes('有效身分'));
  assert(page.includes('需處理帳號'));
  assert(page.includes('同角色衝突'));
  assert(client.includes('coursePortalAdminUnifiedLineData'));
  assert(client.includes('coursePortalAdminUnifiedLineAction'));
  assert(client.includes('完全解除 LINE'));
  assert(client.includes('summary.manualReviewSources'));
  assert(client.includes('row.lineIdConflict'));
  assert(client.includes('result.ok !== true && result.partial !== true'));
  assert(client.includes("P.toast(result.message || '整理完成。', result.partial ? 'error' : '')"));
  assert(link.includes('line-binding-admin.html'));

  console.log('unified-line-binding-admin tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
