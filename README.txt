這次只需要替換 6 個檔案：
1. config.js
2. app.js
3. index.html
4. register.html
5. task.html
6. dashboard.html

這版效果：
- admin / 老闆登入後，直接先進 task.html
- 一般員工登入後，進 dashboard.html
- 老闆在 task.html 上方可直接切換到：員工首頁 / 打卡 / 請假 / 工讀時數 / 交辦事項
- 老闆同一個帳號仍然可以看到全部功能，不是只剩 task
- 登入頁與註冊頁分開
- config.js 已更新成新的 Apps Script 部署網址

注意：
- 員工資料 的 角色 欄位請填 admin
- 帳號狀態 請填 active
