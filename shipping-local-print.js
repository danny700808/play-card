'use strict';
// Local PDFs stay on the packing PC. This module never requests a shipment.
(function () {
  const BASE = 'http://127.0.0.1:18182';
  const LAYOUT = 'packing-footer-v1';
  let generation = 0, inFlight = false, currentButton = null;
  const $ = id => document.getElementById(id);
  async function local(path, body) {
    let response;
    try {
      response = await fetch(BASE + path, {
        method: body ? 'POST' : 'GET',
        headers: body ? {'Content-Type': 'application/json', 'X-Youzi-Print': '1'} : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120000), cache: 'no-store',
      });
    } catch {
      throw Error(path === '/print'
        ? '送印結果尚未確認。請先查看印表機，勿連續重按。'
        : '列印助手未連線；請在副機開啟助手，或從「更多」開啟原單。');
    }
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '本機列印未完成。');
    return result;
  }
  async function documentBase64(url) {
    const response = await fetch(url, {cache: 'no-store', signal: AbortSignal.timeout(60000)});
    if (!response.ok) throw Error('原單連結已失效，請關閉單據後重新開啟。');
    const blob = await response.blob();
    if (blob.size > 15 * 1024 * 1024) throw Error('原單超過本機列印大小限制。');
    const head = await blob.slice(0, 5).text();
    if (head !== '%PDF-') throw Error('這張原單是網頁格式，請使用「開啟原單列印」。');
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(Error('無法讀取原單。'));
      reader.readAsDataURL(blob);
    });
  }
  function reset() {
    generation++;
    $('localPrintControls')?.remove();
    currentButton = null;
  }
  function attach(row, links, recordPrint, recordSubmitted) {
    reset();
    if (!row || !links || !['MOMO', '蝦皮', '酷澎', '官網'].includes(row.channel)) return;
    const own = generation;
    const box = document.createElement('div');
    box.id = 'localPrintControls';
    box.className = 'local-print-controls';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary';
    const carrierMethod = /7-11/.test(row.carrier || '') ? 'seven' : /全家/.test(row.carrier || '') ? 'family' : '';
    const shippingMethod = row.shippingMethod || carrierMethod;
    const momoStore = row.channel === 'MOMO' && ['seven', 'family'].includes(shippingMethod);
    const printProfile = momoStore ? 'momo-cvs-v1' : '';
    const prepareBody = () => ({channel: row.channel, pdfBase64,
      orderKey: row.key, orderNo: row.orderNo, tracking: row.tracking || '',
      packingFooter: window.ShippingModel.packingLabel(row),
      ...(momoStore ? {printProfile, shippingMethod} : {})});
    function checkPrepared(job) {
      if (job.layoutVersion !== LAYOUT || !job.preview?.startsWith('data:image/png;base64,'))
        throw Error('副機尚未回傳新版商品標籤與預覽，尚未送印。');
      if (momoStore && (job.printProfile !== printProfile || job.pages !== 1 ||
          !Array.isArray(job.paperMm) || job.paperMm.length !== 2 || job.paperMm[0] !== 100 || job.paperMm[1] !== 150))
        throw Error('副機未回傳正確的超商單張版型，尚未送印。請更新副機列印助手。');
      return job;
    }
    function showPrepared(job) {
      const image = $('documentPreviewImage'), zoom = $('zoomDocumentPreview');
      if (!image || !zoom) return;
      image.src = job.preview; image.hidden = false; zoom.hidden = false;
      $('documentPlaceholder').hidden = true;
      $('previewCaption').hidden = false;
      $('previewCaption').textContent = `實際列印版面 · 100 × 150 mm · 共 ${job.pages} 張`;
      zoom.onclick = () => {
        $('largeImage').src = job.preview;
        $('largeImage').alt = '實際列印第一張預覽';
        $('imageTitle').textContent = '實際列印第一張預覽';
        $('imageDialog').showModal();
      };
    }
    let reprint = window.ShippingModel?.documentActionLabel(row) === '重印貨運單';
    let pdfBase64, preparedJob, ready = false;
    const label = () => reprint ? '重印貨運單' : '列印貨運單';
    const active = () => generation === own && $('documentDialog').open;
    button.textContent = label();
    button.disabled = true;
    currentButton = button;
    const status = document.createElement('p');
    status.className = 'muted';
    status.setAttribute('role', 'status');
    status.textContent = '檢查本機列印服務…';
    box.append(button, status);
    ($('localPrintSlot') || $('documentControls')).prepend(box);
    // Prepare without submitting paper. Resolve the persisted local print state
    // before enabling the action, so a reprint never needs a discovery click.
    async function preparePreview() {
      const result = await local('/health');
      if (!active()) return;
      if (result.service !== 'youzi-shipping-print') throw Error('本機連線服務不符。');
      if (!result.packingLayouts?.includes(LAYOUT))
        throw Error('副機列印助手需要更新商品標籤版型，尚未送印。');
      if (row.channel === 'MOMO' && carrierMethod && carrierMethod !== shippingMethod)
        throw Error('物流方式與列印版型不一致，請先重新讀取最新訂單。');
      $('printerHint').textContent = row.channel === 'MOMO'
        ? momoStore ? 'MOMO 超商單：單張原單，100 × 150 mm；底部放品名、貨號、數量。'
          : 'MOMO：左右雙聯共兩張 100 × 150 mm；第一張底部放商品資料，第二張底部留白。'
        : '100 × 150 mm；原單置中，底部放品名、貨號、數量。';
      if (momoStore && (!Array.isArray(result.printProfiles) || !result.printProfiles.includes(printProfile)))
        throw Error('副機列印助手需要更新 MOMO 超商單版型，尚未送印。');
      if (momoStore && !links.print)
        throw Error('主機尚未完成這張超商原單的版型與條碼核對，尚未送印。請重新讀取訂單。');
      status.textContent = '正在準備標籤與確認列印紀錄…';
      pdfBase64 = await documentBase64(links.print || links.label);
      if (!active()) return;
      preparedJob = checkPrepared(await local('/prepare', prepareBody()));
      if (!active()) return;
      if (!['prepared', 'preview', 'submitted'].includes(preparedJob.status))
        throw Error('這份單據正在處理或送印結果不明，請先查看印表機。');
      if (preparedJob.alreadySubmitted || preparedJob.status === 'submitted') reprint = true;
      showPrepared(preparedJob);
      ready = true;
      button.textContent = label();
      status.textContent = `新版標籤已備妥，共 ${preparedJob.pages} 張。`;
    }
    const preparation = preparePreview().catch(error => {
      if (active()) status.textContent = error.message;
    }).finally(() => {
      if (active()) button.disabled = inFlight;
    });
    button.onclick = async () => {
      if (inFlight) return;
      inFlight = true;
      button.disabled = true;
      let phase = '副機準備標籤';
      try {
        await preparation;
        if (!active()) return;
        if (!ready) await preparePreview();
        if (!active() || !ready) return;
        // This explicit button click authorizes one copy, including a reprint.
        // Preparation and network retries never call /print automatically.
        status.textContent = reprint ? '正在準備重印…' : '正在準備列印…';
        let job = checkPrepared(await local('/prepare', {...prepareBody(), reprint}));
        if (!active()) return;
        if (job.status === 'submitted' && !reprint) {
          job = checkPrepared(await local('/prepare', {...prepareBody(), reprint: true}));
          if (!active()) return;
        }
        if (job.status !== 'prepared') throw Error('這份單據正在處理或送印結果不明，請先查看印表機。');
        showPrepared(job);
        status.textContent = `條碼檢查通過，正在送印 ${job.pages} 張…`;
        phase = '副機送交印表機';
        const result = await local('/print', {jobId: job.jobId});
        if (result.status !== 'submitted') throw Error('送印結果不明，請先查看印表機。');
        // Submitted to Windows is not proof that labels physically printed.
        if (generation === own) {
          status.textContent = `已送出 ${job.pages} 張，正在更新處理紀錄…`;
          reprint = true;
          button.textContent = '重印貨運單';
        }
        phase = '保存送印紀錄（已送出，請勿重複列印）';
        await (recordSubmitted || recordPrint)();
      } catch (error) {
        if (generation === own) status.textContent = `訂單 ${row.orderNo} · ${phase}：${error.message}`;
      } finally {
        inFlight = false;
        if (currentButton) currentButton.disabled = false;
      }
    };
  }
  window.YouziLocalPrint = {attach, reset};
})();



