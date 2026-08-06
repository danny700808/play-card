from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def insert_before_regex(text: str, pattern: str, addition: str, label: str) -> str:
    if addition.strip() in text:
        return text
    match = re.search(pattern, text)
    if not match:
        raise RuntimeError(f"{label}: marker not found")
    return text[:match.start()] + addition + text[match.start():]


# 1. Employee management is the one canonical external-teacher master.
employee_path = Path("employee-admin.html")
employee = employee_path.read_text(encoding="utf-8")
employee = replace_once(
    employee,
    "const mergedRows = (res.rows || []).map(function(row){ return mergeSalaryIntoEmployee(row, salaryMap); }).filter(externalConfirmedForEmployeeAdmin);",
    "const mergedRows = (res.rows || []).map(function(row){ return mergeSalaryIntoEmployee(row, salaryMap); });",
    "show every external teacher in employee management",
)

ext_start = employee.index("    async function loadExternalSupplement(e){")
ext_end = employee.index("\n    async function loadEmployeeSupplement(e){", ext_start)
ext_section = employee[ext_start:ext_end]
ext_section = replace_once(
    ext_section,
    "      const eid=empId(e),email=emailOf(e),mobile=clean(firstValue(e,['mobilePhone','phone','mobile']));",
    "      const eid=empId(e);",
    "external supplement exact id only",
)
ext_section, email_removed = re.subn(r"\n      if\(email\)\{[^\n]*\}", "", ext_section, count=1)
ext_section, mobile_removed = re.subn(r"\n      if\(mobile\)\{[^\n]*\}", "", ext_section, count=1)
if email_removed != 1 or mobile_removed != 1:
    raise RuntimeError(f"remove fuzzy external matches: email={email_removed}, mobile={mobile_removed}")
if "if(email)" in ext_section or "if(mobile)" in ext_section:
    raise RuntimeError("fuzzy external matching still remains")
employee = employee[:ext_start] + ext_section + employee[ext_end:]

old_supplement = """    async function loadEmployeeSupplement(e){
      const [registration,external]=await Promise.all([loadRegistrationSupplement(e),loadExternalSupplement(e)]);
      return {registration:registration||{},externalProfile:(external&&external.externalProfile)||{},externalContract:(external&&external.externalContract)||{}};
    }"""
new_supplement = """    async function loadEmployeeSupplement(e){
      if(identityType(e)==='external'){
        const external=await loadExternalSupplement(e);
        return {registration:{},externalProfile:(external&&external.externalProfile)||{},externalContract:(external&&external.externalContract)||{}};
      }
      const registration=await loadRegistrationSupplement(e);
      return {registration:registration||{},externalProfile:{},externalContract:{}};
    }"""
employee = replace_once(employee, old_supplement, new_supplement, "external employee skips legacy registration supplement")
employee = insert_before_regex(
    employee,
    r'  <script src="global-nav\.js\?v=[^"]+"></script>',
    '  <script src="external-teacher-admin-route-v1.js?v=20260806-external-teacher-canonical-v1"></script>\n',
    "employee external route script",
)
employee_path.write_text(employee, encoding="utf-8")


# 2. External announcement entry defaults to external audience.
announcement_path = Path("announcement-admin.html")
announcement = announcement_path.read_text(encoding="utf-8")
announcement = insert_before_regex(
    announcement,
    r'  <script src="global-nav\.js\?v=[^"]+"></script>',
    '  <script src="external-teacher-admin-route-v1.js?v=20260806-external-teacher-canonical-v1"></script>\n',
    "announcement external route script",
)
announcement_path.write_text(announcement, encoding="utf-8")


