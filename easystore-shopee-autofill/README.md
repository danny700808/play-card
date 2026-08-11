# 柚子樂器 EasyStore 蝦皮自動填寫

這是獨立的 Chrome Manifest V3 擴充套件。它會從全通路營運中心接收一次性的蝦皮待填資料，在 EasyStore 蝦皮設定頁核對商品 ID 與 SKU，等使用者按「開始自動填寫」後再依欄位名稱填入分類、品牌、商品屬性、物流與預購。

重要限制：

- **目前只支援桌面版 Google Chrome。** 手機 Safari、手機 Chrome 不能安裝此擴充套件。
- 擴充套件**永遠不會按 EasyStore 最後的「上架」**；填完仍由使用者檢查並按上架。
- 待填資料只存於 `chrome.storage.session`，關閉 Chrome 會清除；完成一次自動填寫後也會立刻刪除該筆資料。
- 不會讀取或儲存 EasyStore 密碼、Cookie 或登入權杖。

## 安裝

1. 在全通路營運中心按「店內電腦第一次使用：下載助手」，下載並解壓縮安裝包。
2. 在桌面 Chrome 開啟 `chrome://extensions/`。
3. 開啟右上角「開發人員模式」。
4. 點「載入未封裝項目」。
5. 選擇解壓縮後的 `easystore-shopee-autofill/` 資料夾。
6. 程式更新後，回到擴充功能頁按「重新載入」。

擴充套件只在以下頁面執行：

- `https://danny700808.github.io/play-card/*`
- `https://admin.easystore.co/products/*`
- `https://admin.easystore.co/channels/shopee/taiwan/products/sync*`

## 使用流程

1. 在全通路營運中心完成「確認上架」。
2. 在蝦皮結果按「在 EasyStore 自動填寫」。
3. 頁面送出一次性資料，擴充套件以 `YOUZI_SHOPEE_AUTOFILL_ACK` 回覆相同 `nonce`。
4. EasyStore 商品頁會顯示助手；按「開啟蝦皮設定」。
5. 進入蝦皮設定頁後，擴充套件必須同時核對網址中的 EasyStore 商品 ID 與頁面的完整賣家 SKU，才顯示填寫面板。
6. 使用者按「開始自動填寫」。
7. 檢查「已填／保留人工值／略過／待補」報告。
8. 人工確認價格、庫存、分類、屬性及物流後，再按 EasyStore 的「上架」。

## 現行訊息格式

橋接程式送出的外層訊息必須包含來源：

```js
window.postMessage({
  source: "youzi-operations-hub",
  type: "YOUZI_SHOPEE_AUTOFILL_QUEUE",
  payload
}, location.origin);
```

擴充套件接受的 `payload` 與現有上架後端一致：

```js
const payload = {
  schemaVersion: 1,
  nonce: "azes40-prb-00000001",
  createdAt: Date.now(),
  expiresAt: Date.now() + 10 * 60 * 1000,
  productId: "catalog-azes40-prb",
  easyStoreProductId: "3969443",
  easyStoreUrl: "https://admin.easystore.co/products/3969443",
  sku: "1040160-1",
  title: "Ibanez AZES40-PRB AZ Essentials 電吉他－馬卡藍",
  categoryPath: [
    "愛好與收藏品",
    "樂器與樂器配件",
    "弦樂器",
    "吉他、貝斯"
  ],
  brand: "Ibanez",
  attributes: [
    { label: "Neck Material", value: "Maple", confidence: "high", note: "官方規格" },
    { label: "Body Material", value: "Poplar", confidence: "high", note: "官方規格" },
    { label: "Fretboard Material", value: "Jatoba", confidence: "high", note: "官方規格" },
    { label: "Pickup Configuration", value: "HSS", confidence: "high", note: "Essentials S-S-H" },
    { label: "Guitar Type", value: "Electric Guitar", confidence: "high", note: "產品類型" },
    { label: "Hand Configuration", value: "Right Handed", confidence: "high", note: "標準右手版" },
    { label: "Number of Strings", value: "6", confidence: "high", note: "六弦電吉他" },
    { label: "Item condition", value: "New", confidence: "high", note: "新品" },
    { label: "Weight", value: "4.2 kg", confidence: "medium", note: "包裝重量" },
    { label: "Dimension (L x W x H)", value: "106.7 x 45.7 x 10.2 cm", confidence: "medium", note: "包裝尺寸" }
  ],
  package: { lengthCm: 106.7, widthCm: 45.7, heightCm: 10.2, weightKg: 4.2 },
  logistics: {
    decision: "freight",
    packageTotalCm: 162.6,
    methods: [
      { label: "蝦皮店到店", enabled: false, option: "", sellerPays: false },
      { label: "7-ELEVEN", enabled: false, option: "", sellerPays: false },
      { label: "新竹物流", enabled: true, option: "S170", sellerPays: false },
      { label: "全家", enabled: false, option: "", sellerPays: false }
    ],
    requiresConfirmation: false
  },
  preorder: { enabled: false, days: 1 },
  guard: { brand: "Ibanez", model: "AZES40-PRB", color: "Purist Blue", identityStatus: "confirmed" }
};
```

ACK 格式：

```js
{
  type: "YOUZI_SHOPEE_AUTOFILL_ACK",
  nonce: payload.nonce,
  ok: true,
  error: ""
}
```

## 安全與保留規則

- 嚴格驗證 `schemaVersion`、`nonce`、建立／到期時間、SKU、EasyStore 商品 ID、EasyStore 網址、資料大小及欄位結構；已過期資料直接拒絕，不會替它延長期限。
- EasyStore 商品網址一律由通過驗證的商品 ID 重建為 `https://admin.easystore.co/products/{id}`；不信任訊息內可任意指定的路徑、查詢參數或片段。
- 頁面必須同時匹配 EasyStore 商品 ID 與完整 SKU。
- 非空白欄位視為人工資料並保留。
- 下拉選單只選完全相符值或程式內明列的核准同義詞，不做模糊猜測。
- `confidence: "low"` 的屬性不自動填。
- 不會關閉人工已開啟的物流。
- 新竹物流會用包裝最長邊、三邊總和及重量交叉檢查。AZES40 的 `106.7 + 45.7 + 10.2 = 162.6 cm`，因此對應 **S170**。
- S170 僅核准 `S170`、`161–170 cm`、`170cm（含）以下`、`≤170cm` 等同義顯示；不接受舊的 `151–180cm`。
- 找不到完全相符的新竹級距時，如果物流是擴充套件剛開啟的，會復原為關閉並列入「待補」。
- 找不到欄位或核准選項時列入「待補」，不強行輸入。
- 完成自動填寫後刪除一次性 session 記錄，且不會按最後「上架」。

## 測試

在本資料夾執行：

```bash
npm test
```

或：

```bash
node --test
```

測試只使用 Node.js 內建測試工具，不需安裝套件。
