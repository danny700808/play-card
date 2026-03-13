這包是打卡頁修正版 v6，只需要替換下面這幾個檔案：
1. apps-script.gs
2. clock.html
3. sheet-setup.txt（照內容修改 Google Sheet 欄位）

操作順序：
1. 先把 apps-script.gs 全部貼到 Apps Script。
2. 在 Apps Script 執行一次 setupSheets()。
3. 到 Google Sheet 檢查「打卡紀錄 / 打卡失敗紀錄」A1 是否已變成最新版欄位。
4. 把 clock.html 覆蓋到 GitHub。
5. 重新部署 Apps Script 的 Web App。
6. 重新整理 GitHub Pages，再測試打卡。

這版改動：
- 打卡頁只保留三個按鈕：上班打卡 / 下班打卡 / 補登。
- 補登按下去才展開表單。
- 同一天同一種打卡，第 2 次會先跳出確認視窗。
- 下班打卡不再顯示遲到 0 分鐘。
- 補登會另外記錄補登原因。