# 3. External-task entry uses only employee-master rows whose identity is external.
task_path = Path("task.html")
task = task_path.read_text(encoding="utf-8")
fn_start = task.index("    async function loadEmployees(selectId){")
fn_end_marker = "}catch(e){}}"
fn_end = task.index(fn_end_marker, fn_start) + len(fn_end_marker)
new_load_employees = """    async function loadEmployees(selectId){
      try{
        const externalOnly=new URLSearchParams(location.search||'').get('identity')==='external';
        const res=externalOnly
          ? await api('getEmployeeManagementData',{userId:uid(),statusMode:'all'})
          : await api('getEmployeeOptions',{userId:uid()});
        employees=res.employees||res.rows||[];
        if(externalOnly){
          employees=employees.filter(x=>{
            const sources=[x||{},x&&x.raw||{},x&&x.profile||{}];
            let raw='';
            for(const source of sources){
              raw=String(source&&(source.identityType||source.employeeType||source.identityLabel||source.roleLabel||source.role||source['身分類型'])||'').trim().toLowerCase();
              if(raw)break;
            }
            return raw.includes('external')||raw.includes('外聘');
          });
        }
        $(selectId).innerHTML='<option value="">'+(externalOnly?'請選擇外聘老師':'請選擇員工')+'</option>'+employees.map(x=>`<option value="${esc(x.id||x.employeeId||x.__id||'')}">${esc(x.name||x.employeeName||x.displayName||'')}</option>`).join('');
      }catch(e){}
    }"""
task = task[:fn_start] + new_load_employees + task[fn_end:]
task = insert_before_regex(
    task,
    r'  <script src="global-nav\.js\?v=[^"]+"></script>',
    '  <script src="external-teacher-admin-route-v1.js?v=20260806-external-teacher-canonical-v1"></script>\n',
    "task external route script",
)
task_path.write_text(task, encoding="utf-8")


# 4. Teacher-side utility order: daily work first, profile and contract last.
portal_path = Path("teacher-course-portal.html")
portal = portal_path.read_text(encoding="utf-8")
old_links = """        <a href="profile.html" id="teacherProfileLink"><span>人</span><b>我的資料</b><small id="teacherProfileLinkHint">基本資料與通知設定</small></a>
        <a href="contract.html"><span>約</span><b>合約</b><small>查看與簽署合約</small></a>
        <a href="announcements.html"><span>告</span><b>公告</b><small>最新公告與通知</small></a>
        <a href="task.html"><span>辦</span><b>協助事項</b><small>待處理與回報</small></a>
        <a href="teacher-goods.html"><span>貨</span><b>拿貨／詢價</b><small>商品與詢價</small></a>
        <a href="forms-hub.html"><span>表</span><b>表格</b><small>集點卡與證明申請</small></a>"""
new_links = """        <a href="announcements.html"><span>告</span><b>公告</b><small>最新公告與通知</small></a>
        <a href="task.html"><span>辦</span><b>協助事項</b><small>待處理與回報</small></a>
        <a href="teacher-goods.html"><span>貨</span><b>拿貨／詢價</b><small>商品搜尋與詢價</small></a>
        <a href="forms-hub.html"><span>表</span><b>表格</b><small>集點卡與證明申請</small></a>
        <a href="profile.html" id="teacherProfileLink"><span>人</span><b>我的資料</b><small id="teacherProfileLinkHint">基本資料與通知設定</small></a>
        <a href="contract.html"><span>約</span><b>合約</b><small>查看與簽署合約</small></a>"""
portal = replace_once(portal, old_links, new_links, "teacher utility menu order")
portal_path.write_text(portal, encoding="utf-8")


# 5. Teacher forms contain only points and teacher certificates.
forms_path = Path("forms-hub.html")
forms = forms_path.read_text(encoding="utf-8")
forms, removed = re.subn(
    r'\n\s*<a class="form-card" href="rental-order\.html">.*?</a>',
    "",
    forms,
    count=1,
    flags=re.S,
)
if removed != 1:
    raise RuntimeError(f"remove equipment-rental form: expected 1, found {removed}")
forms = forms.replace(
    "這裡放外聘、工讀生與專職老師可使用的表格。",
    "這裡放老師可使用的集點卡與證明申請。",
    1,
)
forms_path.write_text(forms, encoding="utf-8")


# 6. Internal-system description reflects the complete center.
settings_path = Path("settings.html")
settings = settings_path.read_text(encoding="utf-8")
settings = replace_once(
    settings,
    "<span>合約與拿貨紀錄</span>",
    "<span>名單、資料、合約、公告、協助事項、拿貨與表格</span>",
    "settings external center description",
)
settings_path.write_text(settings, encoding="utf-8")


