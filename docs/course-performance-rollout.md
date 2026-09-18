# 課務速度調整與區域整合

這批變更先縮小讀取量、減少重複工作，並準備額外台灣入口。它沒有搬移資料庫、修改 LINE 回呼網址、開啟常駐執行個體，或啟用全部台灣路由。

## 已確認的現況

依據 `aca1b5448f3785251d914e0807dd43c28529c430` 的程式，以及 2026-09-18 已登入 Firebase 正式後台的實際設定：

| 功能 | 目前程式路由 | 整合前需要確認 |
| --- | --- | --- |
| 老師週課表、可用時段、多數課務操作 | 台灣 `asia-east1`，後台已確認 | 本批四個新增老師入口尚未部署 |
| 管理課表、主要課務異動 | 台灣 `asia-east1` | 完整帳務與衝突查核維持相同資料來源 |
| 課務 LINE 登入及權杖交換 | 美國 `us-central1` | LINE Developers 登記的回呼網址、舊登入連結相容性 |
| 課務教室租用查詢 | 台灣 `asia-east1` | 租用建立、付款及取消入口仍需分別盤點 |
| 獨立租賃、商品／庫存、老師合約／個資等 | 多處明確指定美國 | HTTP、callable、簽名資產網址及外部整合一起核對 |
| Firestore `(default)` | **台灣 `asia-east1`**，Standard、Native | 不需要搬移主要資料庫 |
| Storage `youzi-c1b74.firebasestorage.app` | **美國 `US-EAST1`** | 若整合至台灣，需新建儲存桶、複製檔案、核對權限與既有連結後切換 |

美國與台灣端的 `coursePortal.js` 都使用相同 Firebase 專案的預設 Firestore API；不同程式入口本身不代表有兩份資料庫。此次區域證據來自 Firestore「查看資料庫詳細資料」、Storage 儲存桶選單及 Functions 完整清單，並非原始碼註解。Functions 當時共 197 個：台灣 36 個、美國 `us-central1` 161 個；這是已部署項目數，包含舊入口及背景工作，不等於前端實際使用比例。四個新增老師台灣入口尚未出現在正式清單。

核對頁面：[Storage](https://console.firebase.google.com/project/youzi-c1b74/storage/youzi-c1b74.firebasestorage.app/files)、[Functions](https://console.firebase.google.com/project/youzi-c1b74/functions)。

先前的「兩個月」是 `PORTAL_MAX_ADVANCE_MONTHS = 2` 的操作期限，不是一次預載兩個月歷史。

## 這批實作

- 老師週課表快取與薪資月份分開；切週先顯示快取並更新，閒置後僅預讀前後各一週。合併相同讀取，限制快取數量，寫入後只失效受影響日期；舊請求與舊帳號的結果不得覆蓋新狀態。
- 只繪製正在看的老師分頁。薪資查詢在資料庫端依老師與月份過濾，新增六個必要索引；管理者月份查詢維持全體老師。
- 每次請求仍檢查登入有效性與帳號綁定。使用時間／滑動期限寫入通常每五分鐘更新一次，近到期時立即延長。
- 課表可獨立的查詢並行執行，老師／占用查詢的單堂設定限制在日期範圍。網路或權限錯誤不再觸發整個集合掃描。
- 管理課表開頁先讀前週、本週、次週共 21 天的正式課程；使用既有取消、調課、固定課及占用計算。首次開明細、帳務或範圍外日期再讀完整資料。
- 部分課表保持唯讀、不覆蓋已保存的完整帳本；未讀取帳務時，未收款數量顯示省略符號。明細與寫入入口等待完整資料，範圍外日期顯示讀取狀態。
- 收據圖像元件延後使用時載入；操作計時不記錄姓名、帳號權杖、課程內容或金額，巢狀計時共用一筆紀錄。
- 新增四個老師台灣端點，`config.js` 的 `COURSE_PORTAL_TAIWAN_EXTENDED` **預設 false**。資料庫位置已核實；啟用前仍須確認新入口部署完成，不在錯誤後自動跨區重送寫入。
- 歷史七月薪資修補改成手動部署時明確勾選才執行，日常速度部署不連帶重跑舊帳務。健康檢查的公開紀錄與附件只保留筆數摘要，不輸出整份課務回應；結束後清除暫時權杖及原始回應檔。

## 部署順序

1. 已透過正式後台確認 Firestore、Storage 及函式區域。需要重新核對時，可在有既有 Firebase 專案權限的環境只讀取：

   ```sh
   firebase firestore:databases:get '(default)' --project youzi-c1b74
   firebase functions:list --project youzi-c1b74
   ```

   同時核對 Storage bucket 位置。只需記錄區域，勿把服務帳號金鑰或登入權杖貼入紀錄。

2. 保持擴充台灣路由旗標關閉。部署流程先建立索引並等到 READY，再部署後端。新的 `calendar-bootstrap` 範圍沿用現有管理者驗證；前端遇到未更新的舊後端時仍接收原有完整載入結果。
3. 確認新端點部署完成，使用各角色帳號驗證登入、切週、簽到、請假、調課、租用占用與取消、薪資、收退款、收據。核對實際讀取數量及暖機／首次呼叫時間，不能以單元測試時間當成正式加速幅度。
4. Firestore 已確認在 `asia-east1`；四個老師台灣入口部署並驗證後，可啟用擴充路由，同時更新 `config.js` 的版本參數。其他登入、租賃、合約、商品和庫存服務需要依入口逐項遷移；LINE 回呼需和供應商設定一同切換。定時通知與資料觸發器須確認冪等及切換順序，避免新舊兩份同時處理相同事件。
5. 檔案儲存整合另做遷移：先盤點檔案數量、大小、權限、簽名網址與資料庫中的連結，再建立台灣儲存桶、複製及驗證。Google Cloud 的直接 bucket relocation 目前不支援 Firebase bucket，見[官方相容性限制](https://docs.cloud.google.com/storage/docs/bucket-relocation/plan-bucket-relocation)。新舊檔案讀取須相容，切換成功前保留原儲存桶；本批不搬移或刪除檔案。此項涉及複製及跨區傳輸費，與後端常駐執行個體是不同費用。

LINE／Google 身分驗證、外部商店和圖片平台的基礎設施由供應商管理。「集中」應指我們可控制的主要處理程式與資料庫靠近，並非要求所有第三方服務都部署到同一台主機。

## 驗證

本機 Node.js 24：課務、老師端與教室租用共 299 項檢查通過；部署環境使用既有 Node.js 20。另已檢查 Functions 主模組能載入且六個相關台灣匯出使用 `asia-east1`，以及執行正式課表建置器並保留新版分段載入。

```sh
node --test tests/course*.js tests/course*.cjs tests/teacher*.js tests/teacher*.cjs tests/room-booking*.js tests/room-booking*.cjs
node .github/scripts/build-inline-course-workspace.cjs
git diff --check
```

新增測試涵蓋快取失效後舊結果晚到、帳號隔離、共用進行中請求、登入撤銷、月份查詢邊界、只讀取自己的薪資、管理者授權、課表版本衝突，以及部分資料不得覆蓋完整帳本。正式帳號操作與實際延遲仍需在部署時驗證。

參考：[Firebase 函式區域](https://firebase.google.com/docs/functions/locations)、[Firestore 位置限制](https://firebase.google.com/docs/firestore/locations)、[查看資料庫設定](https://firebase.google.com/docs/firestore/manage-databases)。
