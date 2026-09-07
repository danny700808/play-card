# 音教雲日表核對來源工作

此來源對應 Cloud Run 工作 `injiaoyun-course-audit-0723-0724-v4`，不直接修改音教雲。使用既有服務帳戶及 Secret Manager 的登入參照；不得把密碼或 token 放入建置來源。

日期由 `AUDIT_START_DATE`、`AUDIT_END_DATE` 指定。逐日透過舊版 Angular 日期選擇器定位，確認顯示日期及統計存在後才完成來源 run。七天一批，避免每日回應紀錄達 5,000 筆上限。

`opsInjiaoyunCourseAuditV3Runs` 的成功狀態會觸發新版鏡像覆蓋。測試來源工作應另用 review collection，完整檢查所有日期、來源紀錄及轉換後的人數，再提交成功狀態。不得直接把沒有日表證據的主檔擷取 run 標為正式課表成功。

後端 `injiaoyunAuditCoverage.js` 再次拒絕缺日期證據與截斷資料；`injiaoyunAuditPageRecords.js` 合併頁面實際回應，以來源課程日期處理延遲到達的回應。未結清期別来源用於補入近期新增學生與期別，未付款資料不能轉成已收款。

2026-09-07 日期修正版標籤為 `20260907-date-safe`；加入未結清期別來源的版本為 `20260907-date-safe-master`。建置使用此目錄的 Dockerfile/package.json/index.js。部署後應驗證 Cloud Run ready image 及 Firebase 寫入函式狀態，並保留日期內的備份和套用後回讀證據。
