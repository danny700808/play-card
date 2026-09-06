'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','operations-phase1.js'),'utf8');
const start=source.indexOf('function productListingCodexHandoffPrompt(');
const prompt=source.slice(start,source.indexOf('\n  function ',start+10));
test('V3 preflights actual image dimensions and bytes before freezing publication output',()=>{
 assert.match(prompt,/在建立 preparedSnapshot 與首次發布前，逐張讀取實際檔案/);
 for(const value of ['700px','32px','0.5～32','1,000,000 bytes','700×1000','1000×1000'])assert.ok(prompt.includes(value));
 assert.match(prompt,/使用 contain 保持內容比例，禁止以 fill 拉伸商品/);
 assert.match(prompt,/已存在 preparedSnapshot 時只保存相容輸出收據，不可覆寫快照/);
});
test('V3 rejects repeated wrong-texture seeds and retains the assigned style',()=>{
 assert.match(prompt,/不得繼續把該錯圖當下一次修圖底稿/);
 assert.match(prompt,/原始來源或已核對的 cleanMain/);
 assert.match(prompt,/沿用本案既定 styleId/);
 assert.match(prompt,/相同材質錯誤連續兩次/);
 assert.match(prompt,/image-qa-failed/);
});
test('V3 user pause permits offline tests but no new image generation or publication',()=>{
 assert.match(prompt,/使用者要求本件完成圖片後暫停/);
 assert.match(prompt,/不得為測試再產圖、重送平台或開下一件/);
 assert.match(prompt,/pausedByUser 與 resumeAfterUserRequest/);
 assert.match(prompt,/換模型不是新案件/);
 assert.match(prompt,/不重做合格圖片、不重建或重送 verified 通路/);
});
