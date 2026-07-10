# 全通路營運中心｜第一階段安裝與測試說明

版本：2026-07-10 Phase 1

## 這一版完成的功能

1. 在原本 `settings.html` 管理首頁最上方新增「全通路營運中心」入口。
2. 新增 `operations-hub.html`，沿用原本管理員登入狀態，不需第二次登入。
3. 從既有 Firebase／Cloud Firestore 以唯讀方式尋找商品資料：
   - `easystoreProducts`
   - `websiteProducts`
   - `officialWebsiteProducts`
   - `websiteGoods`
   - `products`
4. 顯示商品名稱、SKU、規格、圖片、售價、庫存欄位、成本欄位及原商品連結。
5. 直接唯讀 `rentalContracts`，顯示租賃合約、客戶、設備、期間、租金、運費、押金與狀態。
6. 顯示 Firebase 專案、實際採用的商品集合、讀取筆數與錯誤診斷。
7. 支援桌機、平板與手機版面。

## 安全範圍

這一版沒有使用 Firestore 的 `set`、`add`、`update`、`delete`，也沒有呼叫平台修改 API。

因此本次新增頁面不會：

- 建立現場銷售
- 扣除或增加庫存
- 修改成本
- 修改租賃合約
- 更新 EasyStore、momo、Coupang
- 新增 Cloud Functions
- 修改 Firestore Rules

租賃資料需要修改時，頁面會連回原本的 `rental-admin.html`。

## 本次新增／修改檔案

| 檔案 | 狀態 | 說明 |
|---|---|---|
| `settings.html` | 修改 | 管理首頁新增全通路營運中心入口 |
| `operations-hub.html` | 新增 | 第一階段線上營運中心頁面 |
| `operations-phase1.css` | 新增 | 桌機及手機響應式樣式 |
| `operations-phase1.js` | 新增 | Firebase 唯讀載入、資料整理、搜尋及顯示 |
| `PHASE1_OPERATIONS_README.md` | 新增 | 本說明文件 |

其他既有頁面、Functions、Rules與資料集合均未修改。

## GitHub 部署方式

### 使用完整整合版

1. 先下載並備份目前 GitHub Repository。
2. 將完整整合版 ZIP 解壓縮。
3. 用整合版內容更新同一個 GitHub Repository。
4. Commit 訊息建議：

   `feat: add phase 1 omnichannel operations read-only hub`

5. Push 到原本 GitHub Pages 使用的分支。
6. 等待 GitHub Pages 完成部署。

### 只套用變更檔

將下列四個檔案放到 Repository 根目錄：

- `settings.html`
- `operations-hub.html`
- `operations-phase1.css`
- `operations-phase1.js`

其中 `settings.html` 是已合併入口的版本，請先備份原檔再覆蓋。

## 上線後測試順序

1. 用原本管理員帳號登入。
2. 進入「管理首頁」。
3. 確認最上方出現「全通路營運中心」。
4. 點入後確認不需要再次登入。
5. 查看「資料連線狀態」：
   - Firebase 專案應顯示 `youzi-c1b74`。
   - 商品主要來源應顯示其中一個既有商品集合。
   - `rentalContracts` 應顯示成功或明確錯誤。
6. 查看「商品與庫存」：
   - 商品名稱、SKU及圖片是否正確。
   - 有規格的商品是否拆成不同SKU。
   - 原資料有成本欄位時是否能顯示。
7. 查看「租賃概況」：
   - 合約編號、客戶、設備、起訖日及費用是否正確。
   - 按「原系統查看」是否回到正確租賃合約。
8. 用手機開啟相同網址測試版面及搜尋。

## 商品來源判定規則

頁面會依序查找：

1. `easystoreProducts`
2. `websiteProducts`
3. `officialWebsiteProducts`
4. `websiteGoods`
5. `products`

找到第一個具有可顯示商品的集合後即採用，不會同時混合多個集合，避免重複商品。

每次最多讀取 800 筆商品文件。若商品規格在 `variants` 陣列內，會拆成不同商品／規格卡片。

## 成本欄位判定

第一階段不新建成本資料，只辨識原文件內可能存在的欄位，例如：

- `averageCost`
- `avgCost`
- `movingAverageCost`
- `latestPurchaseCost`
- `purchasePrice`
- `costPrice`
- `unitCost`
- `cost`
- `平均成本`
- `進貨成本`

沒有上述資料時會顯示「尚未設定」，並留待第二階段建立正式成本與庫存異動結構。

## 金額顯示注意事項

租賃頁的「租金、運費、押金」是原合約欄位合計，不代表已經實際收到的金額。

- 押金不列為營業收入。
- 尚未扣除搬運、維修、取得成本與其他費用。
- 第二階段才會加入實收、應收、支出及租賃損益。

## 回復方式

若要移除第一階段：

1. 將 `settings.html` 回復到部署前版本。
2. 刪除：
   - `operations-hub.html`
   - `operations-phase1.css`
   - `operations-phase1.js`
3. Push 回 GitHub。

本次沒有修改 Firebase 資料，因此不需要回復資料庫。

## 第二階段預定內容

- 現場商品銷售
- 快速收入
- 進貨單與驗收入庫
- 庫存異動流水帳
- 平均成本及最近進貨成本
- 收款與支出
- 租賃實收、應收、搬運及維修成本
- 獨立 `ops...` Firestore 集合

第二階段開始前，應先確認第一階段顯示的商品來源、SKU與租賃欄位是否正確。
