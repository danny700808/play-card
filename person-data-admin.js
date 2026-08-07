(function (global) {
  'use strict';
  const RETURN_TARGET = 'person-data-admin.html';
  const LOGIN_URL = `login.html?next=${encodeURIComponent(RETURN_TARGET)}`;
  const ADMIN_EMAILS = new Set(['danny700808@gmail.com']);
  let groups = [];
  let selected = null;
  let busy = false;
  const $ = (id) => document.getElementById(id);
  const clean = (value) => String(value == null ? '' : value).trim();
  const lower = (value) => clean(value).toLowerCase();
  const truthy = (value) => value === true || ['1', 'true', 'yes', '是', 'enabled', 'active'].includes(lower(value));
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function localUser() {
    try { return JSON.parse(global.localStorage.getItem('employeeUser') || 'null') || {}; } catch (_) { return {}; }
  }
  function localManagerAllowed(user) {
    const role = lower(user && user.role);
    return Boolean(user && (truthy(user.showSettingsZone) || truthy(user.isManagerAccount) || ['admin', 'manager', 'owner', '主管', '管理者'].includes(role)));
  }
  function claimsAllowed(claims, user) {
    const token = claims || {};
    const role = lower(token.role || token.userRole || token.permissionRole);
    return token.admin === true || token.manager === true || token.owner === true ||
      ['admin', 'manager', 'owner', '主管', '管理者'].includes(role) ||
      ADMIN_EMAILS.has(lower(token.email || user && user.email));
  }
  function clearShell() {
    ['employeeUser', 'employeeUserId', 'employeeSecureAuthVersion', 'employeePortalMode'].forEach((key) => {
      try { global.localStorage.removeItem(key); } catch (_) {}
    });
  }
  async function ensureManager() {
    const manager = localUser();
    if (!localManagerAllowed(manager) || !global.firebase || typeof global.firebase.auth !== 'function') {
      clearShell(); global.location.replace(LOGIN_URL); return false;
    }
    const config = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if (!global.firebase.apps.length && config) global.firebase.initializeApp(config);
    const auth = global.firebase.auth();
    const user = await new Promise((resolve) => {
      let done = false; let unsubscribe = null;
      const finish = (value) => { if (done) return; done = true; try { if (unsubscribe) unsubscribe(); } catch (_) {} resolve(value || null); };
      unsubscribe = auth.onAuthStateChanged(finish, () => finish(null));
      global.setTimeout(() => finish(auth.currentUser), 8000);
    });
    if (!user) { clearShell(); global.location.replace(LOGIN_URL); return false; }
    const result = await user.getIdTokenResult(true);
    if (!claimsAllowed(result && result.claims, user)) {
      clearShell(); try { await auth.signOut(); } catch (_) {} global.location.replace(LOGIN_URL); return false;
    }
    return true;
  }
  function functionsClient() {
    const config = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if (!global.firebase.apps.length) global.firebase.initializeApp(config);
    return global.firebase.app().functions('us-central1');
  }
  async function call(name, data) {
    const response = await functionsClient().httpsCallable(name)(data || {});
    return response && response.data || {};
  }
  function errorText(error) {
    return clean(error && (error.details || error.message) || error || '目前無法處理。').replace(/^FirebaseError:\s*/i, '');
  }
  function setStatus(text) { $('personStatus').textContent = text; }
  function setMessage(text, isError) {
    const node = $('personMessage'); node.textContent = text || ''; node.style.display = text ? 'block' : 'none'; node.classList.toggle('error', Boolean(isError));
  }
  function titleOf(group) { return clean(group.names && group.names[0]) || clean(group.employeeIds && group.employeeIds[0]) || clean(group.teacherIds && group.teacherIds[0]) || '未命名歷史資料'; }
  function sourceText(group) {
    return Object.entries(group.sourceCounts || {}).map(([name, count]) => `${name} ${count}`).join('、');
  }
  function renderSummary(summary) {
    const values = [summary.people, summary.review, summary.deletable, summary.formal, summary.sources];
    Array.from($('personSummary').children).forEach((node, index) => { node.querySelector('b').textContent = Number(values[index] || 0); });
  }
  function visibleGroups() {
    const keyword = lower($('personSearch').value);
    if (!keyword) return groups;
    return groups.filter((group) => lower([...(group.names || []), ...(group.emails || []), ...(group.employeeIds || []), ...(group.teacherIds || [])].join(' ')).includes(keyword));
  }
  function renderList() {
    const rows = visibleGroups();
    $('personList').innerHTML = rows.length ? rows.map((group) => `
      <article class="person">
        <div><h2>${esc(titleOf(group))}</h2><div class="meta">人員：${esc((group.employeeIds || []).join('、') || '尚未歸入人員主檔')}<br>老師：${esc((group.teacherIds || []).join('、') || '—')}${(group.emails || []).length ? `<br>Email：${esc(group.emails.join('、'))}` : ''}</div><div class="tags">${group.needsReview ? '<span class="tag warn">需確認歸屬</span>' : '<span class="tag">單一人員主檔</span>'}${group.formalCount ? `<span class="tag bad">正式歷史 ${group.formalCount}</span>` : ''}${group.safelyDeletable ? '<span class="tag warn">可刪測試資料</span>' : ''}<span class="tag">來源 ${group.sourceCount}</span></div><div class="sources">${esc(sourceText(group))}</div></div>
        <button class="btn soft" type="button" data-group="${esc(group.groupId)}">查看與處理</button>
      </article>`).join('') : '<div class="notice">目前沒有符合條件的人員資料。</div>';
    $('personList').querySelectorAll('[data-group]').forEach((button) => button.addEventListener('click', () => openDetail(button.dataset.group)));
  }
  function renderEmployeeOptions() {
    const rows = [];
    groups.forEach((group) => (group.canonicalEmployeeIds || group.employeeIds || []).forEach((id) => {
      if (group.masterCount) rows.push({ id, name: titleOf(group) });
    }));
    const seen = new Set();
    $('personEmployeeOptions').innerHTML = rows.filter((row) => row.id && !seen.has(row.id) && seen.add(row.id))
      .map((row) => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
  }
  async function load() {
    if (busy) return; busy = true; $('personReload').disabled = true; setStatus('正在安全掃描所有人員資料來源…');
    try {
      const result = await call('personDataAdminInventory', {});
      groups = Array.isArray(result.groups) ? result.groups : [];
      renderSummary(result.summary || {}); renderEmployeeOptions(); renderList(); setStatus(`已整理 ${groups.length} 組；系統沒有自動合併或刪除任何資料。`);
      const employeeId = clean(new URLSearchParams(global.location.search).get('employeeId'));
      if (employeeId) { const match = groups.find((group) => (group.employeeIds || []).includes(employeeId)); if (match) openDetail(match.groupId); }
    } catch (error) { setStatus(errorText(error)); }
    finally { busy = false; $('personReload').disabled = false; }
  }
  function detailBox(label, value) { return `<div class="detail-box"><span>${esc(label)}</span><b>${esc(value || '—')}</b></div>`; }
  function actionButton(label, action, style) { return `<button class="btn ${style || 'soft'}" type="button" data-action="${esc(action)}">${esc(label)}</button>`; }
  async function openDetail(groupId) {
    $('personMask').classList.remove('hidden'); setMessage('正在讀取完整資料…', false); $('personActions').innerHTML = ''; $('personSourceList').innerHTML = '';
    try {
      const result = await call('personDataAdminDetail', { groupId });
      selected = result; const group = result.group || {};
      $('personDetailTitle').textContent = titleOf(group); $('personDetailMeta').textContent = `資料群組 ${group.groupId || ''}`;
      $('personDetailGrid').innerHTML = [
        detailBox('人員編號', (group.employeeIds || []).join('、')),
        detailBox('老師編號', (group.teacherIds || []).join('、')),
        detailBox('Email', (group.emails || []).join('、')),
        detailBox('身分證字號', result.privateProfile && result.privateProfile.idNumber),
        detailBox('資料來源', String(group.sourceCount || 0)),
        detailBox('正式歷史', String(group.formalCount || 0))
      ].join('') + ((result.privateProfile && result.privateProfile.identityFiles || []).map((file, index) => `<div class="detail-box"><span>身分證明 ${index + 1}</span><b><a href="${esc(file.url)}" target="_blank" rel="noopener">${esc(file.name)}</a>（15 分鐘內有效）</b></div>`).join(''));
      $('personSourceList').innerHTML = (result.sources || []).map((source) => `<div class="source-row"><strong>${esc(source.label)}${source.formal ? '｜正式歷史' : ''}</strong><small>${esc(source.collection)}/${esc(source.docId)}${source.status ? `｜${esc(source.status)}` : ''}${source.employeeIds && source.employeeIds.length ? `｜人員 ${esc(source.employeeIds.join('、'))}` : ''}</small></div>`).join('');
      const hasProfile = (result.sources || []).some((source) => source.collection === 'externalTeacherProfiles');
      const hasOneMaster = group.masterCount === 1;
      let actions = '';
      if (hasProfile && hasOneMaster) actions += `<div class="action-row">${actionButton('確認資料並啟用老師', 'approve-profile', 'primary')}${actionButton('退回補件', 'return-profile', 'warn')}</div>`;
      if (group.needsReview) actions += `<div class="action-row"><input id="personTargetEmployee" list="personEmployeeOptions" placeholder="選擇或輸入人員編號"><button class="btn soft" type="button" data-action="link">歸到這個人員主檔</button></div>`;
      actions += `<div class="action-row">${actionButton('解除這個人的 LINE', 'unlink-line', 'soft')}${actionButton('封存並停止登入／班表', 'archive', 'warn')}${group.safelyDeletable ? actionButton('永久刪除測試資料', 'delete-test', 'danger') : ''}</div>`;
      $('personActions').innerHTML = actions;
      $('personActions').querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => runAction(button.dataset.action)));
      setMessage('', false);
    } catch (error) { setMessage(errorText(error), true); }
  }
  async function runAction(action) {
    if (!selected || busy) return;
    const group = selected.group || {}; const data = { groupId: group.groupId, action };
    if (action === 'return-profile') { const reason = global.prompt('請輸入需要補件的內容：', '請補齊或修正個人資料'); if (reason === null) return; data.reason = clean(reason); }
    if (action === 'archive') { const reason = global.prompt('請輸入封存原因：', '停止合作'); if (reason === null) return; data.reason = clean(reason); }
    if (action === 'link') { data.targetEmployeeId = clean($('personTargetEmployee') && $('personTargetEmployee').value); if (!data.targetEmployeeId) { setMessage('請先輸入目標人員編號。', true); return; } if (!global.confirm(`確定把這組歷史來源歸到「${data.targetEmployeeId}」？原始契約內容不會改寫。`)) return; }
    if (action === 'approve-profile' && !global.confirm('確定個人資料已核對完成，並啟用此外聘老師？')) return;
    if (action === 'unlink-line' && !global.confirm('確定解除這個人的 LINE 登入與通知？個人資料和正式歷史會保留。')) return;
    if (action === 'delete-test') { const confirmation = global.prompt('這會刪除所有沒有正式歷史的測試資料。請輸入：永久刪除測試資料'); if (confirmation === null) return; data.confirmation = clean(confirmation); }
    busy = true; setMessage('正在安全處理，請勿重複操作…', false);
    try { const result = await call('personDataAdminAction', data); setMessage(result.message || '已完成。', false); busy = false; await load(); $('personMask').classList.add('hidden'); }
    catch (error) { setMessage(errorText(error), true); }
    finally { busy = false; }
  }

  $('personSearch').addEventListener('input', renderList);
  $('personReload').addEventListener('click', load);
  $('personClose').addEventListener('click', () => $('personMask').classList.add('hidden'));
  $('personMask').addEventListener('click', (event) => { if (event.target === $('personMask')) $('personMask').classList.add('hidden'); });
  ensureManager().then((ok) => { if (ok) load(); }).catch(() => { clearShell(); global.location.replace(LOGIN_URL); });
})(window);
