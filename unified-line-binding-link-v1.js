(function (global) {
  'use strict';
  if (global.__YOUZI_UNIFIED_LINE_BINDING_LINK_V1__) return;
  global.__YOUZI_UNIFIED_LINE_BINDING_LINK_V1__ = true;

  function updateLinks(root) {
    (root || document).querySelectorAll('a[href*="course-portal-admin.html"][href*="section=bindings"]').forEach(function (link) {
      link.href = 'line-binding-admin.html';
      if (/入口綁定/.test(link.textContent || '')) link.textContent = 'LINE 綁定管理';
      link.title = '集中管理課務、員工、外聘老師與租賃的 LINE 綁定';
    });
  }

  updateLinks(document);
  const observer = new MutationObserver(function (records) {
    for (const record of records) {
      for (const node of record.addedNodes || []) {
        if (node && node.nodeType === 1) updateLinks(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  global.addEventListener('pageshow', function () { updateLinks(document); });
})(window);
