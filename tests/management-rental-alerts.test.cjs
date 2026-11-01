const {test}=require('node:test'),assert=require('node:assert/strict');
const {countsFor,rentalAlerts}=require('../management-pending-counts');
const scope=require('../personnel-approval-scope'),routes=require('../internal-workspace-routes');
const empty={leave:[],clock:[],temporary:[],profile:[],registration:[],contract:[]};
test('overlapping overdue and reminder contracts count once at rental and root',()=>{
 const rows=[{kind:'application',caseKey:'new',needsReview:true},{kind:'contract',caseKey:'old',status:'到期提醒中',endDate:'2000-01-01'},{kind:'contract',caseKey:'upcoming',status:'到期提醒中',endDate:'2099-01-01'},{kind:'contract',caseKey:'returned',status:'已退租',endDate:'2000-01-01'},{kind:'contract',caseKey:'archived',status:'已封存',endDate:'2000-01-01'}];
 const c=countsFor({...empty,rental:rows},[],scope);
 assert.equal(c['rental-overdue'],1);assert.equal(c['rental-reminder'],2);assert.equal(c.rental,3);assert.equal(c['rental-applications'],3);assert.equal(c.root,3);
 const failed=countsFor({...empty,rental:null},[],scope);assert.equal(failed['rental-overdue'],null);assert.equal(failed['rental-reminder'],null);assert.equal(failed.rental,null);
});
test('same expiry boundaries as rental manager, excluding invalid dates and applications',()=>{
 const row={kind:'contract',status:'租賃中',endDate:'2026-11-01'};
 assert.equal(rentalAlerts(row,'2026-11-01').overdue,false);assert.equal(rentalAlerts(row,'2026-11-02').overdue,true);
 assert.equal(rentalAlerts({...row,endDate:'2026-02-30'},'2026-11-01').overdue,false);
 assert.equal(rentalAlerts({...row,kind:'application'},'2026-11-02').overdue,false);
 for(const status of ['已退租','已取消','已封存','草稿'])assert.equal(rentalAlerts({...row,status},'2026-11-02').overdue,false);
});
test('tree links preserve exact category filters',()=>{
 for(const key of ['overdue','reminder'])assert.equal(new URL(routes.treeLink(routes.treeNode('rental-'+key)),'https://example.test/').searchParams.get('filter'),key);
});

