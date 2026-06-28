Play Card 租賃附件標準儲存修正包

目的：
- 身分證圖片、簽名圖片、正式契約 PDF 改放 Firebase Storage。
- Firestore rentalContracts 只保留圖片/PDF URL，不再保存大型 base64 dataURL。
- 避免 Firestore 單一文件超過 1MB。

需要覆蓋到 GitHub 根目錄的檔案：
- rental-sign.html
- rental-admin.html
- rental-common.js
- rental-contract.html
- rental-contract-view.html
- rental-my-contract.html
- rental-order.html
- index.js
- firebase.json
- storage.rules

重要：
只把 storage.rules 上傳到 GitHub 不一定會立刻套用 Firebase Storage 規則。
如果你的 GitHub Actions 沒有自動 firebase deploy，請到 Firebase Console → Storage → Rules，貼上 storage.rules 的內容並 Publish。

測試順序：
1. 上傳此修正包的檔案到 GitHub 根目錄並覆蓋。
2. 到 Firebase Console → Storage → Rules 套用 storage.rules。
3. 用測試案件重新走一次：產生填寫連結 → 客人上傳證件/簽名 → 管理端確認租用成立。
4. 確認 rentalContracts 文件裡有 customerIdImageUrl / customerSignatureUrl，而不要再有很長的 data:image... 欄位。
