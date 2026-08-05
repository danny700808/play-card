(function (global) {
  'use strict';

  if (global.__YZ_OPERATIONS_SYNC_ANOMALY_RECHECK_V1__) return;
  global.__YZ_OPERATIONS_SYNC_ANOMALY_RECHECK_V1__ = true;

  const COLLECTIONS = {
    products: 'opsInternalProducts',
    inventoryQueue: 'opsPlatformInventoryQueue',
    syncRequests: 'opsPlatformSyncRequests',
    audit: 'opsAuditLogs'
  };
  const PLATFORMS = ['EasyStore', 'MOMO', 'Coupang'];
  const RESULT_KEY = 'youzi_sync_anomaly_recheck_result_v1';
  let running = false;
  let enhanceTimer = 0;

  function clean(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function lower(value) {
    return clean(value).toLowerCase();
  }

  function escapeHtml(value) {
    return clean(value).replace(/[&<>"']/g, function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char];
    });
  }

  function numberOrNull(value) {
    if (value === '' || value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function firstValue(object, keys) {
    object = object || {};
    for (const key of keys) {
      if (object[key] !== undefined && object[key] !== null && clean(object[key])) return object[key];
    }
    return '';
  }

  function serverTimestamp() {
    return global.firebase.firestore.FieldValue.serverTimestamp();
  }

  function deleteField() {
    return global.firebase.firestore.FieldValue.delete();
  }

  function currentUserLabel() {
    try {
      const user = global.firebase.auth && global.firebase.auth().currentUser;
      return clean(user && (user.displayName || user.email || user.uid)) || '管理者';
    } catch (_) {
      return '管理者';
    }
  }

  async function waitForDb() {
    const started = Date.now();
    while (Date.now() - started < 15000) {
      if (global.firebase && global.firebase.apps && global.firebase.apps.length && global.firebase.firestore) {
        return global.firebase.firestore();
      }
      await new Promise(function (resolve) { global.setTimeout(resolve, 120); });
    }
    throw new Error('營運資料庫尚未完成載入，請重新整理後再試。');
  }

  function installStyles() {
    if (document.getElementById('opsSyncAnomalyRecheckStylesV1')) return;
    const style = document.createElement('style');
    style.id = 'opsSyncAnomalyRecheckStylesV1';
    style.textContent = '' +
      '.ops-anomaly-recheck-toolbar{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin:14px 0 18px;padding:15px 16px;border:1px solid #c9ded2;border-radius:15px;background:#f2faf5}' +
      '.ops-anomaly-recheck-toolbar b{display:block;color:#173247;margin-bottom:4px}' +
      '.ops-anomaly-recheck-toolbar p{margin:0;color:#52685c;font-size:13px;line-height:1.65}' +
      '.ops-anomaly-recheck-toolbar .ops-button{flex:0 0 auto}' +
      '.ops-anomaly-guide{margin-top:10px;padding:11px 12px;border-radius:12px;background:#fff8df;border:1px solid #ead487;color:#5f4a00;font-size:13px;line-height:1.65}' +
      '.ops-anomaly-guide b{display:inline;color:#4c3b00}' +
      '.ops-anomaly-guide span{display:block}' +
      '.ops-anomaly-recheck-result{margin-top:9px;padding:9px 11px;border-radius:10px;font-size:13px;font-weight:800;line-height:1.55}' +
      '.ops-anomaly-recheck-result.ok{background:#e8f8ee;color:#146c43;border:1px solid #a7d8b8}' +
      '.ops-anomaly-recheck-result.bad{background:#fff0f0;color:#b42318;border:1px solid #efb3b3}' +
      '.ops-anomaly-recheck-button.is-working{opacity:.72;pointer-events:none}' +
      '@media(max-width:680px){.ops-anomaly-recheck-toolbar{display:block}.ops-anomaly-recheck-toolbar .ops-button{width:100%;margin-top:12px}.ops-sync-anomaly-actions .ops-anomaly-recheck-button{width:100%;margin-top:8px}}';
    document.head.appendChild(style);
  }

  function platformFromIssue(issue) {
    const text = clean(issue && issue.textContent);
    return PLATFORMS.find(function (platform) { return text.includes(platform); }) || '';
  }

  function kindFromIssue(issue) {
    const head = issue && issue.querySelector('.ops-sync-platform-issue-head');
    const text = clean(head && head.textContent);
    return text.includes('價格') ? 'price' : 'inventory';
  }

  function guidanceFor(reason, message, kind, platform, sku) {
    const text = lower([reason, message].join(' '));
    const code = clean(sku) || '未設定';

    if (text.includes('sku') || text.includes('商品代碼') || text.includes('規格代碼') || text.includes('找不到') || text.includes('not found') || text.includes('unmapped') || text.includes('no match')) {
      return {
        cause: '目前商品編號／規格編號無法和 ' + (platform || '平台') + ' 的商品資料對上。',
        fix: '進入商品資訊確認 SKU「' + code + '」是否完整、唯一，而且與平台商品或規格代碼一致；儲存後再按「重新檢查這項」。'
      };
    }
    if (text.includes('unauthorized') || text.includes('forbidden') || text.includes('401') || text.includes('403') || text.includes('權限') || text.includes('授權')) {
      return {
        cause: (platform || '平台') + ' 的授權已失效，或目前帳號沒有' + (kind === 'price' ? '改價' : '更新庫存') + '權限。',
        fix: '先重新連接平台授權或確認 API 權限，再按「重新檢查這項」。商品編號本身不一定有錯。'
      };
    }
    if (text.includes('timeout') || text.includes('timed out') || text.includes('逾時')) {
      return {
        cause: '上次連線到 ' + (platform || '平台') + ' 時超過等待時間。',
        fix: '通常不必修改商品；確認店內同步電腦與網路正常後，直接重新檢查即可。'
      };
    }
    if (text.includes('rate limit') || text.includes('too many requests') || text.includes('429') || text.includes('次數受限')) {
      return {
        cause: (platform || '平台') + ' 暫時限制 API 呼叫次數。',
        fix: '稍等幾分鐘再重新檢查；不需要因為這個訊息修改商品編號。'
      };
    }
    if (text.includes('unsupported') || text.includes('不支援') || text.includes('manual-required') || text.includes('手動')) {
      return {
        cause: '目前同步程式無法直接完成這個平台操作。',
        fix: '依訊息到平台後台手動處理；完成後可重新檢查，確認異常是否已解除。'
      };
    }
    if (kind === 'price' && (text.includes('價格') || text.includes('price') || text.includes('售價'))) {
      return {
        cause: (platform || '平台') + ' 拒絕目前設定的售價或價格格式。',
        fix: '到商品資訊確認該平台售價；酷澎價格需符合 10 元倍數等平台規則，修正後再重新檢查。'
      };
    }
    if (text.includes('結果不完整') || text.includes('沒有留下平台明細')) {
      return {
        cause: '上次同步沒有留下完整的平台回應，因此系統無法判斷真正失敗點。',
        fix: '直接重新檢查一次；若仍出現，請確認店內同步電腦的執行狀態。'
      };
    }
    return {
      cause: clean(reason) || '平台回傳未明錯誤。',
      fix: '先查看下方原始訊息，修正商品或平台設定後，再按「重新檢查這項」。'
    };
  }

  function issueMeta(issue) {
    const action = issue.querySelector('.ops-sync-anomaly-actions [data-id], .ops-sync-anomaly-actions [data-sku]');
    const body = issue.querySelector('.ops-sync-platform-issue-body');
    const reasonNode = body && body.querySelector('strong');
    const messageNode = body && body.querySelector('p');
    return {
      issue: issue,
      productId: clean(action && action.dataset.id),
      sku: clean(action && action.dataset.sku),
      platform: platformFromIssue(issue),
      kind: kindFromIssue(issue),
      reason: clean(reasonNode && reasonNode.textContent),
      message: clean(messageNode && messageNode.textContent)
    };
  }

  function setInlineResult(issue, message, ok) {
    let box = issue.querySelector('.ops-anomaly-recheck-result');
    if (!box) {
      box = document.createElement('div');
      box.className = 'ops-anomaly-recheck-result';
      const body = issue.querySelector('.ops-sync-platform-issue-body') || issue;
      body.appendChild(box);
    }
    box.className = 'ops-anomaly-recheck-result ' + (ok ? 'ok' : 'bad');
    box.textContent = message;
  }

  function enhanceIssue(issue) {
    if (!issue || issue.dataset.anomalyRecheckReady === '1') return;
    issue.dataset.anomalyRecheckReady = '1';
    const meta = issueMeta(issue);
    const body = issue.querySelector('.ops-sync-platform-issue-body');
    const actions = issue.querySelector('.ops-sync-anomaly-actions');
    if (!body || !actions) return;

    const guidance = guidanceFor(meta.reason, meta.message, meta.kind, meta.platform, meta.sku);
    const guide = document.createElement('div');
    guide.className = 'ops-anomaly-guide';
    guide.innerHTML = '<span><b>發生原因：</b>' + escapeHtml(guidance.cause) + '</span>' +
      '<span><b>修正方式：</b>' + escapeHtml(guidance.fix) + '</span>';
    body.appendChild(guide);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ops-button small ghost ops-anomaly-recheck-button';
    button.dataset.anomalyRecheck = 'one';
    button.textContent = '重新檢查這項';
    actions.appendChild(button);
  }

  function enhancePanel(panel) {
    if (!panel) return;
    panel.querySelectorAll('.ops-sync-platform-issue').forEach(enhanceIssue);
    if (panel.dataset.anomalyRecheckToolbar === '1') return;
    panel.dataset.anomalyRecheckToolbar = '1';

    const list = panel.querySelector('.ops-sync-anomaly-list');
    if (!list) return;
    const toolbar = document.createElement('div');
    toolbar.className = 'ops-anomaly-recheck-toolbar';
    toolbar.innerHTML = '<div><b>修正後可以重新檢查</b><p>系統會使用最新商品編號、庫存與平台售價重新排程同步。已符合條件的項目會離開異常清單；若平台再次回報失敗，會帶著新的原因重新出現。這個動作只重送庫存或售價，不會再次扣除中央庫存。</p></div>' +
      '<button type="button" class="ops-button primary" data-anomaly-recheck="all">重新檢查全部異常</button>';
    panel.insertBefore(toolbar, list);
  }

  function scheduleEnhance() {
    global.clearTimeout(enhanceTimer);
    enhanceTimer = global.setTimeout(function () {
      document.querySelectorAll('.ops-platform-error-panel').forEach(enhancePanel);
    }, 30);
  }

  async function findProduct(db, productId, sku) {
    if (productId) {
      const snap = await db.collection(COLLECTIONS.products).doc(productId).get();
      if (snap.exists) return { id: snap.id, ref: snap.ref, data: snap.data() || {} };
    }

    const normalizedSku = clean(sku);
    if (!normalizedSku) throw new Error('這筆異常沒有商品編號，請先進入商品資訊補上唯一 SKU。');

    let snap = await db.collection(COLLECTIONS.products).where('internalSku', '==', normalizedSku).limit(3).get();
    if (snap.empty) snap = await db.collection(COLLECTIONS.products).where('sku', '==', normalizedSku).limit(3).get();
    if (snap.empty) throw new Error('商品主檔仍找不到 SKU「' + normalizedSku + '」，請先新增或修正商品編號。');
    if (snap.size > 1) throw new Error('SKU「' + normalizedSku + '」對應到多個商品，請先處理重複編號。');
    const doc = snap.docs[0];
    return { id: doc.id, ref: doc.ref, data: doc.data() || {} };
  }

  async function verifyUniqueSku(db, product) {
    const sku = clean(firstValue(product.data, ['internalSku', 'sku', 'productCode']));
    if (!sku) throw new Error('商品主檔目前仍沒有 SKU，請先填寫商品編號再重新檢查。');

    const matches = await db.collection(COLLECTIONS.products).where('internalSku', '==', sku).limit(3).get();
    const other = matches.docs.filter(function (doc) { return doc.id !== product.id; });
    if (other.length) throw new Error('SKU「' + sku + '」目前被多個商品使用，請先修正成唯一編號。');
    return sku;
  }

  function productName(data) {
    return clean(firstValue(data, ['internalName', 'originalName', 'name', 'productName'])) || '未命名商品';
  }

  async function requestInventoryRetry(db, meta, product, sku) {
    const queueRef = db.collection(COLLECTIONS.inventoryQueue).doc(product.id);
    const queueSnap = await queueRef.get();
    const queue = queueSnap.exists ? (queueSnap.data() || {}) : {};
    const stock = Math.max(0, Number(firstValue(product.data, ['currentStock', 'openingStock', 'stock']) || 0));
    const requestRef = db.collection(COLLECTIONS.syncRequests).doc();
    const auditRef = db.collection(COLLECTIONS.audit).doc();
    const timestamp = serverTimestamp();
    const operator = currentUserLabel();
    const batch = db.batch();

    batch.set(queueRef, {
      productId: product.id,
      sku: sku,
      productName: productName(product.data),
      targetStock: stock,
      status: 'pending',
      lastAttemptStatus: 'pending',
      results: {},
      reason: 'manual-anomaly-recheck',
      retryRequestedAt: timestamp,
      retryRequestedBy: operator,
      previousErrorSnapshot: {
        lastAttemptStatus: clean(queue.lastAttemptStatus),
        lastAttemptAt: queue.lastAttemptAt || '',
        results: queue.results && typeof queue.results === 'object' ? queue.results : {}
      },
      resolvedAt: deleteField(),
      resolvedBy: deleteField(),
      updatedAt: timestamp,
      updatedBy: operator,
      version: '2026.08.05-sync-anomaly-recheck-v1'
    }, { merge: true });

    batch.set(requestRef, {
      requestId: requestRef.id,
      status: 'pending',
      reason: 'manual-anomaly-recheck',
      productIds: [product.id],
      platforms: meta.platform ? [meta.platform] : [],
      retryKinds: ['inventory'],
      requestedAt: timestamp,
      requestedBy: operator,
      source: 'operations-sync-anomaly-recheck',
      version: '2026.08.05-sync-anomaly-recheck-v1'
    });

    batch.set(auditRef, {
      action: 'platform-sync-anomaly-recheck',
      entityType: 'product',
      entityId: product.id,
      summary: '重新檢查庫存同步異常：' + (meta.platform || '平台未辨識') + '／SKU ' + sku,
      createdAt: timestamp,
      createdBy: operator,
      version: '2026.08.05-sync-anomaly-recheck-v1'
    });

    await batch.commit();
  }

  function priceField(platform) {
    return platform === 'EasyStore' ? 'easyStorePrice' : platform === 'MOMO' ? 'momoPrice' : platform === 'Coupang' ? 'coupangPrice' : '';
  }

  async function requestPriceRetry(db, meta, product, sku) {
    if (!meta.platform || !PLATFORMS.includes(meta.platform)) {
      throw new Error('這筆價格異常沒有可辨識的平台，請先查看原始錯誤訊息。');
    }
    const field = priceField(meta.platform);
    const price = numberOrNull(product.data[field]);
    if (price == null || price < 0) throw new Error(meta.platform + ' 售價尚未設定，請先到商品資訊補上售價。');
    if (meta.platform === 'Coupang' && (!Number.isInteger(price) || price % 10 !== 0)) {
      throw new Error('酷澎售價必須是 10 元倍數，請先修改商品價格。');
    }

    const currentSync = product.data.platformPriceSync && typeof product.data.platformPriceSync === 'object'
      ? product.data.platformPriceSync : {};
    const currentPlatform = currentSync[meta.platform] && typeof currentSync[meta.platform] === 'object'
      ? currentSync[meta.platform] : {};
    const requestRef = db.collection(COLLECTIONS.syncRequests).doc();
    const auditRef = db.collection(COLLECTIONS.audit).doc();
    const timestamp = serverTimestamp();
    const operator = currentUserLabel();
    const batch = db.batch();
    const update = {
      updatedAt: timestamp,
      updatedBy: operator,
      version: '2026.08.05-sync-anomaly-recheck-v1'
    };
    update['platformPriceSync.' + meta.platform] = Object.assign({}, currentPlatform, {
      targetPrice: price,
      status: 'pending',
      message: '已重新檢查，等待平台價格同步',
      requestedAt: timestamp,
      retryRequestedAt: timestamp,
      retryRequestedBy: operator
    });
    update['platformPriceSync.lastUpdatedAt'] = timestamp;
    batch.update(product.ref, update);

    batch.set(requestRef, {
      requestId: requestRef.id,
      status: 'pending',
      reason: 'manual-price-anomaly-recheck',
      productIds: [product.id],
      platforms: [meta.platform],
      retryKinds: ['price'],
      requestedAt: timestamp,
      requestedBy: operator,
      source: 'operations-sync-anomaly-recheck',
      version: '2026.08.05-sync-anomaly-recheck-v1'
    });

    batch.set(auditRef, {
      action: 'platform-price-anomaly-recheck',
      entityType: 'product',
      entityId: product.id,
      summary: '重新檢查價格同步異常：' + meta.platform + '／SKU ' + sku + '／目標售價 ' + price,
      createdAt: timestamp,
      createdBy: operator,
      version: '2026.08.05-sync-anomaly-recheck-v1'
    });

    await batch.commit();
  }

  async function recheckMeta(meta) {
    const db = await waitForDb();
    const product = await findProduct(db, meta.productId, meta.sku);
    const sku = await verifyUniqueSku(db, product);
    if (meta.kind === 'price') await requestPriceRetry(db, meta, product, sku);
    else await requestInventoryRetry(db, meta, product, sku);
    return { productId: product.id, sku: sku, platform: meta.platform, kind: meta.kind };
  }

  function showToast(title, message, type) {
    const stack = document.getElementById('opsToastStack');
    if (!stack) return;
    const item = document.createElement('div');
    item.className = 'ops-toast ' + (type || '');
    item.innerHTML = '<b>' + escapeHtml(title) + '</b><span>' + escapeHtml(message || '') + '</span>';
    stack.appendChild(item);
    global.setTimeout(function () { item.remove(); }, 5200);
  }

  function saveReloadResult(message, type) {
    try {
      global.sessionStorage.setItem(RESULT_KEY, JSON.stringify({ message: message, type: type || 'ok' }));
    } catch (_) {}
  }

  function restoreReloadResult() {
    try {
      const raw = global.sessionStorage.getItem(RESULT_KEY);
      if (!raw) return;
      global.sessionStorage.removeItem(RESULT_KEY);
      const result = JSON.parse(raw);
      global.setTimeout(function () {
        showToast(result.type === 'ok' ? '重新檢查完成' : '重新檢查結果', result.message, result.type === 'ok' ? '' : 'error');
      }, 900);
    } catch (_) {}
  }

  async function runOne(button) {
    if (running) return;
    const issue = button.closest('.ops-sync-platform-issue');
    if (!issue) return;
    running = true;
    const oldText = button.textContent;
    button.disabled = true;
    button.classList.add('is-working');
    button.textContent = '重新檢查中…';
    setInlineResult(issue, '正在讀取最新商品編號與同步設定…', true);

    try {
      await recheckMeta(issueMeta(issue));
      setInlineResult(issue, '已使用最新商品資料重新排程。若平台同步成功，這項異常會維持消失；若仍失敗，會顯示新的原因。', true);
      saveReloadResult('已重新排程 1 項平台同步異常。', 'ok');
      global.setTimeout(function () { global.location.reload(); }, 900);
    } catch (error) {
      setInlineResult(issue, clean(error && error.message) || '重新檢查失敗。', false);
      showToast('仍需修正', clean(error && error.message), 'error');
      button.disabled = false;
      button.classList.remove('is-working');
      button.textContent = oldText;
      running = false;
    }
  }

  async function runAll(button) {
    if (running) return;
    const panel = button.closest('.ops-platform-error-panel');
    const issues = panel ? Array.from(panel.querySelectorAll('.ops-sync-platform-issue')) : [];
    if (!issues.length) return;

    running = true;
    const metas = [];
    const seen = new Set();
    issues.forEach(function (issue) {
      const meta = issueMeta(issue);
      const key = [meta.kind, meta.productId || meta.sku, meta.platform].join('|');
      if (!seen.has(key)) {
        seen.add(key);
        metas.push(meta);
      }
    });

    const oldText = button.textContent;
    button.disabled = true;
    const successes = [];
    const failures = [];
    for (let index = 0; index < metas.length; index += 1) {
      button.textContent = '重新檢查 ' + (index + 1) + ' / ' + metas.length;
      const meta = metas[index];
      setInlineResult(meta.issue, '正在讀取最新商品資料…', true);
      try {
        await recheckMeta(meta);
        successes.push(meta);
        setInlineResult(meta.issue, '已重新排程，等待平台同步。', true);
      } catch (error) {
        const message = clean(error && error.message) || '重新檢查失敗。';
        failures.push({ meta: meta, message: message });
        setInlineResult(meta.issue, message, false);
      }
    }

    if (successes.length) {
      const message = '已重新排程 ' + successes.length + ' 項；' + (failures.length ? failures.length + ' 項仍需修正。' : '目前全部異常已重新檢查。');
      saveReloadResult(message, failures.length ? 'warning' : 'ok');
      global.setTimeout(function () { global.location.reload(); }, 1200);
      return;
    }

    button.disabled = false;
    button.textContent = oldText;
    running = false;
    showToast('尚未送出重新同步', failures.length + ' 項都仍需先修正商品或平台設定。', 'error');
  }

  document.addEventListener('click', function (event) {
    const button = event.target && event.target.closest ? event.target.closest('[data-anomaly-recheck]') : null;
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.dataset.anomalyRecheck === 'all') runAll(button);
    else runOne(button);
  }, true);

  installStyles();
  const root = document.getElementById('opsContent') || document.body;
  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(root, { childList: true, subtree: true });
  scheduleEnhance();
  restoreReloadResult();
})(window);