# 7. Canonical teacher utility identity: exact link or a fresh employee-master row.
course_path = Path("functions/coursePortal.js")
course = course_path.read_text(encoding="utf-8")
resolve_start = course.index("async function resolveTeacherUtilityEmployee(session) {")
resolve_end = course.index("\nasync function teacherUtilitySession(data) {", resolve_start)
new_resolver = r"""async function resolveTeacherUtilityEmployee(session) {
  const teacherId = clean(session && session.teacherId);
  if (!teacherId) throw new HttpsError('failed-precondition', '老師登入資料缺少老師編號，請重新登入。');
  const bindings = await authorizedBindingsForSession(session);
  if (!bindings.length) throw new HttpsError('permission-denied', '老師登入綁定已停用，請重新登入。');

  const [teacherRows, employeeSnapshot] = await Promise.all([
    mirrorRows('teachers'),
    db.collection('employees').limit(2000).get()
  ]);
  const teacher = teacherRows.find((row) => sourceId(row) === teacherId) || {};
  const employees = employeeSnapshot.docs.map((doc) =>
    Object.assign({ __id: doc.id, __ref: doc.ref }, jsonValue(doc.data() || {}))
  );

  const explicitIds = new Set([teacherId]);
  bindings.forEach((row) => {
    const value = linkedEmployeeId(row);
    if (value) explicitIds.add(value);
  });
  const direct = employees.filter((row) => isExternalTeacherEmployee(row) && (
    explicitIds.has(clean(row.__id)) ||
    explicitIds.has(clean(row.employeeId || row.id || row.userId)) ||
    clean(row.coursePortalTeacherId || row.legacyTeacherId) === teacherId ||
    (Array.isArray(row.coursePortalTeacherIds) && row.coursePortalTeacherIds.map(clean).includes(teacherId))
  ));
  if (direct.length > 1) {
    throw new HttpsError('failed-precondition', '這個老師編號連到多個外聘老師主檔，請先由管理者整理重複資料。');
  }

  let employee = direct[0] || null;
  if (!employee) {
    const employeeId = `EXT_${hash(`course-teacher:${teacherId}`).slice(0, 16)}`;
    const employeeRef = db.collection('employees').doc(employeeId);
    const existingSnapshot = await employeeRef.get();
    const existing = existingSnapshot.exists ? jsonValue(existingSnapshot.data() || {}) : {};
    if (existingSnapshot.exists && !isExternalTeacherEmployee(existing)) {
      throw new HttpsError('failed-precondition', '外聘老師主檔編號發生衝突，請聯絡管理者。');
    }
    const identityRows = [teacher].concat(bindings);
    const name = clean(identityRows.map((row) => row && (
      row.name || row.teacherName || row.targetName || row.displayName
    )).find(clean)) || '外聘老師';
    const email = identityRows.map(employeeEmail).find(clean) || '';
    const phone = identityRows.map(employeePhone).find(clean) || '';
    const createdAt = existingSnapshot.exists
      ? (existing.createdAt || existing.createdAtText || null)
      : FieldValue.serverTimestamp();
    const fresh = {
      employeeId,
      id: employeeId,
      userId: employeeId,
      name,
      displayName: name,
      email,
      mobilePhone: phone,
      phone,
      identityType: 'external',
      identityLabel: '外聘老師',
      employeeType: 'external',
      role: 'externalTeacher',
      isExternalTeacher: true,
      accountStatus: 'active',
      employmentStatus: 'active',
      hiddenFromActiveLists: false,
      coursePortalTeacherId: teacherId,
      coursePortalTeacherIds: FieldValue.arrayUnion(teacherId),
      legacyTeacherId: teacherId,
      source: 'course-portal-canonical-external-teacher',
      createdAt,
      updatedAt: FieldValue.serverTimestamp()
    };
    await employeeRef.set(fresh, { merge: true });
    employee = Object.assign({}, existing, fresh, { __id: employeeId, __ref: employeeRef });
  }

  const employeeId = clean(employee.employeeId || employee.id || employee.__id);
  const employeeRef = employee.__ref || db.collection('employees').doc(employeeId);
  const canonicalPatch = {
    employeeId,
    id: clean(employee.id) || employeeId,
    userId: clean(employee.userId) || employeeId,
    identityType: 'external',
    identityLabel: '外聘老師',
    employeeType: 'external',
    role: 'externalTeacher',
    isExternalTeacher: true,
    coursePortalTeacherId: teacherId,
    coursePortalTeacherIds: FieldValue.arrayUnion(teacherId),
    updatedAt: FieldValue.serverTimestamp()
  };
  if (!clean(employee.legacyTeacherId)) canonicalPatch.legacyTeacherId = teacherId;
  await employeeRef.set(canonicalPatch, { merge: true });

  const bindingBatch = db.batch();
  bindings.forEach((row) => bindingBatch.set(row.__ref, {
    employeeId,
    externalTeacherEmployeeId: employeeId,
    legacyTeacherId: teacherId,
    employeeRef: `employees/${employeeId}`,
    linkedAt: row.linkedAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true }));
  await bindingBatch.commit();

  const merged = Object.assign({}, employee, canonicalPatch, {
    name: clean(employee.name || employee.displayName || teacher.name || teacher.teacherName) || '外聘老師',
    email: employeeEmail(employee),
    mobilePhone: employeePhone(employee)
  });
  const missingProfileFields = externalTeacherProfileMissingFields(merged);
  return {
    employeeId,
    user: {
      id: employeeId,
      employeeId,
      name: merged.name,
      displayName: merged.name,
      email: employeeEmail(merged),
      phone: employeePhone(merged),
      mobilePhone: employeePhone(merged),
      identityType: 'external',
      identityLabel: '外聘老師',
      employeeType: 'external',
      role: 'externalTeacher',
      isExternalTeacher: true,
      lineUserId: clean(session.lineUserId),
      lineNotifyEnabled: Boolean(clean(session.lineUserId)),
      accountStatus: clean(employee.accountStatus || 'active'),
      employmentStatus: clean(employee.employmentStatus || 'active'),
      legacyTeacherId: teacherId,
      portalSessionBridge: true
    },
    profileComplete: missingProfileFields.length === 0,
    missingProfileFields
  };
}
"""
course = course[:resolve_start] + new_resolver + course[resolve_end:]
course_path.write_text(course, encoding="utf-8")


