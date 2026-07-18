'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const integrity=require('../../operations-data-integrity');

test('SKU labels use 500-1234-1 format',function(){
  assert.equal(integrity.formatLabelSku('50012341'),'500-1234-1');
  assert.equal(integrity.formatLabelSku('500-1234-1'),'500-1234-1');
});

test('browser inventory helper matches negative-stock FIFO boundary',function(){
  assert.deepEqual(integrity.positiveInventoryDelta(-5,3),{before:-5,after:-2,delta:3,layerQty:0});
  assert.deepEqual(integrity.positiveInventoryDelta(-5,8),{before:-5,after:3,delta:8,layerQty:3});
});
