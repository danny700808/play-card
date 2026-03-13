這包只放需要替換的檔案，不需要整站重蓋。

請替換這些檔案：
1. Apps Script：把 apps-script.gs 全部覆蓋到你的 Apps Script 專案
2. GitHub 前端：替換 index.html、register.html、app.js、config.js

這次修改內容：
- 登入頁與註冊頁分開
- 送出時有「送出中 / 登入中」提示
- 管理者收到註冊信後，先看完整資料，再按同意 / 不同意
- 新增 testMail()，可手動觸發寄信授權

更新後請做：
1. 在 Apps Script 執行 setupSheets()
2. 再執行 testMail()
3. 部署 -> 管理部署 -> 更新目前 Web App
4. 把前端檔案重新上傳到 GitHub Pages
5. 用無痕視窗重新測試
