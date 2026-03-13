這包是目前最需要一次更新的檔案。

請照順序做：
1. 將 apps-script.gs 全部覆蓋到 Google Apps Script。
2. 存檔後重新部署 Web App。
3. 將以下前端檔案覆蓋到 GitHub：
   - config.js
   - app.js
   - index.html
   - register.html
   - dashboard.html
   - task.html
   - clock.html
4. 若 Sheet 欄位尚未更新，請依 sheet-setup.txt 調整。
5. 用無痕視窗重新測試登入。

這包用途：
- 管理者 admin 登入後先進 task.html
- 一般員工登入後進 dashboard.html
- 打卡頁為三鍵版本：上班打卡 / 下班打卡 / 補登
- 補登按下後才展開表單

若仍卡在登入成功不跳頁，通常是 GitHub 快取或檔案未覆蓋完整。