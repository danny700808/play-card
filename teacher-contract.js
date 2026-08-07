(function (global) {
  'use strict';
  const SESSION_KEY = 'youzi.coursePortal.teacher.session.v1';
  let result = null;
  let current = null;
  let canvas = null;
  let context = null;
  let drawing = false;
  let signed = false;
  let busy = false;

  const $ = (id) => document.getElementById(id);
  const clean = (value) => String(value == null ? '' : value).trim();
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  function token() { try { return clean(global.localStorage.getItem(SESSION_KEY)); } catch (_) { return ''; } }
  function todayTaipei() { return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
  function show(node, visible) { if (node) node.classList.toggle('hidden', !visible); }
  function message(text, error) { const node = $('contractMessage'); node.textContent = clean(text); node.classList.toggle('error', Boolean(error)); node.style.display = text ? 'block' : 'none'; }
  function errorText(error) { return clean(error && (error.details || error.message) || error || '目前無法處理。').replace(/^FirebaseError:\s*/i, ''); }
  function functionsClient() {
    const config = global.APP_CONFIG && global.APP_CONFIG.FIREBASE_CONFIG;
    if (!global.firebase || !config) throw new Error('系統尚未準備完成，請重新整理。');
    if (!global.firebase.apps.length) global.firebase.initializeApp(config);
    return global.firebase.app().functions('us-central1');
  }
  async function call(name, data) {
    const sessionToken = token();
    if (!sessionToken) throw new Error('老師登入已失效，請重新登入。');
    const response = await functionsClient().httpsCallable(name)(Object.assign({}, data || {}, { sessionToken }));
    return response && response.data || {};
  }
  function logout() { try { global.localStorage.removeItem(SESSION_KEY); } catch (_) {} global.location.replace('course-portal.html?method=line&role=teacher'); }
  function statusClass(row) { return row.status === 'active' ? 'active' : (['submitted_pending_admin', 'signed'].includes(row.status) ? 'review' : ''); }
  function statusText(row) {
    if (row.status === 'active') return '已生效';
    if (['submitted_pending_admin', 'signed'].includes(row.status)) return '等待主管確認';
    if (row.status === 'needs_revision') return row.revisionReason ? `退回：${row.revisionReason}` : '請重新簽署';
    return '待簽署';
  }
  function itemHtml(row) {
    return `<button class="contract-item" type="button" data-assignment="${esc(row.assignmentId)}"><strong>${esc(row.contractName || '外聘老師年度契約')}</strong><small>${esc(row.year || '')}${row.submittedAtText ? `｜${esc(row.submittedAtText)}` : ''}</small><span class="badge ${statusClass(row)}">${esc(statusText(row))}</span></button>`;
  }
  function renderList(id, rows, emptyText) {
    const node = $(id); node.innerHTML = rows.length ? rows.map(itemHtml).join('') : `<div class="empty">${esc(emptyText)}</div>`;
    node.querySelectorAll('[data-assignment]').forEach((button) => button.addEventListener('click', () => select(button.dataset.assignment)));
  }
  function allRows() { return result && Array.isArray(result.history) ? result.history : []; }
  function select(id) {
    current = allRows().find((row) => row.assignmentId === id) || null;
    document.querySelectorAll('[data-assignment]').forEach((node) => node.classList.toggle('active', current && node.dataset.assignment === current.assignmentId));
    show($('contractProfileSummary'), Boolean(current));
    const signable = current && ['', 'pending', 'waiting_contract', 'needs_revision', 'overdue_unsigned'].includes(current.status);
    show($('contractSignCard'), Boolean(signable));
    clearSign();
    renderSummary();
    renderPreview();
  }
  function personal() { return current && current.personalData || result && result.profileData || {}; }
  function renderSummary() {
    const data = personal();
    if (!current) { $('contractSummaryGrid').replaceChildren(); return; }
    const rows = [
      ['姓名', data.name], ['身分證', data.idNumberMasked || data.idNumber],
      ['戶籍地址', data.householdAddress], ['通訊地址', data.mailingAddress],
      ['授課項目', data.teachingItemsText]
    ];
    $('contractSummaryGrid').innerHTML = rows.map(([label, value], index) => `<div class="${index > 1 ? 'wide' : ''}"><span>${esc(label)}</span><b>${esc(value || '—')}</b></div>`).join('');
  }
  function fillTemplate(text, data, template) {
    const date = clean(current && current.signDate) || todayTaipei();
    const parsed = new Date(`${date}T12:00:00+08:00`);
    const map = {
      '甲方名稱': template.partyAName || '', '甲方代表人': template.partyAOwner || '', '甲方地址': template.partyAAddress || '',
      '合約開始日期': template.startDate || '', '合約結束日期': template.endDate || '', '老師姓名': data.name || '',
      '授課項目': data.teachingItemsText || '', '身分證字號': data.idNumber || data.idNumberMasked || '',
      '地址': data.contractAddress || data.householdAddress || data.mailingAddress || '',
      '簽署民國年': Number.isNaN(parsed.getTime()) ? '' : String(parsed.getFullYear() - 1911),
      '簽署月': Number.isNaN(parsed.getTime()) ? '' : String(parsed.getMonth() + 1),
      '簽署日': Number.isNaN(parsed.getTime()) ? '' : String(parsed.getDate())
    };
    let output = clean(text);
    Object.entries(map).forEach(([key, value]) => { output = output.replaceAll(`【${key}】`, clean(value)); });
    return output;
  }
  function articleHtml(text) {
    return clean(text).split(/\n{2,}/).filter(Boolean).map((block) => {
      const lines = block.split('\n'); const first = clean(lines[0]);
      const title = /^(?:第[一二三四五六七八九十百0-9]+條|[一二三四五六七八九十]+、|\d+[.、)]|（[一二三四五六七八九十0-9]+）)/.test(first);
      return `<div class="article">${title ? `<div class="article-title">${esc(first)}</div>${esc(lines.slice(1).join('\n')).replace(/\n/g, '<br>')}` : esc(block).replace(/\n/g, '<br>')}</div>`;
    }).join('');
  }
  function splitContractText(text) {
    const blocks = clean(text).split(/\n{2,}/).filter(Boolean);
    if (blocks.length < 2) return [clean(text), ''];
    const target = blocks.reduce((sum, block) => sum + block.length, 0) * .52;
    const first = []; const second = []; let size = 0;
    blocks.forEach((block) => { if (size < target) { first.push(block); size += block.length; } else second.push(block); });
    return [first.join('\n\n'), second.join('\n\n')];
  }
  function renderPreview() {
    if (!current) { $('contractPreview').innerHTML = '<div class="empty">請選擇合約。</div>'; return; }
    const data = personal(); const template = current.contractSnapshot || {};
    const text = fillTemplate(template.contractText || template.contractTemplateHtml || template.contractHtml, data, template);
    const signature = signed && canvas ? canvas.toDataURL('image/png') : clean(current.signatureDataUrl);
    const date = clean(current.signDate) || todayTaipei();
    const parsed = new Date(`${date}T12:00:00+08:00`);
    const dateText = Number.isNaN(parsed.getTime()) ? date : `中華民國 ${parsed.getFullYear() - 1911} 年 ${parsed.getMonth() + 1} 月 ${parsed.getDate()} 日`;
    const parts = splitContractText(text); const title = esc(template.contractName || current.contractName || '外聘老師年度契約');
    $('contractPreview').innerHTML = `<section class="preview-page"><h1 class="preview-title">${title}</h1><div class="preview-meta"><b>甲方：</b>${esc(template.partyAName || '')}<br><b>契約期間：</b>${esc(template.startDate || '')} ～ ${esc(template.endDate || '')}</div><div class="preview-body">${articleHtml(parts[0])}</div><div class="page-no">第 1 頁 / 共 2 頁</div></section><section class="preview-page"><h1 class="preview-title">${title}</h1><div class="preview-body">${articleHtml(parts[1])}</div><div class="sign-grid"><div class="sign-party"><b>甲方</b><br>${esc(template.partyAName || '')}<br>代表人：${esc(template.partyAOwner || '')}<br>地址：${esc(template.partyAAddress || '')}</div><div class="sign-party"><b>乙方（外聘老師）</b><br>姓名：${esc(data.name || '')}<br>身分證字號：${esc(data.idNumber || data.idNumberMasked || '')}<br>地址：${esc(data.contractAddress || data.householdAddress || '')}<div class="signature-view">${signature ? `<img src="${esc(signature)}" alt="老師簽名">` : '老師簽名位置'}</div></div></div><div class="preview-meta" style="text-align:center;margin-top:18px">${esc(dateText)}</div><div class="page-no">第 2 頁 / 共 2 頁</div></section>`;
  }
  function fitCanvas() {
    if (!canvas) return; const rect = canvas.getBoundingClientRect(); const ratio = global.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * ratio)); const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width === width && canvas.height === height && context) return;
    let snapshot = null;
    if (signed && canvas.width > 1 && canvas.height > 1) {
      snapshot = document.createElement('canvas'); snapshot.width = canvas.width; snapshot.height = canvas.height;
      snapshot.getContext('2d').drawImage(canvas, 0, 0);
    }
    canvas.width = width; canvas.height = height; context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0); context.lineWidth = 3; context.lineCap = 'round'; context.strokeStyle = '#15231d';
    if (snapshot) context.drawImage(snapshot, 0, 0, rect.width, rect.height);
  }
  function position(event) { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  function start(event) { drawing = true; signed = true; const point = position(event); context.beginPath(); context.moveTo(point.x, point.y); canvas.setPointerCapture(event.pointerId); }
  function move(event) { if (!drawing) return; event.preventDefault(); const point = position(event); context.lineTo(point.x, point.y); context.stroke(); }
  function end() { if (!drawing) return; drawing = false; renderPreview(); }
  function clearSign() { if (context && canvas) context.clearRect(0, 0, canvas.width, canvas.height); signed = false; if (current) renderPreview(); }
  async function submit() {
    if (busy || !current) return;
    if (!signed) { message('請先完成老師簽名。', true); return; }
    busy = true; $('contractSubmit').disabled = true; message('正在安全送出…', false);
    try {
      const response = await call('coursePortalTeacherSubmitContract', { assignmentId: current.assignmentId, signatureDataUrl: canvas.toDataURL('image/png') });
      message(response.message || '已送出主管確認。', false); await load(false);
    } catch (error) { message(errorText(error), true); }
    finally { busy = false; $('contractSubmit').disabled = false; }
  }
  function render(data) {
    result = data || {}; show($('contractLoading'), false);
    if (!result.profileComplete) { show($('contractProfileRequired'), true); show($('contractContent'), false); return; }
    show($('contractProfileRequired'), false); show($('contractContent'), true);
    renderList('contractPendingList', result.pendingAssignments || [], '目前沒有待簽署合約。');
    renderList('contractReviewList', result.waitingApprovalRecords || [], '目前沒有等待主管確認的合約。');
    renderList('contractActiveList', result.activeRecords || [], '目前沒有已生效合約。');
    const first = (result.pendingAssignments || [])[0] || (result.waitingApprovalRecords || [])[0] || (result.activeRecords || [])[0];
    if (first) select(first.assignmentId); else { current = null; show($('contractSignCard'), false); show($('contractProfileSummary'), false); renderPreview(); }
  }
  async function load(showLoading) {
    if (showLoading !== false) show($('contractLoading'), true);
    try { render(await call('coursePortalTeacherContractSession')); }
    catch (error) {
      show($('contractLoading'), false); message(errorText(error), true);
      if (/登入|權限.*停用|請先登入/.test(errorText(error))) global.setTimeout(logout, 900);
    }
  }

  $('contractBackBtn').addEventListener('click', () => { global.location.href = 'teacher-course-portal.html'; });
  $('contractLogoutBtn').addEventListener('click', logout);
  $('contractOpenProfile').addEventListener('click', () => { global.location.href = 'teacher-profile.html'; });
  $('contractClearSign').addEventListener('click', clearSign);
  $('contractRefreshPreview').addEventListener('click', renderPreview);
  $('contractSubmit').addEventListener('click', submit);
  $('contractPrint').addEventListener('click', () => global.print());
  canvas = $('contractSignCanvas'); fitCanvas(); global.addEventListener('resize', fitCanvas);
  canvas.addEventListener('pointerdown', start); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('pointerleave', end);
  load(true);
})(window);
