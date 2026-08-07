'use strict';
const assert = require('assert');
const fs = require('fs');
const read = name => fs.readFileSync(name, 'utf8');

const hub = read('teacher-hub.html');
assert(hub.includes('外聘老師管理中心'));
assert(hub.includes('employee-admin.html?type=external'));
assert(hub.includes('announcement-admin.html?audience=external'));
assert(hub.includes('task.html?mode=admin&identity=external'));
assert(hub.includes('external-teacher-forms-admin.html'));
assert(hub.includes("getEmployeeManagementData"));

const employee = read('employee-admin.html');
assert(!employee.includes('}).filter(externalConfirmedForEmployeeAdmin);'));
const extStart = employee.indexOf('async function loadExternalSupplement(e)');
const extEnd = employee.indexOf('async function loadEmployeeSupplement(e)', extStart);
const extSection = employee.slice(extStart, extEnd);
assert(!extSection.includes('if(email)'));
assert(!extSection.includes('if(mobile)'));
assert(employee.includes("if(identityType(e)==='external')"));
assert(employee.includes('external-teacher-admin-route-v1.js'));

const task = read('task.html');
assert(task.includes("get('identity')==='external'"));
assert(task.includes("getEmployeeManagementData"));
assert(task.includes('請選擇外聘老師'));
assert(task.includes('external-teacher-admin-route-v1.js'));

const announcement = read('announcement-admin.html');
assert(announcement.includes('external-teacher-admin-route-v1.js'));

const portal = read('teacher-course-portal.html');
const gridStart = portal.indexOf('<div class="teacher-more-grid">');
const gridEnd = portal.indexOf('</div>', gridStart);
const menu = portal.slice(gridStart, gridEnd);
const positions = ['announcements.html','task.html','teacher-goods.html','forms-hub.html','profile.html','contract.html'].map(x => menu.indexOf(x));
positions.forEach(x => assert(x >= 0));
for(let i=1;i<positions.length;i++) assert(positions[i] > positions[i-1]);

const forms = read('forms-hub.html');
assert(!forms.includes('rental-order.html'));
assert(forms.includes('集點卡'));
assert(forms.includes('在職證明'));
assert(forms.includes('教學證明'));

const settings = read('settings.html');
assert(settings.includes('名單、資料、合約、公告、協助事項、拿貨與表格'));

const contractPage = read('contract.html');
assert(contractPage.includes('canonicalExternalTeacher:canonical'));
assert(contractPage.includes('payload.portalProfileId=currentUser.portalProfileId'));
assert(contractPage.includes('payload.portalProfileVersion=Number(currentUser.portalProfileVersion||0)'));

const bridge = read('teacher-more-auth-bridge.js');
assert(bridge.includes('youzi.teacherMore.authorization.v4'));
const course = read('functions/coursePortal.js');
const resolverStart = course.indexOf('async function resolveTeacherUtilityEmployee(session)');
const resolverEnd = course.indexOf('function teacherUtilityBoolean', resolverStart);
const resolver = course.slice(resolverStart, resolverEnd);
assert(resolver.includes('teacherPortalProfileId(teacherId)'));
assert(resolver.includes('TEACHER_PORTAL_PROFILE_SOURCE'));
assert(resolver.includes('canonicalEmployeeId'));
assert(resolver.includes("clean(canonicalExisting.source) === 'course-portal-canonical-external-teacher'"));
assert(resolver.includes('batch.delete(canonicalRef)'));
assert(!resolver.includes("teacherUtilityResolveRows('externalTeacherProfiles'"));
assert(!resolver.includes("mirrorRows('teachers')"));
assert(!resolver.includes("collection('employees').limit"));

const onboarding = read('external-teacher-onboarding.html');
const createStart = onboarding.indexOf('async function createOrResumeBinding()');
const createEnd = onboarding.indexOf('function requiredBindingDone', createStart);
const createFlow = onboarding.slice(createStart, createEnd);
assert(onboarding.includes("DRAFT_KEY_PREFIX='externalTeacherOnboardingDraftV3:'"));
assert(onboarding.includes('sessionStorage.setItem(activeDraftKey()'));
assert(onboarding.includes("p.get('fresh')==='1'"));
assert(onboarding.includes('freshPortalMode&&!hasBasic'));
assert(onboarding.includes("clearLegacyDraftState()"));
assert(!createFlow.includes('findReusableExternalContract('));
assert(!onboarding.includes('findReusableExternalContract'));
assert(!onboarding.includes('findExternalEmployeeByContact'));
assert(!onboarding.includes('syncExternalTeacherEmployee'));
assert(!createFlow.includes("localStorage.setItem('externalTeacherCurrentId'"));
assert(!onboarding.includes("const lastId=localStorage.getItem('externalTeacherCurrentId')"));

const externalAdmin = read('external-teacher-admin.html');
assert(externalAdmin.includes("source:'external-teacher-admin-confirmed'"));
assert(externalAdmin.includes('portalProfileVersion:Number(c.portalProfileVersion||0)'));
const onboardingBackend = read('functions/externalTeacherOnboarding.js');
const createCallableStart = onboardingBackend.indexOf('exportsObj.externalTeacherCreateBindCode');
const createCallableEnd = onboardingBackend.indexOf('exportsObj.externalTeacherGetOnboarding', createCallableStart);
const createCallable = onboardingBackend.slice(createCallableStart, createCallableEnd);
assert(createCallable.includes("db().collection('externalTeacherProfiles').doc().id"));
assert(!createCallable.includes('request.auth.uid'));
assert(!createCallable.includes('resolveExternalEmployeeId'));
console.log('external teacher center tests passed');

assert(read('teacher-hub.html').includes('!replaced(row)'));
assert(read('employee-admin.html').includes('coursePortalTeacherCanonicalReplaced'));
