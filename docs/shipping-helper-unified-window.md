# 副機蝦皮取單助手：統一視窗 v1

共用頁已負責訂單、付款、商品圖片、SKU、數量、預覽、列印及「已印好」按鈕。副機擴充僅取得正式貨運單及 PNG 預覽，不再注入自己的視窗、PDF iframe 或列印按鈕。所有平台沿用 XP-420B 設定；不要改驅動、紙張或工作佇列。

## 安裝範圍

這份規格尚未代表副機擴充已更新。先定位實際安裝的蝦皮取單助手，備份並修改它。更新共用 repo 前先 fetch 最新 main，保留後續修改。主機的配送讀取助手 `delivery-reader/` 只讀物流，並非副機取單助手，不能混改。

共用檔案：`shipping-shopee-bridge.js`、`shipping-local-print.js`、`store-agent/shipping-ui/`。
包貨頁：`https://danny700808.github.io/play-card/shipping-desk.html`（包括嵌入系統版本）。

## 同頁通訊

Content script 使用 `window.postMessage(message, location.origin)`。只接受正確包貨頁、`event.source === window`、`event.origin === location.origin`，且核對 namespace、version、direction、requestId。不接受任意網頁、任意 URL 或一般腳本執行指令。不得傳送 Cookie、密碼、登入權杖或 API 金鑰。

共用頁送出訊息都含：

```js
{namespace:'youzi-shipping-helper', version:1, direction:'desk',
 type:'probe' | 'get-document' | 'cancel', requestId:'隨機識別碼'}
```

1. `probe`：兩秒內回覆；只宣告能力，不可取單、出貨、登入或列印。完成新協定後，停止舊按鈕和舊視窗的注入。

```js
{namespace:'youzi-shipping-helper',version:1,direction:'helper',
 type:'ready',requestId,capabilities:{unifiedDocument:true}}
```

2. 使用者按訂單按鈕才會送出 `get-document`，另帶：

```js
order:{key:'EasyStore:123',externalId:'123',orderNo:'SHOPEE_ORDER',
       tracking:'既有物流號碼或空字串',mode:'reprint' /* 或 create */}
```

依正式後台最新資料核對 EasyStore ID、蝦皮訂單號、收件/商品/物流及狀態。`reprint` 永遠不能退回新出貨；取消、部分出貨或異動不明時回報 `order_changed`。`create` 若最新資料已有原單，取回原單，不能重建。不可只以頁面原本的快照直接送出。

3. 進度可回傳 `type:'progress'`，加相同 `requestId,key,orderNo`，`stage` 限 `checking_login / reading_order / getting_document / preparing_preview`。前端統一呈現文字，不顯示任意上游錯誤或敏感內容。

4. 取得正式原單後，回覆：

```js
{namespace:'youzi-shipping-helper',version:1,direction:'helper',
 type:'document',requestId,key,orderNo,tracking,
 pdfBase64:'正式 PDF 的純 base64，不含 data 前綴',
 previewDataUrl:'data:image/png;base64,...'}
```

PDF 上限15MB，PNG上限約8MB。必須驗證回來的是該筆正式 PDF，不是登入頁/空頁；核對物流號碼及條碼。PNG 是第一頁清楚預覽，保持原單內容與比例，可去除外圍空白，不得截斷條碼、靜區或文字。不得回傳遠端 URL 或 SVG。取單完成不可呼叫 `/print`；共用頁收到後顯示同一個 `documentDialog`，使用者再按「列印貨運單」才會透過既有18182的 `/prepare` 和 `/print` 送印。

若現有 helper `/prepare` 本身會送印，先拆開職責後才能接新協定。PNG 可在既有本機服務新增只渲染不送印的能力，維持既有安全限制，不開對外埠。

5. 錯誤：`type:'error'`，相同 `requestId,key,orderNo`，`code` 為 `login_required / not_ready / order_changed / unsupported / failed`。不要把密碼、網址中的權杖或原始 API 回應放進訊息。前端不會收到錯誤後自動跳頁或重送。

6. `cancel`：使用者關閉視窗或逾時。停止後續步驟並關閉助手自己建立的背景頁；已送到平台的操作不能當作取消成功或再送一次。保存不確定結果供下次正式查詢，不自動重試出貨。主頁忽略已取消或其他 requestId 的晚到結果。

## 背景及登入

沿用副機已登入 EasyStore 的同一 Chrome 個人資料，正常取單不可主動登出、清 Cookie 或每次另建登入環境。以不搶焦點的背景頁執行所需官方流程，回傳文件後關閉自己開的頁面。處理平台開 PDF 分頁的情況，取回其官方文件後清理自己建立的頁面，不關閉使用者原有分頁，不留下獨立 PDF 檢視器。

只有真正登入失效才回 `login_required`。不要以無可用貨運單、空列表或初始頁面尚未載入當作登出。驗證已登入的判斷與頁面就緒等待。自動恢復登入能否使用系統現有安全機制需在副機實測，不宣稱永不過期；不把帳密放公開程式或跨機複製 Cookie，不停用平台驗證。

## 列印與紀錄

正式文件只存在這次核對視窗記憶體，關閉會撤銷 blob URL；此協定沒有把蝦皮 PDF 保存到主機。蝦皮平台出貨狀態仍由更新訂單同步。「已印好」才明確保存已印單紀錄；取得 PDF 或 Windows 接收工作均不冒稱實際出紙。共用頁目前不替擴充原單呼叫主機 `/api/print-event`，因該接口要求主機已有綁定文件；請保留此限制，不偽造 host documentReady。若要新增持久化送印紀錄，需另實作受限且綁定訂單的協定。

## 驗收

- 使用店主指定的既有新竹物流蝦皮單，先重新核對最新訂單及物流號碼。真實訂單識別碼僅保留在私人交接，不寫入公開 repo；不能重新申請出貨。
- 舊單重印全程不跳到前景 EasyStore/PDF，沒有留下新分頁；只出現共用核對視窗，商品/金額/物流/原單一致。
- 檢查連按、關閉、逾時與晚回覆，不重複出貨或自動列印。
- 用 mock 測新單、登入失效與需要驗證；真實新出貨需使用者選定訂單才驗收。
- 先做取回/預覽及不送印測試；實體試印前請使用者指定一張既有單並確認一次，記錄張數與條碼可讀性。
- MOMO/酷澎既有列印設定須保留。最後回報副機實際修改位置、版本、測試結果、剩餘限制，不把主機測試當副機驗收。
