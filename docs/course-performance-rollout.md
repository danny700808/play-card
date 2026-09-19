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

Storage 用量頁當時顯示約 **1.74 GB、4,187 個物件**；這是後台顯示的用量摘要，尚未逐一核對每個檔案的 checksum。此盤點沒有下載或搬移任何合約、個資或照片。

先前的「兩個月」是 `PORTAL_MAX_ADVANCE_MONTHS = 2` 的操作期限，不是一次預載兩個月歷史。

## 這批實作

- 老師週課表快取與薪資月份分開；切週先顯示快取並更新，閒置後僅預讀前後各一週。合併相同讀取，限制快取數量，寫入後只失效受影響日期；舊請求與舊帳號的結果不得覆蓋新狀態。
- 只繪製正在看的老師分頁。薪資查詢在資料庫端依老師與月份過濾，新增六個必要索引；管理者月份查詢維持全體老師。
- 每次請求仍檢查登入有效性與帳號綁定。使用時間／滑動期限寫入通常每五分鐘更新一次，近到期時立即延長。
- 課表可獨立的查詢並行執行，老師／占用查詢的單堂設定限制在日期範圍。網路或權限錯誤不再觸發整個集合掃描。
- 管理課表開頁先讀前週、本週、次週共 21 天的正式課程；使用既有取消、調課、固定課及占用計算。首次開明細、帳務或範圍外日期再讀完整資料。
- 部分課表保持唯讀、不覆蓋已保存的完整帳本；未讀取帳務時，未收款數量顯示省略符號。明細與寫入入口等待完整資料，範圍外日期顯示讀取狀態。
- 收據圖像元件延後使用時載入；操作計時不記錄姓名、帳號權杖、課程內容或金額，巢狀計時共用一筆紀錄。
- 新增四個老師台灣端點。第一批部署時 `COURSE_PORTAL_TAIWAN_EXTENDED` 保持 false；後續啟用分支將設為 true，並更新七個課務頁面的設定版本。合併啟用分支前，必須確認新入口部署完成並通過下述正式端點檢查；不在錯誤後自動跨區重送寫入。
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

## 台灣老師入口啟用檢查

`Verify Taiwan Teacher Endpoints` 對四個新增入口送出沒有登入資料的空請求，確認回應為 callable 的 `401 / UNAUTHENTICATED`，而不是找不到入口或 Cloud Run 權限拒絕。四個處理程式都在業務讀寫前先驗證 session，因此此檢查不建立課程、學生、聯絡簿或獎金申請；也不需要正式使用者的權杖。

這項檢查只證明入口已部署、可以到達且仍強制驗證身分；它不是正式帳號的完整操作驗證，也不代表老師實際使用的速度量測。啟用範圍僅限 `TeacherUtilitySession`、`TeacherUpdateStudent`、`TeacherSubmitContactBookPost`、`TeacherBonusRequest`；登入、合約與其餘租賃入口仍須另行整合。需要回復時關閉旗標並更新設定版本即可。

## 驗證

本機 Node.js 24：課務、老師端與教室租用共 299 項檢查通過；部署環境使用既有 Node.js 20。另已檢查 Functions 主模組能載入且六個相關台灣匯出使用 `asia-east1`，以及執行正式課表建置器並保留新版分段載入。

```sh
node --test tests/course*.js tests/course*.cjs tests/teacher*.js tests/teacher*.cjs tests/room-booking*.js tests/room-booking*.cjs
node .github/scripts/build-inline-course-workspace.cjs
git diff --check
```

新增測試涵蓋快取失效後舊結果晚到、帳號隔離、共用進行中請求、登入撤銷、月份查詢邊界、只讀取自己的薪資、管理者授權、課表版本衝突，以及部分資料不得覆蓋完整帳本。正式帳號操作與實際延遲仍需在部署時驗證。

