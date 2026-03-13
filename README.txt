【這包已修正】
1. config.js 已改成新的 Apps Script 部署網址：
https://script.google.com/macros/s/AKfycby2fAM3Q5j9-4je9atMNzbdNIXn3-Y90nacN75jJgCyO7fSglgBR9iE-lOEacmh7dI_/exec
2. apps-script.gs 已加入 testMail()，可直接執行來開通 MailApp.sendEmail 權限。
3. 管理者角色同時支援：admin / superadmin / 管理員 / 超級管理員。
4. setupSheets() 預設會補上：管理通知信箱 = danny700808@gmail.com

【安裝順序】
1. 把 apps-script.gs 全貼到你的 Apps Script 專案，存檔。
2. 先執行一次 setupSheets()。
3. 再執行一次 testMail()，如果跳授權就按允許。這一步是專門開通 MailApp.sendEmail。
4. 右上角「部署」→「管理部署」→ 更新目前的 Web App。
   - 執行身分：我自己
   - 存取權：任何人
5. 把這包 web 檔案上傳到 GitHub Pages（至少要更新 config.js、app.js、index.html、dashboard.html、clock.html、leave.html、parttime.html、task.html、style.css）。
6. 用無痕視窗重新打開網站測試，避免快取到舊 config.js。

【系統設定至少要有】
公司IP	125.229.190.123
時薪	196
管理通知信箱	danny700808@gmail.com
附件大小上限MB	30

【員工資料表 A1】
員工ID	姓名	Email	密碼	角色	是否工讀生	帳號狀態	建立時間	最後登入時間

【角色建議】
一般員工：staff
管理者：admin
超級管理者：superadmin

【帳號狀態】
pending / active / disabled
