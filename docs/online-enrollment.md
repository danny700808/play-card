# 招生／線上報名（直接網址，尚未對外宣傳）

管理入口是 `enrollment-admin.html`；營運中心側欄與管理樹都提供獨立入口。管理者透過既有 Firebase 安全登入查看報名。一般訪客直接開啟 `https://danny700808.github.io/play-card/enrollment.html` 即可填寫，不需要邀請碼、預先登入或管理者授權。頁面暫不列於官網或公開選單，並保留 noindex；這是可由網址存取的正式表單，不是私人邀請制。

報名頁依序選課程、時間及資料、同意並綁定 LINE。科目與價格來自 `enrollmentCatalogHttp` 的正式共用科目資料。第三步沒有模擬成功按鈕；使用現有 LINE Login channel 與已登記的台灣 callback。`en_` state 交由 enrollment 模組處理，其餘登入仍沿用原流程。

服務端驗證同意版本、課程、班別、時段及聯絡資料，並保留操作頻率限制。OAuth 採 PKCE，另以瀏覽器持有的 verifier 兌換完成授權的短效 ticket。使用者授權並返回原分頁後才產生正式報名紀錄；分頁暫存姓名電話在成功後清除。不保存 LINE access token。原有邀請流程僅保留相容已開始的舊授權，不再由新表單或後台產生。

後台可核對資料、記錄聯絡進度、明確選擇新建或連結既有學生，並直接編輯正式課程的科目、老師、日期、時間、教室、固定頻率及收費方案。原始報名資料保留不覆寫；「儲存安排」只存草稿。勾選已與學生確認安排後，「確認排課並傳送 LINE」會沿用既有排課檢查，將學生、LINE 綁定、固定課程、未繳費期別、報名狀態及報名者確認通知一次寫入。相同姓名／電話只是候選提示，不會自動合併。

同一份報名使用固定的排課操作編號及版本檢查，重試不會多建課程或學費。預設每週固定上課，也可選隔週；後續期別沿用原課務規則。新雙人班保留兩位學生與 LINE 綁定，共用一個課程和學費期別。已有其他分組的學生，必須先在課務確認分組，避免影響既有課程。已確認的排課顯示結果，後續調課導回正式課表。

完成驗證並正式送出報名時，同一交易會建立一筆管理者 LINE 通知，固定 queueId 防止重複送出。通知由既有 notificationQueue 解析主要管理者，包含可直接開啟該筆報名的連結；未登入時先安全登入，再返回同一筆。管理後台顯示佇列的實際通知狀態。學生端顯示「LINE 身分已確認」，正式學生綁定仍在管理者確認排課後建立。確認排課時會自動將管理者已預覽的確認訊息傳給報名時驗證的 LINE；只儲存草稿不傳訊息。確認通知使用固定 queueId，重複確認不會重複排課或寄送。訊息以最後的正式資料產生，包含首堂日期、固定時段、科目、老師、教室及學費，內部分成與內部備註不對外傳送；可另填給報名者的補充說明。前後端共用同版 formatter，伺服器逐字核對已預覽的內容。通知狀態與失敗原因從既有佇列讀取，未發送前不顯示成功。其他手動聯絡與內部處理紀錄收合在次要區塊。未確認為官方 LINE 好友者可先用電話或官方 LINE 後台聯絡。佇列的「已發送」不代表已讀。

新集合 `onlineEnrollmentInvites`、`onlineEnrollmentOAuth`、`onlineEnrollmentGrants`、`onlineEnrollmentSubmissions`、`onlineEnrollmentLimits` 不在前端 Firestore allowlist，僅由 Admin SDK 存取。過期授權及頻率限制資料每日清理，正式報名不隨暫存清理。

## 部署與驗證

Firebase 精準部署：`enrollmentPublicHttp`、`enrollmentAdmin`、`enrollmentCleanup`、`coursePortalLineLoginCallback`。前兩者與既有 callback 兼容台灣及美國端點，清理排程僅台灣。不要為此變更部署其他課務、薪資或通知函式。

前端 `enrollment.html` 和 `enrollment-assets/` 是 enrollment preview Site 的 `dist/` 同版副本，HTML 的 CSS、JS、logo 路徑改為 `enrollment-assets/`；JS 以自身 script URL 解析課程圖片。修改時同步更新兩份並保持 Sites 的 owner-only 分享設定。對外填寫與朋友測試一律使用原 GitHub 系統的固定報名網址。

測試：`node --test tests/enrollment.test.cjs tests/enrollment-scheduling.test.cjs tests/enrollment-admin.test.cjs tests/course-manager-schedule.test.js tests/course-login-region-migration.test.cjs tests/management-tree.test.cjs`。Site 另有 `test-flow.cjs`（可用 `LIVE_CATALOG=1` 檢查正式科目資料）。排課測試執行真正的共用排課函式，驗證衝突、交易失敗、重複及並行操作不留下部分建檔，並驗證收費方案變更、學生分組與管理畫面。

測試資料使用隔離記憶體資料庫，不發送真實通知。上線冒煙測試以無邀請、無登入狀態開始及取消授權，不建立正式報名；真實手機 LINE 授權成功仍需填寫者自行完成。

排課整合由 `enrollmentScheduling.js` 組織，`coursePortal.js` 僅增加內部交易掛鉤及共用選單橋接，不接受前端傳入掛鉤。`enrollmentAdmin` 為 180 秒／1 GiB；只需精準部署此函式即可發布排課後台變更。瀏覽器新選單使用 `enrollment-scheduling-ui.js`，無修改公開招生頁或 LINE 授權流程。

確認訊息的前端副本 `enrollment-confirmation-message.js` 必須與 `functions/enrollmentConfirmationMessage.js` 保持一致（測試會驗證）；此功能精準部署 `enrollmentAdmin`，不回溯傳送給既有已排課學生。
