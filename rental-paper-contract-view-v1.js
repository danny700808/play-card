(function (global) {
  'use strict';
  if (global.__YZ_RENTAL_PAPER_CONTRACT_VIEW_V2__) return;
  global.__YZ_RENTAL_PAPER_CONTRACT_VIEW_V2__ = true;

  const R = global.YZRental;
  if (!R) return;

  let contract = null;
  let authorized = false;
  let rendering = false;
  let observer = null;
  let retryTimer = 0;

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function isPaperContract(row) {
    return !!(row && (
      clean(row.signingMethod || row.signatureMethod) === 'paper' ||
      row.customerPortalDocumentMode === 'paper_scan' ||
      row.paperSignedPdfUrl ||
      (Array.isArray(row.paperSignedPageUrls) && row.paperSignedPageUrls.length)
    ));
  }

  function paperPages(row) {
    return (Array.isArray(row && row.paperSignedPageUrls) ? row.paperSignedPageUrls : [])
      .map(clean)
      .filter(Boolean);
  }

  function paperPdf(row) {
    return clean(row && (
      row.paperSignedPdfUrl ||
      row.officialPaperSignedPdfUrl ||
      (row.officialDocumentSource === 'paper-signed-scan' ? row.officialPdfUrl : '')
    ));
  }

  function updateSummary(row) {
    const summary = document.getElementById('summary');
    if (!summary) return;
    summary.innerHTML = '<div class="summary-line"><span class="status">' +
      R.esc(row.status || '租賃中') + '｜紙本簽署</span><br><b>客戶：</b>' +
      R.esc(row.customerName || '') + '<br><b>租期：</b>' +
      R.esc(row.startDate || '') + ' ～ ' + R.esc(row.endDate || '') +
      '<br><b>契約編號：</b>' +
      R.esc(row.contractNo || row.contractId || row.__id || '') + '</div>';
  }

  function buildPaperView(row) {
    const pages = paperPages(row);
    const pdfUrl = paperPdf(row);
    const wrap = document.createElement('div');
    wrap.className = 'rental-paper-contract-view';
    wrap.setAttribute('data-paper-contract-view', 'true');

    if (pages.length) {
      pages.forEach(function (url, index) {
        const page = document.createElement('section');
        page.className = 'paper-contract-page';
        const img = document.createElement('img');
        img.src = url;
        img.alt = '已簽紙本合約第 ' + (index + 1) + ' 頁';
        img.loading = 'eager';
        img.addEventListener('load', function () {
          if (typeof global.fitContractToA4 === 'function') global.fitContractToA4();
        });
        page.appendChild(img);
        wrap.appendChild(page);
      });
    } else {
      const note = document.createElement('div');
      note.className = 'save-notice';
      note.textContent = '這份契約使用紙本簽署，請按下方按鈕開啟店家保存的已簽 PDF。';
      wrap.appendChild(note);
    }

    if (pdfUrl) {
      const link = document.createElement('a');
      link.className = 'btn rental-paper-contract-open';
      link.href = pdfUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = '開啟／下載已簽紙本 PDF';
      wrap.appendChild(link);
    }
    return wrap;
  }

  function applyPaperView() {
    retryTimer = 0;
    if (!authorized || !contract || !isPaperContract(contract)) return;
    const preview = document.getElementById('contractPreview');
    if (!preview) return;
    if (preview.firstElementChild && preview.firstElementChild.matches('[data-paper-contract-view="true"]')) return;

    rendering = true;
    preview.replaceChildren(buildPaperView(contract));
    preview.dataset.paperContractRendered = 'true';
    updateSummary(contract);

    const notice = document.querySelector('.no-print .save-notice');
    if (notice) {
      notice.textContent = '下方顯示店家上傳並確認的已簽紙本合約；可直接查看兩頁照片，或開啟 PDF 保存。';
    }
    const hint = document.querySelector('.mobile-hint');
    if (hint) hint.textContent = '這是店家保存的正式紙本掃描檔，LINE 或 Email 連結日後仍可再次開啟查看。';

    global.setTimeout(function () {
      rendering = false;
      if (typeof global.fitContractToA4 === 'function') global.fitContractToA4();
    }, 0);
  }

  function scheduleApply(delay) {
    clearTimeout(retryTimer);
    retryTimer = global.setTimeout(applyPaperView, Number(delay) || 0);
  }

  async function enhance() {
    try {
      const params = new URLSearchParams(global.location.search || '');
      const contractId = clean(params.get('contractId') || params.get('id'));
      const token = clean(params.get('token'));
      if (!contractId || !token) return;

      contract = await R.get('rentalContracts', contractId);
      if (!isPaperContract(contract)) return;
      const validTokens = [
        contract.officialContractToken,
        contract.customerToken,
        contract.signToken,
        contract.token
      ].map(clean).filter(Boolean);
      if (!validTokens.includes(token)) return;
      authorized = true;

      const shell = document.getElementById('contractShell') || document.body;
      observer = new MutationObserver(function () {
        if (!rendering) scheduleApply(0);
      });
      observer.observe(shell, { childList: true, subtree: true });

      applyPaperView();
      [180, 600, 1400, 2800].forEach(function (delay) {
        global.setTimeout(applyPaperView, delay);
      });
    } catch (error) {
      console.warn('paper contract view enhancement failed:', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance, { once: true });
  } else {
    enhance();
  }
  global.addEventListener('pageshow', function () { scheduleApply(80); });
})(window);
