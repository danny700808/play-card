(function (global) {
  'use strict';

  if (global.__YZ_RENTAL_PAPER_SIGN_V1__) return;
  global.__YZ_RENTAL_PAPER_SIGN_V1__ = true;

  const R = global.YZRental;
  if (!R) return;

  const PAPER_WAITING = '待紙本簽署';
  const PAPER_UPLOADED = '紙本已上傳待確認';
  const PAPER_CONFIRMED = '待付款確認';
  const drafts = new Map();
  let enhanceFrame = 0;

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function nowText() { return typeof R.nowText === 'function' ? R.nowText() : new Date().toISOString(); }
  function safeId(value) { return clean(value).replace(/[^a-zA-Z0-9_-]/g, '_') || 'rental-contract'; }
  function currentContractId() { return clean(R.val('contractId')); }
  function currentStatus() { return clean(R.val('status')); }
  function currentSourceKind() { return clean(R.val('sourceKind')); }

  function operatorLabel() {
    try {
      const user = JSON.parse(global.localStorage.getItem('employeeUser') || 'null') || {};
      return clean(user.name || user.displayName || user.email || user.id || user.employeeId) || '管理者';
    } catch (_) {
      return '管理者';
    }
  }

  function isPaperContract(row) {
    row = row || {};
    return clean(row.signingMethod || row.signatureMethod) === 'paper' ||
      !!(row.paperSignedPdfUrl || row.paperSignedConfirmedAt || (Array.isArray(row.paperSignedDocuments) && row.paperSignedDocuments.length));
  }

  function paperConfirmed(row) {
    row = row || {};
    return isPaperContract(row) && !!(row.paperSignedConfirmedAt && (row.paperSignedPdfUrl || (Array.isArray(row.paperSignedPageUrls) && row.paperSignedPageUrls.length)));
  }

  async function readContract(id) {
    if (!id) return null;
    return await R.get('rentalContracts', id);
  }

  async function saveCurrentContract() {
    if (typeof global.saveContract !== 'function') throw new Error('租賃儲存功能尚未載入。');
    const result = await global.saveContract(false, { silent: true });
    if (!result) throw new Error('合約尚未成功儲存。');
    const id = currentContractId() || clean(result.contractId);
    if (!id) throw new Error('找不到合約編號，請先儲存資料。');
    return { id, result };
  }

  async function updateContract(id, data) {
    await R.db().collection('rentalContracts').doc(id).set(Object.assign({ updatedAtText: nowText() }, data || {}), { merge: true });
  }

  function setStatusField(value) {
    const input = document.getElementById('status');
    if (input) input.value = value;
  }

  function setProgress(panel, percent, text) {
    if (!panel) return;
    const wrap = panel.querySelector('[data-paper-progress]');
    const fill = panel.querySelector('[data-paper-progress-fill]');
    const label = panel.querySelector('[data-paper-progress-text]');
    if (wrap) wrap.classList.add('show');
    if (fill) fill.style.width = Math.max(0, Math.min(100, Number(percent) || 0)) + '%';
    if (label) label.textContent = text || '';
  }

  function clearProgress(panel) {
    const wrap = panel && panel.querySelector('[data-paper-progress]');
    if (wrap) wrap.classList.remove('show');
  }

  function documentState(id) {
    if (!drafts.has(id || '__new__')) {
      drafts.set(id || '__new__', {
        page1: null,
        page2: null,
        rotation1: 0,
        rotation2: 0,
        pdf: null,
        urls: []
      });
    }
    return drafts.get(id || '__new__');
  }

  function revokePreview(page) {
    if (page && page.previewUrl) {
      try { URL.revokeObjectURL(page.previewUrl); } catch (_) {}
      page.previewUrl = '';
    }
  }

  function imageFileAccepted(file) {
    return !!(file && /^image\//i.test(file.type || '') && file.size > 0 && file.size <= 20 * 1024 * 1024);
  }

  function pdfFileAccepted(file) {
    return !!(file && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) && file.size > 0 && file.size <= 35 * 1024 * 1024);
  }

  function renderPagePreview(panel, pageNo, entry, rotation) {
    const preview = panel.querySelector('[data-paper-preview="' + pageNo + '"]');
    const name = panel.querySelector('[data-paper-file-name="' + pageNo + '"]');
    if (!preview) return;
    preview.replaceChildren();
    if (!entry || !entry.file) {
      preview.textContent = '尚未選擇第 ' + pageNo + ' 頁';
      if (name) name.textContent = '';
      return;
    }
    if (!entry.previewUrl) entry.previewUrl = URL.createObjectURL(entry.file);
    const img = document.createElement('img');
    img.src = entry.previewUrl;
    img.alt = '紙本合約第 ' + pageNo + ' 頁預覽';
    img.style.transform = 'rotate(' + rotation + 'deg)';
    preview.append(img);
    if (name) name.textContent = entry.file.name || ('第 ' + pageNo + ' 頁');
  }

  function renderDraft(panel, id) {
    const state = documentState(id);
    renderPagePreview(panel, 1, state.page1, state.rotation1);
    renderPagePreview(panel, 2, state.page2, state.rotation2);
    const pdfName = panel.querySelector('[data-paper-pdf-name]');
    if (pdfName) pdfName.textContent = state.pdf && state.pdf.name ? state.pdf.name : '';
  }

  function fileToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('檔案讀取失敗。')); };
      reader.readAsDataURL(blob);
    });
  }

  async function loadImage(file) {
    if (global.createImageBitmap) {
      try { return await global.createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) {}
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise(function (resolve, reject) {
        const img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('照片無法讀取。')); };
        img.src = url;
      });
    } finally {
      global.setTimeout(function () { try { URL.revokeObjectURL(url); } catch (_) {} }, 0);
    }
  }

  async function normalizeImage(file, rotation) {
    const source = await loadImage(file);
    const originalWidth = Number(source.width || source.naturalWidth || 0);
    const originalHeight = Number(source.height || source.naturalHeight || 0);
    if (!originalWidth || !originalHeight) throw new Error('照片尺寸不正確。');

    const angle = ((Number(rotation) || 0) % 360 + 360) % 360;
    const rotated = angle === 90 || angle === 270;
    const targetOriginalWidth = rotated ? originalHeight : originalWidth;
    const targetOriginalHeight = rotated ? originalWidth : originalHeight;
    const maxSide = 2600;
    const scale = Math.min(1, maxSide / Math.max(targetOriginalWidth, targetOriginalHeight));
    const width = Math.max(1, Math.round(targetOriginalWidth * scale));
    const height = Math.max(1, Math.round(targetOriginalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(angle * Math.PI / 180);
    const drawWidth = originalWidth * scale;
    const drawHeight = originalHeight * scale;
    ctx.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();
    if (source && typeof source.close === 'function') source.close();

    return await new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('照片整理失敗。'));
      }, 'image/jpeg', 0.92);
    });
  }

  async function imageDimensions(dataUrl) {
    return await new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () { resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height }); };
      img.onerror = function () { reject(new Error('PDF 圖片尺寸讀取失敗。')); };
      img.src = dataUrl;
    });
  }

  async function imagesToPdf(blobs, fileName) {
    const dataUrls = [];
    for (const blob of blobs) dataUrls.push(await fileToDataUrl(blob));
    const Ctor = global.jspdf && global.jspdf.jsPDF ? global.jspdf.jsPDF : global.jsPDF;
    if (Ctor) {
      const pdf = new Ctor({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      for (let i = 0; i < dataUrls.length; i += 1) {
        if (i > 0) pdf.addPage('a4', 'portrait');
        const dims = await imageDimensions(dataUrls[i]);
        const maxWidth = 200;
        const maxHeight = 287;
        const ratio = Math.min(maxWidth / dims.width, maxHeight / dims.height);
        const width = dims.width * ratio;
        const height = dims.height * ratio;
        const x = (210 - width) / 2;
        const y = (297 - height) / 2;
        pdf.addImage(dataUrls[i], 'JPEG', x, y, width, height, undefined, 'FAST');
      }
      return pdf.output('blob');
    }

    if (!global.html2pdf) throw new Error('PDF 產生工具尚未載入。');
    const wrap = document.createElement('div');
    wrap.style.position = 'fixed';
    wrap.style.left = '-99999px';
    wrap.style.top = '0';
    wrap.style.width = '210mm';
    dataUrls.forEach(function (url, index) {
      const page = document.createElement('section');
      page.style.width = '210mm';
      page.style.height = '297mm';
      page.style.display = 'flex';
      page.style.alignItems = 'center';
      page.style.justifyContent = 'center';
      page.style.background = '#fff';
      page.style.pageBreakAfter = index === dataUrls.length - 1 ? 'auto' : 'always';
      const img = document.createElement('img');
      img.src = url;
      img.style.maxWidth = '200mm';
      img.style.maxHeight = '287mm';
      img.style.objectFit = 'contain';
      page.append(img);
      wrap.append(page);
    });
    document.body.append(wrap);
    try {
      return await global.html2pdf().set({
        margin: 0,
        filename: fileName || 'paper-signed-contract.pdf',
        image: { type: 'jpeg', quality: 0.96 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
      }).from(wrap).outputPdf('blob');
    } finally {
      wrap.remove();
    }
  }

  function extensionFor(file, fallback) {
    const name = clean(file && file.name);
    const match = name.match(/\.([a-zA-Z0-9]{1,8})$/);
    return match ? match[1].toLowerCase() : fallback;
  }

  async function uploadBlob(path, blob, contentType, onProgress) {
    if (!global.firebase || !global.firebase.storage) throw new Error('Firebase Storage 尚未載入。');
    const storage = global.firebase.storage();
    if (typeof storage.setMaxUploadRetryTime === 'function') storage.setMaxUploadRetryTime(90000);
    const task = storage.ref().child(path).put(blob, { contentType: contentType || blob.type || 'application/octet-stream' });
    await new Promise(function (resolve, reject) {
      task.on('state_changed', function (snap) {
        if (typeof onProgress === 'function' && snap.totalBytes) onProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100));
      }, reject, resolve);
    });
    return await task.snapshot.ref.getDownloadURL();
  }

  async function downloadDraftPdf(panel) {
    const saved = await saveCurrentContract();
    const contract = typeof global.collect === 'function' ? global.collect() : await readContract(saved.id);
    if (!contract) throw new Error('找不到合約資料。');
    let blob = null;
    if (typeof global.generatePdfBlob === 'function') blob = await global.generatePdfBlob(contract);
    else {
      const wrap = document.createElement('div');
      wrap.style.position = 'fixed';
      wrap.style.left = '-99999px';
      wrap.style.width = '210mm';
      wrap.innerHTML = R.renderContractHtml(contract);
      document.body.append(wrap);
      try {
        blob = await global.html2pdf().set({ margin: 0, filename: (contract.contractNo || saved.id) + '.pdf', html2canvas: { scale: 2, useCORS: true, backgroundColor: '#fff' }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css', 'legacy'] } }).from(wrap).outputPdf('blob');
      } finally { wrap.remove(); }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = (contract.contractNo || saved.id || 'rental-contract') + '-paper-sign.pdf';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    setProgress(panel, 100, '列印版 PDF 已下載。');
  }

  async function setSigningMethod(method, panel) {
    const saved = await saveCurrentContract();
    const row = await readContract(saved.id) || {};
    const current = clean(row.status);
    let status = current;
    if (method === 'paper') {
      if (!['租賃中', '已退租', '退租申請中', '退租待安排', '待收回'].includes(current)) status = row.paperSignedConfirmedAt ? PAPER_CONFIRMED : (row.paperSignedPdfUrl ? PAPER_UPLOADED : PAPER_WAITING);
      await updateContract(saved.id, {
        signingMethod: 'paper',
        signatureMethod: 'paper',
        paperSigningStatus: row.paperSignedConfirmedAt ? 'confirmed' : (row.paperSignedPdfUrl ? 'uploaded' : 'awaiting_signature'),
        paperContractPreparedAt: row.paperContractPreparedAt || nowText(),
        paperContractPreparedBy: row.paperContractPreparedBy || operatorLabel(),
        status: status
      });
    } else {
      if ([PAPER_WAITING, PAPER_UPLOADED].includes(current)) status = '草稿';
      await updateContract(saved.id, {
        signingMethod: 'online',
        signatureMethod: 'online',
        status: status
      });
    }
    setStatusField(status);
    await refreshPanel(panel, saved.id);
  }

  async function uploadPaperDocument(panel) {
    const saved = await saveCurrentContract();
    const id = saved.id;
    const state = documentState(id);
    const directPdf = state.pdf;
    if (!directPdf && (!state.page1 || !state.page2)) throw new Error('請拍攝／選擇第 1 頁與第 2 頁，或直接上傳完整 PDF。');
    if (directPdf && !pdfFileAccepted(directPdf)) throw new Error('PDF 檔案過大或格式不正確。');

    const stamp = Date.now();
    const base = 'rental-contracts/' + safeId(id) + '/paper-signed/' + stamp;
    const rawUrls = [];
    const pageUrls = [];
    let pdfBlob = null;
    let pdfName = '';

    setProgress(panel, 5, '正在準備紙本合約檔案...');

    if (directPdf) {
      pdfBlob = directPdf;
      pdfName = directPdf.name || 'signed-contract.pdf';
    } else {
      const normalized = [];
      const entries = [[state.page1, state.rotation1, 1], [state.page2, state.rotation2, 2]];
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index][0];
        const rotation = entries[index][1];
        const pageNo = entries[index][2];
        if (!entry || !imageFileAccepted(entry.file)) throw new Error('第 ' + pageNo + ' 頁照片格式不正確或超過 20MB。');
        setProgress(panel, 10 + index * 15, '正在整理第 ' + pageNo + ' 頁照片...');
        const normalizedBlob = await normalizeImage(entry.file, rotation);
        normalized.push(normalizedBlob);

        const rawExt = extensionFor(entry.file, 'jpg');
        const rawUrl = await uploadBlob(base + '/original-page-' + pageNo + '.' + rawExt, entry.file, entry.file.type, function (pct) {
          setProgress(panel, 18 + index * 18 + Math.round(pct * 0.08), '正在保存第 ' + pageNo + ' 頁原始照片...');
        });
        rawUrls.push(rawUrl);

        const pageUrl = await uploadBlob(base + '/page-' + pageNo + '.jpg', normalizedBlob, 'image/jpeg', function (pct) {
          setProgress(panel, 27 + index * 18 + Math.round(pct * 0.08), '正在保存第 ' + pageNo + ' 頁整理版...');
        });
        pageUrls.push(pageUrl);
      }
      setProgress(panel, 67, '正在合併兩頁 A4 PDF...');
      pdfBlob = await imagesToPdf(normalized, id + '-signed.pdf');
      pdfName = id + '-signed.pdf';
    }

    setProgress(panel, 76, '正在上傳已簽紙本 PDF...');
    const pdfUrl = await uploadBlob(base + '/signed-contract.pdf', pdfBlob, 'application/pdf', function (pct) {
      setProgress(panel, 76 + Math.round(pct * 0.18), '正在上傳已簽紙本 PDF... ' + pct + '%');
    });

    const old = await readContract(id) || {};
    const history = Array.isArray(old.paperSignedDocuments) ? old.paperSignedDocuments.slice(-19) : [];
    const record = {
      versionId: String(stamp),
      pdfUrl: pdfUrl,
      pageUrls: pageUrls,
      originalPageUrls: rawUrls,
      originalFileNames: directPdf ? [directPdf.name || pdfName] : [state.page1.file.name || 'page-1', state.page2.file.name || 'page-2'],
      sourceType: directPdf ? 'pdf' : 'camera_images',
      uploadedAt: nowText(),
      uploadedBy: operatorLabel()
    };

    await updateContract(id, {
      signingMethod: 'paper',
      signatureMethod: 'paper',
      paperSigningStatus: 'uploaded',
      paperSignedPdfUrl: pdfUrl,
      paperSignedPageUrls: pageUrls,
      paperSignedOriginalPageUrls: rawUrls,
      paperSignedOriginalFileNames: record.originalFileNames,
      paperSignedUploadedAt: record.uploadedAt,
      paperSignedUploadedBy: record.uploadedBy,
      paperSignedDocuments: history.concat([record]),
      status: PAPER_UPLOADED
    });
    setStatusField(PAPER_UPLOADED);
    setProgress(panel, 100, '已簽紙本合約上傳完成，請確認內容。');
    await refreshPanel(panel, id);
  }

  async function confirmPaperDocument(panel) {
    const saved = await saveCurrentContract();
    const row = await readContract(saved.id) || {};
    if (!row.paperSignedPdfUrl && !(Array.isArray(row.paperSignedPageUrls) && row.paperSignedPageUrls.length)) throw new Error('尚未上傳已簽紙本合約。');
    if (!global.confirm('確認這份紙本合約已由客人完成手寫簽名，並進入待付款確認嗎？\n\n原始照片與歷次版本會保留，不會被覆蓋。')) return;
    const at = nowText();
    await updateContract(saved.id, {
      signingMethod: 'paper',
      signatureMethod: 'paper',
      paperSigningStatus: 'confirmed',
      paperSignedConfirmedAt: at,
      paperSignedConfirmedBy: operatorLabel(),
      paperSubmittedAt: at,
      status: PAPER_CONFIRMED
    });
    global.__YZ_CURRENT_PAPER_SIGN_CONFIRMED__ = true;
    setStatusField(PAPER_CONFIRMED);
    setProgress(panel, 100, '紙本簽署已確認，案件已進入待付款確認。');
    await refreshPanel(panel, saved.id);
    if (typeof global.loadAll === 'function') {
      try { await global.loadAll(); } catch (_) {}
    }
  }

  function documentLinksHtml(row) {
    row = row || {};
    const links = [];
    if (row.paperSignedPdfUrl) links.push('<a href="' + R.esc(row.paperSignedPdfUrl) + '" target="_blank" rel="noopener">開啟已簽 PDF</a>');
    (Array.isArray(row.paperSignedPageUrls) ? row.paperSignedPageUrls : []).forEach(function (url, index) {
      if (url) links.push('<a href="' + R.esc(url) + '" target="_blank" rel="noopener">查看第 ' + (index + 1) + ' 頁</a>');
    });
    return links.join('');
  }

  function statusText(row) {
    if (paperConfirmed(row)) return '紙本已確認';
    if (row && row.paperSignedPdfUrl) return '紙本已上傳，待確認';
    return '等待紙本簽署';
  }

  function panelMarkup(row) {
    row = row || {};
    const method = isPaperContract(row) ? 'paper' : 'online';
    const confirmed = paperConfirmed(row);
    const hasDocument = !!(row.paperSignedPdfUrl || (Array.isArray(row.paperSignedPageUrls) && row.paperSignedPageUrls.length));
    return '' +
      '<h3>簽署方式</h3>' +
      '<p class="paper-help">線上簽署維持原本流程；只有選擇紙本簽署的案件，才會使用下方列印與拍照上傳功能。</p>' +
      '<div class="paper-method-grid">' +
        '<button class="paper-method-btn ' + (method === 'online' ? 'active' : '') + '" type="button" data-sign-method="online"><b>線上簽署（原流程）</b><span>客人由 LINE 或 Email 開啟連結，補身分資料、上傳證明並在手機簽名。</span></button>' +
        '<button class="paper-method-btn ' + (method === 'paper' ? 'active' : '') + '" type="button" data-sign-method="paper"><b>紙本列印簽署</b><span>列印兩頁 A4，客人手寫簽名後，由店家拍照或上傳 PDF。</span></button>' +
      '</div>' +
      '<div class="paper-flow-box ' + (method === 'online' ? '' : 'hidden') + '" data-online-flow>' +
        '<div class="paper-online-note"><b>原有線上流程未變更。</b><br>請繼續使用下方原本的「回傳給客人填寫身分證字號」按鈕。客人送出後，案件會進入待付款確認。</div>' +
      '</div>' +
      '<div class="paper-flow-box ' + (method === 'paper' ? '' : 'hidden') + '" data-paper-flow>' +
        '<div class="paper-status-line"><span class="paper-status-chip paper">紙本簽署</span><span class="paper-status-chip ' + (confirmed ? 'confirmed' : '') + '">' + R.esc(statusText(row)) + '</span></div>' +
        '<div class="paper-flow-steps"><div class="paper-flow-step ' + (method === 'paper' ? 'done' : '') + '">1. 儲存並列印兩頁 A4</div><div class="paper-flow-step ' + (hasDocument ? 'done' : '') + '">2. 客人手寫後拍照／上傳</div><div class="paper-flow-step ' + (confirmed ? 'done' : '') + '">3. 店家確認並進入待付款</div></div>' +
        '<div class="paper-flow-actions"><button class="btn secondary" type="button" data-paper-print>儲存並列印兩頁 A4</button><button class="btn secondary" type="button" data-paper-download>下載列印版 PDF</button></div>' +
        '<div class="paper-upload-grid">' +
          '<div class="paper-upload-card"><h4>已簽第 1 頁</h4><input type="file" accept="image/*" capture="environment" data-paper-page-input="1"><span class="paper-file-name" data-paper-file-name="1"></span><div class="paper-upload-preview" data-paper-preview="1">尚未選擇第 1 頁</div><div class="paper-upload-tools"><button type="button" data-paper-rotate="1" data-step="-90">向左轉</button><button type="button" data-paper-rotate="1" data-step="90">向右轉</button><button type="button" data-paper-remove="1">移除</button></div></div>' +
          '<div class="paper-upload-card"><h4>已簽第 2 頁</h4><input type="file" accept="image/*" capture="environment" data-paper-page-input="2"><span class="paper-file-name" data-paper-file-name="2"></span><div class="paper-upload-preview" data-paper-preview="2">尚未選擇第 2 頁</div><div class="paper-upload-tools"><button type="button" data-paper-rotate="2" data-step="-90">向左轉</button><button type="button" data-paper-rotate="2" data-step="90">向右轉</button><button type="button" data-paper-remove="2">移除</button></div></div>' +
        '</div>' +
        '<div class="paper-pdf-upload"><label>或直接上傳完整兩頁 PDF</label><input type="file" accept="application/pdf,.pdf" data-paper-pdf-input><span class="paper-file-name" data-paper-pdf-name></span><small>使用 PDF 時，不必再選第 1、2 頁照片；原始 PDF 會直接保存為正式紙本掃描檔。</small></div>' +
        '<button class="btn paper-upload-submit" type="button" data-paper-upload>合併並上傳已簽紙本合約</button>' +
        '<div class="paper-progress" data-paper-progress><div class="paper-progress-track"><div class="paper-progress-fill" data-paper-progress-fill></div></div><div class="paper-progress-text" data-paper-progress-text></div></div>' +
        '<div class="paper-document-box ' + (hasDocument ? '' : 'hidden') + '" data-paper-document-box><strong>已保存的紙本合約</strong><div class="paper-document-links">' + documentLinksHtml(row) + '</div></div>' +
        '<button class="btn paper-confirm-btn" type="button" data-paper-confirm ' + (hasDocument && !confirmed ? '' : 'disabled') + '>' + (confirmed ? '紙本簽署已確認' : '確認紙本已簽署・進入待付款') + '</button>' +
      '</div>';
  }

  function syncOriginalOnlineButton(row) {
    const paper = isPaperContract(row);
    document.querySelectorAll('[data-send-fill-btn]').forEach(function (button) {
      button.style.display = paper ? 'none' : '';
    });
  }

  async function refreshPanel(panel, id) {
    const currentId = id || currentContractId();
    const row = currentId ? (await readContract(currentId) || {}) : {};
    global.__YZ_CURRENT_PAPER_SIGN_CONFIRMED__ = paperConfirmed(row);
    if (!panel || !document.contains(panel)) return;
    panel.innerHTML = panelMarkup(row);
    panel.dataset.contractId = currentId || '';
    bindPanel(panel, row);
    renderDraft(panel, currentId);
    syncOriginalOnlineButton(row);
  }

  function bindPanel(panel, row) {
    panel.querySelectorAll('[data-sign-method]').forEach(function (button) {
      button.addEventListener('click', async function () {
        button.disabled = true;
        try { await setSigningMethod(button.dataset.signMethod, panel); }
        catch (error) { R.toast(error.message || String(error), false); }
        finally { if (document.contains(button)) button.disabled = false; }
      });
    });

    const printButton = panel.querySelector('[data-paper-print]');
    if (printButton) printButton.addEventListener('click', async function () {
      printButton.disabled = true;
      try {
        await setSigningMethod('paper', panel);
        if (typeof global.printRentalContract !== 'function') throw new Error('列印功能尚未載入。');
        global.printRentalContract();
      } catch (error) { R.toast(error.message || String(error), false); }
      finally { if (document.contains(printButton)) printButton.disabled = false; }
    });

    const downloadButton = panel.querySelector('[data-paper-download]');
    if (downloadButton) downloadButton.addEventListener('click', async function () {
      downloadButton.disabled = true;
      try {
        await setSigningMethod('paper', panel);
        setProgress(panel, 15, '正在產生兩頁 A4 PDF...');
        await downloadDraftPdf(panel);
      } catch (error) { clearProgress(panel); R.toast(error.message || String(error), false); }
      finally { if (document.contains(downloadButton)) downloadButton.disabled = false; }
    });

    panel.querySelectorAll('[data-paper-page-input]').forEach(function (input) {
      input.addEventListener('change', function () {
        const file = input.files && input.files[0];
        const pageNo = Number(input.dataset.paperPageInput);
        if (!file) return;
        if (!imageFileAccepted(file)) {
          input.value = '';
          R.toast('照片格式不正確，或檔案超過 20MB。', false);
          return;
        }
        const id = currentContractId();
        const state = documentState(id);
        const key = pageNo === 1 ? 'page1' : 'page2';
        revokePreview(state[key]);
        state[key] = { file: file, previewUrl: '' };
        state.pdf = null;
        const pdfInput = panel.querySelector('[data-paper-pdf-input]');
        if (pdfInput) pdfInput.value = '';
        renderDraft(panel, id);
      });
    });

    panel.querySelectorAll('[data-paper-rotate]').forEach(function (button) {
      button.addEventListener('click', function () {
        const pageNo = Number(button.dataset.paperRotate);
        const id = currentContractId();
        const state = documentState(id);
        const rotationKey = pageNo === 1 ? 'rotation1' : 'rotation2';
        state[rotationKey] = (Number(state[rotationKey]) + Number(button.dataset.step || 0) + 360) % 360;
        renderDraft(panel, id);
      });
    });

    panel.querySelectorAll('[data-paper-remove]').forEach(function (button) {
      button.addEventListener('click', function () {
        const pageNo = Number(button.dataset.paperRemove);
        const id = currentContractId();
        const state = documentState(id);
        const key = pageNo === 1 ? 'page1' : 'page2';
        revokePreview(state[key]);
        state[key] = null;
        state[pageNo === 1 ? 'rotation1' : 'rotation2'] = 0;
        const input = panel.querySelector('[data-paper-page-input="' + pageNo + '"]');
        if (input) input.value = '';
        renderDraft(panel, id);
      });
    });

    const pdfInput = panel.querySelector('[data-paper-pdf-input]');
    if (pdfInput) pdfInput.addEventListener('change', function () {
      const file = pdfInput.files && pdfInput.files[0];
      if (!file) return;
      if (!pdfFileAccepted(file)) {
        pdfInput.value = '';
        R.toast('PDF 格式不正確，或檔案超過 35MB。', false);
        return;
      }
      const state = documentState(currentContractId());
      state.pdf = file;
      const name = panel.querySelector('[data-paper-pdf-name]');
      if (name) name.textContent = file.name;
    });

    const uploadButton = panel.querySelector('[data-paper-upload]');
    if (uploadButton) uploadButton.addEventListener('click', async function () {
      uploadButton.disabled = true;
      try { await uploadPaperDocument(panel); }
      catch (error) { clearProgress(panel); R.toast(error.message || String(error), false); }
      finally { if (document.contains(uploadButton)) uploadButton.disabled = false; }
    });

    const confirmButton = panel.querySelector('[data-paper-confirm]');
    if (confirmButton) confirmButton.addEventListener('click', async function () {
      confirmButton.disabled = true;
      try { await confirmPaperDocument(panel); }
      catch (error) { R.toast(error.message || String(error), false); }
      finally { if (document.contains(confirmButton) && !paperConfirmed(row)) confirmButton.disabled = false; }
    });
  }

  async function enhance() {
    enhanceFrame = 0;
    const detail = document.getElementById('detailBox');
    if (!detail || !document.getElementById('sourceKind')) return;
    if (detail.querySelector('#rentalPaperSignPanel')) return;

    const panel = document.createElement('section');
    panel.id = 'rentalPaperSignPanel';
    panel.className = 'rental-paper-sign-panel';
    panel.innerHTML = '<h3>簽署方式</h3><p class="paper-help">正在讀取簽署狀態...</p>';

    const sendButton = detail.querySelector('[data-send-fill-btn]');
    const actionRow = sendButton && sendButton.closest('.btn-row');
    if (actionRow && actionRow.parentNode === detail) detail.insertBefore(panel, actionRow);
    else detail.append(panel);

    await refreshPanel(panel, currentContractId());
  }

  function scheduleEnhance() {
    if (enhanceFrame) return;
    enhanceFrame = global.requestAnimationFrame(enhance);
  }

  /* 紙本合約正式成立後，把正式 PDF 指向已簽掃描檔；線上合約完全交回原函式。 */
  const originalMarkDelivered = global.markDelivered;
  if (typeof originalMarkDelivered === 'function' && !originalMarkDelivered.__paperWrapped) {
    const wrapped = async function () {
      const id = currentContractId();
      const before = id ? await readContract(id) : null;
      const paper = paperConfirmed(before);
      const result = await originalMarkDelivered.apply(this, arguments);
      if (paper && id) {
        const after = await readContract(id);
        if (after && ['租賃中', '租用中', '已成立', 'active', '待配送 / 待安裝'].includes(clean(after.status))) {
          await updateContract(id, {
            signingMethod: 'paper',
            signatureMethod: 'paper',
            officialDocumentSource: 'paper-signed-scan',
            officialPdfUrl: before.paperSignedPdfUrl || after.paperSignedPdfUrl || '',
            officialPaperSignedPdfUrl: before.paperSignedPdfUrl || after.paperSignedPdfUrl || ''
          });
        }
      }
      return result;
    };
    wrapped.__paperWrapped = true;
    global.markDelivered = wrapped;
  }

  const root = document.getElementById('detailBox') || document.body;
  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(root, { childList: true, subtree: true });
  global.addEventListener('pageshow', scheduleEnhance);
  scheduleEnhance();
})(window);
