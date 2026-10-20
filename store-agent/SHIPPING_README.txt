柚子樂器 出貨工作台 — 2026-10-20 第一版

使用方式
雙擊桌面「柚子樂器－出貨工作台」。
程式只在這台電腦的 http://127.0.0.1:18765 執行。
開啟時讀取近 30 天訂單；畫面開著時每 5 分鐘重新讀取。
選取訂單後，可核對商品名稱、規格、SKU、數量、原始圖片和備註。
相同 SKU、品名、規格的商品合計數量；運費不列為實體包貨商品。
蝦皮訂單新增「到 EasyStore 出貨／印蝦皮單」入口，開啟同一筆 EasyStore 訂單。
在 EasyStore 選「出貨 → 透過蝦皮台灣出貨」，核對後才開始出貨處理；
成功後選「更多功能 → 列印蝦皮交貨便服務單」。完成後回工作台讀取最新訂單。
此入口仍需在 EasyStore 確認，尚不是工作台內一鍵出貨。工作台畫面已明確標示。

目前可用
1. EasyStore、MOMO、酷澎訂單集中讀取。蝦皮、官網、LINE 依原始來源分類。
   LINE 只有平台明確標記為 LINE 才分類；不以猜測將官網訂單改為 LINE。
2. MOMO：第三方物流、7-11、全家正式貨運單 API 已實作。
   已用真實「已列印」訂單測試重印成功。原始 PDF、官方明細合併 PDF 可取回。
   部分 MOMO PDF 需要供應商公司統編作為密碼。
3. 酷澎：已用真實「待寄出」訂單測試取回正式 PDF 成功。
   新出貨申請限商品準備中（INSTRUCT），需選物流與填寫平台登記地址代碼。
4. 包貨明細列印，保留訂單原始規格圖片。未提供圖片的商品標示「圖片待配對」。

尚未完成的部分
蝦皮／官網／LINE 的正式貨運單接口尚未接入。
目前已確認 EasyStore 後台可操作蝦皮出貨，但現有訂單讀取 token 並不等於
可在外部系統呼叫該後台功能。本版本不把手動寫入物流單號冒充申請正式貨運單。
需取得可用的蝦皮物流授權，或 EasyStore 提供的物流操作接口，才能完成此部分。
LINE 訂單若合併為官網來源，需平台提供原始通路標記。
酷澎/MOMO 的商品圖片仍需接商品資料庫做精確 SKU 配對。
此版是單張操作，未提供批量申請出貨；超過 30 天的舊待出貨單不在目前查詢內。
新申請出貨流程有防重送及即時核對，但尚未用真實新訂單測試提交，
以免製作期間擅自產生出貨。正式使用前請選一筆確定要出貨的訂單驗收。

重要行為
同步／開啟畫面只讀取訂單，不改庫存或價格。
只有按「確認申請出貨」才提交平台。送出逾時會保留未確認紀錄，不自動重送。
下載既有貨運單不會再次申請出貨。
列印包貨明細不等於列印正式物流單。正式單維持平台原始 PDF／HTML。
不得使用取消、異常或地址已變動的訂單申請出貨。

安裝與資料
shipping-workbench 資料夾置於原有店內同步程式資料夾內，與 config.json 同層。
使用原本 .venv 與 config.json；本套件不含任何金鑰或顧客資料。
運單及紀錄保存在 %LOCALAPPDATA%\YouziShipping，不公開到 GitHub。
執行 start_shipping.ps1 會啟動本機服務並開啟畫面。
僅綁定 127.0.0.1；精確 Host、Origin 與工作階段 cookie 檢查防止外部網站操作。
如需搬到另一台電腦，需在該電腦安裝原本同步程式及授權，不能直接分享此網址。

測試
使用既有 .venv 執行：
python -m unittest test_shipping_workbench test_shipping_http -q
測試含取消/零件數阻擋、部分出貨、地址異動、防重送、
跨程序保留紀錄、正式文件保存、未授權存取與跨來源請求拒絕。

官方接口依據
MOMO 店+後台 A202：20241007001 API 文件，v0.11.4。
https://developers.coupang.com/zh-TW/api/shipments/for-taiwan-onlyarrange-shipment-for-directly-integrated-courier
https://developers.coupang.com/zh-TW/api/shipments/for-taiwan-onlydownload-invoice-for-direct-integrated-courier
https://developers.easystore.co/docs/api/popular-apis
https://developers.easystore.co/docs/api/logistic-apps/awb-printing
