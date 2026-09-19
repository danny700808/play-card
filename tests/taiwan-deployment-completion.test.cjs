'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {httpNames,missingNames}=require('../.github/scripts/deploy-missing-taiwan-http.cjs');
test('completion reconciles callable and HTTP entries and excludes event handlers',()=>{
 const names=httpNames({login:{__endpoint:{callableTrigger:{}}},asset:{__endpoint:{httpsTrigger:{}}},notice:{__endpoint:{eventTrigger:{}}}});
 assert.deepEqual(names,['login','asset']);
 assert.deepEqual(missingNames(names,[{name:'projects/p/locations/asia-east1/functions/login',state:'ACTIVE'},{name:'projects/p/locations/asia-east1/functions/asset',state:'DEPLOYING'}]),['asset']);
 assert.deepEqual(missingNames(names,names.map(name=>({name:'projects/p/locations/asia-east1/functions/'+name,state:'ACTIVE'}))),[]);
});
