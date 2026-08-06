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
    if (desc) desc.textContent = '此入口預設只發布給外聘老師；需要改成其他對象時仍可自行調整。';
  }

  function configureTask() {
    if (page !== 'task.html' || params.get('identity') !== 'external') return;
    document.title = '外聘老師協助事項管理';
    const section = document.querySelector('#adminWrap .section-title');
    if (section) section.innerHTML = '<span class="num">1</span>外聘老師協助事項';
    const assignee = document.querySelector('label[for="assigneeId"]');
    if (assignee) assignee.textContent = '外聘老師';
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