參考：[Firebase 函式區域](https://firebase.google.com/docs/functions/locations)、[Firestore 位置限制](https://firebase.google.com/docs/firestore/locations)、[查看資料庫設定](https://firebase.google.com/docs/firestore/manage-databases)。


## 2026-09-19 第二階段（準備部署）

使用者回報桌機「正在讀取課程與帳務明細」久等。現行讀取已指定台灣，不能把這個現象直接歸因於美國連線。檢查發現完整資料合併前有六段串行資料庫讀取、學生覆寫資料重複讀取，且載入明細會隱藏已完成更新的課表；切到 21 天範圍外也會改讀完整帳本。

這批把獨立查詢合併並行、重用學生快照，保留新課表直到帳務載入完成，範圍外日期仍採 21 天課表讀取。完整財務資料、付款及歷史簽到的合併規則維持原有邏輯。

所有 180 個 HTTP/callable 匯出均宣告台灣部署：原有 39 個台灣別名，加上 141 個原美國入口的台灣同名版本。原美國入口保留供既有客戶端相容；本批尚未切換其餘前端、LINE 回呼或儲存桶。不新增背景工作的第二個區域，也不啟用常駐執行個體。

部署工作補齊原流程未涵蓋的入口，最後透過正式 Cloud Functions API 確認每個台灣 HTTP 入口為 ACTIVE。區域宣告測試不等同正式部署完成；前端切換必須在這個檢查成功後進行。驗證腳本另讀取經過欄位篩選的伺服器計時與儲存桶區域，不輸出課務內容、個資或權杖。


### 前端切換準備

`FUNCTION_REGION` 統一設定為 `asia-east1`，登入、員工、老師個資／合約、課程、租賃、商品操作及盤點頁均讀取此設定。既有台灣別名維持原本名稱，不在寫入失敗時跨區重送。所有引用修改後設定／腳本的頁面更新快取版本。範圍外課表仍只補讀 21 天，課表顯示後延遲 1.2 秒準備完整明細；手動開啟共用同一個請求，失敗不循環重試。

327 項本機檢查通過；正式啟用需等 #235 的台灣入口部署檢查及 8 個無登入保護入口測試成功。這不是每位老師正式帳號的全面實測，也不代表量測到使用者端的加速幅度。

尚須獨立切換：LINE 登記回呼與 webhook、店內 Windows agent 的本機 `agent.bridge_url`、檔案儲存、單一區域背景排程與觸發器。外部 Google／LINE／Cloudinary 基礎設施不受本專案區域設定控制。舊客戶端保留美國相容入口，更新頁面後才改採台灣設定。


## 2026-09-19 LINE Login 回傳切換

本機 Codex 已由 LINE Developers 儲存後畫面確認，LINE Login Channel `2010902226`（柚子樂器會員登入）保留美國 callback 並新增台灣 callback。Messaging API Channel `2006335686`（柚子樂器，Bot `@046xzcpz`）仍使用美國 webhook；Use webhook 開啟，redelivery 與 error statistics aggregation 關閉，本批不變更這些設定。

登入程式為每次 OAuth state 保存實際 callbackUrl，交換授權碼沿用該網址。沒有此欄位的既有 state 使用原美國網址；不接受客戶端 query 指定網址、不因交換失敗跨區重試。新登入使用已登記的台灣網址。部署先完成並核對美國與台灣 callback，再部署 login starter。回復時改回美國起始網址但保留 per-state 相容處理，不能回退到忽略 callbackUrl 的舊 callback 實作。

測試涵蓋四種入口、新／舊 state、切換中登入、取消、過期、未知 state、重复回傳及交換失敗；正式 smoke check 只建立合成登入 state 後取消，檢查兩區入口皆發出台灣 callback，無真實 LINE 帳號、授權碼或訊息。此檢查不能替代本機使用已授權帳號完成實際 LINE 登入、身分綁定與登入後畫面的驗證。


## Messaging API 切換前保護（待部署及正式驗證）

本機已核對 Channel `2006335686`，Webhook 尚為美國。切換前須先將美國、台灣兩個 `lineWebhook` 部署相同的簽章與持久事件去重處理，再完成正式空事件簽章檢查。原始 request bytes 的 HMAC 驗證在任何業務處理與去重紀錄前執行。兩區以同一台灣 Firestore 的 `lineWebhookEventProcessing`、Channel ID 與 `webhookEventId` 原子取得事件處理權。

事件紀錄只含雜湊鍵、狀態、時間與區域，不保存文字、使用者 ID、replyToken 或原始錯誤。相同事件只允許一次 handler 嘗試；完成、失敗待查及處理中均不自動重跑。這是避免重複副作用的保護，不是承諾每筆事件一定成功。`needs-review` 或超過 120 秒的 processing 須核對原業務結果與通知紀錄，再決定人工修復；不可直接刪除 claim 或重送舊 reply token。新訊息仍使用新的事件 ID，正常分開處理。單一失敗不跳過同批其他事件，整批有失敗回 500。

本機切換前的必要證據：兩区 ACTIVE；簽章 secret 參照一致；同一既有 secret 簽署的空 events 在兩區均 200，偽造簽章均 401；去重及失敗不重播測試通過。簽章檢查前另等候兩區最大 request timeout 加 15 秒，讓舊版本已開始的請求結束；去重不追溯部署前未留下紀錄的歷史事件。切換時僅改 Webhook URL 至 `https://asia-east1-youzi-c1b74.cloudfunctions.net/lineWebhook`，按 Verify 須 Success；Use webhook 保持開啟，redelivery 與 error statistics aggregation 維持原關閉設定。未得到正式驗證成功通知前不切換。

網址回復：改回 `https://us-central1-youzi-c1b74.cloudfunctions.net/lineWebhook` 並 Verify。美國相容入口與同一事件 ledger 保留；切換網址不清除 ledger，亦不回退去重程式。正式空事件檢查不發送訊息；真實綁定與通知需本機另行驗證。

## 2026-09-19 檔案正式切換（準備中，須以部署結果更新）

本機已完成 LINE Webhook 台灣 URL、Verify Success、兩區正確／錯誤簽章 200／401 驗證；本批不修改或部署 lineWebhook。逐項補部署七項函式的 run 35443677125 已成功，全部台灣 ACTIVE 且無登入請求正常拒絕；接著補齊檔案副本及部署。

副本核對使用 `.github/scripts/reconcile-taiwan-storage.cjs`；舊 `prepare-taiwan-storage` 僅屬初始快照流程，正式切換後不得以它補檔。新流程比對 checksum、大小、快取及其他 metadata，標記來源 generation/metageneration，以條件寫入避免覆蓋競態更新。未知目標差異或未分類孤立檔案會停止切換，不任意刪除或覆寫。副本移除原 Firebase download tokens，避免原連結撤銷後仍可跨桶使用舊 token。

`storageRouting` 的新上傳使用台灣桶。既有純路徑讀取先檢查台灣物件：若是遷移副本，必須核對來源仍存在且版本及 metadata 未變，才讀副本；來源晚到更新改讀來源、來源已刪則拒絕，不從副本復活。新的台灣物件直接讀台灣。私人合約下載仍先核對原身分／契約 token 與路徑；新網址使用台灣函式，舊美國網址仍接受。影片上傳 session 保存實際 bucket；未具此欄位的舊 session 固定回原美國桶完成，不能拿台灣副本冒充尚未完成的上傳。

後端刪除同一路徑會核對並刪除兩桶的實際 generation；商品 references 清理分別保存 bucket/path/generation 的 lineage，維持每桶 100 檔的上限及原完成工作授權。未變更課務、付款、簽到或庫存的合併規則。

正式部署由 `.github/storage-rollout.json` 指定 24 項受影響函式，讀取／驗證入口先行，每批最多 2 個名稱。該檔變更時，四個既有部署流程仍跑原測試，但將雲端部署讓給 `Deploy Taiwan Storage`，避免同一版同時大批更新；未變更此 manifest 的一般提交維持原流程。後續改動共享 storageRouting 時應同時更新此 manifest 版本，透過同一受控流程部署。此流程不納入 LINE webhook、不執行歷史薪資修復、不修改私人 PIN 或擴張 Storage rules。

正式 smoke check 只建立隔離的隨機 probe 檔案：台灣寫讀、匿名拒絕、短效簽名讀取、來源 metadata 更新與刪除相容，完成或失敗均清除 probe。它不能替代本機真實老師／客戶帳號的上傳、簽約和附件檢視測試。

前端 storageBucket 及快取版本須在上述後端部署全部成功後才切換。已儲存的舊商品／合約／外部分享網址保留原桶，不批次改寫原始紀錄；這些舊網址及尚未重新整理的頁面仍可能使用美國，不能宣稱所有檔案流量都已集中台灣，也不能停用或刪除美國桶。回復前端時可改回舊 bucket，但後端必須保留新舊讀取及上傳 session 相容層，以讀取已新增的台灣檔案。
