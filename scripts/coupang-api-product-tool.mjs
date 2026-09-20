import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { selectCoupangGalleryUrls } from './coupang-gallery-plan.mjs';

const HOST = 'https://api-gateway.coupang.com';
const vendorId = String(process.env.COUPANG_VENDOR_ID || '').trim();
const accessKey = String(process.env.COUPANG_ACCESS_KEY || '').trim();
const secretKey = String(process.env.COUPANG_SECRET_KEY || '').trim();

if (!vendorId || !accessKey || !secretKey) {
  throw new Error('Missing Coupang API credentials in environment variables.');
}

function signedDate() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').slice(2);
}

function authorization(method, path, query = '') {
  const date = signedDate();
  const message = date + method.toUpperCase() + path + query;
  const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${date}, signature=${signature}`;
}

async function request(method, path, queryParams = {}, body) {
  const query = new URLSearchParams(Object.entries(queryParams).filter(([, value]) => value !== '' && value != null)).toString();
  const response = await fetch(`${HOST}${path}${query ? `?${query}` : ''}`, {
    method,
    headers: {
      Authorization: authorization(method, path, query),
      'Content-Type': 'application/json;charset=UTF-8',
      Accept: 'application/json',
      'X-EXTENDED-TIMEOUT': '90000',
      'X-MARKET': 'TW',
      'X-Requested-By': vendorId
    },
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: text }; }
  if (!response.ok) {
    const error = new Error(`Coupang API ${response.status}: ${payload?.message || text || 'request failed'}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function sellerProductIds(value, result = new Set()) {
  if (Array.isArray(value)) value.forEach((entry) => sellerProductIds(entry, result));
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'sellerProductId' && entry != null) result.add(String(entry));
      else sellerProductIds(entry, result);
    }
  }
  return [...result];
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') return value;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, entry]) => [key, decodeFirestoreValue(entry)]));
  return value;
}

