from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


course_path = Path("functions/coursePortal.js")
course = course_path.read_text(encoding="utf-8")
start = course.index("async function resolveTeacherUtilityEmployee(session) {")
end = course.index("\nasync function teacherUtilitySession(data) {", start)
new_function = r"""async function resolveTeacherUtilityEmployee(session) {
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
  const canonicalEmployeeId = `EXT_${hash(`course-teacher:${teacherId}`).slice(0, 16)}`;
  const canonicalRef = db.collection('employees').doc(canonicalEmployeeId);
  const canonicalSnapshot = await canonicalRef.get();
  const canonicalExisting = canonicalSnapshot.exists ? jsonValue(canonicalSnapshot.data() || {}) : {};
  if (canonicalSnapshot.exists && !isExternalTeacherEmployee(canonicalExisting)) {
    throw new HttpsError('failed-precondition', '外聘老師主檔編號發生衝突，請聯絡管理者。');
  }

  const identityRows = [teacher].concat(bindings);
  const verifiedName = clean(identityRows.map((row) => row && (
    row.name || row.teacherName || row.targetName || row.displayName
  )).find(clean));
  const verifiedEmail = identityRows.map(employeeEmail).find(clean) || '';
  const verifiedPhone = identityRows.map(employeePhone).find(clean) || '';
  const canonicalSeed = {
    employeeId: canonicalEmployeeId,
    id: canonicalEmployeeId,
    userId: canonicalEmployeeId,
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
    coursePortalTeacherCanonical: true,
    canonicalTeacherKey: `course-teacher:${teacherId}`,
    source: 'course-portal-canonical-external-teacher',
    updatedAt: FieldValue.serverTimestamp()
  };
  if (verifiedName) {
    canonicalSeed.name = verifiedName;
    canonicalSeed.displayName = verifiedName;
  } else if (!clean(canonicalExisting.name || canonicalExisting.displayName)) {
    canonicalSeed.name = '外聘老師';
    canonicalSeed.displayName = '外聘老師';
  }
  if (verifiedEmail) canonicalSeed.email = verifiedEmail;
  if (verifiedPhone) {
    canonicalSeed.mobilePhone = verifiedPhone;
    canonicalSeed.phone = verifiedPhone;
  }
  if (!canonicalSnapshot.exists) canonicalSeed.createdAt = FieldValue.serverTimestamp();
  await canonicalRef.set(canonicalSeed, { merge: true });

  const oldLinkedIds = new Set();
  bindings.forEach((row) => {
    const value = linkedEmployeeId(row);
    if (value && value !== canonicalEmployeeId) oldLinkedIds.add(value);
  });
  const replacedRows = employees.filter((row) => {
    const employeeId = clean(row.employeeId || row.id || row.userId || row.__id);
    if (!employeeId || employeeId === canonicalEmployeeId || !isExternalTeacherEmployee(row)) return false;
    return oldLinkedIds.has(employeeId) ||
      clean(row.coursePortalTeacherId || row.legacyTeacherId) === teacherId ||
      (Array.isArray(row.coursePortalTeacherIds) && row.coursePortalTeacherIds.map(clean).includes(teacherId));
  });

  const batch = db.batch();
  bindings.forEach((row) => batch.set(row.__ref, {
    employeeId: canonicalEmployeeId,
    externalTeacherEmployeeId: canonicalEmployeeId,
    legacyTeacherId: teacherId,
    employeeRef: `employees/${canonicalEmployeeId}`,
    coursePortalTeacherCanonical: true,
    linkedAt: row.linkedAt || FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true }));
  replacedRows.forEach((row) => batch.set(row.__ref, {
    accountStatus: 'archived',
    employmentStatus: 'archived',
    hiddenFromActiveLists: true,
    coursePortalTeacherCanonicalReplaced: true,
    canonicalReplacementEmployeeId: canonicalEmployeeId,
    canonicalReplacementTeacherId: teacherId,
    canonicalReplacementAt: FieldValue.serverTimestamp(),
    statusNote: '舊課務老師自動配對資料已由新的固定外聘老師主檔取代。',
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true }));
  await batch.commit();

  const canonicalReload = await canonicalRef.get();
  const employee = Object.assign(
    { __id: canonicalEmployeeId, __ref: canonicalRef },
    canonicalReload.exists ? jsonValue(canonicalReload.data() || {}) : {},
    { employeeId: canonicalEmployeeId }
  );
  const merged = Object.assign({}, employee, {
    name: clean(employee.name || employee.displayName || verifiedName) || '外聘老師',
    email: employeeEmail(employee),
    mobilePhone: employeePhone(employee)
  });
  const missingProfileFields = externalTeacherProfileMissingFields(merged);
  return {
    employeeId: canonicalEmployeeId,
    user: {
      id: canonicalEmployeeId,
      employeeId: canonicalEmployeeId,
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
      accountStatus: 'active',
      employmentStatus: 'active',
      legacyTeacherId: teacherId,
      portalSessionBridge: true,
      coursePortalTeacherCanonical: true
    },
    profileComplete: missingProfileFields.length === 0,
    missingProfileFields
  };
}
"""
course = course[:start] + new_function + course[end:]
course_path.write_text(course, encoding="utf-8")

