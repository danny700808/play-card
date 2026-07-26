<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#24735c">
  <title>課務入口與 LINE 綁定管理｜柚子樂器</title>
  <link rel="stylesheet" href="course-portal.css?v=20260726-v2">
</head>
<body>
  <main class="portal-shell">
    <header class="portal-head">
      <div class="head-title"><span class="brand-mark">管</span><div><h1>入口與 LINE 綁定管理</h1><p>老師、學生／家長與一般租用者</p></div></div>
      <a class="btn" href="course-scheduler.html">返回排課系統</a>
    </header>
    <section class="card">
      <div class="toolbar">
        <div class="field"><label>管理密碼</label><input id="adminPin" type="password" autocomplete="current-password"></div>
        <button class="btn primary" id="loadBtn" type="button">讀取綁定資料</button>
      </div>
      <div class="notice">解除綁定後，該 LINE 的入口工作階段會立即失效；不會刪除老師、學生、課程或學費資料。</div>
    </section>
    <section class="card" style="margin-top:16px">
      <nav class="tabs">
        <button class="btn active" type="button" data-filter="all">全部</button>
        <button class="btn" type="button" data-filter="teacher">老師</button>
        <button class="btn" type="button" data-filter="student">學生／家長</button>
        <button class="btn" type="button" data-filter="renter">一般租用</button>
      </nav>
      <div class="list" id="bindingList"><p class="muted">請先輸入管理密碼。</p></div>
    </section>
  </main>
  <script src="config.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.12.5/firebase-functions-compat.js"></script>
  <script src="course-portal-common.js?v=20260726-v2"></script>
  <script>
  (function () {
    const P = window.CoursePortal;
    let rows = [];
    let filter = 'all';

    function label(row) {
      if (row.type === 'teacher') return `老師 ${row.targetName || row.teacherId || ''}`;
      if (row.type === 'student') return `學生 ${row.targetName || row.studentId || ''}`;
      return `租用者 ${row.targetName || row.renterId || ''}`;
    }

    function render() {
      const visible = rows.filter((row) => filter === 'all' || row.type === filter);
      document.getElementById('bindingList').innerHTML = visible.length ? visible.map((row) => `
        <article class="list-row">
          <strong>${P.escapeHtml(label(row))}</strong>
          <span>${P.escapeHtml(row.lineDisplayName || 'LINE 名稱未取得')}</span>
          <span>${P.escapeHtml(row.relationship || row.type)}</span>
          <span class="badge ${row.status === 'active' ? '' : 'danger'}">${row.status === 'active' ? '已綁定' : '已解除'}</span>
          <button class="btn ${row.status === 'active' ? 'danger' : 'soft'}" type="button" data-id="${P.escapeHtml(row.id)}" data-type="${P.escapeHtml(row.type)}" data-action="${row.status === 'active' ? 'revoke' : 'restore'}">${row.status === 'active' ? '解除綁定' : '恢復'}</button>
        </article>`).join('') : '<p class="muted">目前沒有綁定資料。</p>';
    }

    async function load() {
      const button = document.getElementById('loadBtn');
      P.loading(button, true, '讀取中…');
      try {
        const result = await P.call('coursePortalAdminData', { adminPin: document.getElementById('adminPin').value });
        rows = result.bindings || [];
        render();
      } catch (error) { P.toast(error.message, 'error'); }
      finally { P.loading(button, false); }
    }

    document.getElementById('loadBtn').addEventListener('click', load);
    document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
      filter = button.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((node) => node.classList.toggle('active', node === button));
      render();
    }));
    document.getElementById('bindingList').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-id]');
      if (!button) return;
      if (button.dataset.action === 'revoke' && !confirm('確定解除這個 LINE 綁定？課程資料不會被刪除。')) return;
      P.loading(button, true, '處理中…');
      try {
        await P.call('coursePortalAdminBindingAction', {
          adminPin: document.getElementById('adminPin').value,
          id: button.dataset.id,
          type: button.dataset.type,
          action: button.dataset.action
        });
        P.toast('綁定狀態已更新。');
        await load();
      } catch (error) { P.toast(error.message, 'error'); }
      finally { P.loading(button, false); }
    });
  })();
  </script>
</body>
</html>
