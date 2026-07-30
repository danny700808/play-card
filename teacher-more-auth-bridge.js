(function (global) {
  'use strict';

  const TEACHER_PORTAL_SESSION_KEY = 'youzi.coursePortal.teacher.session.v1';
  const LEGACY_USER_KEY = 'employeeUser';
  const ALLOWED_RETURN_PAGES = new Set([
    'profile.html',
    'contract.html',
    'announcements.html',
    'task.html',
    'teacher-goods.html',
    'forms-hub.html'
  ]);

  function readStorage(key) {
    try {
      return String(global.localStorage.getItem(key) || '').trim();
    } catch (_) {
      return '';
    }
  }

  function hasLegacyEmployeeUser() {
    const raw = readStorage(LEGACY_USER_KEY);
    if (!raw) return false;
    try {
      const user = JSON.parse(raw);
      return Boolean(user && (user.id || user.employeeId || user.email));
    } catch (_) {
      return false;
    }
  }

  function hasTeacherPortalSession() {
    return Boolean(readStorage(TEACHER_PORTAL_SESSION_KEY));
  }

  function currentPage() {
    const page = String(global.location && global.location.pathname || '')
      .split('/')
      .pop()
      .toLowerCase();
    return ALLOWED_RETURN_PAGES.has(page) ? page : '';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char];
    });
  }

  function blockIfPortalOnly(options) {
    options = options || {};
    if (hasLegacyEmployeeUser() || !hasTeacherPortalSession()) return false;

    const root = document.querySelector('[data-teacher-utility-root]');
    if (!root) return true;
    const page = currentPage();
    const title = String(options.title || '這項老師功能').trim();
    const loginHref = page
      ? `index.html?next=${encodeURIComponent(page)}&source=teacher-more`
      : 'index.html';

    document.body.classList.add('teacher-portal-session-only');
    root.innerHTML = [
      '<section class="teacher-more-auth-boundary" role="status" aria-live="polite">',
      '<div class="teacher-more-auth-boundary-mark" aria-hidden="true">師</div>',
      `<h1>${escapeHtml(title)}需要原員工帳號</h1>`,
      '<p>您目前使用的是老師課務的 LINE／Email 驗證工作階段；它只授權課表、學生、薪資與教室租用。</p>',
      '<p class="teacher-more-auth-boundary-note">為避免把 LINE-only 老師誤認成已取得員工資料權限，本頁不會自動建立、合併或偽造舊員工登入。</p>',
      '<div class="teacher-more-auth-boundary-actions">',
      '<a href="teacher-course-portal.html">返回老師課務</a>',
      `<a class="secondary" href="${loginHref}">使用既有 Email／密碼</a>`,
      '</div>',
      '</section>'
    ].join('');
    return true;
  }

  global.YZTeacherMoreAuth = Object.freeze({
    blockIfPortalOnly,
    hasLegacyEmployeeUser,
    hasTeacherPortalSession
  });
})(window);