function decodeFirestoreDocument(document) {
  return Object.fromEntries(Object.entries(document?.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function pick(source, keys) {
  return Object.fromEntries(keys.filter((key) => source?.[key] !== undefined).map((key) => [key, source[key]]));
}

function safeSearchTag(value) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COUPANG_ATTRIBUTE_NAME_MAX = 25;
const COUPANG_REDUNDANT_ATTRIBUTE_NAMES = new Set([
  'Parent Manufacturer Part Number',
  'Manufacturer Part Number'
]);

function sanitizeCoupangPayload(input) {
  const body = input && typeof input === 'object' ? input : {};
  body.items = (body.items || []).map((item) => {
    const attributes = (item.attributes || []).filter((attribute) => {
      const name = String(attribute?.attributeTypeName || '').trim();
      return name && !COUPANG_REDUNDANT_ATTRIBUTE_NAMES.has(name);
    });
    const overlong = attributes.find((attribute) => Array.from(String(attribute.attributeTypeName || '').trim()).length > COUPANG_ATTRIBUTE_NAME_MAX);
    if (overlong) {
      throw new Error(`Coupang attribute name exceeds ${COUPANG_ATTRIBUTE_NAME_MAX} characters before submission: ${overlong.attributeTypeName}`);
    }
    return { ...item, attributes };
  });
  return body;
}

function buildGroupedDrumstickPayload(templateFile, queueFile) {
  return Promise.all([
    fs.readFile(templateFile, 'utf8').then(JSON.parse),
    fs.readFile(queueFile, 'utf8').then(JSON.parse)
  ]).then(([templateRaw, queueRaw]) => {
    const queue = queueRaw && queueRaw.data ? queueRaw.data : queueRaw;
    const template = templateRaw.details?.[0]?.data || templateRaw.details?.[0] || templateRaw.data || templateRaw;
    const prepared = queue.payload?.preparedPlatformFieldPlan?.coupang?.preparedFields || {};
    const variants = prepared.variantGroup?.items || queue.payload?.variantGroupVariants || [];
    if (variants.length < 2) throw new Error('Grouped Coupang payload requires at least two variants.');
    const imageUrls = [...new Set(prepared.imageUrls || queue.payload?.images || [])];
    const baseItem = template.items?.[0] || {};
    const descriptionHtml = prepared.descriptionHtml || queue.payload?.coupangDescriptionHtml || '';
    const parentSku = String(variants[0].sku || queue.sku || '').replace(/-\d+$/, '');
    const shippingKeys = [
      'deliveryCompanyType', 'deliveryCompanyCode', 'deliveryChargeType', 'deliveryCharge',
      'freeShipOverAmount', 'deliveryChargeOnReturn', 'deliveryMethod',
      'outboundShippingPlaceId', 'outboundShippingTime'
    ];
    const returnKeys = [
      'pickUpBranchType', 'pickUpBranchId', 'pickUpBranchGroupCode', 'returnCenterCode',
      'returnChargeName', 'companyContactNumber', 'returnZipCode', 'returnAddress',
      'returnAddressDetail', 'returnCharge'
    ];
    const now = new Date();
    const saleStartedAt = now.toISOString().slice(0, 19);
    const commonTitle = String(prepared.title || queue.payload?.coupangTitle || queue.payload?.title || '').trim();
    const brandValue = String(prepared.brand?.value || prepared.brand || queue.payload?.brand || '').trim();
    const modelValue = String(prepared.model || queue.payload?.model || '').trim();
    if (!commonTitle) throw new Error('Grouped Coupang payload is missing the prepared title.');
    const commonNotices = [
      { noticeCategoryName: 'TW_General', noticeCategoryDetailName: '國內製造商或負責商名稱 ', content: '尚品樂器行' },
      { noticeCategoryName: 'TW_General', noticeCategoryDetailName: '原產地/國', content: '商品或包裝標示為準' },
      { noticeCategoryName: 'TW_General', noticeCategoryDetailName: '注意事項/備註欄', content: '避免高溫潮濕；使用前請檢查棒身，如有裂損請停止使用。' }
    ];
    const items = variants.map((variant, index) => {
      const optionValue = String(variant.value || variant.attributeValue || '').trim() || `款式 ${index + 1}`;
      const representation = String(variant.imageUrl || '').trim();
      if (!representation.startsWith('https://')) throw new Error(`Variant ${optionValue} is missing a public completed image URL.`);
      const detailImages = index === 0
        ? imageUrls.filter((url) => url !== representation).slice(0, 9)
        : [];
      const images = [
        { imageOrder: 0, imageType: 'REPRESENTATION', vendorPath: representation },
        ...detailImages.map((url, detailIndex) => ({ imageOrder: detailIndex + 1, imageType: 'DETAIL', vendorPath: url }))
      ];
      return {
        ...(variant.sellerProductItemId ? { sellerProductItemId: Number(variant.sellerProductItemId) } : {}),
        offerCondition: 'NEW', offerDescription: '',
        itemName: optionValue,
        originalPrice: Number(variant.price || variant.coupangPrice || prepared.price || 380),
        salePrice: Number(variant.price || variant.coupangPrice || prepared.price || 380),
        maximumBuyCount: Number(variant.stock ?? prepared.stock ?? 0),
        maximumBuyForPerson: 0,
        outboundShippingTimeDay: Number(baseItem.outboundShippingTimeDay || 1),
        maximumBuyForPersonPeriod: 1,
        unitCount: 1,
        adultOnly: 'EVERYONE',
        taxType: 'TAX',
        externalVendorSku: String(variant.sku || '').trim(),
        emptyBarcode: true,
        emptyBarcodeReason: String(baseItem.emptyBarcodeReason || '無商品條碼').slice(0, 100),
        barcode: '',
        modelNo: [brandValue, modelValue, optionValue].filter(Boolean).join('-').slice(0, 100),
        images,
        notices: commonNotices,
        attributes: [
          { attributeTypeName: '顏色', attributeValueName: optionValue },
          { attributeTypeName: '數量', attributeValueName: '1個' },
          { attributeTypeName: '尺寸', attributeValueName: modelValue || '5A' },
          { attributeTypeName: '商品材質', attributeValueName: '胡桃木' },
          { attributeTypeName: 'Parent Manufacturer Part Number', attributeValueName: parentSku },
          { attributeTypeName: 'Manufacturer Part Number', attributeValueName: String(variant.sku || '').trim() }
        ],
        contents: [{ contentsType: 'HTML', contentDetails: [{ detailType: 'TEXT', content: descriptionHtml }] }],
        certifications: [{ certificationType: 'NOT_REQUIRED', certificationCode: '', certificationAttachments: [] }],
        extraProperties: null,
        searchTags: [brandValue, modelValue, '鼓棒', optionValue, '打擊樂器', '爵士鼓'].filter(Boolean)
      };
    });
    return {
      sellerProductName: commonTitle,
      displayCategoryCode: Number(template.displayCategoryCode || 77688),
      vendorId,
      saleStartedAt,
      saleEndedAt: '2099-12-31T23:59:59',
      displayProductName: commonTitle,
      brand: brandValue,
      generalProductName: commonTitle,
      productGroup: '',
      deliveryMethod: template.deliveryMethod || 'SEQUENCIAL',
      deliveryCompanyCode: template.deliveryCompanyCode || 'TWL_HCT',
      multiShippingInfos: (template.multiShippingInfos || []).map((entry) => pick(entry, shippingKeys)),
      multiReturnInfos: (template.multiReturnInfos || [])
        .filter((entry) => String(entry.pickUpBranchType || '').toUpperCase() !== 'CVS')
        .map((entry) => pick(entry, returnKeys)),
      ...pick(template, [
        'deliveryChargeType', 'deliveryCharge', 'freeShipOverAmount', 'deliveryChargeOnReturn',
        'remoteAreaDeliverable', 'unionDeliveryType',
        'returnCenterCode', 'returnChargeName', 'companyContactNumber', 'returnZipCode',
        'returnAddress', 'returnAddressDetail', 'returnCharge', 'outboundShippingPlaceCode', 'vendorUserId'
      ]),
      requested: true,
      registrationType: 'NORMAL',
      items,
      requiredDocuments: [],
      manufacture: brandValue || '尚品樂器行'
    };
  });
}

function buildGroupedQueuePayload(templateFile, queueFile) {
  return Promise.all([
    fs.readFile(templateFile, 'utf8').then(JSON.parse),
    fs.readFile(queueFile, 'utf8').then(JSON.parse)
  ]).then(([templateRaw, queueRaw]) => {
    const queue = queueRaw && queueRaw.data ? queueRaw.data : queueRaw;
    const template = templateRaw.details?.[0]?.data || templateRaw.details?.[0] || templateRaw.data || templateRaw;
    const payload = queue.payload || {};
    const prepared = payload.preparedPlatformFieldPlan?.coupang?.preparedFields || {};
    const variants = prepared.variantGroup?.items || payload.variantGroupVariants || [];
    if (variants.length < 2) throw new Error('Grouped Coupang queue payload requires at least two variants.');
    const title = String(prepared.title || payload.coupangTitle || payload.title || '').trim();
    const descriptionHtml = String(prepared.descriptionHtml || payload.coupangDescriptionHtml || '').trim();
    const brand = String(prepared.brand?.value || prepared.brand || payload.brand || '').trim();
    const targetCategoryCode = Number(prepared.categoryCode || template.displayCategoryCode);
    const categoryChanged = targetCategoryCode !== Number(template.displayCategoryCode);
    if (!title || !descriptionHtml) throw new Error('Grouped Coupang queue payload is missing the prepared title or description.');

    const existingItems = new Map((template.items || []).map((item) => [String(item.externalVendorSku || '').trim(), item]));
    const baseItem = template.items?.[0] || {};
    const preparedImages = [...new Set((prepared.imageUrls || payload.images || [])
      .map((url) => String(url || '').trim())
      .filter((url) => /^https:\/\//.test(url) && !url.includes('product-listing-store-promo')))];
    const shippingKeys = [
      'deliveryCompanyType', 'deliveryCompanyCode', 'deliveryChargeType', 'deliveryCharge',
      'freeShipOverAmount', 'deliveryChargeOnReturn', 'deliveryMethod',
      'outboundShippingPlaceId', 'outboundShippingTime'
    ];
    const returnKeys = [
      'pickUpBranchType', 'pickUpBranchId', 'pickUpBranchGroupCode', 'returnCenterCode',
      'returnChargeName', 'companyContactNumber', 'returnZipCode', 'returnAddress',
      'returnAddressDetail', 'returnCharge'
    ];
    const noticeRows = (baseItem.notices || []).map((notice) => ({
      noticeCategoryName: notice.noticeCategoryName,
      noticeCategoryDetailName: notice.noticeCategoryDetailName,
      content: notice.noticeCategoryDetailName === '國內製造商或負責商名稱 ' ? '尚品樂器行'
        : notice.noticeCategoryDetailName === '原產地/國' ? '商品或包裝標示為準'
          : '使用前請確認商品與接頭完整；避免高溫、潮濕與過度彎折。'
    }));
    const items = variants.map((variant, index) => {
      const sku = String(variant.sku || '').trim();
      const option = String(variant.value || variant.attributeValue || '').trim() || `款式 ${index + 1}`;
      const imageUrl = String(variant.imageUrl || '').trim();
      const current = existingItems.get(sku) || baseItem;
      if (!sku || !/^https:\/\//.test(imageUrl)) throw new Error(`Variant ${option} is missing an exact SKU or completed image URL.`);
      // Do not resend optional legacy attributes with empty values. This musical-instrument
      // category only mandates the option size and quantity.
      const attributes = [
        { attributeTypeName: '尺寸', attributeValueName: option },
        { attributeTypeName: '數量', attributeValueName: '1個' }
      ];
      // A grouped listing owns one shared detail gallery.  Keep every variant's
      // clean representative on the variant itself, but attach the shared
      // clean/brand detail sequence to the first item only.  Otherwise Coupang
      // expands the same group gallery once per variant and the live product
      // ends up with repeated green-template images.
      const detailImages = index === 0
        ? preparedImages.filter((url) => url !== imageUrl).slice(0, 9)
        : [];
      return {
        ...(!categoryChanged && existingItems.has(sku) && current.sellerProductItemId
          ? { sellerProductItemId: Number(current.sellerProductItemId) } : {}),
        offerCondition: 'NEW', offerDescription: '', itemName: `${option}, 1個`,
        originalPrice: Number(variant.price || variant.coupangPrice || prepared.price || 0),
        salePrice: Number(variant.price || variant.coupangPrice || prepared.price || 0),
        maximumBuyCount: Number(current.maximumBuyCount || 1), maximumBuyForPerson: 0,
        outboundShippingTimeDay: Number(current.outboundShippingTimeDay || baseItem.outboundShippingTimeDay || 1),
        maximumBuyForPersonPeriod: Number(current.maximumBuyForPersonPeriod || 1), unitCount: 1,
        adultOnly: 'EVERYONE', taxType: 'TAX', externalVendorSku: sku,
        emptyBarcode: true, emptyBarcodeReason: '無商品條碼', barcode: '', modelNo: sku,
        images: [
          { imageOrder: 0, imageType: 'REPRESENTATION', vendorPath: imageUrl },
          ...detailImages.map((url, detailIndex) => ({ imageOrder: detailIndex + 1, imageType: 'DETAIL', vendorPath: url }))
        ],
        notices: noticeRows,
        attributes,
        contents: [{ contentsType: 'HTML', contentDetails: [{ detailType: 'TEXT', content: descriptionHtml }] }],
        certifications: [{ certificationType: 'NOT_REQUIRED', certificationCode: '', certificationAttachments: [] }],
        extraProperties: null,
        searchTags: [...new Set([brand, '6.35mm', '樂器導線', '吉他導線', option]
          .map(safeSearchTag).filter(Boolean))].slice(0, 20)
      };
    });
    return {
      sellerProductId: Number(template.sellerProductId),
      sellerProductName: title,
      displayCategoryCode: targetCategoryCode,
      vendorId,
      saleStartedAt: String(template.saleStartedAt || new Date().toISOString().slice(0, 19)),
      saleEndedAt: String(template.saleEndedAt || '2099-12-31T23:59:59'),
      displayProductName: title,
      brand,
      generalProductName: title,
      productGroup: String(template.productGroup || ''),
      deliveryMethod: template.deliveryMethod || 'SEQUENCIAL',
      deliveryCompanyCode: template.deliveryCompanyCode || 'TWL_HCT',
      multiShippingInfos: (template.multiShippingInfos || []).map((entry) => pick(entry, shippingKeys)),
      multiReturnInfos: (template.multiReturnInfos || []).map((entry) => pick(entry, returnKeys)),
      ...pick(template, [
        'deliveryChargeType', 'deliveryCharge', 'freeShipOverAmount', 'deliveryChargeOnReturn',
        'remoteAreaDeliverable', 'unionDeliveryType', 'returnCenterCode', 'returnChargeName',
        'companyContactNumber', 'returnZipCode', 'returnAddress', 'returnAddressDetail',
        'returnCharge', 'outboundShippingPlaceCode', 'vendorUserId'
      ]),
      requested: true, registrationType: 'NORMAL', items, requiredDocuments: [],
      manufacture: brand || String(template.manufacture || '尚品樂器行')
    };
  });
}

function buildSingleQueuePayload(templateFile, queueFile, categoryCodeOverride = '') {
  return Promise.all([
    fs.readFile(templateFile, 'utf8').then(JSON.parse),
    fs.readFile(queueFile, 'utf8').then(JSON.parse)
  ]).then(([templateRaw, queueRaw]) => {
    const queue = queueRaw && queueRaw.data ? queueRaw.data : queueRaw;
    const template = templateRaw.details?.[0]?.data || templateRaw.details?.[0] || templateRaw.data || templateRaw;
    const payload = queue.payload || {};
    const prepared = payload.preparedPlatformFieldPlan?.coupang?.preparedFields || {};
    const title = String(prepared.title || payload.coupangTitle || payload.title || '').trim();
    const descriptionHtml = String(prepared.descriptionHtml || payload.coupangDescriptionHtml || '').trim();
    const brand = String((typeof prepared.brand === 'object' ? prepared.brand?.value : prepared.brand) || (typeof payload.brand === 'string' ? payload.brand : '') || '').trim();
    const sku = String(payload.sku || prepared.sku || '').trim();
    const color = String(prepared.variantDefaults?.color || payload.color || '').trim();
    const price = Number(prepared.price || payload.price || payload.coupangPrice || 0);
    const stock = Number(prepared.stock ?? payload.stock ?? 0);
    const categoryCode = Number(categoryCodeOverride || prepared.categoryCode || template.displayCategoryCode);
    const baseItem = template.items?.[0] || {};
    const imageUrls = selectCoupangGalleryUrls(prepared.imageUrls || payload.images || []);
    if (!title || !descriptionHtml || !sku || !price || !categoryCode || imageUrls.length < 1) {
      throw new Error('Single Coupang queue payload is missing title, description, SKU, price, category or completed images.');
    }
    const shippingKeys = [
      'deliveryCompanyType', 'deliveryCompanyCode', 'deliveryChargeType', 'deliveryCharge',
      'freeShipOverAmount', 'deliveryChargeOnReturn', 'deliveryMethod',
      'outboundShippingPlaceId', 'outboundShippingTime'
    ];
    const returnKeys = [
      'pickUpBranchType', 'pickUpBranchId', 'pickUpBranchGroupCode', 'returnCenterCode',
      'returnChargeName', 'companyContactNumber', 'returnZipCode', 'returnAddress',
      'returnAddressDetail', 'returnCharge'
    ];
    const templateNotices = (baseItem.notices || []).map((notice) => ({
      noticeCategoryName: notice.noticeCategoryName,
      noticeCategoryDetailName: notice.noticeCategoryDetailName,
      content: String(notice.noticeCategoryDetailName || '').includes('國內製造商或負責商名稱') ? '尚品樂器行'
        : String(notice.noticeCategoryDetailName || '').includes('原產地') ? '商品或包裝標示為準'
          : categoryCode === 77701
            ? '使用前請確認調音與各部件狀態；避免高溫、潮濕、碰撞與長時間日曬。'
            : '安裝前請核對規格；避免潮濕、重壓與過度拉伸。'
    }));
    const notices = categoryCode === 77717 ? [
      { noticeCategoryName: 'TW_General', noticeCategoryDetailName: '國內製造商或負責商名稱 ', content: '尚品樂器行' },
      { noticeCategoryName: 'TW_General', noticeCategoryDetailName: '原產地/國', content: '商品或包裝標示為準' },
      { noticeCategoryName: 'TW_General', noticeCategoryDetailName: '注意事項/備註欄', content: '使用前請確認接線與音量設定；避免高溫、潮濕、碰撞與長時間日曬。' }
    ] : templateNotices;
    const electricGuitarValues = {
      '慣用手方向': '右手',
      '數量': '1個',
      '電吉他類型': '實心電吉他',
      '顏色': color || 'LPK 淺粉色',
      '吉他弦線種類': '鋼弦',
      '吉他琴頸材質': '楓木',
      '吉他琴橋系統': 'T106 顫音琴橋',
      '吉他拾音器配置/構成': 'S-S-H',
      '商品材質': '孿葉蘇木',
      '電吉他/貝斯琴身材料': '白楊木',
      'Global Trade Item Number': '',
      '吉他琴橋線(弦)數': '6弦',
      'Parent Manufacturer Part Number': sku,
      '型號/產品編號': String(prepared.model || payload.model || sku).trim() || sku,
      'Manufacturer Part Number': sku,
      '是否需要電池': '否'
    };
    const stringAccessoryValues = {
      '商品材質': '琴弦',
      '樂器種類': '中胡',
      '弦徑規格': '內弦約0.61mm／外弦約0.37mm',
      '數量': '1套',
      '顏色': '銀色',
      '弦樂器弦種類': '鋼弦(Steel-CoreStrings)',
      'Global Trade Item Number': '',
      'Parent Manufacturer Part Number': sku,
      '型號/產品編號': String(prepared.model || payload.model || sku).trim() || sku,
      'Manufacturer Part Number': sku
    };
    const amplifierValues = {
      '型號/產品編號': String(prepared.model || payload.model || sku).trim() || sku,
      '顏色': color || '黑色',
      '數量': '1套',
      '擴音器型態': '組合擴音器',
      '放大器輸出': '10W',
      '擴音器揚聲器數量': '1個',
      '是否需要電池': '必要'
    };
    // A previous product supplies merchant logistics only, never product facts.
    const explicitAttributes = prepared.attributes || payload.coupangAttributes;
    const attributeValues = {
      '型號/產品編號': String(prepared.model || payload.model || sku).trim(),
      '數量': '1個',
      ...(color ? { '顏色': color } : {}),
      ...(!Array.isArray(explicitAttributes) && explicitAttributes || {})
    };
    const attributeRows = Array.isArray(explicitAttributes)
      ? explicitAttributes
      : Object.keys(attributeValues).map(attributeTypeName => ({attributeTypeName}));
    const attributes = attributeRows.map((row) => {
      const name = String(row.attributeTypeName || '').trim();
      return {
        attributeTypeName: name,
        attributeValueName: Object.prototype.hasOwnProperty.call(attributeValues, name)
          ? attributeValues[name]
          : String(row.attributeValueName || '').trim()
      };
    }).filter((row) => row.attributeTypeName && row.attributeValueName);
    const item = {
      offerCondition: 'NEW', offerDescription: '', itemName: String(prepared.model || payload.model || title).slice(0, 150),
      originalPrice: price, salePrice: price, maximumBuyCount: Math.max(0, stock), maximumBuyForPerson: 0,
      outboundShippingTimeDay: Number(baseItem.outboundShippingTimeDay || 1), maximumBuyForPersonPeriod: 1,
      unitCount: 1, adultOnly: 'EVERYONE', taxType: 'TAX', externalVendorSku: sku,
      emptyBarcode: true, emptyBarcodeReason: '無商品條碼', barcode: '', modelNo: sku,
      images: imageUrls.slice(0, 10).map((url, index) => ({
        imageOrder: index === 0 ? 0 : index,
        imageType: index === 0 ? 'REPRESENTATION' : 'DETAIL',
        vendorPath: url
      })),
      notices,
      attributes,
      contents: [{ contentsType: 'HTML', contentDetails: [{ detailType: 'TEXT', content: descriptionHtml }] }],
      certifications: [{ certificationType: 'NOT_REQUIRED', certificationCode: '', certificationAttachments: [] }],
      extraProperties: null,
      searchTags: [...new Set((prepared.searchTags || payload.searchTags || [brand, sku])
        .map(safeSearchTag).filter(Boolean))].slice(0, 20)
    };
    return {
      sellerProductName: title,
      displayCategoryCode: categoryCode,
      vendorId,
      saleStartedAt: new Date().toISOString().slice(0, 19),
      saleEndedAt: '2099-12-31T23:59:59',
      displayProductName: title,
      brand,
      generalProductName: title,
      productGroup: '',
      deliveryMethod: template.deliveryMethod || 'SEQUENCIAL',
      deliveryCompanyCode: template.deliveryCompanyCode || 'TWL_HCT',
      multiShippingInfos: (template.multiShippingInfos || [])
        .filter((entry) => {
          const convenienceAllowed = prepared.shipping?.convenienceStore?.enabled !== false
            && String(payload.shippingDecision || '').toLowerCase() !== 'freight';
          return convenienceAllowed || String(entry.deliveryCompanyType || '').toUpperCase() !== 'CVS';
        })
        .map((entry) => pick(entry, shippingKeys)),
      multiReturnInfos: (template.multiReturnInfos || [])
        .filter((entry) => String(entry.pickUpBranchType || '').toUpperCase() !== 'CVS')
        .map((entry) => pick(entry, returnKeys)),
      ...pick(template, [
        'deliveryChargeType', 'deliveryCharge', 'freeShipOverAmount', 'deliveryChargeOnReturn',
        'remoteAreaDeliverable', 'unionDeliveryType', 'returnCenterCode', 'returnChargeName',
        'companyContactNumber', 'returnZipCode', 'returnAddress', 'returnAddressDetail',
        'returnCharge', 'outboundShippingPlaceCode', 'vendorUserId'
      ]),
      requested: true,
      registrationType: 'NORMAL',
      items: [item],
      requiredDocuments: [],
      manufacture: brand || '尚品樂器行'
    };
  });
}

function buildGroupedSpecPayload(templateFile, specFile, uploadedFile) {
  return Promise.all([
    fs.readFile(templateFile, 'utf8').then(JSON.parse),
    fs.readFile(specFile, 'utf8').then(JSON.parse),
    fs.readFile(uploadedFile, 'utf8').then(JSON.parse)
  ]).then(([templateRaw, spec, uploaded]) => {
    const template = templateRaw.details?.[0]?.data || templateRaw.details?.[0] || templateRaw.data || templateRaw;
    const shippingKeys = [
      'deliveryCompanyType', 'deliveryCompanyCode', 'deliveryChargeType', 'deliveryCharge',
      'freeShipOverAmount', 'deliveryChargeOnReturn', 'deliveryMethod',
      'outboundShippingPlaceId', 'outboundShippingTime'
    ];
    const returnKeys = [
      'pickUpBranchType', 'pickUpBranchId', 'pickUpBranchGroupCode', 'returnCenterCode',
      'returnChargeName', 'companyContactNumber', 'returnZipCode', 'returnAddress',
      'returnAddressDetail', 'returnCharge'
    ];
    const title = String(spec.title || '').trim();
    const brand = String(spec.brand || '').trim();
    const variants = Array.isArray(spec.variants) ? spec.variants : [];
    if (!title || !variants.length) throw new Error('Grouped spec requires a title and variants.');
    const detailUrls = (spec.detailImageKeys || []).map((key) => uploaded[key]).filter((url) => /^https:\/\//.test(String(url || '')));
    const descriptionHtml = String(spec.descriptionHtml || spec.description || '').trim().replace(/\n/g, '<br>');
    const notices = [
      { noticeCategoryName: 'TW_General', noticeCategoryDetailName: '國內製造商或負責商名稱 ', content: '尚品樂器行' },
      { noticeCategoryName: 'TW_General', noticeCategoryDetailName: '原產地/國', content: '商品或包裝標示為準' },
      { noticeCategoryName: 'TW_General', noticeCategoryDetailName: '注意事項/備註欄', content: String(spec.notice || '使用前請確認商品完整；使用後置於乾燥處保存。') }
    ];
    const items = variants.map((variant, variantIndex) => {
      const imageUrl = uploaded[variant.imageKey];
      if (!/^https:\/\//.test(String(imageUrl || ''))) throw new Error(`Missing completed main image for ${variant.sku}.`);
      const option = String(variant.option || '').trim();
      const material = String(variant.material || '').trim();
      const variantDetails = variantIndex === 0
        ? detailUrls.filter((url) => url !== imageUrl).slice(0, 9)
        : [];
      return {
        ...(variant.sellerProductItemId ? { sellerProductItemId: Number(variant.sellerProductItemId) } : {}),
        offerCondition: 'NEW', offerDescription: '', itemName: option,
        originalPrice: Number(variant.price), salePrice: Number(variant.price),
        maximumBuyCount: Number(variant.stock), maximumBuyForPerson: 0,
        outboundShippingTimeDay: 1, maximumBuyForPersonPeriod: 1, unitCount: 1,
        adultOnly: 'EVERYONE', taxType: 'TAX', externalVendorSku: String(variant.sku),
        emptyBarcode: true, emptyBarcodeReason: '無商品條碼', barcode: '', modelNo: String(variant.sku),
        images: [
          { imageOrder: 0, imageType: 'REPRESENTATION', vendorPath: imageUrl },
          ...variantDetails.map((url, index) => ({ imageOrder: index + 1, imageType: 'DETAIL', vendorPath: url }))
        ],
        notices,
        // Existing grouped products must keep the category's exact attribute
        // schema.  A caller may therefore supply the validated attributes from
        // the current product instead of rebuilding them with generic names.
        attributes: Array.isArray(variant.attributes) && variant.attributes.length
          ? variant.attributes.map(({ attributeTypeName, attributeValueName }) => ({
              attributeTypeName: String(attributeTypeName || '').trim(),
              attributeValueName: String(attributeValueName || '').trim()
            })).filter(({ attributeTypeName }) => attributeTypeName)
          : [
              { attributeTypeName: '型號/產品編號', attributeValueName: String(variant.sku) },
              { attributeTypeName: '尺寸', attributeValueName: option },
              { attributeTypeName: '數量', attributeValueName: '1個' },
              { attributeTypeName: '樂器材質', attributeValueName: material },
              { attributeTypeName: 'Parent Manufacturer Part Number', attributeValueName: String(spec.parentSku || '').slice(0, 25) },
              { attributeTypeName: 'Manufacturer Part Number', attributeValueName: String(variant.sku) }
            ],
        contents: [{ contentsType: 'HTML', contentDetails: [{ detailType: 'TEXT', content: descriptionHtml }] }],
        certifications: [{ certificationType: 'NOT_REQUIRED', certificationCode: '', certificationAttachments: [] }],
        extraProperties: null,
        searchTags: [...new Set((spec.searchTags || []).concat([option, material]).map(safeSearchTag).filter(Boolean))].slice(0, 20)
      };
    });
    return {
      ...(spec.sellerProductId ? { sellerProductId: Number(spec.sellerProductId) } : {}),
      sellerProductName: title, displayCategoryCode: Number(template.displayCategoryCode), vendorId,
      saleStartedAt: new Date().toISOString().slice(0, 19), saleEndedAt: '2099-12-31T23:59:59',
      displayProductName: title, brand, generalProductName: title, productGroup: '',
      deliveryMethod: template.deliveryMethod || 'SEQUENCIAL',
      deliveryCompanyCode: template.deliveryCompanyCode || 'TWL_HCT',
      multiShippingInfos: (template.multiShippingInfos || []).map((entry) => pick(entry, shippingKeys)),
      multiReturnInfos: (template.multiReturnInfos || []).map((entry) => pick(entry, returnKeys)),
      ...pick(template, [
        'deliveryChargeType', 'deliveryCharge', 'freeShipOverAmount', 'deliveryChargeOnReturn',
        'remoteAreaDeliverable', 'unionDeliveryType', 'returnCenterCode', 'returnChargeName',
        'companyContactNumber', 'returnZipCode', 'returnAddress', 'returnAddressDetail',
        'returnCharge', 'outboundShippingPlaceCode', 'vendorUserId'
      ]),
      requested: true, registrationType: 'NORMAL', items, requiredDocuments: [],
      manufacture: brand || '尚品樂器行'
    };
  });
}

function buildSingleAcousticPayload(templateFile, queueFile, categoryCode) {
  return Promise.all([
    fs.readFile(templateFile, 'utf8').then(JSON.parse),
    fs.readFile(queueFile, 'utf8').then(JSON.parse)
  ]).then(([templateRaw, queueRaw]) => {
    const template = templateRaw.details?.[0]?.data || templateRaw.details?.[0] || templateRaw.data || templateRaw;
    const queue = queueRaw && queueRaw.data ? queueRaw.data : queueRaw;
    const payload = queue.payload || {};
    const prepared = payload.preparedPlatformFieldPlan?.coupang?.preparedFields || {};
    const title = String(prepared.title || payload.coupangTitle || '').trim();
    const sku = String(prepared.sku || payload.sku || queue.sku || '').trim();
    const brand = String(prepared.brand?.value || payload.brand || '').trim();
    const model = String(prepared.model || payload.model || '').trim();
    const color = String(prepared.variantDefaults?.color || payload.color || '原木色').trim();
    const price = Number(prepared.price ?? payload.coupangPrice);
    const stock = Math.max(0, Number(prepared.stock ?? payload.stock ?? 0));
    const descriptionHtml = String(prepared.descriptionHtml || payload.coupangDescriptionHtml || '').trim();
    const imageUrls = [...new Set((prepared.imageUrls || payload.platformImagePlan?.coupang?.imageUrls || [])
      .map((url) => String(url || '').trim())
      .filter((url) => /^https:\/\//.test(url) && !url.includes('product-listing-store-promo')))].slice(0, 7);
    if (!title || !sku || !Number.isFinite(price) || !imageUrls.length) throw new Error('Single acoustic payload is missing title, SKU, price or completed images.');

    const shippingKeys = [
      'deliveryCompanyType', 'deliveryCompanyCode', 'deliveryChargeType', 'deliveryCharge',
      'freeShipOverAmount', 'deliveryChargeOnReturn', 'deliveryMethod',
      'outboundShippingPlaceId', 'outboundShippingTime'
    ];
    const returnKeys = [
      'pickUpBranchType', 'pickUpBranchId', 'pickUpBranchGroupCode', 'returnCenterCode',
      'returnChargeName', 'companyContactNumber', 'returnZipCode', 'returnAddress',
      'returnAddressDetail', 'returnCharge'
    ];
    const shippingRows = (template.multiShippingInfos || [])
      .filter((entry) => String(entry.deliveryCompanyType || '').toUpperCase() !== 'CVS')
      .map((entry) => pick(entry, shippingKeys));
    const notices = [
      { noticeCategoryName: 'TW_General', noticeCategoryDetailName: '國內製造商或負責商名稱 ', content: '尚品樂器行' },
      { noticeCategoryName: 'TW_General', noticeCategoryDetailName: '原產地/國', content: '商品或包裝標示為準' },
      { noticeCategoryName: 'TW_General', noticeCategoryDetailName: '注意事項/備註欄', content: '本商品提供六個月保固；避免高溫、潮濕與日光直射，實際規格與配件內容以實品及原廠包裝為準。' }
    ];
    const attributes = [
      { attributeTypeName: '型號/產品編號', attributeValueName: model || sku },
      { attributeTypeName: '顏色', attributeValueName: color || '原木色' },
      { attributeTypeName: '數量', attributeValueName: '1個' },
      { attributeTypeName: '面板材料', attributeValueName: '雲杉' },
      { attributeTypeName: '木吉他/古典吉他 側板材質', attributeValueName: '桃花心木' },
      { attributeTypeName: '吉他琴頸材質', attributeValueName: '桃花心木' },
      { attributeTypeName: '商品材質', attributeValueName: '烏木' },
      { attributeTypeName: 'Parent Manufacturer Part Number', attributeValueName: model || sku },
      { attributeTypeName: 'Manufacturer Part Number', attributeValueName: sku }
    ];
    return {
      sellerProductName: title,
      displayCategoryCode: Number(categoryCode || template.displayCategoryCode),
      vendorId,
      saleStartedAt: new Date().toISOString().slice(0, 19),
      saleEndedAt: '2099-12-31T23:59:59',
      displayProductName: title,
      brand,
      generalProductName: title,
      productGroup: '',
      deliveryMethod: template.deliveryMethod || 'SEQUENCIAL',
      deliveryCompanyCode: template.deliveryCompanyCode || 'TWL_HCT',
      multiShippingInfos: shippingRows,
      multiReturnInfos: (template.multiReturnInfos || [])
        .filter((entry) => String(entry.pickUpBranchType || '').toUpperCase() !== 'CVS')
        .map((entry) => pick(entry, returnKeys)),
      ...pick(template, [
        'deliveryChargeType', 'deliveryCharge', 'freeShipOverAmount', 'deliveryChargeOnReturn',
        'remoteAreaDeliverable', 'unionDeliveryType', 'returnCenterCode', 'returnChargeName',
        'companyContactNumber', 'returnZipCode', 'returnAddress', 'returnAddressDetail',
        'returnCharge', 'outboundShippingPlaceCode', 'vendorUserId'
      ]),
      requested: true,
      registrationType: 'NORMAL',
      items: [{
        offerCondition: 'NEW', offerDescription: '', itemName: color || model || '單一規格',
        originalPrice: price, salePrice: price, maximumBuyCount: stock,
        maximumBuyForPerson: 0, outboundShippingTimeDay: 1,
        maximumBuyForPersonPeriod: 1, unitCount: 1,
        adultOnly: 'EVERYONE', taxType: 'TAX', externalVendorSku: sku,
        emptyBarcode: true, emptyBarcodeReason: '無商品條碼', barcode: '', modelNo: model || sku,
        images: imageUrls.map((url, index) => ({ imageOrder: index === 0 ? 0 : index - 1, imageType: index === 0 ? 'REPRESENTATION' : 'DETAIL', vendorPath: url })),
        notices, attributes,
        contents: [{ contentsType: 'HTML', contentDetails: [{ detailType: 'TEXT', content: descriptionHtml }] }],
        certifications: [{ certificationType: 'NOT_REQUIRED', certificationCode: '', certificationAttachments: [] }],
        extraProperties: null,
        searchTags: [...new Set([brand, model, '木吉他', '民謠吉他', '41吋', color, '單板吉他'].map(safeSearchTag).filter(Boolean))]
      }],
      requiredDocuments: [],
      manufacture: brand || '尚品樂器行'
    };
  });
}

const [command, ...args] = process.argv.slice(2);

if (command === 'build-grouped-drumsticks') {
  const templatePath = String(args[0] || '').trim();
  const queuePath = String(args[1] || '').trim();
  const outputPath = String(args[2] || '').trim();
  if (!templatePath || !queuePath || !outputPath) throw new Error('build-grouped-drumsticks requires template, queue and output paths');
  const body = sanitizeCoupangPayload(await buildGroupedDrumstickPayload(templatePath, queuePath));
  await fs.writeFile(outputPath, JSON.stringify(body, null, 2), 'utf8');
  console.log(JSON.stringify({ sku: body.items.map((item) => item.externalVendorSku), category: body.displayCategoryCode, itemCount: body.items.length, imageCount: body.items.map((item) => item.images.length) }));
} else if (command === 'build-grouped-queue') {
  const templatePath = String(args[0] || '').trim();
  const queuePath = String(args[1] || '').trim();
  const outputPath = String(args[2] || '').trim();
  if (!templatePath || !queuePath || !outputPath) throw new Error('build-grouped-queue requires template, queue and output paths');
  const body = sanitizeCoupangPayload(await buildGroupedQueuePayload(templatePath, queuePath));
  await fs.writeFile(outputPath, JSON.stringify(body, null, 2), 'utf8');
  console.log(JSON.stringify({ sellerProductId: body.sellerProductId, sku: body.items.map((item) => item.externalVendorSku), category: body.displayCategoryCode, itemCount: body.items.length, imageCount: body.items.map((item) => item.images.length) }));
} else if (command === 'build-single-queue') {
  const templatePath = String(args[0] || '').trim();
  const queuePath = String(args[1] || '').trim();
  const outputPath = String(args[2] || '').trim();
  const categoryCode = String(args[3] || '').trim();
  if (!templatePath || !queuePath || !outputPath) throw new Error('build-single-queue requires template, queue, output and optional category code');
  const body = sanitizeCoupangPayload(await buildSingleQueuePayload(templatePath, queuePath, categoryCode));
  await fs.writeFile(outputPath, JSON.stringify(body, null, 2), 'utf8');
  console.log(JSON.stringify({ sku: body.items.map((item) => item.externalVendorSku), category: body.displayCategoryCode, imageCount: body.items[0]?.images?.length || 0 }));
} else if (command === 'build-grouped-spec') {
  const templatePath = String(args[0] || '').trim();
  const specPath = String(args[1] || '').trim();
  const uploadedPath = String(args[2] || '').trim();
  const outputPath = String(args[3] || '').trim();
  if (!templatePath || !specPath || !uploadedPath || !outputPath) throw new Error('build-grouped-spec requires template, spec, uploaded URLs and output paths');
  const body = sanitizeCoupangPayload(await buildGroupedSpecPayload(templatePath, specPath, uploadedPath));
  await fs.writeFile(outputPath, JSON.stringify(body, null, 2), 'utf8');
  console.log(JSON.stringify({ sku: body.items.map((item) => item.externalVendorSku), category: body.displayCategoryCode, itemCount: body.items.length }));
} else if (command === 'build-single-acoustic') {
  const templatePath = String(args[0] || '').trim();
  const queuePath = String(args[1] || '').trim();
  const outputPath = String(args[2] || '').trim();
  const categoryCode = String(args[3] || '').trim();
  if (!templatePath || !queuePath || !outputPath) throw new Error('build-single-acoustic requires template, queue, output and optional category code');
  const body = sanitizeCoupangPayload(await buildSingleAcousticPayload(templatePath, queuePath, categoryCode));
  await fs.writeFile(outputPath, JSON.stringify(body, null, 2), 'utf8');
  console.log(JSON.stringify({ sku: body.items.map((item) => item.externalVendorSku), category: body.displayCategoryCode, imageCount: body.items[0]?.images?.length || 0 }));
} else if (command === 'get') {
  const path = String(args[0] || '').trim();
  const outputPath = String(args[1] || '').trim();
  if (!path.startsWith('/')) throw new Error('get requires an absolute API path');
  const result = await request('GET', path);
  if (outputPath) await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({ code: result?.code, message: result?.message, saved: Boolean(outputPath) }));
} else if (command === 'lookup') {
  const sku = String(args[0] || '').trim();
  const outputPath = String(args[1] || '').trim();
  if (!sku) throw new Error('lookup requires SKU');
  const path = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/external-vendor-sku-codes/${encodeURIComponent(sku)}`;
  const summary = await request('GET', path);
  const ids = sellerProductIds(summary);
  const details = [];
  for (const id of ids) {
    details.push(await request('GET', `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${encodeURIComponent(id)}`));
  }
  if (outputPath) await fs.writeFile(outputPath, JSON.stringify({ sku, summary, details }, null, 2), 'utf8');
  console.log(JSON.stringify({ sku, sellerProductIds: ids, count: ids.length }));
} else if (command === 'predict-category') {
  const productName = String(args[0] || '').trim();
  const outputPath = String(args[1] || '').trim();
  if (!productName) throw new Error('predict-category requires a product name');
  const result = await request('POST', '/v2/providers/openapi/apis/api/v1/categorization/predict', {}, { productName });
  if (outputPath) await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({ productName, code: result?.code, message: result?.message, data: result?.data }));
} else if (command === 'list-by-name') {
  const productName = String(args[0] || '').trim();
  const outputPath = String(args[1] || '').trim();
  if (!productName) throw new Error('list-by-name requires a product name');
  const result = await request('GET', '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products', {
    vendorId, sellerProductName: productName, maxPerPage: 50
  });
  if (outputPath) await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({ productName, code: result?.code, message: result?.message, count: Array.isArray(result?.data) ? result.data.length : undefined }));
} else if (command === 'decode-firestore') {
  const inputPath = String(args[0] || '').trim();
  const outputPath = String(args[1] || '').trim();
  if (!inputPath || !outputPath) throw new Error('decode-firestore requires input and output paths');
  const raw = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const decoded = decodeFirestoreDocument(raw);
  await fs.writeFile(outputPath, JSON.stringify(decoded, null, 2), 'utf8');
  console.log(JSON.stringify({ keys: Object.keys(decoded), platform: decoded.platform, sku: decoded.sku, status: decoded.status }));
} else if (command === 'inspect-file') {
  const inputPath = String(args[0] || '').trim();
  if (!inputPath) throw new Error('inspect-file requires JSON input path');
  const raw = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const detail = raw.details?.[0]?.data || raw.details?.[0] || raw.data || raw;
  console.log(JSON.stringify({
    keys: Object.keys(detail || {}),
    sellerProductId: detail?.sellerProductId,
    statusName: detail?.statusName,
    displayCategoryCode: detail?.displayCategoryCode,
    sellerProductName: detail?.sellerProductName,
    displayProductName: detail?.displayProductName,
    brand: detail?.brand,
    deliveryMethod: detail?.deliveryMethod,
    deliveryCompanyCode: detail?.deliveryCompanyCode,
    multiShippingInfos: detail?.multiShippingInfos,
    returnChargeName: detail?.returnChargeName,
    items: (detail?.items || []).map((item) => ({
      keys: Object.keys(item),
      externalVendorSku: item.externalVendorSku,
      itemName: item.itemName,
      originalPrice: item.originalPrice,
      salePrice: item.salePrice,
      quantity: item.quantity,
      maximumBuyCount: item.maximumBuyCount,
      maximumBuyForPerson: item.maximumBuyForPerson,
      attributes: item.attributes,
      notices: item.notices,
      images: (item.images || []).map((image) => ({ imageOrder: image.imageOrder, imageType: image.imageType, vendorPath: image.vendorPath, cdnPath: image.cdnPath })),
      contents: (item.contents || []).map((content) => ({
        contentsType: content.contentsType,
        contentDetails: (content.contentDetails || []).map((entry) => ({ detailType: entry.detailType, content: String(entry.content || '').slice(0, 160) }))
      }))
    }))
  }, null, 2));
} else if (command === 'create') {
  const inputPath = String(args[0] || '').trim();
  if (!inputPath) throw new Error('create requires JSON input path');
  const body = sanitizeCoupangPayload(JSON.parse(await fs.readFile(inputPath, 'utf8')));
  const result = await request('POST', '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products', {}, body);
  console.log(JSON.stringify({ code: result?.code, message: result?.message, data: result?.data }));
} else if (command === 'append-description-video') {
  const [id, expectedSku, videoId, outputFile] = args;
  if (!/^\d+$/.test(id) || !/^[A-Za-z0-9_-]{11}$/.test(videoId) || !outputFile) throw Error('Invalid video parameters');
  const productPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${id}`;
  const before = await request('GET', productPath), product = structuredClone(before.data);
  const item = product.items.find(i => i.externalVendorSku === expectedSku);
  if (!item || String(product.sellerProductId) !== id) throw Error('Exact SKU mismatch');
  const detail = item.contents.find(c => c.contentsType === 'HTML')?.contentDetails.find(c => c.detailType === 'TEXT');
  if (!detail?.content) throw Error('Description missing');
  await fs.writeFile(`${outputFile}.before.json`, JSON.stringify(before,null,2));
  if (!detail.content.includes(`/embed/${videoId}`)) {
    detail.content = `<p><iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" title="實體商品介紹影片" frameborder="0" allowfullscreen></iframe></p>` + detail.content;
    const result = await request('PUT','/v2/providers/seller_api/apis/api/v1/marketplace/seller-products',{},product);
    await fs.writeFile(`${outputFile}.response.json`,JSON.stringify(result,null,2));
    if (result.code !== 'SUCCESS') throw Error(`Video update rejected: ${result.message}`);
  }
  // A successful write is not approval. Submit once and defer status inspection
  // to the next batch, rather than interpreting an eventually-consistent GET as failure.
  const submission = await request('PUT',productPath+'/approvals');
  const receipt={id,expectedSku,videoId,status:submission.code==='SUCCESS'?'pending-review':'failed',submittedAt:new Date().toISOString(),submissionReceipt:submission,nextCheckPolicy:'next-new-batch-once'};
  await fs.writeFile(outputFile,JSON.stringify(receipt,null,2));
  if(submission.code!=='SUCCESS')throw Error('Approval submission failed: '+submission.message);
  console.log(JSON.stringify({ok:true,id,expectedSku,videoId,status:'pending-review',approved:false}));
} else if (command === 'update') {
  const inputPath = String(args[0] || '').trim();
  if (!inputPath) throw new Error('update requires JSON input path');
  const body = sanitizeCoupangPayload(JSON.parse(await fs.readFile(inputPath, 'utf8')));
  const result = await request('PUT', '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products', {}, body);
  console.log(JSON.stringify({ code: result?.code, message: result?.message, data: result?.data }));
} else if (command === 'approve') {
  const id = String(args[0] || '').trim();
  if (!id) throw new Error('approve requires sellerProductId');
  const path = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${encodeURIComponent(id)}/approvals`;
  const result = await request('PUT', path);
  console.log(JSON.stringify({ sellerProductId: id, code: result?.code, message: result?.message, data: result?.data }));
} else if (command === 'suspend') {
  const vendorItemId = String(args[0] || '').trim();
  if (!vendorItemId) throw new Error('suspend requires vendorItemId');
  const path = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${encodeURIComponent(vendorItemId)}/sales/stop`;
  const result = await request('PUT', path);
  console.log(JSON.stringify({ vendorItemId, code: result?.code, message: result?.message, data: result?.data }));
} else if (command === 'resume') {
  const vendorItemId = String(args[0] || '').trim();
  if (!/^\d+$/.test(vendorItemId)) throw new Error('resume requires exact numeric vendorItemId');
  const path = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${encodeURIComponent(vendorItemId)}/sales/resume`;
  const result = await request('PUT', path);
  console.log(JSON.stringify({ vendorItemId, code: result?.code, message: result?.message, data: result?.data }));
} else if (command === 'get-inventory') {
  const vendorItemId = String(args[0] || '').trim();
  if (!vendorItemId) throw new Error('get-inventory requires vendorItemId');
  const path = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${encodeURIComponent(vendorItemId)}/inventories`;
  const result = await request('GET', path);
  console.log(JSON.stringify({ vendorItemId, code: result?.code, message: result?.message, data: result?.data }));
} else if (command === 'set-price-verified-sku') {
  const [productId, expectedSku, rawPrice, outputFile] = args;
  const targetPrice=Number(rawPrice);
  if(!/^\d+$/.test(productId)||!expectedSku||!Number.isInteger(targetPrice)||targetPrice<=0||!outputFile)throw Error('Exact product, SKU, positive price, receipt required');
  const before=await request('GET',`/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${productId}`);
  const matches=(before.data?.items||[]).filter(x=>x.externalVendorSku===expectedSku);
  if(matches.length!==1||!matches[0].vendorItemId)throw Error('Exact unique SKU not found');
  const item=matches[0],vendorItemId=String(item.vendorItemId);
  const result=Number(item.salePrice)===targetPrice?{code:'SUCCESS',message:'already matching'}:await request('PUT',`/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/prices/${targetPrice}`,{forceSalePriceUpdate:'true'});
  if(result.code!=='SUCCESS')throw Error('Price update failed: '+JSON.stringify(result));
  const verified=await request('GET',`/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${vendorItemId}/inventories`);
  const receipt={productId,expectedSku,vendorItemId,targetPrice,beforePrice:item.salePrice,result,verified,checkedAt:new Date().toISOString()};
  await fs.writeFile(outputFile,JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt));
} else if (command === 'set-quantity') {
  const vendorItemId = String(args[0] || '').trim();
  const quantity = Number(args[1]);
  if (!vendorItemId || !Number.isInteger(quantity) || quantity < 0) throw new Error('set-quantity requires vendorItemId and a non-negative integer');
  const path = `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/${encodeURIComponent(vendorItemId)}/quantities/${quantity}`;
  const result = await request('PUT', path);
  console.log(JSON.stringify({ vendorItemId, quantity, code: result?.code, message: result?.message, data: result?.data }));
} else {
  throw new Error('Usage: build-grouped-drumsticks <template.json> <queue.json> <output.json> | build-grouped-queue <template.json> <queue.json> <output.json> | build-single-queue <template.json> <queue.json> <output.json> [categoryCode] | build-grouped-spec <template.json> <spec.json> <uploaded.json> <output.json> | build-single-acoustic <template.json> <queue.json> <output.json> [categoryCode] | get <path> [output.json] | lookup <sku> [output.json] | predict-category <productName> [output.json] | list-by-name <productName> [output.json] | decode-firestore <input.json> <output.json> | inspect-file <input.json> | create <input.json> | update <input.json> | approve <sellerProductId> | suspend <vendorItemId> | get-inventory <vendorItemId> | set-quantity <vendorItemId> <quantity>');
}
