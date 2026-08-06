'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  bindingIdentityPatch,
  decideLineLoginBinding,
  isApprovedActiveBinding,
  isRecoverableUnboundBinding
} = require('../functions/courseLoginPolicy');

test('pending LINE bindings stay pending and cannot log in', () => {
  const row = {
    __id: 'pending-teacher',
    teacherId: 'T001',
    status: 'pending',
    approvalStatus: 'pending'
  };
  assert.equal(isApprovedActiveBinding(row), false);
  assert.equal(decideLineLoginBinding('teacher', [row]).action, 'pending');
});

test('teacher and renter roles stop when one LINE maps to different active identities', () => {
  const teacher = decideLineLoginBinding('teacher', [
    { __id: 'a', teacherId: 'T001', status: 'active' },
    { __id: 'b', teacherId: 'T002', status: 'active' }
  ]);
  const renter = decideLineLoginBinding('renter', [
    { __id: 'a', renterId: 'R001', status: 'active' },
    { __id: 'b', renterId: 'R002', status: 'active' }
  ]);
  assert.equal(teacher.action, 'conflict');
  assert.deepEqual(teacher.identities, ['T001', 'T002']);
  assert.equal(renter.action, 'conflict');
});

test('an active row without its role identity never receives an access token', () => {
  assert.equal(decideLineLoginBinding('teacher', [
    { __id: 'broken', status: 'active' }
  ]).action, 'conflict');
});

test('legacy targetId bindings are normalized to the role-specific identity field', () => {
  assert.deepEqual(bindingIdentityPatch('teacher', { targetId: 'T-LEGACY' }), { teacherId: 'T-LEGACY' });
  assert.deepEqual(bindingIdentityPatch('student', { targetId: 'S-LEGACY' }), { studentId: 'S-LEGACY' });
  assert.deepEqual(bindingIdentityPatch('renter', { targetId: 'R-LEGACY' }), { renterId: 'R-LEGACY' });
  assert.deepEqual(bindingIdentityPatch('teacher', { teacherId: 'T-NEW', targetId: 'T-OLD' }), {});
});

test('duplicate rows for the same identity choose the primary or newest row deterministically', () => {
  const newest = decideLineLoginBinding('teacher', [
    { __id: 'old', teacherId: 'T001', status: 'active', updatedAt: '2026-07-01T00:00:00Z' },
    { __id: 'new', teacherId: 'T001', status: 'active', updatedAt: '2026-08-01T00:00:00Z' }
  ]);
  assert.equal(newest.action, 'login');
  assert.equal(newest.binding.__id, 'new');

  const primary = decideLineLoginBinding('teacher', [
    { __id: 'primary', teacherId: 'T001', status: 'active', primary: true, updatedAt: '2026-07-01T00:00:00Z' },
    { __id: 'new', teacherId: 'T001', status: 'active', updatedAt: '2026-08-01T00:00:00Z' }
  ]);
  assert.equal(primary.binding.__id, 'primary');
});

test('one parent may retain multiple active student bindings', () => {
  const result = decideLineLoginBinding('student', [
    { __id: 'child-a', studentId: 'S001', status: 'active' },
    { __id: 'child-b', studentId: 'S002', status: 'active' }
  ]);
  assert.equal(result.action, 'login');
  assert.deepEqual(result.identities, ['S001', 'S002']);
});

test('global unlink is recoverable while explicit revocation or rejection stays blocked', () => {
  assert.equal(decideLineLoginBinding('teacher', []).action, 'setup');

  const explicitRevocation = { __id: 'revoked', teacherId: 'T001', status: 'revoked' };
  assert.equal(isRecoverableUnboundBinding(explicitRevocation), false);
  assert.equal(decideLineLoginBinding('teacher', [explicitRevocation]).action, 'blocked');

  const currentUnlink = {
    __id: 'unbound', teacherId: 'T001', status: 'unbound', approvalStatus: 'unbound'
  };
  assert.equal(isRecoverableUnboundBinding(currentUnlink), true);
  assert.equal(decideLineLoginBinding('teacher', [currentUnlink]).action, 'setup');

  const legacyUnlink = {
    __id: 'legacy-unlink', teacherId: 'T001', status: 'revoked', approvalStatus: 'revoked',
    lineBindStatus: 'unbound', globalLineRevokedReason: '管理者於統一入口完全解除 LINE'
  };
  assert.equal(isRecoverableUnboundBinding(legacyUnlink), true);
  assert.equal(decideLineLoginBinding('teacher', [legacyUnlink]).action, 'setup');

  const rejected = Object.assign({}, legacyUnlink, { status: 'rejected', approvalStatus: 'rejected' });
  assert.equal(isRecoverableUnboundBinding(rejected), false);
  assert.equal(decideLineLoginBinding('teacher', [rejected]).action, 'blocked');
});

test('both deployed and legacy callbacks use the shared policy and never self-approve pending rows', () => {
  const root = path.join(__dirname, '..', 'functions');
  const v3 = fs.readFileSync(path.join(root, 'courseLoginAuthV3.js'), 'utf8');
  const legacy = fs.readFileSync(path.join(root, 'coursePortal.js'), 'utf8');
  const legacyCallback = legacy.slice(
    legacy.indexOf('async function lineLoginCallback'),
    legacy.indexOf('async function completeVerifiedLineRegistration')
  );
  assert.match(v3, /decideLineLoginBinding\(type, allBindings\)/);
  assert.match(legacyCallback, /decideLineLoginBinding\(type, allBindings\)/);
  assert.match(v3, /bindingIdentity\(type, binding\)/);
  assert.match(legacyCallback, /bindingIdentity\(type, binding\)/);
  assert.match(v3, /bindingIdentityPatch\(type, binding\)/);
  assert.match(legacy, /bindingIdentityPatch\(type, binding\)/);
  assert.doesNotMatch(v3, /approvalSource:\s*['"]line-self-service-v3/);
  assert.doesNotMatch(legacyCallback, /approvalSource:\s*['"]line-self-service['"]/);
});
