# 柚子樂器 EasyStore 蝦皮自動填寫

這是獨立的 Chrome Manifest V3 擴充套件。它可以把一般商品網頁上的圖片或框選截圖直接送進指定的「準備上架」商品，也會從全通路營運中心接收一次性的蝦皮待填資料，在 EasyStore 蝦皮設定頁核對商品 ID 與 SKU，依欄位名稱填入分類、品牌、商品屬性、物流與預購；資料完整時接著按 EasyStore 的上架送到蝦皮。

重要限制：

- **目前只支援桌面版 Google Chrome。** 手機 Safari、手機 Chrome 不能安裝此擴充套件。
- 收圖面板支援一般 HTTP／HTTPS 網頁。Chrome 內建頁、Chrome 線上應用程式商店、其他擴充功能頁與部分內建 PDF 頁受瀏覽器限制；遇到這類頁面請用 Win+Shift+S，再回一般商品頁貼上或直接從營運中心上傳。
- 只有資料設定為自動上架、物流不需人工確認且填寫報告沒有「待補」時，才會按 EasyStore 最後的上架。
- 若找不到完全相符欄位、分類、物流級距或 EasyStore 顯示錯誤，會停止並留在畫面讓使用者處理。
- 蝦皮建立／更新方向只讀中央商品已保存的平台 ID：沒有 ID 就建立新品；有且只有一個 ID 就更新既有商品；加入細項時則更新指定的既有父商品。正式路徑不會先掃描平台，也不會再使用舊的配對決策。
- EasyStore 畫面尚未顯示明確建立／更新文字時可依中央平台 ID 繼續；若畫面明確顯示與中央方向相反，或同時出現互相矛盾的狀態，會在送出前停止。
- 送出結果不明時只用完全相同的 SKU 回查同一筆工作，不會另建替代商品或切換到另一條上架路徑。
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
7. 0.3.31 會要求「所有網站」與腳本執行權限；這兩項用於頁內框選截圖，以及替更新前已開啟的普通網頁補載入收圖面板。
8. 同一台電腦不要同時保留舊版與 0.3.31；更新後重新整理營運中心，再重新開始搜圖。

擴充套件只在以下頁面執行：

- `https://danny700808.github.io/play-card/*`
- `https://admin.easystore.co/products/*`
- `https://admin.easystore.co/channels/shopee/taiwan/products/sync*`
- 一般 `http`／`https` 商品網頁（包含台灣官網、淘寶、天貓、1688、阿里巴巴）

## 供應商框選收圖

1. 在「準備上架」開啟指定商品，按「開始搜圖」。
2. 保留商品頁，另外開啟任何一般商品網頁；右上角會自動出現「柚子掌櫃收圖中」。
   - 開始搜圖時，0.3.31 也會替更新前已開著的普通網頁自動補載入；新開或重新整理的商品頁會照常自動出現。
3. 「點圖片加入」預設關閉，讓商品頁連結維持正常可點。要抓單張圖片時先按一下開啟，再把滑鼠移到圖片上；出現綠框後點一下，圖片會自動加入同一個 SKU／EasyStore 商品 ID。不使用時再按一次即可關閉綠框。助手會優先讀取乾淨原圖，網站阻擋時才自動改用可見畫面截圖。
4. 要截取畫面的一部分時，直接按右上角的「框選截圖」，按住滑鼠拉出範圍，放開後可選擇「確認截圖」、「重新框選」或「取消框選」；取消後會立即恢復商品頁正常操作。
5. 仍可用 `Ctrl+Shift+Y` 直接開始框選；若使用 Windows 的 `Win+Shift+S`，截完後回商品頁按 `Ctrl+V`，截圖也會送入目前商品。
6. 每件商品最多保留 20 張來源圖片；正式處理時仍最多勾選 12 張。截錯可回「準備上架」按圖片下方的「刪除」。
7. 按 `Esc` 或「結束搜圖」即可停止。這一步只收圖，不做簡繁轉換。

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
3. 頁面送出一次性 v3 工作資料，擴充套件以 `YOUZI_SHOPEE_AUTOFILL_ACK_V2` 回覆相同 `nonce`（訊息名稱保留 V2 是傳輸協定名稱，不代表舊工作流程）。
4. EasyStore 商品頁會顯示助手並自動進入蝦皮設定；助手會等待動態載入的「銷售管道」，辨識蝦皮複合狀態列，展開後繼續尋找「刷新／連接商品」入口。若 EasyStore 超過 10 秒仍未載入，可按畫面上的按鈕重試。
5. 進入蝦皮設定頁後，擴充套件優先核對網址中唯一的 `store_product_ids`；分類尚未選擇、頁面還沒顯示賣家 SKU 時也能接續。若之後出現明確但不同的賣家 SKU 會立即停止；舊版網址若只有一般 `product_ids`，仍必須再核對賣家 SKU 欄位才顯示填寫面板。
6. 助手依中央平台 ID 決定建立新品、更新舊商品或新增細項；頁面狀態未知不會阻擋，只有明確矛盾才停止。
7. 助手自動開始填寫；畫面上的「自動填寫並上架蝦皮」保留作為重試按鈕。
8. 助手產生「已填／保留人工值／略過／待補」報告。
9. 沒有待補、物流明確且頁面未出現方向矛盾時，助手按 EasyStore 的上架；否則停止並顯示原因。

