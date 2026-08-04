(function (global) {
  'use strict';
  if (global.__YZ_RENTAL_PAPER_CONTRACT_VIEW_V1__) return;
  global.__YZ_RENTAL_PAPER_CONTRACT_VIEW_V1__ = true;

  const R = global.YZRental;
  if (!R) return;

  function clean(value) { return String(value == null ? '' : value).trim(); }
  function paperContract(row) {
    return !!(row && clean(row.signingMethod || row.signatureMethod) === 'paper' && (row.paperSignedPdfUrl || (Array.isArray(row.paperSignedPageUrls) && row.paperSignedPageUrls.length)));
  }

  async function enhance() {
    try {
      const params = new URLSearchParams(global.location.search || '');
      const contractId = clean(params.get('contractId') || params.get('id'));
      const token = clean(params.get('token'));
      if (!contractId || !token) return;
      const row = await R.get('rentalContracts', contractId);
      if (!paperContract(row)) return;

      const validTokens = [row.officialContractToken, row.customerToken, row.signToken, row.token].map(clean).filter(Boolean);
      if (!validTokens.includes(token)) return;

      const preview = document.getElementById('contractPreview');
      if (!preview) return;
      const pages = Array.isArray(row.paperSignedPageUrls) ? row.paperSignedPageUrls.filter(Boolean) : [];
      const pdfUrl = clean(row.paperSignedPdfUrl || row.officialPaperSignedPdfUrl || row.officialPdfUrl);

      const wrap = document.createElement('div');
      wrap.className = 'rental-paper-contract-view';
      if (pages.length) {
        pages.forEach(function (url, index) {
          const page = document.createElement('section');
          page.className = 'paper-contract-page';
          const img = document.createElement('img');
          img.src = url;
          img.alt = '已簽紙本合約第 ' + (index + 1) + ' 頁';
          page.append(img);
          wrap.append(page);
        });
      } else {
        const note = document.createElement('div');
        note.className = 'save-notice';
        note.textContent = '這份契約使用紙本簽署，請按下方按鈕開啟已簽 PDF。';
        wrap.append(note);
      }
      if (pdfUrl) {
        const link = document.createElement('a');
        link.className = 'btn rental-paper-contract-open';
        link.href = pdfUrl;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = '開啟已簽紙本 PDF';
        wrap.append(link);
      }
      preview.replaceChildren(wrap);

      const summary = document.getElementById('summary');
      if (summary) {
        const badge = summary.querySelector('.status');
        if (badge) badge.textContent = (row.status || '租賃中') + '｜紙本簽署';
      }
      const notice = document.querySelector('.save-notice');
      if (notice) notice.textContent = '此頁顯示店家保存的已簽紙本掃描檔；原始照片與歷次版本由租賃管理系統留存。';
    } catch (error) {
      console.warn('paper contract view enhancement failed:', error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(enhance, 120); }, { once: true });
  else setTimeout(enhance, 120);
})(window);
