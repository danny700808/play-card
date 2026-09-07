'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sourceHash,sourceMatches}=require('../functions/injiaoyunEducationMirror');
test('matching stored hash cannot hide stale fields left by recursive merges',()=>{
 const source={id:'lesson',date:'2026-09-01',start:'16:30',studentIds:['correct-student']};
 const hash=sourceHash(source);
 assert.equal(sourceMatches({sourceHash:hash,source:{...source,studentNames:['old student']}},source,hash),false);
 assert.equal(sourceMatches({sourceHash:hash,source:{...source,start:'16:00'}},source,hash),false);
});
test('Firestore field ordering does not force another overwrite of identical data',()=>{
 const source={id:'lesson',date:'2026-09-01',start:'16:30',studentIds:['correct-student']};
 const reordered=Object.fromEntries(Object.entries(source).reverse());
 assert.equal(sourceMatches({sourceHash:sourceHash(source),source:reordered},source,sourceHash(source)),true);
});