bridge_path = Path("teacher-more-auth-bridge.js")
bridge = bridge_path.read_text(encoding="utf-8")
bridge = replace_once(
    bridge,
    "const AUTH_CACHE_KEY = 'youzi.teacherMore.authorization.v3';",
    "const AUTH_CACHE_KEY = 'youzi.teacherMore.authorization.v4';",
    "force canonical teacher identity refresh",
)
bridge_path.write_text(bridge, encoding="utf-8")

for name in ["profile.html", "contract.html", "announcements.html", "task.html", "teacher-goods.html", "forms-hub.html"]:
    path = Path(name)
    text = path.read_text(encoding="utf-8")
    text = replace_once(
        text,
        "teacher-more-auth-bridge.js?v=20260806-external-teacher-canonical-v1",
        "teacher-more-auth-bridge.js?v=20260806-external-teacher-canonical-v2",
        f"{name} teacher identity cache bust",
    )
    path.write_text(text, encoding="utf-8")

hub_path = Path("teacher-hub.html")
hub = hub_path.read_text(encoding="utf-8")
hub = replace_once(
    hub,
    "      function dedupe(list){const map=new Map();list.forEach(row=>{const key=idOf(row)||lower(emailOf(row));if(key&&!map.has(key))map.set(key,row)});return Array.from(map.values())}",
    "      function replaced(row){return String(first(row,['coursePortalTeacherCanonicalReplaced','canonicalReplaced'])||'').trim().toLowerCase()==='true'||first(row,['coursePortalTeacherCanonicalReplaced','canonicalReplaced'])===true} function dedupe(list){const map=new Map();list.forEach(row=>{const key=idOf(row)||lower(emailOf(row));if(key&&!map.has(key))map.set(key,row)});return Array.from(map.values())}",
    "hub excludes replaced legacy external rows",
)
hub = replace_once(
    hub,
    "rows=dedupe((res.rows||[]).filter(row=>identityType(row)==='external'));",
    "rows=dedupe((res.rows||[]).filter(row=>identityType(row)==='external'&&!replaced(row)));",
    "hub canonical external rows only",
)
hub_path.write_text(hub, encoding="utf-8")

employee_path = Path("employee-admin.html")
employee = employee_path.read_text(encoding="utf-8")
employee = replace_once(
    employee,
    "const mergedRows = (res.rows || []).map(function(row){ return mergeSalaryIntoEmployee(row, salaryMap); });",
    "const mergedRows = (res.rows || []).map(function(row){ return mergeSalaryIntoEmployee(row, salaryMap); }).filter(function(row){ return lower(firstValue(row,['coursePortalTeacherCanonicalReplaced','canonicalReplaced']))!=='true'; });",
    "employee admin hides canonical-replaced legacy rows",
)
employee_path.write_text(employee, encoding="utf-8")

test_path = Path("tests/external-teacher-center.test.js")
test = test_path.read_text(encoding="utf-8")
test = test.replace("assert(bridge.includes('youzi.teacherMore.authorization.v3'));", "assert(bridge.includes('youzi.teacherMore.authorization.v4'));", 1)
test = test.replace("assert(resolver.includes('coursePortalTeacherId: teacherId'));", "assert(resolver.includes('canonicalEmployeeId'));\nassert(resolver.includes('coursePortalTeacherCanonicalReplaced'));\nassert(resolver.includes('canonicalReplacementEmployeeId'));", 1)
test += "\nassert(read('teacher-hub.html').includes('!replaced(row)'));\nassert(read('employee-admin.html').includes('coursePortalTeacherCanonicalReplaced'));\n"
test_path.write_text(test, encoding="utf-8")

print("Canonical external teacher replacement fix applied.")
