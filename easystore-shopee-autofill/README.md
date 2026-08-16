# 柚子樂器 EasyStore 蝦皮自動填寫

這是獨立的 Chrome Manifest V3 擴充套件。它可以把淘寶、天貓、1688、阿里巴巴圖片直接送進指定的「準備上架」商品，也會從全通路營運中心接收一次性的蝦皮待填資料，在 EasyStore 蝦皮設定頁核對商品 ID 與 SKU，依欄位名稱填入分類、品牌、商品屬性、物流與預購；資料完整時接著按 EasyStore 的上架送到蝦皮。

重要限制：

- **目前只支援桌面版 Google Chrome。** 手機 Safari、手機 Chrome 不能安裝此擴充套件。
- 只有資料設定為自動上架、物流不需人工確認且填寫報告沒有「待補」時，才會按 EasyStore 最後的上架。
- 若找不到完全相符欄位、分類、物流級距或 EasyStore 顯示錯誤，會停止並留在畫面讓使用者處理。
- 蝦皮只有在明確辨識為「更新既有商品」，或使用者已明確確認「沒有既有商品、允許新增」時才會送出；狀態不明就停止，避免建立重複商品。
- EasyStore 畫面若顯示「發布商品到蝦皮購物」，一律視為建立新品；即使資料庫已有舊蝦皮編號，也不能把新品畫面推測成更新。
- 蝦皮已有相同商品時，不刪除原商品；請先從蝦皮匯入 EasyStore，再用 **Match product** 連結到相同 SKU，之後走更新／重新同步。
- 待填資料會存於擴充功能自己的 `chrome.storage.local`，讓營運中心與 EasyStore 分頁能可靠交接；每筆只有 30 分鐘效期，成功送出後立即刪除，過期資料不會執行。
- 不會讀取或儲存 EasyStore 密碼、Cookie 或登入權杖。
- EasyStore 商品庫存為 `0` 時仍會照常建立或更新並送出蝦皮上架，商品會以缺貨狀態存在；之後由既有庫存同步流程更新可售庫存。

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
- 淘寶、天貓、1688、阿里巴巴及其官方圖片網域

## 供應商框選收圖

1. 在「準備上架」開啟指定商品，按「開始收圖」。
2. 保留商品頁，另外開啟淘寶、天貓、1688 或阿里巴巴。
3. 在供應商頁按右鍵選「柚子掌櫃：框選截圖」，或直接按 `Ctrl+Shift+Y`；再用滑鼠拉出需要的畫面，放開後會直接送入同一個 SKU／EasyStore 商品 ID 的「上傳圖片」區。
4. 若使用 Windows 的 `Win+Shift+S`，截完後回供應商頁按 `Ctrl+V`，截圖也會直接送入目前商品。
5. 每件商品最多保留 12 張來源圖片；截錯可回「準備上架」按圖片下方的「刪除」。原圖點選預設關閉，需要時可自行開啟。
6. 按 `Esc` 或「結束收圖」即可停止。這一步只收圖，不做簡繁轉換。

## EasyStore 實機檢查

EasyStore 改版或助手找不到入口／欄位時，商品頁與蝦皮設定頁左下角會固定顯示 **「EasyStore 實機檢查」**：

1. 按「開始實機記錄」。
2. 照平常方式依序開啟「更多操作」、蝦皮入口、分類、品牌、屬性與物流；只需展示選項，不要按最後上架。
3. 記錄會跨 EasyStore 頁面接續。完成後按「完成並下載檢查檔」。
4. 將下載的 `youzi-easystore-live-check-*.json` 提供給開發人員，即可依實際 DOM、按鈕、選項與捲動容器修正，不必再從照片猜測。

檢查檔不包含密碼、Cookie、登入權杖、文字輸入框內容或文字輸入值；只包含 EasyStore 畫面中可見的按鈕／選項文字、安全屬性、位置與捲動尺寸。記錄最長保留兩小時，取消或下載後會從擴充功能儲存區刪除。

## 使用流程

