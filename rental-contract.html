# 租賃續租 / 退租 + Email 發送更新說明

## 這版新增

1. `rental-renewal.html`
   - 客人點連結後可選「我要續租」或「我要退租」。
   - 續租可選 1 / 2 / 3 期，自動接目前到期日下一天。
   - 可填匯款末五碼、上傳付款截圖、送出給管理端確認。
   - 退租會回寫為 `退租申請中`，管理端會看到紅色待處理數字。

2. `rental-admin.html`
   - 租用中契約新增「傳送續租 / 退租確認連結」。
   - 續租付款確認後可按「確認續約成立」，系統會新增第二頁續租明細並傳新契約。
   - 通知會同時建立 LINE 與 Email 佇列；有 LINE 發 LINE，有 Email 寄 Email。

3. `functions/index.js`
   - 補上 `notificationQueue` 真正發送器。
   - LINE 使用 `LINE_CHANNEL_ACCESS_TOKEN`。
   - Email 使用 SendGrid：`SENDGRID_API_KEY`、`SENDGRID_FROM_EMAIL`。
   - 每天 10:00 自動檢查 7 天內到期租約，自動發續租 / 退租確認連結。

4. `email-send-check.html`
   - 可測試 Email 是否真的寄出。
   - 若未設定 SendGrid，會在畫面顯示 `Email 尚未設定 SENDGRID_API_KEY / SENDGRID_FROM_EMAIL`。

## Email 是否能寄出

從舊檔案判斷：原本目前部署的 `functions/index.js` 只有 LINE webhook，沒有實際 Email 發送器；所以原本即使前端寫入 `notificationQueue` 的 email 項目，也不一定會真正寄出。

這版已補上 Email 發送器，但 Firebase Functions 環境必須設定：

```txt
SENDGRID_API_KEY=你的 SendGrid API Key
SENDGRID_FROM_EMAIL=已驗證的寄件 Email
SENDGRID_FROM_NAME=柚子樂器
```

設定完成並部署 Functions 後，打開：

```txt
email-send-check.html
```

送出測試信。如果狀態變成 `已發送`，代表 Email 可以發出去；如果變成 `發送失敗`，畫面會顯示失敗原因。

## 部署注意

GitHub workflow 已改成部署全部 Functions：

```txt
firebase deploy --only firestore:rules,storage,functions --project youzi-c1b74
```

因為這版新增了：

- `sendNotificationQueueOnCreate`
- `flushNotificationQueue`
- `rentalAutoRenewalReminder`
- `emailSendCheckHttp`
- 多個租賃 HTTP functions

如果只部署 `functions:lineWebhook`，Email 與續租自動提醒不會生效。


## 2026-06-14 付款資訊更新

已將續租頁付款區塊改為：

- QR Code 圖檔：`rental-payment-qr.png`
- 銀行：台新銀行（812）｜敦南分行（0023）
- 戶名：黃銘廷
- 帳號：2888-1010-149-129
- 顯示名稱：柚子樂器帳戶

位置：`rental-renewal.html` 的「匯款資訊」區塊。
