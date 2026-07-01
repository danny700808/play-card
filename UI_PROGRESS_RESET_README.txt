UI 進度提示重置修正

覆蓋方式：
1. 將本資料夾內所有檔案上傳覆蓋到 GitHub Pages 的 play-card 根目錄。
2. 這次只修前台 UI 進度提示，不需要部署 Firebase Functions。
3. 上傳後請用 Ctrl + F5 或無痕視窗測試，避免瀏覽器讀到舊版 ui-action-feedback.js。

修正重點：
- 移除前一版會重複堆疊綠框、搬動既有訊息、卡在確認中/送出中的做法。
- 改成單一綠底白字進度框。
- 進度統一為 10%、20%、30% ... 90%、完成 100%。
- 不修改 Firestore、租賃邏輯、員工邏輯、LINE/Email Functions。
