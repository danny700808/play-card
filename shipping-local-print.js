'use strict';
// Local PDFs stay on the packing PC. This module never requests a shipment.
(function () {
  const BASE = 'http://127.0.0.1:18182';
  const LAYOUT = 'packing-footer-v1';
  const SHEET = 'packing-sheet-v1';
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
  async function packingSheet(row) {
    window.ShippingModel.packingLabel(row);
    const grouped = new Map(), photos = new Map();
    for (const item of row.items) {
      const quantity = Number(row.stage === 'partial' ? item.remaining : item.quantity);
      if (!quantity) continue;
      const name = String(item.name || '').trim(), variant = String(item.variant || '').trim();
      const sku = window.ShippingModel.formatSku(item.sku), key = JSON.stringify([name, variant, sku]);
      if (grouped.has(key)) grouped.get(key).quantity += quantity;
      else grouped.set(key, {name, variant, sku, quantity, image: item.image || ''});
    }
    const items = [...grouped.values()];
    if (items.length > 120) throw Error('這筆訂單超過包貨明細的單次列印數量。');
    async function photo(url) {
      if (!url) return '';
      if (!photos.has(url)) photos.set(url, (async () => {
        if (!url.startsWith('https:')) throw Error('商品圖片網址不正確。');
        const response = await fetch(url, {credentials:'omit', referrerPolicy:'no-referrer', signal:AbortSignal.timeout(15000)});
        if (!response.ok) throw Error('商品圖片讀取失敗。');
        const blob = await response.blob();
        if (blob.size > 8 * 1024 * 1024) throw Error('商品圖片過大。');
        const image = await createImageBitmap(blob);
        try {
          const scale = Math.min(1, 600 / Math.max(image.width, image.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          const context = canvas.getContext('2d');
          context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/jpeg', .8).split(',')[1];
        } finally { image.close(); }
      })());
      return photos.get(url);
    }
    // Bound concurrent decoding; every supplied photo must be ready before paper is sent.
    for (let start = 0; start < items.length; start += 3) await Promise.all(items.slice(start, start + 3).map(async item => {
      try { item.imageBase64 = await photo(item.image); }
      catch { throw Error(`商品 ${item.sku || item.name} 的照片尚未讀取完成，尚未送印，請稍後再試。`); }
      delete item.image;
    }));
    return {version:SHEET, orderNo:row.orderNo, channel:row.channel, items,
      recipient:/^(未提供|未知|待確認|不提供|—|-|無)$/.test(String(row.recipient || '').trim())?'':String(row.recipient || '').trim(), buyer:String(row.buyerAccount || row.buyerUsername || '').trim(),
      carrier:String(row.carrier || ''), tracking:String(row.tracking || '')};
  }
  function attach(row, links, recordPrint, recordSubmitted, options = {}) {
    reset();
    if (!row || !links || !['MOMO', '蝦皮', '酷澎', '官網', 'LINE'].includes(row.channel)) {
      if(options.silent)throw Error('此訂單尚未提供可列印的貨運單。');
      return;
    }
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
    const postal = row.documentType === 'postal-address-v1' && shippingMethod === 'postal' && ['官網','LINE'].includes(row.channel);
    const printProfile = postal ? 'postal-address-v1' : momoStore ? 'momo-cvs-v1' : '';
    const prepareBody = () => ({channel: row.channel, pdfBase64,
      orderKey: row.key, orderNo: row.orderNo, tracking: row.tracking || '',
      packingFooter: window.ShippingModel.packingLabel(row),
      ...(sheet ? {packingSheet:sheet} : {}),
      ...(printProfile ? {printProfile, shippingMethod} : {})});
    function checkPrepared(job) {
      if (job.layoutVersion !== (postal ? printProfile : LAYOUT) || !job.preview?.startsWith('data:image/png;base64,'))
        throw Error('副機尚未回傳新版商品標籤與預覽，尚未送印。');
      if (options.packingSheet && (job.packingSheetVersion !== SHEET || job.packingPages !== Math.ceil(sheet.items.length / 3) ||
          !Number.isInteger(job.shippingPages) || job.shippingPages < 1 || job.pages !== job.packingPages + job.shippingPages))
        throw Error('包貨明細與貨運單尚未完整合併，尚未送印。');
      if (momoStore && (job.printProfile !== printProfile || (job.shippingPages ?? job.pages) !== 1 ||
          !Array.isArray(job.paperMm) || job.paperMm.length !== 2 || job.paperMm[0] !== 100 || job.paperMm[1] !== 150))
        throw Error('副機未回傳正確的超商單張版型，尚未送印。請更新副機列印助手。');
      if (postal && (job.printProfile !== printProfile || job.barcodeCount !== 0 ||
          !Array.isArray(job.paperMm) || job.paperMm.join(',') !== '100,150'))
        throw Error('副機未回傳正確的郵局寄件標籤，請更新列印助手。');
      return job;
    }
    function showPrepared(job) {
      if(options.silent)return;
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
    let pdfBase64, preparedJob, sheet, ready = false;
    const label = () => reprint ? '重印貨運單' : '列印貨運單';
    const active = () => generation === own && (options.silent ? options.isActive?.() !== false : $('documentDialog').open);
    button.textContent = label();
    button.disabled = true;
    currentButton = button;
    const status = document.createElement('p');
    status.className = 'muted';
    status.setAttribute('role', 'status');
    status.textContent = '檢查本機列印服務…';
    box.append(button, status);
    if(!options.silent)($('localPrintSlot') || $('documentControls')).prepend(box);
    function report(message){status.textContent=message;if(active())options.onStatus?.(message);}
    // Prepare without submitting paper. Resolve the persisted local print state
    // before enabling the action, so a reprint never needs a discovery click.
    async function preparePreview() {
      const result = await local('/health');
      if (!active()) return;
      if (result.service !== 'youzi-shipping-print') throw Error('本機連線服務不符。');
      if (!result.packingLayouts?.includes(LAYOUT))
        throw Error('副機列印助手需要更新商品標籤版型，尚未送印。');
      if (options.packingSheet && !result.packingSheets?.includes(SHEET))
        throw Error('副機列印助手需要更新包貨明細合併列印功能，尚未送印。');
      if (row.channel === 'MOMO' && carrierMethod && carrierMethod !== shippingMethod)
        throw Error('物流方式與列印版型不一致，請先重新讀取最新訂單。');
      if (postal && !result.printProfiles?.includes(printProfile))
        throw Error('副機列印助手需要更新郵局寄件標籤版型，尚未送印。');
      $('printerHint').textContent = postal ? '郵局寄件標籤 · 100 × 150 mm；郵件條碼由郵局交寄時提供。' : row.channel === 'MOMO'
        ? momoStore ? 'MOMO 超商單：單張原單，100 × 150 mm；底部放品名、貨號、數量。'
          : 'MOMO：左右雙聯共兩張 100 × 150 mm；第一張底部放商品資料，第二張底部留白。'
        : '100 × 150 mm；原單置中，底部放品名、貨號、數量。';
      if (momoStore && (!Array.isArray(result.printProfiles) || !result.printProfiles.includes(printProfile)))
        throw Error('副機列印助手需要更新 MOMO 超商單版型，尚未送印。');
      if (momoStore && !links.print)
        throw Error('主機尚未完成這張超商原單的版型與條碼核對，尚未送印。請重新讀取訂單。');
      report('正在準備貨運單，請等待…');
      pdfBase64 = await documentBase64(links.print || links.label);
      if (options.packingSheet) sheet = await packingSheet(row);
      if (!active()) return;
      preparedJob = checkPrepared(await local('/prepare', prepareBody()));
      if (!active()) return;
      if (!['prepared', 'preview', 'submitted'].includes(preparedJob.status))
        throw Error('這份單據正在處理或送印結果不明，請先查看印表機。');
      if (preparedJob.alreadySubmitted || preparedJob.status === 'submitted') reprint = true;
      showPrepared(preparedJob);
      ready = true;
      button.textContent = label();
      report(`貨運單已備妥，共 ${preparedJob.pages} 張。`);
    }
    let preparationError;
    const preparation = preparePreview().catch(error => {
      preparationError=error;
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
        if (!ready) {
          if(options.silent)throw preparationError||Error('貨運單尚未備妥，未送印。');
          await preparePreview();
        }
        if (!active() || !ready) return;
        // This explicit button click authorizes one copy, including a reprint.
        // Preparation and network retries never call /print automatically.
        report(reprint ? '正在準備重印，請等待…' : '正在準備列印，請等待…');
        let job = checkPrepared(await local('/prepare', {...prepareBody(), reprint}));
        if (!active()) return;
        if (job.status === 'submitted' && !reprint) {
          job = checkPrepared(await local('/prepare', {...prepareBody(), reprint: true}));
          if (!active()) return;
        }
        if (job.status !== 'prepared') throw Error('這份單據正在處理或送印結果不明，請先查看印表機。');
        showPrepared(job);
        report(`${postal?'寄件資料核對完成':'條碼檢查通過'}，正在送印 ${job.pages} 張…`);
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
        if(options.silent)throw Error(`訂單 ${row.orderNo} · ${phase}：${error.message}`);
      } finally {
        inFlight = false;
        if (currentButton) currentButton.disabled = false;
      }
    };
    return {print:button.onclick};
  }
  async function printDocument(row,links,recordSubmitted,options={}){
    if(inFlight)throw Error('另一張貨運單正在送印，請等待。');
    return attach(row,links,async()=>{},recordSubmitted,{...options,silent:true}).print();
  }
  window.YouziLocalPrint = {attach, reset, printDocument};
})();




