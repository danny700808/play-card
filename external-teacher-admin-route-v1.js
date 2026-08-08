(function (global) {
  'use strict';
  if (global.__YZ_EXTERNAL_TEACHER_ADMIN_ROUTE_V1__) return;
  global.__YZ_EXTERNAL_TEACHER_ADMIN_ROUTE_V1__ = true;

  const params = new URLSearchParams(global.location.search || '');
  const page = String(global.location.pathname || '').split('/').pop().toLowerCase();
  const fromCenter = params.get('source') === 'teacher-hub';
  const externalRoute = params.get('type') === 'external' || params.get('identity') === 'external' || params.get('audience') === 'external';

  function addReturnButton() {
    if (!fromCenter || document.querySelector('[data-external-teacher-center-return]')) return;
    const nav = document.querySelector('[data-yz-global-nav]');
    if (!nav) return;
    const link = document.createElement('a');
    link.href = 'teacher-hub.html';
    link.textContent = '回外聘老師管理中心';
    link.setAttribute('data-external-teacher-center-return', '');
    link.style.cssText = 'grid-column:1/-1;display:flex;align-items:center;justify-content:center;min-height:46px;border-radius:14px;background:#1f7a5a;color:#fff;text-decoration:none;font-weight:900;padding:9px 14px;';
    nav.appendChild(link);
  }

  function configureAnnouncement() {
    if (page !== 'announcement-admin.html' || params.get('audience') !== 'external') return;
    document.title = '外聘老師公告管理';
    const all = document.getElementById('audAll');
    const staff = document.getElementById('audStaff');
    const parttime = document.getElementById('audParttime');
    const external = document.getElementById('audExternal');
    if (!external) return;
    if (all) all.checked = false;
    if (staff) staff.checked = false;
    if (parttime) parttime.checked = false;
    external.checked = true;
    [all, staff, parttime, external].filter(Boolean).forEach(function (node) {
      node.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const title = document.querySelector('.title');
    if (title) title.textContent = '外聘老師公告管理';
    const desc = document.querySelector('.admin-card .section-desc');
    if (desc) desc.textContent = '此入口固定只發布給外聘老師；舊版公告不會自動混入。';
    const publishDesc = document.getElementById('announcementPublishDesc');
    if (publishDesc) publishDesc.textContent = '需要回覆時，老師端才會出現回覆框；不需要回覆時只顯示內容與附件。';
    const attachmentDesc = document.getElementById('announcementAttachmentDesc');
    if (attachmentDesc) attachmentDesc.textContent = '附件保存到新版外聘老師公告區，不會寫回舊版公告資料。';
    const category = document.getElementById('categoryInput');
    if (category) {
      [...category.options].forEach(function (option) {
        if (!['一般公告', '重要公告'].includes(option.value)) option.remove();
      });
      if (!['一般公告', '重要公告'].includes(category.value)) category.value = '一般公告';
    }
    const audienceBox = document.getElementById('audienceOptionBox');
    if (audienceBox) {
      audienceBox.hidden = true;
      if (audienceBox.parentElement) audienceBox.parentElement.style.gridTemplateColumns = 'minmax(0,1fr)';
    }
    external.disabled = true;
  }

  function configureTask() {
    if (page !== 'task.html' || params.get('identity') !== 'external') return;
    document.title = '外聘老師協助事項管理';
    const section = document.querySelector('#adminWrap .section-title');
    if (section) section.innerHTML = '<span class="num">1</span>外聘老師協助事項';
    const assignee = document.querySelector('label[for="assigneeId"]');
    if (assignee) assignee.textContent = '負責人';
    const assigneeSelect = document.getElementById('assigneeId');
    if (assigneeSelect && !assigneeSelect.querySelector('option[value="__ALL_EXTERNAL__"]')) {
      const allExternal = document.createElement('option');
      allExternal.value = '__ALL_EXTERNAL__';
      allExternal.textContent = '全體外聘老師（公告）';
      assigneeSelect.prepend(allExternal);
      assigneeSelect.value = '__ALL_EXTERNAL__';
    }
    const dueType = document.getElementById('dueType');
    const dueTime = document.getElementById('dueTime');
    const title = document.getElementById('taskTitle');
    if (dueType && !(title && String(title.value || '').trim())) dueType.value = 'none';
    if (dueTime && dueType && dueType.value === 'none') dueTime.value = '';
    ['needReport', 'allowComment', 'allowRedo', 'needDoneFile'].forEach(function (id) {
      const node = document.getElementById(id);
      if (node && !(title && String(title.value || '').trim())) node.checked = false;
    });
    if (typeof global.renderDueFields === 'function') global.renderDueFields();
  }

  function configureEmployeeAdmin(attempt) {
    if (page !== 'employee-admin.html' || !externalRoute) return;
    attempt = Number(attempt || 0);
    try {
      if (typeof openCategory === 'function' && typeof allEmployees !== 'undefined' && Array.isArray(allEmployees)) {
        openCategory('external');
        const requestedId = String(params.get('employeeId') || '').trim();
        if (requestedId && typeof selectEmployee === 'function') {
          const found = allEmployees.some(function (row) {
            const values = [row && row.employeeId, row && row.id, row && row.userId, row && row.__id, row && row.email]
              .map(function (value) { return String(value == null ? '' : value).trim(); });
            return values.includes(requestedId);
          });
          if (found) selectEmployee(requestedId);
        }
        return;
      }
    } catch (_) {}
    if (attempt < 80) global.setTimeout(function () { configureEmployeeAdmin(attempt + 1); }, 100);
  }

  function run() {
    addReturnButton();
    configureAnnouncement();
    configureTask();
    configureEmployeeAdmin(0);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
  else run();
  global.addEventListener('pageshow', run);
})(window);