# 8. Force old browser bridges to resolve the canonical employee again.
bridge_path = Path("teacher-more-auth-bridge.js")
bridge = bridge_path.read_text(encoding="utf-8")
bridge = replace_once(
    bridge,
    "const AUTH_CACHE_KEY = 'youzi.teacherMore.authorization.v2';",
    "const AUTH_CACHE_KEY = 'youzi.teacherMore.authorization.v3';",
    "teacher utility authorization cache version",
)
bridge_path.write_text(bridge, encoding="utf-8")

for page_name in [
    "profile.html",
    "contract.html",
    "announcements.html",
    "task.html",
    "teacher-goods.html",
    "forms-hub.html",
]:
    page_path = Path(page_name)
    page = page_path.read_text(encoding="utf-8")
    old = 'teacher-more-auth-bridge.js?v=20260801-teacher-session-v2'
    if old not in page:
        raise RuntimeError(f"{page_name}: old teacher bridge version not found")
    page = page.replace(old, 'teacher-more-auth-bridge.js?v=20260806-external-teacher-canonical-v1')
    page_path.write_text(page, encoding="utf-8")


# 9. Regression tests for the new single-source architecture.
test_path = Path("tests/external-teacher-center.test.js")
test_path.write_text(r"""'use strict';
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

const bridge = read('teacher-more-auth-bridge.js');
assert(bridge.includes('youzi.teacherMore.authorization.v3'));
const course = read('functions/coursePortal.js');
const resolverStart = course.indexOf('async function resolveTeacherUtilityEmployee(session)');
const resolverEnd = course.indexOf('async function teacherUtilitySession(data)', resolverStart);
const resolver = course.slice(resolverStart, resolverEnd);
assert(resolver.includes("source: 'course-portal-canonical-external-teacher'"));
assert(resolver.includes('coursePortalTeacherId: teacherId'));
assert(!resolver.includes('const scored ='));
assert(!resolver.includes('emails.has'));
assert(!resolver.includes('phones.has'));
console.log('external teacher center tests passed');
""", encoding="utf-8")

print("External teacher management redesign applied.")
