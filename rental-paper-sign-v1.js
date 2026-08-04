(function (global) {
  'use strict';

  const R = global.YZRental;
  if (!R) return;

  const BASE_SCRIPT = 'rental-paper-sign-v1-base.js?v=20260804-paper-handoff-v4';
  const ACTIVE_STATUSES = ['租賃中', '租用中', '已成立', 'active', '待配送 / 待安裝', '到期提醒中'];
  let working = false;
  let previewFrame = 0;
  let lastPreviewMode = '';
  let metadataTimer = 0;
  let metadataRunning = false;
  let activationWrapped = false;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function nowText() {
    return typeof R.nowText === 'function' ? R.nowText() : new Date().toISOString();
  }

  function operatorLabel() {
    try {
      const user = JSON.parse(global.localStorage.getItem('employeeUser') || 'null') || {};
      return clean(user.name || user.displayName || user.email || user.id || user.employeeId) || '管理者';
    } catch (_) {
      return '管理者';
    }
  }

  function currentContractId() {
    return clean(R.val('contractId'));
  }

  function currentStatus() {
    return clean(R.val('status'));
  }

  function isActiveStatus(value) {
    return ACTIVE_STATUSES.includes(clean(value));
  }

  function paperModeActive() {
    const button = document.querySelector('#rentalPaperSignPanel [data-sign-method="paper"]');
    if (button && button.classList.contains('active')) return true;
    const status = currentStatus();
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

  function paperPanelState(panel) {
    const documentBox = panel && panel.querySelector('[data-paper-document-box]');
    const hasDocument = !!(documentBox && !documentBox.classList.contains('hidden'));
    const confirmButton = panel && panel.querySelector('[data-paper-confirm]');
    const confirmed = global.__YZ_CURRENT_PAPER_SIGN_CONFIRMED__ === true ||
      !!(confirmButton && confirmButton.disabled && /已確認/.test(clean(confirmButton.textContent)));
    return { hasDocument: hasDocument, confirmed: confirmed };
  }

  function enhancePaperPanel() {
    const panel = document.getElementById('rentalPaperSignPanel');
    if (!panel) return;

    const heading = panel.querySelector('h3');
    if (heading) heading.textContent = '客人簽署流程（管理端）';

    const help = panel.querySelector('.paper-help');
    if (help) {
      help.textContent = '客人端始終只使用 LINE 或 Email 開啟網頁。客人若不會操作第二步，才由店家在這裡改用紙本接手；列印、拍照上傳與確認都只在後台進行。';
      let notice = panel.querySelector('.paper-handoff-notice');
      if (!notice) {
        notice = document.createElement('div');
        notice.className = 'paper-handoff-notice';
        help.insertAdjacentElement('afterend', notice);
      }
      notice.innerHTML = '<b>客人不會看到「紙本簽署」選項。</b><span>切換紙本後，舊的線上補資料／簽名連結會停止操作；LINE 或 Email 仍繼續用於後續通知與查看正式文件。</span>';
    }

    const onlineButton = panel.querySelector('[data-sign-method="online"]');
    const paperButton = panel.querySelector('[data-sign-method="paper"]');
    const state = paperPanelState(panel);
    if (onlineButton) {
      const title = onlineButton.querySelector('b');
      const copy = onlineButton.querySelector('span');
      if (title) title.textContent = '客人自行線上完成';
      if (copy) copy.textContent = '客人從 LINE 或 Email 開啟同一個網頁，填身分資料、上傳證明並用手機手寫簽名。';
      if ((state.hasDocument || state.confirmed) && paperModeActive()) {
        onlineButton.disabled = true;
        onlineButton.title = '紙本文件已上傳；為保留正式紀錄，不能直接切回線上簽署。';
      }
    }
    if (paperButton) {
      const title = paperButton.querySelector('b');
      const copy = paperButton.querySelector('span');
      if (title) title.textContent = '店家紙本接手（備援）';
      if (copy) copy.textContent = '客人已完成第一步申請，但不會操作下一步時，由店家列印、收回、拍照上傳。';
    }

    const onlineNote = panel.querySelector('[data-online-flow] .paper-online-note');
    if (onlineNote) {
      onlineNote.innerHTML = '<b>正常流程：客人自行完成。</b><br>LINE 與 Email 都只是傳送連結和通知；客人從手機瀏覽器開啟後都能上傳證件與線上簽名。';
    }

    const steps = panel.querySelector('.paper-flow-steps');
    if (steps) {
      steps.innerHTML = '' +
        '<div class="paper-flow-step done">1. 客人完成第一步申請</div>' +
        '<div class="paper-flow-step ' + (paperModeActive() ? 'done' : '') + '">2. 店家列印給客人手寫</div>' +
        '<div class="paper-flow-step ' + (state.hasDocument ? 'done' : '') + '">3. 店家拍照／上傳 PDF</div>' +
        '<div class="paper-flow-step ' + (state.confirmed ? 'done' : '') + '">4. 確認紙本後收款成立</div>';
    }

    const confirmButton = panel.querySelector('[data-paper-confirm]');
    if (confirmButton) {
      confirmButton.textContent = state.confirmed ? '紙本簽署已確認・可繼續收款成立' : '確認紙本已完成・下一步收款';
    }

    let activationBox = panel.querySelector('[data-paper-activation-box]');
    const active = isActiveStatus(currentStatus());
    if (state.confirmed) {
      if (!activationBox) {
        activationBox = document.createElement('div');
        activationBox.className = 'paper-activation-box';
        activationBox.setAttribute('data-paper-activation-box', '');
        panel.appendChild(activationBox);
      }
      activationBox.innerHTML = active
        ? '<b>這份紙本合約已轉為正式租賃</b><span>客人後續仍依原本選擇的 LINE 或 Email 接收通知，並可查看已簽紙本 PDF。</span>'
        : '<b>紙本文件已完成，最後確認收款與起租資料</b><span>請先確認交付日期、租期與實收款項；按下後會沿用原本通知方式寄送正式租賃連結。</span><button class="btn paper-activate-btn" type="button" data-paper-activate-rental>確認已收款並成立租賃</button>';
    } else if (activationBox) {
      activationBox.remove();
    }
  }

  function scheduleMetadataSync(methodHint, delay) {
    clearTimeout(metadataTimer);
    metadataTimer = global.setTimeout(function () {
      syncSigningMetadata(methodHint).catch(function (error) {
        console.warn('paper handoff metadata sync failed:', error);
      });
    }, Number(delay) || 700);
  }

  async function syncSigningMetadata(methodHint) {
    if (metadataRunning) {
      scheduleMetadataSync(methodHint, 500);
      return;
    }
    const id = currentContractId();
    if (!id) return;
    metadataRunning = true;
    try {
      const row = await R.get('rentalContracts', id) || {};
      const paper = methodHint === 'paper' || (!methodHint && (clean(row.signingMethod || row.signatureMethod) === 'paper' || !!row.paperSignedPdfUrl));
      const confirmed = paper && !!(row.paperSignedConfirmedAt && (row.paperSignedPdfUrl || (Array.isArray(row.paperSignedPageUrls) && row.paperSignedPageUrls.length)));
      const active = isActiveStatus(row.status);
      const patch = { updatedAtText: nowText() };

      if (paper) {
        Object.assign(patch, {
          signingMethod: 'paper',
          signatureMethod: 'paper',
          customerSigningFlow: 'paper_admin_assisted',
          customerActionRequired: false,
          customerOnlineSigningDisabled: true,
          customerOnlineSigningDisabledAt: row.customerOnlineSigningDisabledAt || nowText(),
          customerOnlineSigningDisabledReason: '客人無法或不便完成線上簽署，由店家改用紙本接手',
          paperFallbackSelectedAt: row.paperFallbackSelectedAt || nowText(),
          paperFallbackSelectedBy: row.paperFallbackSelectedBy || operatorLabel(),
          notificationChannelPreserved: true
        });
        if (confirmed) {
          Object.assign(patch, {
            paperWorkflowReadyForPayment: true,
            customerIdentityVerificationSource: 'paper_contract',
            customerSignatureSource: 'paper_contract',
            customerIdentityDataOnPaper: true,
            customerPortalDocumentMode: 'paper_scan',
            customerPortalReadOnly: active
          });
        }
        if (active) {
          Object.assign(patch, {
            paperWorkflowReadyForPayment: false,
            paperRentalActivatedAt: row.paperRentalActivatedAt || nowText(),
            customerPortalReadOnly: true,
            customerActionRequired: false
          });
        }
      } else {
        Object.assign(patch, {
          signingMethod: 'online',
          signatureMethod: 'online',
          customerSigningFlow: 'online_self_service',
          customerActionRequired: true,
          customerOnlineSigningDisabled: false,
          customerOnlineSigningDisabledAt: '',
          customerOnlineSigningDisabledReason: '',
          paperWorkflowReadyForPayment: false,
          customerIdentityVerificationSource: 'online',
          customerSignatureSource: 'online',
          customerPortalDocumentMode: 'generated_contract',
          customerPortalReadOnly: false
        });
        if (row.paperFallbackSelectedAt) {
          patch.paperFallbackCancelledAt = nowText();
          patch.paperFallbackCancelledBy = operatorLabel();
        }
      }

      await R.db().collection('rentalContracts').doc(id).set(patch, { merge: true });
    } finally {
      metadataRunning = false;
    }
  }

  function installActivationFinalizer() {
    if (activationWrapped || typeof global.markDelivered !== 'function') return;
    const original = global.markDelivered;
    if (original.__paperHandoffV2) {
      activationWrapped = true;
      return;
    }
    const wrapped = async function () {
      const id = currentContractId();
      const before = id ? await R.get('rentalContracts', id).catch(function () { return null; }) : null;
      const result = await original.apply(this, arguments);
      if (id && before && clean(before.signingMethod || before.signatureMethod) === 'paper' && before.paperSignedConfirmedAt) {
        const after = await R.get('rentalContracts', id).catch(function () { return null; });
        if (after && isActiveStatus(after.status)) {
          await R.db().collection('rentalContracts').doc(id).set({
            customerSigningFlow: 'paper_admin_assisted',
            customerActionRequired: false,
            customerOnlineSigningDisabled: true,
            customerIdentityVerificationSource: 'paper_contract',
            customerSignatureSource: 'paper_contract',
            customerIdentityDataOnPaper: true,
            customerPortalDocumentMode: 'paper_scan',
            customerPortalReadOnly: true,
            paperWorkflowReadyForPayment: false,
            paperRentalActivatedAt: after.paperRentalActivatedAt || nowText(),
            updatedAtText: nowText()
          }, { merge: true });
          schedulePreviewSync();
        }
      }
      return result;
    };
    wrapped.__paperHandoffV2 = true;
    global.markDelivered = wrapped;
    activationWrapped = true;
  }

  function syncLivePreview() {
    previewFrame = 0;
    const mode = paperModeActive() ? 'paper' : 'online';
    if (mode !== lastPreviewMode) {
      lastPreviewMode = mode;
      rerenderPreviewForMode(mode);
    }
    if (mode === 'paper') applyPaperPreviewDecorations();
    enhancePaperPanel();
    installActivationFinalizer();
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
      customerSigningFlow: 'paper_admin_assisted',
      customerActionRequired: false,
      customerOnlineSigningDisabled: true,
      customerOnlineSigningDisabledAt: row.customerOnlineSigningDisabledAt || nowText(),
      customerOnlineSigningDisabledReason: '客人無法或不便完成線上簽署，由店家改用紙本接手',
      paperFallbackSelectedAt: row.paperFallbackSelectedAt || nowText(),
      paperFallbackSelectedBy: row.paperFallbackSelectedBy || operatorLabel(),
      notificationChannelPreserved: true,
      paperSigningStatus: row.paperSignedConfirmedAt ? 'confirmed' : (row.paperSignedPdfUrl ? 'uploaded' : 'awaiting_signature'),
      paperContractPreparedAt: row.paperContractPreparedAt || nowText(),
      status: status,
      updatedAtText: nowText()
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
    scheduleMetadataSync('paper', 50);
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
      paperPrintablePdfGeneratedAt: nowText(),
      paperPrintablePdfFileName: fileName,
      updatedAtText: nowText()
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
    const signMethod = event.target && event.target.closest
      ? event.target.closest('#rentalPaperSignPanel [data-sign-method]')
      : null;
    if (signMethod) {
      const method = clean(signMethod.dataset.signMethod);
      const panel = document.getElementById('rentalPaperSignPanel');
      const state = paperPanelState(panel);
      if (method === 'online' && paperModeActive() && (state.hasDocument || state.confirmed)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        R.toast('紙本文件已經上傳，為保留正式紀錄，不能直接切回線上簽署。', false);
        return;
      }
      scheduleMetadataSync(method, 900);
      global.setTimeout(schedulePreviewSync, 950);
      return;
    }

    const activate = event.target && event.target.closest
      ? event.target.closest('[data-paper-activate-rental]')
      : null;
    if (activate) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (typeof global.markDelivered !== 'function') {
        R.toast('確認租用成立功能尚未載入，請重新整理後再試。', false);
        return;
      }
      global.markDelivered();
      return;
    }

    const confirmButton = event.target && event.target.closest
      ? event.target.closest('[data-paper-confirm]')
      : null;
    if (confirmButton) {
      scheduleMetadataSync('paper', 1200);
      global.setTimeout(schedulePreviewSync, 1250);
      return;
    }

    const uploadButton = event.target && event.target.closest
      ? event.target.closest('[data-paper-upload]')
      : null;
    if (uploadButton) {
      scheduleMetadataSync('paper', 1800);
      global.setTimeout(schedulePreviewSync, 1850);
      return;
    }

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
  script.onload = function () {
    installActivationFinalizer();
    schedulePreviewSync();
    scheduleMetadataSync('', 1000);
  };
  script.onerror = function () {
    R.toast('紙本簽署功能載入失敗，請重新整理後再試。', false);
  };
  document.head.appendChild(script);
  schedulePreviewSync();
})(window);