## 現行訊息格式

橋接程式送出的外層訊息必須包含來源：

```js
window.postMessage({
  source: "youzi-operations-hub",
  type: "YOUZI_SHOPEE_AUTOFILL_QUEUE_V2",
  payload
}, location.origin);
```

擴充套件接受的 `payload` 與現有上架後端一致：

```js
const payload = {
  schemaVersion: 6,
  workflowVersion: "youzi-four-channel-listing-v3",
  jobId: "publish-job-id",
  snapshotId: "media-snapshot-id",
  snapshotFingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  nonce: "azes40-prb-00000001",
  createdAt: Date.now(),
  expiresAt: Date.now() + 30 * 60 * 1000,
  productId: "catalog-azes40-prb",
  easyStoreProductId: "3969443",
  easyStoreUrl: "https://admin.easystore.co/products/3969443",
  sku: "1040160-1",
  title: "Ibanez AZES40-PRB AZ Essentials 電吉他－馬卡藍",
  publishMode: "auto", // 新增細項時為 add-variant-to-existing
  variantGroup: null,
  listingPolicy: {
    mode: "update-existing", // create-new、update-existing 或 add-variant-to-existing
    identitySource: "central-platform-id", // create-new 時為 new-draft
    platformListingIds: ["SP-123456"],
    preflightSkuSearch: false,
    uncertainSubmitRecovery: "exact-sku-only"
  },
  categoryPath: [
    "愛好與收藏品",
    "樂器與樂器配件",
    "弦樂器",
    "吉他、貝斯"
  ],
  brand: "Ibanez",
  advancedDescription: {
    mode: "use-easystore-rich-description",
    source: "easystore-body-html",
    preparedBeforeNavigation: true,
    enableWhenAvailable: true,
    useEasyStoreDescription: true,
    capabilityProbe: "single-lightweight-page-probe",
    contentFingerprint: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    imageUrls: [],
    expectedImageCount: 0,
    fixedFinalDisclaimer: "商品圖片與規格僅供參考，實際內容以收到的實體商品為準。"
  },
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
  type: "YOUZI_SHOPEE_AUTOFILL_ACK_V2",
  nonce: payload.nonce,
  ok: true,
  error: ""
}
```

## 安全與保留規則

- 嚴格驗證 `schemaVersion`、`nonce`、建立／到期時間、SKU、EasyStore 商品 ID、EasyStore 網址、資料大小及欄位結構；已過期資料直接拒絕，不會替它延長期限。
- EasyStore 商品網址一律由通過驗證的商品 ID 重建為 `https://admin.easystore.co/products/{id}`；不信任訊息內可任意指定的路徑、查詢參數或片段。
- EasyStore 商品首頁以網址中的唯一商品 ID 接續助手；蝦皮設定頁若帶唯一 `store_product_ids`，以該 EasyStore 商品 ID 接續（因分類完成前頁面不會顯示 SKU）。助手只讀「賣家 SKU」標籤所屬的可見欄位，不會把商品描述中的相同文字誤當成身分；若欄位之後顯示不同 SKU，會在送出前停止。舊版網址仍須同時匹配完整 SKU。
- 助手會把 EasyStore 蝦皮入口分類為 `update`、`create`、`unknown` 或 `conflict`。正式方向由 `listingPolicy.mode` 與中央平台 ID 決定；`unknown` 可繼續，明確相反或 `conflict` 才停止。
- `create-new` 必須沒有中央蝦皮平台 ID；`update-existing` 與 `add-variant-to-existing` 必須恰有一個中央平台 ID。多個 ID、方向矛盾或缺少細項父商品資料都會停止，不會猜測。
- 新增細項資料以 `variantGroup` 保存父商品、父／子 SKU、細項名稱和值，以及已完成繁體化的父／子代表圖；通過相同身分與必填驗證後可自動送出。
- 助手會先單獨完成分類階段：鎖定「請先選擇分類」卡片右側的鉛筆，確認分類選單已出現，再依核准路徑逐層選擇。EasyStore 每選一層會在右側新增獨立欄位；助手只捲動目前欄位的直向清單，必要時只移動分類視窗底部的橫向捲軸以顯示下一欄，並且只點完全相符的分類文字。只有頁面顯示完整分類路徑並核對賣家 SKU 後，才進入已準備的進階商品描述、品牌、商品屬性、物流與預購。
- 官網 HTML 介紹、介紹圖片與順序在開啟蝦皮前已寫入不可變快照。蝦皮頁只做一次輕量功能檢查；若帳號出現「進階商品描述」，助手會直接開啟並按「使用 EasyStore 的產品描述」，把文字與介紹圖片一起帶入。蝦皮頁內不重新分析、改寫文案或重排圖片；功能不存在時保留純文字描述，功能存在但無法開啟／套用時才停止送出。
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