1. 在全通路營運中心完成「確認上架」。
2. 在蝦皮結果按「安全開啟 EasyStore／蝦皮」。
3. 頁面送出一次性資料，擴充套件以 `YOUZI_SHOPEE_AUTOFILL_ACK` 回覆相同 `nonce`。
4. EasyStore 商品頁會顯示助手並自動進入蝦皮設定；助手會等待動態載入的「銷售管道」，辨識蝦皮複合狀態列，展開後繼續尋找「刷新／連接商品」入口。若 EasyStore 超過 10 秒仍未載入，可按畫面上的按鈕重試。
5. 進入蝦皮設定頁後，擴充套件優先核對網址中唯一的 `store_product_ids`；分類尚未選擇、頁面還沒顯示賣家 SKU 時也能接續。若之後出現明確但不同的賣家 SKU 會立即停止；舊版網址若只有一般 `product_ids`，仍必須再核對賣家 SKU 欄位才顯示填寫面板。
6. 助手先辨識目前入口是「建立新品」或「更新舊商品」；建立新品只有在上架資料明確允許時才能繼續。
7. 助手自動開始填寫；畫面上的「自動填寫並上架蝦皮」保留作為重試按鈕。
8. 助手產生「已填／保留人工值／略過／待補」報告。
9. 沒有待補、物流明確且新增／更新狀態安全時，助手按 EasyStore 的上架；否則停止並顯示原因。

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
  schemaVersion: 4,
  nonce: "azes40-prb-00000001",
  createdAt: Date.now(),
  expiresAt: Date.now() + 30 * 60 * 1000,
  productId: "catalog-azes40-prb",
  easyStoreProductId: "3969443",
  easyStoreUrl: "https://admin.easystore.co/products/3969443",
  sku: "1040160-1",
  title: "Ibanez AZES40-PRB AZ Essentials 電吉他－馬卡藍",
  publishMode: "auto",
  listingPolicy: {
    decision: "auto", // auto、existing 或 new
    matchKey: "sku",
    allowCreate: false,
    existingListingIds: [],
    onZero: "create-only-if-confirmed",
    onOne: "update",
    onMultiple: "block"
  },
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
      { label: "黑貓宅急便", enabled: false, option: "", feeTwd: null, sellerPays: false },
      { label: "蝦皮店到店 - 隔日到貨", enabled: false, option: "", feeTwd: null, sellerPays: false },
      { label: "蝦皮店到店", enabled: false, option: "", feeTwd: null, sellerPays: false },
      { label: "7-ELEVEN", enabled: false, option: "", feeTwd: null, sellerPays: false },
      { label: "新竹物流", enabled: true, option: "S170", feeTwd: null, sellerPays: false },
      { label: "全家", enabled: false, option: "", feeTwd: null, sellerPays: false },
      { label: "賣家宅配：大型/超重物品運送", enabled: true, option: "", feeTwd: 100, sellerPays: false },
      { label: "嘉里快遞", enabled: false, option: "", feeTwd: null, sellerPays: false },
      { label: "店到家宅配", enabled: false, option: "", feeTwd: null, sellerPays: false }
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
- EasyStore 商品首頁以網址中的唯一商品 ID 接續助手；蝦皮設定頁若帶唯一 `store_product_ids`，以該 EasyStore 商品 ID 接續（因分類完成前頁面不會顯示 SKU）。助手只讀「賣家 SKU」標籤所屬的可見欄位，不會把商品描述中的相同文字誤當成身分；若欄位之後顯示不同 SKU，會在送出前停止。舊版網址仍須同時匹配完整 SKU。
- 助手會把 EasyStore 蝦皮入口分類為 `update`、`create` 或 `unknown`。`update` 可繼續；`create` 需要 `listingPolicy.allowCreate: true`；`unknown` 一律停止。
- `allowCreate` 只有 `decision: "new"` 時才能為 `true`。標示為 `existing` 卻出現新品入口時，助手會要求先匯入並使用 **Match product**，不會代替使用者刪除原商品。
- 助手會先單獨完成分類階段：鎖定「請先選擇分類」卡片右側的鉛筆，確認分類選單已出現，再依核准路徑逐層選擇。EasyStore 每選一層會在右側新增獨立欄位；助手只捲動目前欄位的直向清單，必要時只移動分類視窗底部的橫向捲軸以顯示下一欄，並且只點完全相符的分類文字。只有頁面顯示完整分類路徑後，才重新讀取品牌、商品屬性、物流與預購。
- 分類任何一步未完成時，助手只回報目前卡住的分類步驟並立即停止，不會把尚未生成的品牌、物流與預購誤列為多個待補欄位。
- 品牌是分類後的第二個必填關卡；有品牌時只接受完全相符品牌，沒有品牌時只接受蝦皮核准的 `NOBRAND`／無品牌選項，未完成就立即停止。品牌完成後才逐一處理核准屬性；屬性有待補時停在第三階段。接著校正全部物流，指定物流未完成時停在第四階段；預購設定是第五階段，完成後才進入最後發布。
- 分類、品牌與商品屬性的非空白欄位視為人工資料並保留；物流與預購則依本次上架規則校正為指定狀態。
- 下拉選單只選完全相符值或程式內明列的核准同義詞，不做模糊猜測。
- `confidence: "low"` 的屬性不自動填。
- 物流會依後端已確認的商品尺寸與配送決策套用成一致狀態；未核准的物流會關閉，避免沿用上一件商品或人工測試留下的錯誤選項。
- 大型商品（`freight`）在符合新竹物流限制時，會同時開啟「新竹物流」與「賣家宅配：大型/超重物品運送」；賣家宅配固定向買家收取 **NT$100**，不勾選「我將承擔運費」。
- 新竹物流會用包裝最長邊、三邊總和及重量交叉檢查。AZES40 的 `106.7 + 45.7 + 10.2 = 162.6 cm`，因此對應 **S170**。
- S170 僅核准 `S170`、`161–170 cm`、`170cm（含）以下`、`≤170cm` 等同義顯示；不接受舊的 `151–180cm`。
- 找不到完全相符的新竹級距時，會關閉新竹物流並列入「待補」，不會保留錯誤級距後送出。
- 找不到欄位或核准選項時列入「待補」，不強行輸入。
- 庫存 `0` 不是待補條件，也不會阻止自動上架；助手不會自行把缺貨商品改成有庫存。
- 成功送出上架後刪除一次性待填記錄；若有待補或送出失敗則暫時保留，方便在 30 分鐘效期內修正後重試。

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
