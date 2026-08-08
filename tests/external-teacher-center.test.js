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
assert(hub.includes("getExternalTeacherWorkAssignees"));
assert(!hub.includes('id="teacherList"'));
assert(!hub.includes('未命名外聘老師'));

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
assert(task.includes("getExternalTeacherWorkAssignees"));
assert(task.includes('__ALL_EXTERNAL__'));
assert(task.includes('全體外聘老師（公告）'));
assert(task.includes("const external=routeParams.get('identity')==='external'"));
assert(task.includes("$('dueType').value=external?'none':'today'"));
assert(task.includes("$('needReport').checked=!external"));
assert(task.includes("$('allowComment').checked=!external"));
assert(task.includes("$('allowRedo').checked=!external"));
assert(task.includes("workScope:'external-teacher-v2'"));
assert(task.includes('external-teacher-admin-route-v1.js'));

const announcement = read('announcement-admin.html');
const externalRoute = read('external-teacher-admin-route-v1.js');
assert(announcement.includes('external-teacher-admin-route-v1.js'));
assert(announcement.includes('資訊提醒'), '一般員工共用入口仍保留原公告等級');
assert(externalRoute.includes("['一般公告', '重要公告'].includes(option.value)"));
assert(externalRoute.includes('option.remove()'));
assert(externalRoute.includes('audienceBox.hidden = true'));
assert(announcement.includes("workScope:'external-teacher-v2'"));
const saveStart = announcement.indexOf('async function saveAnnouncement()');
const saveEnd = announcement.indexOf('function scheduleIdle_', saveStart);
const saveFlow = announcement.slice(saveStart, saveEnd);
assert(saveFlow.includes('YZManagerAuth.requireManager'));
assert(saveFlow.indexOf('YZManagerAuth.requireManager') < saveFlow.indexOf("filesToAssets('#imageInput'"));

const portal = read('teacher-course-portal.html');
const gridStart = portal.indexOf('<div class="teacher-more-grid">');
const gridEnd = portal.indexOf('</div>', gridStart);
const menu = portal.slice(gridStart, gridEnd);
const positions = ['announcements.html','task.html','teacher-goods.html','forms-hub.html','teacher-profile.html','contract.html'].map(x => menu.indexOf(x));
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
const contractRuntime = read('teacher-contract.js');
assert(contractPage.includes('id="contractProfileRequired"'));
assert(contractPage.includes('請先完成基本資料'));
assert(!contractPage.includes('teacherIdNumber'));
assert(!contractPage.includes('teacherAddress'));
assert(contractRuntime.includes("SESSION_KEY = 'youzi.coursePortal.teacher.session.v1'"));
assert(contractRuntime.includes('coursePortalTeacherContractSession'));
assert(contractRuntime.includes('coursePortalTeacherSubmitContract'));

const bridge = read('teacher-more-auth-bridge.js');
assert(bridge.includes('youzi.teacherMore.authorization.v4'));
const course = read('functions/coursePortal.js');
const resolverStart = course.indexOf('async function resolveTeacherUtilityEmployee(session)');
const resolverEnd = course.indexOf('function teacherUtilityBoolean', resolverStart);
const resolver = course.slice(resolverStart, resolverEnd);
assert(resolver.includes('teacherPortalProfileId(teacherId)'));
assert(resolver.includes('TEACHER_PORTAL_PROFILE_SOURCE'));
assert(resolver.includes('canonicalEmployeeId'));
assert(resolver.includes('batch.set(canonicalRef, employeeSeed'));
assert(!resolver.includes('batch.delete(canonicalRef)'));
assert(resolver.includes('managerLinkedEmployeeIds'));
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
const legacyLineStart = onboardingBackend.indexOf('async function handleExternalTeacherLineEvent(event)');
const legacyLineEnd = onboardingBackend.indexOf('function buildExternalTeacherEmailBody', legacyLineStart);
const legacyLineFlow = onboardingBackend.slice(legacyLineStart, legacyLineEnd);
assert(legacyLineFlow.includes('舊版外聘老師綁定碼，已停止自動回寫'));
assert(!legacyLineFlow.includes("collection('externalTeacherLineBindings')"));
assert(!legacyLineFlow.includes("collection('employeeLineBindings')"));
const createCallableStart = onboardingBackend.indexOf('exportsObj.externalTeacherCreateBindCode');
const createCallableEnd = onboardingBackend.indexOf('exportsObj.externalTeacherGetOnboarding', createCallableStart);
const createCallable = onboardingBackend.slice(createCallableStart, createCallableEnd);
assert(createCallable.includes("db().collection('externalTeacherProfiles').doc().id"));
assert(!createCallable.includes('request.auth.uid'));
assert(!createCallable.includes('resolveExternalEmployeeId'));
console.log('external teacher center tests passed');

assert(read('employee-admin.html').includes('coursePortalTeacherCanonicalReplaced'));

const workBackend = read('functions/externalTeacherWork.js');
assert(workBackend.includes("announcements: 'externalTeacherAnnouncementsV2'"));
assert(workBackend.includes("tasks: 'externalTeacherTasksV2'"));
assert(!workBackend.includes("db.collection('announcements')"));
assert(!workBackend.includes("db.collection('tasks')"));
assert(workBackend.includes('舊版事項，不能直接覆蓋'));
assert(workBackend.includes('PROFILE_IN_PROGRESS'));

const rules = read('firestore.rules');
assert(rules.includes('match /externalTeacherAnnouncementsV2/{document=**} { allow read, write: if false; }'));
assert(rules.includes('match /externalTeacherTasksV2/{document=**} { allow read, write: if false; }'));
