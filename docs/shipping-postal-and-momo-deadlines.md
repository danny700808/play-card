# 出貨配送與郵局標籤更新（2026-11-19）

## 本次行為

- 以訂單原始配送資料決定物流，不再提供重新挑物流公司的選單。酷澎訂單已有物流時禁止換用其他 carrier；缺少平台配送資料時停止取單。
- 官網／LINE 的綠界門市資料依 `pickup_address.service_provider`、`LogisticsSubType`、`CVSStoreID` 分辨 7-11 與全家，不以運費名稱猜門市。
- 官網／LINE 原生自訂物流（一般運費）與明示郵局，產生 100 × 150 mm 郵局地址標籤。明示其他貨運商、門市自取、其他物流擴充不會轉成郵局。使用完整收件資料、商品與店主指定寄件人；不建立郵件條碼或假貨運單號。
- 郵局產生 PDF 不代表出貨或送印。副機 `/print` 明確回覆 submitted 後，頁面立即移到已處理並保存紀錄；取得文件及讀取訂單不會送印。
- 郵局重印重用保存 PDF。來源、地址、商品或配送設定異動後不能直接用舊文件；普通物流文件仍須通過條碼驗證，無條碼只限 postal-address-v1。

## MOMO 正式期限

現場取得 A202 API 文件 v0.12.0（文件清單更新時間與 PDF 內修訂表不一致，未以檔名推測版本）。OrderQuery 有 `LastShipDate` 查詢類型，但 Response 仍未定義最晚出貨欄位。`planShipDate` 明確是預計出貨日，不能代用。

程式先依官方 LastShipDate 做完整分頁及精確日期篩選；同單跨多日出現、篩選被忽略、查詢不完整或資料變動時不推算。現場未出貨單在此查詢中未返回，因此補上主機原有配送讀取助手 1.1.0：從已登入 MOMO 的 E001 訂單管理讀取**明確標示最晚出貨時間**的畫面文字，以訂單和實體商品子訂單逐一比對。API 和後台都讀不到則維持待確認。

後台只讀目前可見清單，最多六頁、42 秒；一單的子訂單缺少期限或期限互相矛盾時不合併猜測。資料回到主機後只傳出正規化期限、來源與核對時間給副機。每次更新重讀；不把舊觀察值永久當作最新。來源只有日期時保留日期精度，不加 19:00 或 23:59。

啟用需要配送讀取助手新增 `https://3p.momo.com.tw/*` 網站讀取權限，使用者已同意。安裝時保留現有 manifest 的 key、pairing.js 與所有主機設定。擴充更新檔案不等於 Chrome 已重新載入，須另外驗證。

主機 `/api/delivery-bridge/status` 必須經本機工作台登入態驗證，只回報版本、瀏覽器種類、連線狀態與最近讀取的筆數／錯誤分類，不包含配對權杖、訂單編號或客戶資料。1.1.0 助手以版本標頭宣告已載入；未宣告或舊版仍可讀原有蝦皮配送，但不派發 MOMO 工作，包貨頁明確提示重新載入助手。現場核對 Chrome 仍使用未宣告版本的舊程式，重新載入前不能視為期限自動同步已完成。

## 官網／LINE 超商尚待完成

已在主機 EasyStore 核對原設定：綠界 C2C，7-11／全家已啟用。現有公開 EasyStore merchant 訂單與 fulfillment API 未回傳綠界 AllPayLogisticsID 或官方標籤內容；物流 App 的取單流程由 EasyStore 對其已安裝服務簽章呼叫，不能把一般新增 fulfillment 紀錄當成物流出貨成功。

現場從已出貨訂單的「列印綠界科技物流寄件單」驗證原整合入口；已取貨的舊單遭 7-11 拒絕再列印。尚未完成從共用包貨頁直接取得 7-11／全家正式原單並傳給副機。沒有為測試任意建立真實新出貨，也未把自製條碼當作正式原單。現階段只可宣稱配送分類已辨識，不能宣稱官網超商取單已接通。

官方文件：
- https://developers.easystore.co/docs/api/logistic-apps/fulfillment
- https://developers.easystore.co/docs/api/logistic-apps/awb-printing
- https://developers.ecpay.com.tw/7406/ （7-11 C2C 官方列印，PrintMode=2 是 A6）

## 部署與驗證

主機依既有 start_shipping.ps1 重啟；更新前核對無 sending/downloading/ack-sending 工作，備份程式，驗證原 config、remote-config、document-settings、delivery-bridge 雜湊不變。

副機需要列印助手 2.3.0-postal-label，僅改 bridge.py、prepare.py、render_worker.py，新增 postal_label.py。原印表機、紙張、密碼保護、jobs、originals 不更動。副機未提供可連線安裝路徑，因此另附更新包，尚未宣稱安裝或實體出紙完成。

自動測試：主機 shipping Python 136 項（含新增的版本／權限邊界驗證）、前端 shipping Node 100 項、local-print Python 30 項通過；配送助手 reader 測試 4 項通過。另以測試收件資料檢查郵局 PDF 實際渲染，尺寸 100 × 150 mm，中文、地址、品項與數量可讀。主機測試不能替代副機的紙張及掃碼驗收。
