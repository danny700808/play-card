# 新版排課系統（已移轉課務唯讀預覽）

這份修改以現有最新版為基礎，保留原本功能，新增接近音教雲操作方式的排課預覽。

## 本版包含

- 「課程日表」保留舊音教雲與新版排課兩個入口。
- 新版以 30 分鐘為一格、教室為欄，顯示固定課、單堂課、體驗課、教室租用、簽到、請假與缺席。
- 示範模式可測試新增排課、衝突檢查、簽到、繳費、老師獎勵／扣薪與基本設定。
- 輸入既有的音教雲手動同步密碼後，可載入移轉批次中的學生、繳費、老師、教室、科目、收費及排課資料。
- 已移轉資料模式為唯讀，不會新增、修改或刪除來源資料。

## 資料範圍

後端使用明確的課務白名單，只會讀取學生、學生繳費、老師、教室、科目、收費、固定課、單堂／體驗課、請假、老師獎勵／扣薪與教室租用。

商品、庫存、銷售、進貨、供應商、倉庫與平台訂單不在白名單中，新版排課頁面不會要求或顯示這些資料。

## 安裝順序

1. 將 ZIP 內檔案依原有資料夾位置覆蓋到最新版專案。
2. 先部署新函式：`firebase deploy --only functions:loadInjiaoyunEducationPreview`
3. 再將網頁檔案發布到目前的 GitHub Pages 流程。
4. 從營運中心進入「課程日表」→「新版排課系統」。
5. 按「載入已移轉課務資料」，輸入既有手動同步密碼後進行唯讀核對。

本版沿用既有 `INJIAOYUN_MANUAL_SYNC_PIN` Secret，不需要把密碼寫進程式或 GitHub。也不需要修改 Firestore Rules。

## ZIP 內檔案

- `course-scheduler.html`
- `course-scheduler-data.js`
- `operations-hub.html`
- `operations-phase1.js`
- `inventory-count.html`（保留前一階段已完成的手機盤點調整）
- `functions/index.js`
- `functions/injiaoyunEducationPreview.js`
- 本說明檔
