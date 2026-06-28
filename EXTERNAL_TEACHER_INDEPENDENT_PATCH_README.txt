外聘老師獨立簽約模組｜上傳說明

這包只處理外聘老師簽約，不包含租賃檔案。

要上傳到 GitHub 的檔案：
- external-teacher-admin.html
- external-teacher-onboarding.html
- external-teacher-contract-admin.html
- external-teacher-payroll.html
- functions/externalTeacherOnboarding.js
- functions/index.js
- functions/package.json

重要原則：
1. 不要整包 ZIP 直接丟上 GitHub。
2. 解壓縮後，把裡面的檔案與 functions 資料夾上傳到 play-card 根目錄。
3. 不要覆蓋 rental-admin.html、rental-common.js、rental-order.html、rental-sign.html、rental-contract.html。
4. 這個模組資料獨立使用：
   - externalTeacherProfiles
   - externalTeacherContracts
   - externalTeacherContractTemplates
   - externalTeacherLineBindings
   - externalTeacherFiles
5. 檔案存放於 Firebase Storage：
   - external-teachers/{teacherId}/{年度}/identity
   - external-teachers/{teacherId}/{年度}/signatures
   - external-teachers/{teacherId}/{年度}/contracts

年度規則：
- 簽約日開始，到該年度 12/31 結束。
- 每年 12/15 起開放下一年度契約。
- 後台會以民國年度，例如 115 年、116 年，做紀錄。

提醒：
這包有 Firebase Functions 檔案。只上傳 GitHub Pages 前端頁面，不一定會讓新的 callable functions 立即生效。
如果外聘老師功能之前沒有部署過 Firebase Functions，還需要部署 functions。

測試網址：
- external-teacher-admin.html
- external-teacher-onboarding.html
- external-teacher-contract-admin.html

建議先放到測試版 GitHub repo 測試，不要直接上正式站。
