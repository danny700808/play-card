(function (global) {
  'use strict';

  if (global.__YZ_RENTAL_PAPER_ACTIVATION_BRIDGE_V1__) return;
  global.__YZ_RENTAL_PAPER_ACTIVATION_BRIDGE_V1__ = true;

  const R = global.YZRental;
  if (!R) return;

  const ACTIVE = new Set(['租賃中', '租用中', '已成立', 'active', '待配送 / 待安裝', '到期提醒中']);
  let busy = false;
  let lastPointerAt = 0;

  function clean(value) {
    return String(value == null ? '' : value).trim();
  }

  function nowText() {
    return typeof R.nowText === 'function' ? R.nowText() : new Date().toISOString();
  }

  function currentContractId() {
    return clean(R.val && R.val('contractId'));
  }

  async function readContract(id) {
    const contractId = clean(id || currentContractId());
    if (!contractId) return null;
    try {
      return await R.get('rentalContracts', contractId);
    } catch (_) {
      return null;
    }
  }

  function confirmedPaper(row) {
    row = row || {};
    const paper = clean(row.signingMethod || row.signatureMethod) === 'paper' || !!row.paperSignedPdfUrl;
    const hasDocument = !!(
      row.paperSignedPdfUrl ||
      (Array.isArray(row.paperSignedPageUrls) && row.paperSignedPageUrls.some(Boolean))
    );
    return paper && hasDocument && !!row.paperSignedConfirmedAt;
  }

  function ensureMask() {
    let mask = document.getElementById('rentalProgressMask');
    if (!mask) {
      mask = document.createElement('div');
      mask.id = 'rentalProgressMask';
      mask.className = 'rental-progress-mask';
      mask.innerHTML = '<div class="rental-progress-box">' +
        '<div class="rental-progress-title" id="rentalProgressTitle">確認租用成立</div>' +
        '<div class="rental-progress-text" id="rentalProgressText">正在檢查紙本、收款與租期資料...</div>' +
        '<div class="rental-progress-bar"><div class="rental-progress-fill" id="rentalProgressFill" style="width:6%;background:#1f7a5a"></div></div>' +
        '<div class="rental-progress-actions" id="rentalProgressActions" style="display:none">' +
          '<button class="btn secondary" type="button" data-paper-bridge-close>關閉</button>' +
        '</div>' +
      '</div>';
      document.body.appendChild(mask);
    }
    const title = document.getElementById('rentalProgressTitle');
    const text = document.getElementById('rentalProgressText');
    const fill = document.getElementById('rentalProgressFill');
    const actions = document.getElementById('rentalProgressActions');
    if (title) title.textContent = '確認租用成立';
    if (text) text.textContent = '正在檢查紙本、收款與租期資料...';
    if (fill) {
      fill.style.background = '#1f7a5a';
      fill.style.width = '6%';
    }
    if (actions) actions.style.display = 'none';
    return mask;
  }

  function finish(text, ok) {
    const title = document.getElementById('rentalProgressTitle');
    const message = document.getElementById('rentalProgressText');
    const fill = document.getElementById('rentalProgressFill');
    const actions = document.getElementById('rentalProgressActions');
    if (title) title.textContent = ok ? '租用成立完成' : '租用尚未成立';
    if (message) message.textContent = text || (ok ? '案件已移至租用中。' : '請依提示補齊資料後再試。');
    if (fill) {
      fill.style.background = ok ? '#1f7a5a' : '#b42318';
      fill.style.width = '100%';
    }
    if (actions) actions.style.display = 'flex';
  }

  function installPaperAssetBypass() {
    const original = global.ensureRentalContractAssetsStored;
    if (typeof original !== 'function') return false;
    if (original.__paperBridgeBypassV1) return true;

    const wrapped = async function (contractId, source) {
      const stored = await readContract(contractId);
      if (!confirmedPaper(stored)) return await original.apply(this, arguments);

      const pages = Array.isArray(stored.paperSignedPageUrls)
        ? stored.paperSignedPageUrls.map(clean).filter(Boolean)
        : [];
      const originals = Array.isArray(stored.paperSignedOriginalPageUrls)
        ? stored.paperSignedOriginalPageUrls.map(clean).filter(Boolean)
        : [];
      const pdfUrl = clean(stored.paperSignedPdfUrl || stored.officialPaperSignedPdfUrl);
      const patch = {
        signingMethod: 'paper',
        signatureMethod: 'paper',
        paperSignedPdfUrl: pdfUrl,
        officialPaperSignedPdfUrl: pdfUrl,
        paperSignedPageUrls: pages,
        paperSignedOriginalPageUrls: originals,
        officialDocumentSource: 'paper-signed-scan',
        customerIdentityVerificationSource: 'paper_contract',
        customerSignatureSource: 'paper_contract',
        customerIdentityDataOnPaper: true,
        customerPortalDocumentMode: 'paper_scan',
        customerPortalReadOnly: false,
        customerOnlineSigningDisabled: true,
        customerActionRequired: false,
        updatedAtText: nowText()
      };
      await R.db().collection('rentalContracts').doc(clean(contractId)).set(patch, { merge: true });
      return patch;
    };
    wrapped.__paperBridgeBypassV1 = true;
    wrapped.__originalEnsureRentalAssets = original;
    global.ensureRentalContractAssetsStored = wrapped;
    return true;
  }

  async function runActivation(button) {
    if (busy) return;
    busy = true;
    const oldText = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = '正在檢查並準備成立...';
    }
    ensureMask();

    try {
      const id = currentContractId();
      if (!id) throw new Error('找不到契約編號，請重新選擇這筆案件。');
      const row = await readContract(id);
      if (!confirmedPaper(row)) {
        throw new Error('紙本合約尚未完成確認，請先完成上傳並按「確認紙本已完成」。');
      }
      if (!installPaperAssetBypass()) {
        throw new Error('正式成立功能尚未載入，請重新整理後再試。');
      }
      if (typeof global.markDelivered !== 'function') {
        throw new Error('確認租用成立功能尚未載入，請重新整理後再試。');
      }

      await Promise.resolve(global.markDelivered());

      const after = await readContract(id);
      if (after && ACTIVE.has(clean(after.status))) {
        finish('已確認收款，案件已正式移至「租用中」。', true);
      } else {
        finish('案件尚未成立。若剛才按了取消，請關閉後重按；若系統提示缺少交付日期、租期或內部租用次數，請補齊後再試。', false);
      }
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      finish(message, false);
      if (typeof R.toast === 'function') R.toast(message, false);
    } finally {
      busy = false;
      if (button && document.contains(button)) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.textContent = oldText || '確認已收款並成立租賃';
      }
    }
  }

  function activationTarget(event) {
    return event.target && event.target.closest
      ? event.target.closest('[data-paper-activate-rental]')
      : null;
  }

  function handlePointer(event) {
    const button = activationTarget(event);
    if (!button) return;
    const now = Date.now();
    if (now - lastPointerAt < 650) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    lastPointerAt = now;
    event.preventDefault();
    event.stopImmediatePropagation();
    runActivation(button);
  }

  document.addEventListener('pointerdown', handlePointer, true);
  document.addEventListener('mousedown', handlePointer, true);
  document.addEventListener('touchstart', handlePointer, { capture: true, passive: false });
  document.addEventListener('click', function (event) {
    const close = event.target && event.target.closest ? event.target.closest('[data-paper-bridge-close]') : null;
    if (close) {
      event.preventDefault();
      const mask = document.getElementById('rentalProgressMask');
      if (mask) mask.remove();
      return;
    }
    const button = activationTarget(event);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  installPaperAssetBypass();
  global.setInterval(installPaperAssetBypass, 1500);
})(window);
