# 招生／線上報名（直接網址，尚未對外宣傳）

管理入口是 `enrollment-admin.html`；營運中心側欄與管理樹都提供獨立入口。管理者透過既有 Firebase 安全登入查看報名。一般訪客直接開啟 `https://danny700808.github.io/play-card/enrollment.html` 即可填寫，不需要邀請碼、預先登入或管理者授權。頁面暫不列於官網或公開選單，並保留 noindex；這是可由網址存取的正式表單，不是私人邀請制。

報名頁依序選課程、時間及資料、同意並綁定 LINE。科目與價格來自 `enrollmentCatalogHttp` 的正式共用科目資料。第三步沒有模擬成功按鈕；使用現有 LINE Login channel 與已登記的台灣 callback。`en_` state 交由 enrollment 模組處理，其餘登入仍沿用原流程。

服務端驗證同意版本、課程、班別、時段及聯絡資料，並保留操作頻率限制。OAuth 採 PKCE，另以瀏覽器持有的 verifier 兌換完成授權的短效 ticket。使用者授權並返回原分頁後才產生正式報名紀錄；分頁暫存姓名電話在成功後清除。不保存 LINE access token。原有邀請流程僅保留相容已開始的舊授權，不再由新表單或後台產生。

後台可核對資料、記錄聯絡進度、明確選擇新建或連結既有學生，再進原課務系統排課。相同姓名／電話只是候選提示，不會自動合併。每次建檔與人工 LINE 訊息有重複防護；收件、授權及建檔本身不會寄訊息。只有管理者確認發送時，才進入既有 notificationQueue。未確認為官方 LINE 好友者可先用電話或官方 LINE 後台聯絡。佇列的「已發送」不代表已讀。

新集合 `onlineEnrollmentInvites`、`onlineEnrollmentOAuth`、`onlineEnrollmentGrants`、`onlineEnrollmentSubmissions`、`onlineEnrollmentLimits` 不在前端 Firestore allowlist，僅由 Admin SDK 存取。過期授權及頻率限制資料每日清理，正式報名不隨暫存清理。

## 部署與驗證

Firebase 精準部署：`enrollmentPublicHttp`、`enrollmentAdmin`、`enrollmentCleanup`、`coursePortalLineLoginCallback`。前兩者與既有 callback 兼容台灣及美國端點，清理排程僅台灣。不要為此變更部署其他課務、薪資或通知函式。

前端 `enrollment.html` 和 `enrollment-assets/` 是 enrollment preview Site 的 `dist/` 同版副本，HTML 的 CSS、JS、logo 路徑改為 `enrollment-assets/`；JS 以自身 script URL 解析課程圖片。修改時同步更新兩份並保持 Sites 的 owner-only 分享設定。對外填寫與朋友測試一律使用原 GitHub 系統的固定報名網址。

測試：`node --test tests/enrollment.test.cjs tests/enrollment-admin.test.cjs tests/course-login-region-migration.test.cjs tests/management-tree.test.cjs`。Site 另有 `test-flow.cjs`（可用 `LIVE_CATALOG=1` 檢查正式科目資料）。涵蓋取消、重複、過期、撤回邀請、資料變更、LINE proof、安全登入、確認建檔及管理畫面。

測試資料使用隔離記憶體資料庫，不發送真實通知。上線冒煙測試以無邀請、無登入狀態開始及取消授權，不建立正式報名；真實手機 LINE 授權成功仍需填寫者自行完成。

目前確認建檔後仍需前往既有課務頁安排正式課程。將老師、日期時間、科目及方案編輯整合成報名後台的一次確認排課，是使用者另提出、尚待確認實作的後續流程。
