(function (global) {
  'use strict';

  const R = global.YZRental;
  if (!R) return;

  const BASE_SCRIPT = 'rental-paper-sign-v1-base.js?v=20260804-paper-preview-v3';
  let working = false;
  let previewFrame = 0;
  let lastPreviewMode = '';

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function currentContractId() {
    return clean(R.val('contractId'));
  }

  function paperModeActive() {
    const button = document.querySelector('#rentalPaperSignPanel [data-sign-method="paper"]');
    if (button && button.classList.contains('active')) return true;
    const status = clean(R.val('status'));
    return ['待紙本簽署', '紙本已上傳待確認'].includes(status) || global.__YZ_CURRENT_PAPER_SIGN_CONFIRMED__ === true;
  }

  function paperPrintHtml(contract) {
    const source = Object.assign({}, contract || {}, {
      signingMethod: 'paper',
      signatureMethod: 'paper',
      paperPrintMode: true,
      customerSignatureDataUrl: '',
      signatureDataUrl: '',
      customerSignatureUrl: '',
      signatureUrl: '',
      signDataUrl: '',
      customerIdImageWatermarkedDataUrl: '',
      idImageWatermarkedDataUrl: '',
      customerIdImageDataUrl: '',
      idImageDataUrl: '',
      idCardImageDataUrl: '',
      customerIdImageUrl: '',
      idImageUrl: '',
      idCardImageUrl: ''
    });

    return R.renderContractHtml(source, { paperSigningView: true })
      .replace(/<span class="sig-empty">尚未簽名<\/span>/g, '<span class="sig-empty"></span>')
      .replace(/身分證字號 \/ 統編：客人正式填寫後顯示/g, '身分證字號 / 統編：____________________________')
      .replace('客人正式填寫連結上傳身分證證明後，此處會顯示加浮水印後的圖片。', '<b>甲方身分證影本黏貼處</b>');
  }

  function applyPaperPreviewDecorations() {
    if (!paperModeActive()) return;
    const preview = document.getElementById('contractPreview');
    if (!preview) return;

    preview.querySelectorAll('.sig-empty').forEach(function (node) {
      if (clean(node.textContent)) node.textContent = '';
    });
    preview.querySelectorAll('.id-card-meta').forEach(function (node) {
      if (node.textContent && node.textContent.includes('客人正式填寫後顯示')) {
        node.textContent = '身分證字號 / 統編：____________________________';
      }
    });
    preview.querySelectorAll('.id-placeholder').forEach(function (node) {
      if (node.textContent && node.textContent.includes('客人正式填寫連結上傳身分證證明後')) {
        node.innerHTML = '<b>甲方身分證影本黏貼處</b>';
      }
    });
  }

  function rerenderPreviewForMode(mode) {
    const preview = document.getElementById('contractPreview');
    if (!preview || typeof global.collect !== 'function') return;
    try {
      const contract = global.collect();
      preview.innerHTML = mode === 'paper' ? paperPrintHtml(contract) : R.renderContractHtml(contract);
    } catch (_) {}
  }

  function syncLivePreview() {
    previewFrame = 0;
    const mode = paperModeActive() ? 'paper' : 'online';
    if (mode !== lastPreviewMode) {
      lastPreviewMode = mode;
      rerenderPreviewForMode(mode);
    }
    if (mode === 'paper') applyPaperPreviewDecorations();
  }

  function schedulePreviewSync() {
    if (previewFrame) return;
    previewFrame = global.requestAnimationFrame(syncLivePreview);
  }

  async function ensurePaperContract() {
    if (typeof global.saveContract !== 'function') throw new Error('租賃儲存功能尚未載入。');
    const result = await global.saveContract(false, { silent: true });
    if (!result) throw new Error('合約尚未成功儲存。');

    const id = currentContractId() || clean(result.contractId);
    if (!id) throw new Error('找不到合約編號，請先儲存資料。');

    const row = await R.get('rentalContracts', id) || {};
    const current = clean(row.status);
    const lockedStatuses = ['租賃中', '租用中', '已成立', 'active', '已退租', '退租申請中', '退租待安排', '待收回'];
    const status = lockedStatuses.includes(current)
      ? current
      : (row.paperSignedConfirmedAt ? '待付款確認' : (row.paperSignedPdfUrl ? '紙本已上傳待確認' : '待紙本簽署'));

    await R.db().collection('rentalContracts').doc(id).set({
      signingMethod: 'paper',
      signatureMethod: 'paper',
      paperSigningStatus: row.paperSignedConfirmedAt ? 'confirmed' : (row.paperSignedPdfUrl ? 'uploaded' : 'awaiting_signature'),
      paperContractPreparedAt: row.paperContractPreparedAt || (typeof R.nowText === 'function' ? R.nowText() : new Date().toISOString()),
      status: status,
      updatedAtText: typeof R.nowText === 'function' ? R.nowText() : new Date().toISOString()
    }, { merge: true });

    const statusField = document.getElementById('status');
    if (statusField) statusField.value = status;

    const contract = typeof global.collect === 'function' ? global.collect() : Object.assign({}, row, { contractId: id });
    contract.signingMethod = 'paper';
    contract.signatureMethod = 'paper';
    contract.paperPrintMode = true;
    lastPreviewMode = 'paper';
    const preview = document.getElementById('contractPreview');
    if (preview) preview.innerHTML = paperPrintHtml(contract);
    return { id: id, contract: contract };
  }

  function printPaperContract(contract) {
    const html = paperPrintHtml(contract);
    const base = location.href.replace(/[^\/]*$/, '');
    const win = global.open('', '_blank');
    if (!win) throw new Error('瀏覽器阻擋列印視窗，請允許彈出視窗後再試。');

    win.document.open();
    win.document.write(
      '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">' +
      '<base href="' + (R.esc ? R.esc(base) : base) + '">' +
      '<title>紙本租賃契約列印</title>' +
      '<style>' +
      'html,body{margin:0!important;padding:0!important;background:#fff!important}' +
      'body{width:210mm}' +
      '@page{size:A4;margin:0}' +
      '.rental-contract-sheet{border:0!important;box-shadow:none!important;margin:0!important;width:210mm!important;height:297mm!important;min-height:297mm!important;page-break-after:always!important;break-after:page!important}' +
      '.rental-contract-sheet:last-child{page-break-after:auto!important;break-after:auto!important}' +
      '.sig-empty{display:inline-block!important;min-width:52mm!important;min-height:12mm!important}' +
      '.id-placeholder{font-size:14px!important;font-weight:900!important;color:#334155!important}' +
      '</style></head><body>' + html +
      '<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},250)}<\/script>' +
      '</body></html>'
    );
    win.document.close();
  }

  function openPdfWaitingWindow() {
    const win = global.open('', '_blank');
    if (!win) return null;
    try {
      win.document.open();
      win.document.write('<!doctype html><meta charset="utf-8"><title>正在產生 PDF</title><style>body{font-family:system-ui,-apple-system,sans-serif;padding:32px;line-height:1.7;color:#18314a}b{font-size:20px}</style><body><b>正在產生兩頁 A4 PDF…</b><br>請不要關閉此頁，完成後會自動開啟 PDF。</body>');
      win.document.close();
    } catch (_) {}
    return win;
  }

  async function uploadPrintablePdf(id, contract, blob) {
    if (!global.firebase || !global.firebase.storage) throw new Error('Firebase Storage 尚未載入，無法保存 PDF。');
    const safe = clean(id).replace(/[^a-zA-Z0-9_-]/g, '_') || 'rental-contract';
    const fileName = safe + '-paper-sign.pdf';
    const ref = global.firebase.storage().ref().child('rental-contracts/' + safe + '/paper-sign/printable-contract.pdf');
    await ref.put(blob, {
      contentType: 'application/pdf',
      contentDisposition: 'attachment; filename="' + fileName + '"'
    });
    const url = await ref.getDownloadURL();
    await R.db().collection('rentalContracts').doc(id).set({
      paperPrintablePdfUrl: url,
      paperPrintablePdfGeneratedAt: typeof R.nowText === 'function' ? R.nowText() : new Date().toISOString(),
      paperPrintablePdfFileName: fileName,
      updatedAtText: typeof R.nowText === 'function' ? R.nowText() : new Date().toISOString()
    }, { merge: true });
    return { url: url, fileName: fileName };
  }

  function showPdfLink(button, url, fileName) {
    const panel = button.closest('#rentalPaperSignPanel') || button.parentElement;
    if (!panel) return;
    let box = panel.querySelector('[data-paper-generated-pdf]');
    if (!box) {
      box = document.createElement('div');
      box.setAttribute('data-paper-generated-pdf', '');
      box.className = 'paper-document-box';
      panel.appendChild(box);
    }
    box.innerHTML = '<strong>列印版 PDF 已產生</strong><div class="paper-document-links"><a href="' + (R.esc ? R.esc(url) : url) + '" target="_blank" rel="noopener" download="' + (R.esc ? R.esc(fileName) : fileName) + '">開啟／下載 PDF</a></div>';
  }

  async function downloadPaperPdf(id, contract, outputWindow, button) {
    if (!global.html2pdf) throw new Error('PDF 產生工具尚未載入，請重新整理後再試。');
    const wrap = document.createElement('div');
    wrap.style.position = 'fixed';
    wrap.style.left = '-99999px';
    wrap.style.top = '0';
    wrap.style.width = '210mm';
    wrap.innerHTML = paperPrintHtml(contract);
    document.body.appendChild(wrap);

    try {
      const blob = await global.html2pdf().set({
        margin: 0,
        filename: (contract.contractNo || contract.contractId || 'rental-contract') + '-paper-sign.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, allowTaint: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
      }).from(wrap).outputPdf('blob');

      const stored = await uploadPrintablePdf(id, contract, blob);
      showPdfLink(button, stored.url, stored.fileName);
      if (outputWindow && !outputWindow.closed) outputWindow.location.replace(stored.url);
      else {
        const link = document.createElement('a');
        link.href = stored.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.download = stored.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } finally {
      wrap.remove();
    }
  }

  async function handlePaperOutput(button, mode, outputWindow) {
    if (working) return;
    working = true;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = mode === 'print' ? '正在準備列印…' : '正在產生 PDF…';

    try {
      const prepared = await ensurePaperContract();
      if (mode === 'print') printPaperContract(prepared.contract);
      else await downloadPaperPdf(prepared.id, prepared.contract, outputWindow, button);
    } catch (error) {
      if (outputWindow && !outputWindow.closed) {
        try { outputWindow.close(); } catch (_) {}
      }
      R.toast(error && error.message ? error.message : String(error), false);
    } finally {
      working = false;
      if (document.contains(button)) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  document.addEventListener('click', function (event) {
    const target = event.target && event.target.closest
      ? event.target.closest('[data-paper-print],[data-paper-download]')
      : null;
    if (!target) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const mode = target.hasAttribute('data-paper-print') ? 'print' : 'download';
    const outputWindow = mode === 'download' ? openPdfWaitingWindow() : null;
    handlePaperOutput(target, mode, outputWindow);
  }, true);

  const previewRoot = document.getElementById('detailBox') || document.body;
  const previewObserver = new MutationObserver(schedulePreviewSync);
  previewObserver.observe(previewRoot, { childList: true, subtree: true, characterData: true });
  document.addEventListener('input', schedulePreviewSync, true);
  document.addEventListener('change', schedulePreviewSync, true);
  global.addEventListener('pageshow', schedulePreviewSync);

  const script = document.createElement('script');
  script.src = BASE_SCRIPT;
  script.async = false;
  script.onload = schedulePreviewSync;
  script.onerror = function () {
    R.toast('紙本簽署功能載入失敗，請重新整理後再試。', false);
  };
  document.head.appendChild(script);
  schedulePreviewSync();
})(window);
