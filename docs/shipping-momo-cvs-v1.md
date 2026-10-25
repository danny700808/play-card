# 副機 MOMO 超商單修正與驗收

2026-10-25。此文件是副機實作交接，不能當作副機已安裝或已實體試印的證明。

## 已確認的問題與主機修正

- 舊共用頁只送 `channel: MOMO`，沒有把超商版型交給副機；副機可能把全家／7-11 單送進宅配左右雙聯裁切，出現 `Content exists below the supported two-panel area` 或 `No clear centre divider`。
- 全家正式原單為 A4 左上角一張標籤，裁切虛線延伸到其他空白象限。全頁縮印會太小；單純 trim 非白像素也會把裁切線當內容。
- `store-agent/shipping_cvs_layout.py` 現在驗證單張原單，保持內容 1:1，只平移到 100 × 150 mm。僅接受已驗證的 A4 左上單張／已處理的 100 × 150 mm；其他象限含內容、多頁、旋轉、非預期註記、條碼遺失時拒絕，不猜版型、不把所有 MOMO 一律切四分之一。
- `shipping_preview.py` 的超商預覽與 `print` 連結使用同一份處理後 PDF；`label` 保留正式原檔。宅配／其他平台不套這項裁切。
- `shipping_remote.py` 保留正式 `shippingMethod`，共用頁依此傳送 `momo-cvs-v1`。舊助手會顯示需要更新而停止，不再把超商單交給雙聯裁切。

## 在副機修改實際服務

先 fetch `danny700808/play-card` 最新 main，保留後續改動。先定位及備份正在運行的服務與設定，通常為 `%LOCALAPPDATA%\YouziShippingPrint`。確認實際執行檔、啟動方式、18182 監聽程序，不只改工作區副本。

1. 將 `store-agent/shipping_cvs_layout.py` 安裝到服務可 import 的位置，於服務實際 Python 環境安裝 `store-agent/requirements-shipping-preview.txt` 的依賴。PDFium 不可同時跨執行緒處理：沿用服務的 render/prepare 鎖。
2. 在 `/prepare` 的 **MOMO 宅配雙聯分支之前** 處理 `printProfile == "momo-cvs-v1"`：
   - 必須 `channel == "MOMO"`、`shippingMethod` 為 `seven` 或 `family`，拒絕其他組合。
   - 保留來源、標頭、大小、訂單／物流／條碼核對等既有檢查。
   - 呼叫 `normalize_cvs_pdf(pdf_bytes, shippingMethod)`；主機已處理的 100 × 150 mm 會再次驗證且原樣回傳，**不能再進 `momo_split`**。
   - 列印來源必須使用回傳 PDF。維持 100 × 150 mm、單張、原內容尺寸，不把 A4 全頁縮進標籤，不再進雙聯裁切。
   - 新工作／準備快取識別包含 PDF 內容雜湊、版型版本與 `shippingMethod`，避免套用舊 A4／雙聯準備結果。保留既有已送印與結果不明記錄及其去重規則，不可把格式更新當成自動重印授權。
3. 同一 `/prepare` 回覆（包含查到既有工作 `submitted`）增加：

```json
{"jobId":"既有工作格式","status":"prepared","pages":1,
 "printProfile":"momo-cvs-v1","paperMm":[100,150]}
```

   只有準備完成才回 `prepared`；查到已送印仍回 `submitted`。不明結果不能改成 prepared。主頁的明確列印按鈕才可送一份 `/print`，prepare／preview／重啟都不得自動送紙。
4. 以上功能完整測過後，在 `/health` 增加 `printProfiles: ["momo-cvs-v1"]`，保留原欄位。**不能只加能力旗標或回傳假 pages/profile 繞過舊分割錯誤。**
5. 保留 MOMO 宅配左右雙聯拆兩張，以及酷澎／蝦皮／官網流程。`config.json`、XP-420B 驅動、USB 埠、100 × 150 mm 紙張、`print_labels.ps1` 既有出紙設定不任意重設。
6. 無活動中的送印工作時，重啟確認屬於此服務的程序。驗證只有一個 127.0.0.1:18182 listener，且 `/health` 真正由新版回應。保留禁止重複綁定的保護。包貨頁重新整理後讀取最新訂單。

## 必須完成的驗證

- 跑 `test_shipping_cvs_layout.py`、`test_shipping_preview.py`，以及共用頁 `test_shipping_local_print.cjs`、`test_shipping_reprint.cjs`；另測副機實際 HTTP `/prepare` 分派和服務重啟後持久化紀錄。
- 使用店主指定的既有全家及 7-11 原單：實際 `/prepare` 必須成功，pages=1，100 × 150 mm，無雙聯錯誤；全家不能仍是完整 A4 小標籤，7-11 不找中央分隔線。預覽和實際送印檔使用同一份內容。
- 條碼驗證主機以 300 dpi 比對原單與處理檔全部解碼結果；全家 4 碼、7-11 2 碼一致。203 dpi 軟體渲染全家只解出 3 碼，且原單／處理檔缺少的碼不同；不能據此宣稱 XP-420B 實物所有條碼已合格。副機須檢查實際印表渲染路徑，最後以實物掃描確認所有條碼。不要任意放大、重新畫條碼或略過失敗。
- 宅配仍為兩張；酷澎、蝦皮、官網不受影響；取消單不出貨、不列印。
- 連按、關閉核對窗、準備失敗、未知送印結果、舊助手、錯版型回覆均不重複送印；不得為驗證而重新申請出貨。
- 先做上述不出紙驗證。實體試印時由店主指定既有單並確認一份，記錄實際張數、尺寸、內容完整、條碼可掃；不能用 mock 或正常預覽冒稱實物驗收。

## 蝦皮空白貨運單是另一條流程

蝦皮助手 1.1.0／1.1.1 的回報只證明「既有原單」可取得，不代表「新單確認出貨 → 取回原單」已完成。先核對正式後台最新狀態；已有原單必須取回它，絕不可再次申請出貨。沒有原單時應明確區分尚未出貨、平台不支援、登入失效，不可都當成請更新。

沿用 `docs/shipping-helper-unified-window.md`，實作及測試 create/reprint 分流，保留已登入的 Chrome 身分、單一共用核對窗、助手背景分頁清理。只有真正登入失效才要求重新登入。不自行保存密碼或複製 Cookie。新單流程先 mock，不以既有單重印成功宣稱新單已成功。

## 回報

列出副機實際路徑、版本、程序與 health 能力、兩筆超商單的 prepare 張數／紙張／條碼結果、宅配與其他平台回歸測試、是否實際出紙。分開寫明已安裝、未出紙測試通過、實體驗收待完成，不籠統回覆「全部完成」。真實訂單 PDF、收件資料、密碼和金鑰不得提交公開 repo。
