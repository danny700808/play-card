'use strict';
// Local PDFs stay on the packing PC. This module never requests a shipment.
(function () {
  const BASE = 'http://127.0.0.1:18182';
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
        : '無法連接這台電腦的列印服務；可先使用「開啟原單列印」。');
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
  function attach(row, links, recordPrint) {
    reset();
    if (!row || !links || !['MOMO', '蝦皮', '酷澎', '官網'].includes(row.channel)) return;
    const own = generation;
    const box = document.createElement('div');
    box.id = 'localPrintControls';
    box.style.cssText = 'margin:12px 0;padding:12px;border:1px solid #d4dfd6;border-radius:10px';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary';
    const momoStore = row.channel === 'MOMO' && /7-11|全家/.test(row.carrier || '');
    const printLabel = row.channel === 'MOMO' && !momoStore ? '用 XP-420B 印兩張貼紙' : '用 XP-420B 列印';
    button.textContent = printLabel;
    button.disabled = inFlight;
    currentButton = button;
    const status = document.createElement('p');
    status.className = 'muted';
    status.setAttribute('role', 'status');
    status.textContent = '檢查本機列印服務…';
    box.append(button, status);
    $('documentControls').prepend(box);
    local('/health').then(result => {
      if (generation !== own) return;
      if (result.service !== 'youzi-shipping-print') throw Error('本機連線服務不符。');
      status.textContent = 'XP-420B · 100 × 150 mm · 已連線';
      $('printerHint').textContent = row.channel === 'MOMO'
        ? momoStore ? 'MOMO 超商單：使用單張原單版型，由副機助手核對後列印。'
          : 'MOMO：自動將已支援的左右雙聯原單拆成兩張 100 × 150 mm 貼紙。'
        : '使用 XP-420B 的 100 × 150 mm 標籤紙。';
    }).catch(error => { if (generation === own) status.textContent = error.message; });
    let reprint = false;
    button.onclick = async () => {
      if (inFlight) return;
      if (reprint && !window.confirm('這份貨運單已送印。確定要再印一份嗎？')) return;
      inFlight = true;
      button.disabled = true;
      let phase = '讀取原貨運單';
      try {
        status.textContent = '讀取既有貨運單並檢查條碼…';
        const pdfBase64 = await documentBase64(links.print || links.label);
        if (generation !== own || !$('documentDialog').open) return;
        phase = '副機準備標籤';
        const job = await local('/prepare', {channel: row.channel, pdfBase64, reprint});
        if (generation !== own || !$('documentDialog').open) return;
        if (job.status === 'submitted') {
          status.textContent = '這份原單已送印。如需補印，請按「重新列印」。';
          reprint = true;
          button.textContent = '重新列印';
          return;
        }
        if (job.status !== 'prepared') throw Error('這份單據正在處理或送印結果不明，請先查看印表機。');
        status.textContent = `條碼檢查通過，正在送印 ${job.pages} 張…`;
        phase = '副機送交印表機';
        const result = await local('/print', {jobId: job.jobId});
        if (result.status !== 'submitted') throw Error('送印結果不明，請先查看印表機。');
        // Submitted to Windows is not proof that labels physically printed.
        if (generation === own) {
          status.textContent = `已送出 ${job.pages} 張。確認出紙後，再按「已印好，標記已印單」。`;
          reprint = true;
          button.textContent = '重新列印';
        }
        await recordPrint();
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
