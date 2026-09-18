'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {signature}=require('../.github/scripts/ensure-course-query-indexes.cjs');
const definitions=require('../firestore.indexes.json').indexes.filter(index=>index.fields.some(field=>/^(source\.)?teacherId$/.test(field.fieldPath)));

test('Firestore API indexes with implicit document ordering match all teacher index definitions',()=>{
  for(const definition of definitions){
    const before=JSON.stringify(definition);
    const apiIndex={...definition,name:'projects/test/indexes/example',state:'READY',fields:[...definition.fields,{fieldPath:'__name__',order:'ASCENDING'}]};
    assert.equal(signature(apiIndex),signature(definition));
    assert.equal(JSON.stringify(definition),before);
  }
  assert.equal(definitions.length,6);
});

test('index matching preserves query scope and explicit ordering differences',()=>{
  const definition=definitions[0];
  assert.notEqual(signature(definition),signature({...definition,queryScope:'COLLECTION_GROUP'}));
  assert.notEqual(signature(definition),signature({...definition,fields:[...definition.fields,{fieldPath:'__name__',order:'DESCENDING'}]}));
  const descending={queryScope:'COLLECTION',fields:[{fieldPath:'date',order:'DESCENDING'}]};
  assert.equal(signature(descending),signature({...descending,fields:[...descending.fields,{fieldPath:'__name__',order:'DESCENDING'}]}));
});
