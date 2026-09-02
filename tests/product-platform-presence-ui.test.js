const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'operations-phase1.js'), 'utf8');

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  let depth = 0;
  let opened = false;
  for (let index = source.indexOf('{', start); index < source.length; index += 1) {
    if (source[index] === '{') { depth += 1; opened = true; }
    if (source[index] === '}') depth -= 1;
    if (opened && depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body was not closed`);
}

test('商品資訊放寬所有 SKU 開頭，只排除沒有商品編號的資料', () => {
  const skuGuard = functionBody('hasListingSku');
  assert.match(skuGuard, /!!normalizeCode\(value\)/);
  assert.doesNotMatch(skuGuard, /\[159\]/);
  assert.match(functionBody('productFiltered'), /if\(!hasListingSku\(p\.sku\)\)return false/);
  assert.doesNotMatch(functionBody('openProductListingCase'), /只有 1、5、9 開頭/);
  assert.match(functionBody('openProductListingCase'), /這筆中央商品沒有 SKU/);
});

test('四平台狀態顯示有、沒有或審核中，並提供對應處理', () => {
  const body = functionBody('productPlatformStatusHtml');
  assert.match(body, /clean\(p&&p\.sku\)\.startsWith\('0'\).*return ''/s);
  assert.match(body, />有<\/i>/);
  assert.match(body, />沒有<\/i>/);
  assert.match(body, /pendingLabel=status\.status==='pending-review'\?'審核中'/);
  assert.match(body, /data-action="product-platform-recheck"/);
  assert.match(body, /data-action="product-platform-missing"/);
  assert.match(body, /data-action="product-platform-status-edit"/);
  assert.match(functionBody('handleAction'), /product-platform-missing.*openProductListingCase/);
  assert.match(functionBody('handleAction'), /product-platform-recheck.*startProductPlatformAudit/);
});

test('通路檢測保留缺貨與一般下架，違規與未通過仍判定沒有', () => {
  const statusBody = functionBody('productPlatformStatus');
  const presenceBody = functionBody('productPlatformPresence');
  const invalidBody = functionBody('productPlatformStatusIsInvalid');
  assert.match(statusBody, /mappingId&&status==='unknown'/);
  assert.doesNotMatch(statusBody, /\['unknown','queued','pending-review','draft'\]/);
  assert.match(invalidBody, /\['missing','restricted','rejected','error'\]/);
  assert.match(invalidBody, /違規/);
  assert.match(presenceBody, /productPlatformStatusIsInvalid\(row\)/);
  assert.match(presenceBody, /'pending-review','draft','inactive'/);
  assert.match(presenceBody, /缺貨或正常下架仍保留/);
  assert.doesNotMatch(presenceBody, /key==='shopee'/);
  assert.doesNotMatch(presenceBody, /inferredFrom:'官網同步'/);
});

test('商品資訊提供完整四平台檢測按鈕與一次授權的 Codex 交接', () => {
  const render = functionBody('renderProducts');
  const prompt = functionBody('productPlatformAuditPrompt');
  const start = functionBody('startProductPlatformAudit');
  assert.match(render, /data-action="product-platform-audit">檢測全部網路商品/);
  assert.doesNotMatch(render, /product-platform-published-audit|重查已送出／審核中/);
  assert.match(prompt, /EasyStore 官網、EasyStore 官方蝦皮通路、MOMO 店\+商品管理、Coupang Wing/);
  assert.match(prompt, /缺貨、庫存 0/);
  assert.match(prompt, /違規、受限制、審核未通過/);
  assert.match(prompt, /合併商品必須展開規格確認每個原廠 SKU/);
  assert.match(prompt, /送審後 24 小時/);
  assert.match(prompt, /第二次重查時間為送審後 48 小時/);
  assert.match(start, /同意並開始檢測/);
  assert.match(start, /noSecondConfirmation:true/);
  assert.match(start, /productListingCodexThreadUrl\(prompt\)/);
  assert.match(functionBody('handleAction'), /product-platform-audit.*startProductPlatformAudit/);
  assert.match(functionBody('handleAction'), /product-platform-published-audit.*publishedOnly:true/);
});

test('已完成上架案件再次開啟時只保留目前 SKU，不延續舊合併清單', () => {
  const completed = functionBody('productListingCaseIsCompleted');
  const reset = functionBody('resetCompletedProductListingCase');
  const open = functionBody('openProductListingCase');
  const form = functionBody('productListingCaseFormHtml');
  assert.match(completed, /caseStatus\)==='published'/);
  assert.match(completed, /publishState\.currentStage\)==='completed'/);
  assert.match(reset, /listingIntent='update-existing'/);
  assert.match(reset, /variantGroupEnabled=false/);
  assert.match(reset, /variantGroupItems=\[\]/);
  assert.match(reset, /variantParentProductId=''/);
  assert.match(open, /productListingCaseIsCompleted\(raw\).*resetCompletedProductListingCase\(row\)/s);
  assert.match(form, /本次已回到單一商品修改狀態/);
});

test('圖片模式商品卡只顯示原始品名，不顯示網路名稱摘要', () => {
  const body = functionBody('productCard');
  assert.match(body, /originalName\|\|p\.name\|\|p\.onlineName/);
  assert.doesNotMatch(body, /網路：/);
  assert.doesNotMatch(body, /onlineSummary/);
  assert.equal(source.includes('function abbreviatedOnlineProductName('), false);
});

test('商品卡只保留列印條碼與準備上架操作', () => {
  for (const name of ['productCard', 'productTextRow']) {
    const body = functionBody(name);
    assert.match(body, /product-print-label/);
    assert.match(body, /product-listing-case-open/);
    assert.doesNotMatch(body, /product-platform-status-open/);
    assert.doesNotMatch(body, /product-listing-variant-open/);
  }
});

test('商品搜尋列不再顯示平台狀態篩選', () => {
  const body = functionBody('renderProducts');
  assert.doesNotMatch(body, /productPlatformFilter/);
  assert.match(body, /productSearch/);
  assert.match(body, /product-display-mode/);
});
