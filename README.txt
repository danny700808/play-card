【這包是需要替換的修正檔】

請替換這些檔案：
- apps-script.gs
- config.js
- app.js
- index.html
- register.html
- clock.html
- sheet-setup.txt

【這次修正重點】
1. 登入頁、註冊頁拆開
2. 註冊送出後顯示成功訊息，約 1.5 秒後自動跳回登入頁
3. 註冊頁底部改成「回登入 / 送出註冊申請」兩顆按鈕
4. 管理者收到註冊信後，會先進入審核頁看到完整資料，再決定同意或不同意
5. 標準打卡之外，不再顯示「遲到 0 分鐘」
6. 下班打卡成功後，只顯示下班打卡成功
7. 當天如果同一個打卡項目已經有一筆紀錄，會先問你這是不是當天第二次打卡
8. 新增「忘記打卡補登」功能，補登時需填日期、時間與原因
9. 新增打卡提醒排程函式與建立排程函式

【Apps Script 必做】
1. 把 apps-script.gs 全部覆蓋到 Apps Script
2. 執行 setupSheets()
3. 執行 testMail()，確認寄信權限正常
4. 重新部署 Web App

【如果要啟用自動提醒打卡】
在 Apps Script 另外執行一次：
setupClockReminderTriggers()

它會建立這些每日提醒：
- 平日 12:20 上班提醒
- 假日 09:50 上班提醒
- 每天 21:00 下班提醒
- 平日 13:30 忘記上班打卡提醒
- 假日 11:00 忘記上班打卡提醒

【提醒判斷】
- 只有 active 帳號會收到提醒
- 已經完成該次打卡的人，不會再收到同一種提醒
- 已核准且為整天 / 8 小時請假的人，當天不提醒

【GitHub 必做】
把下面檔案重新上傳到 GitHub：
- config.js
- app.js
- index.html
- register.html
- clock.html

完成後請用無痕視窗重新測試。
