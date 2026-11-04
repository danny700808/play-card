# 副機 100 × 150 mm 商品標籤

`packing-footer-v1` / 列印服務 `2.1.0-packing-footer`。

包貨頁新印、重印共用 `/prepare`。原平台貨運單等比例置中於上方，保留全部原單內容與條碼；底部約 20 mm 只放完整品名／規格、貨號 × 數量，最後一次 `客人號碼- 2070`（2070 是範例客人實際應付總額）。不印「揀貨明細」標題或個別價格。此欄是客人實際應付的訂單金額，不以付款完成為條件：已付款使用已確認總額，貨到付款使用平台已核對的 `payableAmount`（含折扣與運費）。例如左側「待收款：NT$425」，標籤即為「客人號碼- 425」。退款需核對、缺少金額或非 TWD 仍標示「待確認」，不以牌價或發票欄位推算。

MOMO 超商仍單張、宅配左右雙聯仍兩張。商品資訊只放第一張，其餘頁底部留白。這不會新增出貨或自動送印。

## 實作

- `shipping-local-print.js` 傳遞目前訂單品項和標籤金額；`model.packingLabel` 驗證品名、數量、部分待出貨及待核對狀態。貨號可空白：沒有貨號仍印完整品名／規格及數量，不印貨號或「未提供」，不因此阻擋整單。有貨號則維持「貨號 × 數量」。
- 為相容現場已安裝的 v1 列印助手，標籤金額沿用 `packingFooter.paidAmount`／`paidAmountStatus` 欄位；此 payload 的 `confirmed` 只表示標籤數字已確認，不代表已收款。原始訂單付款狀態、左側待收款顯示及帳務資料不變；副機無須更新。\n- `local-print/packing_footer.py` 合併同品名／貨號數量、自動換行和 1–3 欄，字級最低 7 pt。超出可讀範圍就停止準備，不漏印、不截斷、不增加紙張。
- `prepare.py` 先走既有各平台正常化／MOMO 分流，再保留 `original-labels.pdf`，產生新 `labels.pdf`。輸入 `source.pdf` 完全保留。縮放後的 203 dpi 黑白 PNG 必須與原單所有條碼內容及數量一致。
- `/prepare` 回傳 `preview`，其內容正是送印第一張 PNG。共用視窗改為這份預覽，不再只看原始 PDF。
- 作業快取雜湊包含商品、數量、總額、訂單、版型、物流。舊版 prepared 檔案不會拿來當新版標籤。
- 已送印原單先建立 `preview` 狀態的新布局，`/print` 拒絕此狀態。只有使用者按下重印、以 `reprint:true` 再準備後才建立可送印作業。既有 submitted/uncertain 紀錄完整保留；不明送印結果仍攔截重試。

## 副機更新

### 已保存原單取回相容性

`cached_document.py` 以 `sourceDigest` 核對新版商品標籤作業的原始 PDF，同時相容舊作業的 `digest`。新版 `digest` 包含商品及版型，不能再直接拿它比對原單雜湊；否則會把已保存原單誤判成平台未提供。`preview` 作業也可取回其已驗證的原單，但取回不改變送印權限。

原始 PDF 仍必須通過蝦皮通路雜湊、訂單編號、物流號及 `preview.py` 的條碼檢查。只讀取 `source.pdf`，不以合成後標籤冒充原單，不更動列印歷史或自動送印。已安裝助手每次請求都啟動此腳本，備份後更新 `cached_document.py` 即生效，無須重啟服務。`preview.py` 在本目錄保留現場核對版本。

驗證：`python -m unittest discover -s local-print -p test_cached_document.py`。

現場安裝位置 `%LOCALAPPDATA%\YouziShippingPrint`。先備份服務檔案、設定及所有 `jobs/*/status.json` 雜湊，確認列印佇列空且沒有 preparing/submitting 作業。更新 `bridge.py`、`prepare.py`、新增 `packing_footer.py`；原有 `momo_split.py`、`shipping_cvs_layout.py` 原樣保留（本目錄保存當時基礎版本供維護）。需要現有 Python 的 reportlab、pypdf、pypdfium2、zxingcpp 及 Windows 微軟正黑體。

不覆蓋 config、密碼、print_labels.ps1、preview.py、cached_document.py、啟動設定或 jobs。只停止 health 所回報且命令列指向本服務的 PID，再用既有 start.ps1 隱藏啟動；檢查 18182 唯一 listener 及 health 的 release/packingLayouts。

## 驗證

`python -m unittest discover -s local-print -p test_packing_footer.py`

`node --test store-agent/test_shipping_local_print.cjs store-agent/test_shipping_paid_amount.cjs store-agent/test_shipping_packing_label.cjs`

另用現場既有 PDF 做不出紙轉換：MOMO 全家／7-11／雙聯、酷澎、新竹及店到家蝦皮。每張完整比對原始與最終黑白條碼，頁數與紙張尺寸。最後仍須使用者指定既有單試印，確認實際大小、張數、字體及每個條碼可掃描；軟體解碼通過不代表實體掃描已驗收。
