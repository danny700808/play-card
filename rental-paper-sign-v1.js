(function (global) {
  'use strict';

  const R = global.YZRental;
  if (!R) return;

  const BASE_SCRIPT = 'rental-paper-sign-v1-base.js?v=20260804-paper-print-v2';
  let working = false;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function currentContractId() {
    return clean(R.val('contractId'));
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

  async function downloadPaperPdf(contract) {
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

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = (contract.contractNo || contract.contractId || 'rental-contract') + '-paper-sign.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
      global.setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
    } finally {
      wrap.remove();
    }
  }

  async function handlePaperOutput(button, mode) {
    if (working) return;
    working = true;
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = mode === 'print' ? '正在準備列印…' : '正在產生 PDF…';

    try {
      const prepared = await ensurePaperContract();
      if (mode === 'print') printPaperContract(prepared.contract);
      else await downloadPaperPdf(prepared.contract);
    } catch (error) {
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
    handlePaperOutput(target, target.hasAttribute('data-paper-print') ? 'print' : 'download');
  }, true);

  const script = document.createElement('script');
  script.src = BASE_SCRIPT;
  script.async = false;
  script.onerror = function () {
    R.toast('紙本簽署功能載入失敗，請重新整理後再試。', false);
  };
  document.head.appendChild(script);
})(window);
