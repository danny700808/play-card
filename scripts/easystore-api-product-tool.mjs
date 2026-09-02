import fs from 'node:fs/promises';

const baseUrl = 'https://www.mingtinghuang.com/api/3.0';
const storePromoImageUrl = 'https://danny700808.github.io/play-card/product-listing-store-promo.png';
const descriptionPromoPattern = /product-listing-description-promo-[12]\.jpg(?:$|[?#])/i;
const token = String(process.env.EASYSTORE_ACCESS_TOKEN || '').trim();
if (!token) throw new Error('EASYSTORE_ACCESS_TOKEN is required.');

function clean(value) {
  return String(value ?? '').trim();
}

function sku(value) {
  return clean(value).toUpperCase().replace(/\s+/g, '');
}

function products(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (payload.product && typeof payload.product === 'object') return [payload.product];
  for (const key of ['products', 'data', 'items', 'results']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (payload.data?.product) return [payload.data.product];
  return [];
}

function variants(product) {
  for (const key of ['variants', 'product_variants', 'productVariants', 'items']) {
    if (Array.isArray(product?.[key])) return product[key];
  }
  return [];
}

function images(product) {
  for (const key of ['images', 'product_images', 'productImages']) {
    if (Array.isArray(product?.[key])) return product[key];
  }
  return [];
}

function variantValue(variant) {
  return clean(variant?.option1 || variant?.name || variant?.title || variant?.variant_name);
}

function easyStoreSeoDescription(snapshot) {
  const title = clean(snapshot?.title);
  const lines = clean(snapshot?.description).split(/\r?\n/).map(clean).filter(Boolean);
  const features = [];
  let inFeatures = false;
  for (const line of lines) {
    if (line === '商品特色') { inFeatures = true; continue; }
    if (inFeatures && /^(?:使用方式|適用情境|商品規格)/.test(line)) break;
    if (!inFeatures) continue;
    features.push(line.replace(/^(?:\d+[.、]|[-•●])\s*/, ''));
  }
  const candidates = [title, ...(features.length ? features : lines.filter((line) => !/^(?:商品特色|使用方式|適用情境|商品規格)/.test(line)))];
  const parts = [];
  for (const candidate of candidates) {
    const next = [...parts, candidate].filter(Boolean).join('｜');
    if (Array.from(next).length > 180) break;
    if (candidate && !parts.includes(candidate)) parts.push(candidate);
  }
  return parts.join('｜') || Array.from(title).slice(0, 180).join('');
}

async function request(path, options = {}, attempt = 0) {
  const method = options.method || 'GET';
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'EasyStore-Access-Token': token,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(60_000)
    });
  } catch (error) {
    if (method !== 'POST' && attempt < 2) return request(path, options, attempt + 1);
    throw error;
  }
  const text = await response.text();
  if (!response.ok && method !== 'POST' && [408, 425, 429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
    return request(path, options, attempt + 1);
  }
  if (!response.ok) throw new Error(`EasyStore HTTP ${response.status}: ${text.slice(0, 700)}`);
  return text.trim() ? JSON.parse(text) : {};
}

async function adminRequest(path, options = {}) {
  const response = await fetch(`https://api.easystore.co/${String(path).replace(/^\/+/, '')}`, {
    method: options.method || 'GET',
    headers: {
      'EasyStore-Access-Token': token,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'easystore-source': 'admin'
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(60_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`EasyStore Admin HTTP ${response.status}: ${text.slice(0, 700)}`);
  return text.trim() ? JSON.parse(text) : {};
}

function imageUrl(row) {
  return clean(row?.url || row?.src || row?.source_url || row?.original_url);
}

function imageId(row) {
  return clean(row?.id || row?.image_id || row?.imageId);
}

function plannedImageTitle(url) {
  try {
    const value = new URL(clean(url));
    const marker = '/o/';
    const index = value.pathname.indexOf(marker);
    const path = index >= 0 ? value.pathname.slice(index + marker.length) : value.pathname.split('/').pop();
    return clean(path).replace(/\.(?:jpe?g|png|webp)$/i, '');
  } catch {
    return '';
  }
}

function uniqueUrls(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean)));
}

function easyStorePlatformImageUrls(snapshot) {
  const plan = snapshot?.platformImagePlan?.easyStore || {};
  const assignments = Array.isArray(plan.imageRoleAssignments) ? plan.imageRoleAssignments : [];
  const byUrl = new Map(assignments.map((row) => [clean(row?.url), row]));
  return uniqueUrls(plan.imageUrls || snapshot?.images || []).filter((url) => {
    const row = byUrl.get(url) || {};
    const roles = Array.isArray(row.roles) ? row.roles : [];
    const flags = row.assetFlags || {};
    if (roles.includes('brandedHero')) return false;
    // A dedicated MOMO promotion asset is not part of the EasyStore gallery.
    if (flags.momoPromotionEligible === true && !roles.includes('cleanMain') && !roles.includes('variantRepresentative')) return false;
    return true;
  });
}

function easyStoreGroupGallery(snapshot, expected) {
  const platformImages = easyStorePlatformImageUrls(snapshot);
  const representatives = uniqueUrls(expected.map((row) => row?.imageUrl));
  const baseImages = uniqueUrls(platformImages)
    .filter((url) => url !== storePromoImageUrl && !descriptionPromoPattern.test(url));
  const marketing = baseImages.filter((url) => !representatives.includes(url));
  if (!marketing[0]) throw new Error('EasyStore grouped gallery has no storefront main image.');
  if (representatives.length > 7) {
    throw new Error('EasyStore supports at most 7 unique variant images when storefront main and final store promo are retained.');
  }
  const productImages = uniqueUrls([marketing[0], ...representatives, ...marketing.slice(1)]).slice(0, 8);
  if (representatives.some((url) => !productImages.includes(url))) {
    throw new Error('EasyStore grouped gallery cannot retain every variant representative image.');
  }
  return productImages.length ? [...productImages, storePromoImageUrl] : [];
}

function variantTemplate(snapshot, row) {
  const value = clean(row.attributeValue);
  const price = Number(row.easyStorePrice);
  const verifiedOriginal = Number(row.storePrice);
  const compareAtPrice = Number.isFinite(verifiedOriginal) && verifiedOriginal > price
    ? verifiedOriginal
    : Math.ceil((price * 1.35) / 10) * 10;
  return {
    sku: sku(row.sku),
    barcode: clean(row.barcode) || null,
    price,
    compare_at_price: compareAtPrice,
    inventory_quantity: Math.max(0, Math.round(Number(row.stock) || 0)),
    width: Number(snapshot.packageWidthCm),
    height: Number(snapshot.packageHeightCm),
    length: Number(snapshot.packageLengthCm),
    weight: Number(snapshot.packageWeightKg),
    weight_unit: 'kg',
    inventory_policy: false,
    taxable: false,
    is_enabled: true,
    name: value,
    option1: value
  };
}

function variantCoreMatches(remote, planned) {
  if (!remote || !planned) return false;
  if (sku(remote.sku) !== sku(planned.sku)) return false;
  if (variantValue(remote) !== clean(planned.name || planned.option1)) return false;
  if (clean(remote.barcode) !== clean(planned.barcode)) return false;
  const pairs = [
    [remote.price, planned.price],
    [remote.inventory_quantity ?? remote.stock, planned.inventory_quantity],
    [remote.width, planned.width],
    [remote.height, planned.height],
    [remote.length, planned.length],
    [remote.weight, planned.weight]
  ];
  return pairs.every(([actual, expected]) => Number(actual) === Number(expected));
}

async function getProduct(productId) {
  const payload = await request(`/products/${encodeURIComponent(productId)}.json`);
  return products(payload)[0] || payload.product || payload;
}

function verifyCanonicalBodyHtml(value) {
  const body = clean(value);
  const firstNoticeIndex = body.indexOf('商品圖片與文字說明僅供參考');
  const warrantyIndex = body.indexOf('保固會依商品類型而有所不同');
  const promoOneIndex = body.indexOf('product-listing-description-promo-1.jpg');
  const promoTwoIndex = body.indexOf('product-listing-description-promo-2.jpg');
  const finalPromo = '<p><img src="https://youzi-c1b74.web.app/product-listing-description-promo-2.jpg" alt="柚子樂器門市與服務資訊" style="max-width:100%;height:auto"></p>';
  return firstNoticeIndex >= 0 && warrantyIndex > firstNoticeIndex
    && promoOneIndex > warrantyIndex && promoTwoIndex > promoOneIndex
    && body.endsWith(finalPromo);
}

function canonicalBodyHtml(value) {
  const legacyDisclaimer = '商品圖片與規格僅供參考，實際內容以收到的實體商品為準。';
  const actualProductNotice = '商品圖片與文字說明僅供參考；不同批次的包裝、印刷、配色或細節可能略有差異，實際內容以收到的商品為準。';
  const warrantyNotice = '保固會依商品類型而有所不同。耗材及正常使用產生的自然耗損不在一般保固範圍；若商品附有原廠保固，則以原廠提供的保固時間與方式為主。收到商品若發現新品本身有異常，歡迎聯絡我們協助確認與處理。';
  const actualProductBlock = `<p><strong>${actualProductNotice}</strong></p>`;
  const warrantyBlock = `<p><strong>${warrantyNotice}</strong></p>`;
  const promoOne = '<p><img src="https://youzi-c1b74.web.app/product-listing-description-promo-1.jpg" alt="柚子樂器門市與服務資訊" style="max-width:100%;height:auto"></p>';
  const promoTwo = '<p><img src="https://youzi-c1b74.web.app/product-listing-description-promo-2.jpg" alt="柚子樂器門市與服務資訊" style="max-width:100%;height:auto"></p>';
  let body = clean(value)
    .replace(new RegExp(`<p><strong>${legacyDisclaimer}</strong></p>`, 'g'), '')
    .replace(new RegExp(`<p><strong>${actualProductNotice}</strong></p>`, 'g'), '')
    .replace(new RegExp(`<p><strong>${warrantyNotice}</strong></p>`, 'g'), '')
    .replace(/<p><img[^>]+product-listing-description-promo-1\.jpg[^>]*><\/p>/gi, '')
    .replace(/<p><img[^>]+product-listing-description-promo-2\.jpg[^>]*><\/p>/gi, '');
  return `${body}${actualProductBlock}${warrantyBlock}${promoOne}${promoTwo}`;
}

async function renameOptionValue(productId, optionType, oldValue, newValue) {
  if (![productId, optionType, oldValue, newValue].every((value) => clean(value))) {
    throw new Error('rename-option-value requires productId, optionType, oldValue and newValue.');
  }
  await request(`/products/${encodeURIComponent(productId)}/option_value.json`, {
    method: 'PUT',
    body: {
      option_type: clean(optionType),
      old_option_value: clean(oldValue),
      new_option_value: clean(newValue)
    }
  });
  const product = await getProduct(productId);
  const names = variants(product).map(variantValue);
  if (!names.includes(clean(newValue)) || names.includes(clean(oldValue))) {
    throw new Error(`EasyStore option rename verification failed: ${oldValue} -> ${newValue}.`);
  }
  console.log(JSON.stringify({ ok: true, productId, optionType, oldValue, newValue }, null, 2));
}

async function canonicalizeDescription(productId, outputFile) {
  const before = await getProduct(productId);
  const bodyHtml = canonicalBodyHtml(before.body_html || before.bodyHtml || before.description_html);
  await request(`/products/${encodeURIComponent(productId)}.json`, {
    method: 'PUT',
    body: {
      product: {
        title: clean(before.title || before.name),
        body_html: bodyHtml
      }
    }
  });
  const after = await getProduct(productId);
  const actualBody = clean(after.body_html || after.bodyHtml || after.description_html);
  if (!verifyCanonicalBodyHtml(actualBody)) {
    throw new Error('EasyStore description verification failed after canonical layout update.');
  }
  await fs.writeFile(outputFile, JSON.stringify(after, null, 2));
  console.log(JSON.stringify({
    ok: true,
    productId,
    sku: variants(after).map((row) => sku(row.sku)),
    bodyLength: actualBody.length,
    imageCount: images(after).length,
    descriptionLayoutVersion: 'youzi-interleaved-description-v2'
  }, null, 2));
}

async function syncProductContent(queueFile, productId, outputFile) {
  const queue = JSON.parse(await fs.readFile(queueFile, 'utf8'));
  const snapshot = queue?.data?.payload || queue?.payload || queue;
  const bodyHtml = canonicalBodyHtml(snapshot.bodyHtml);
  const plannedImages = easyStorePlatformImageUrls(snapshot)
    .filter((url) => url !== storePromoImageUrl && !descriptionPromoPattern.test(url))
    .slice(0, 8);
  const galleryUrls = plannedImages.length ? [...plannedImages, storePromoImageUrl] : [];
  if (!galleryUrls.length) throw new Error('EasyStore image plan is empty.');
  await request(`/products/${encodeURIComponent(productId)}.json`, {
    method: 'PUT',
    body: {
      product: {
        title: clean(snapshot.title),
        description: clean(snapshot.description),
        body_html: bodyHtml,
        inventory_management: 'easystore',
        taxable: false,
        shipping_required: true,
        metafields_global_title_tag: Array.from(clean(snapshot.title)).slice(0, 70).join(''),
        metafields_global_description_tag: easyStoreSeoDescription(snapshot),
        images: galleryUrls.map((url) => ({ url }))
      }
    }
  });
  let product = await getProduct(productId);
  const plannedVariants = snapshot.variantGroupEnabled === true && Array.isArray(snapshot.variantGroupVariants) && snapshot.variantGroupVariants.length
    ? snapshot.variantGroupVariants
    : [{
        sku: snapshot.sku,
        barcode: snapshot.barcode,
        easyStorePrice: snapshot.easyStorePrice,
        storePrice: snapshot.storePrice,
        stock: snapshot.stock,
        costPrice: snapshot.costPrice,
        attributeValue: ''
      }];
  const variantUpdates = plannedVariants.map((row) => {
    const current = variants(product).find((variant) => sku(variant.sku) === sku(row.sku));
    const id = clean(current?.id || current?.variant_id || current?.variantId);
    if (!id) throw new Error(`EasyStore variant ${sku(row.sku)} is missing during commerce verification.`);
    return { id, ...variantTemplate(snapshot, row) };
  });
  await request(`/products/${encodeURIComponent(productId)}/variants.json`, {
    method: 'PUT',
    body: { variants: variantUpdates }
  });
  product = await getProduct(productId);
  const actualBody = clean(product.body_html || product.bodyHtml || product.description_html);
  if (!verifyCanonicalBodyHtml(actualBody)) {
    throw new Error('EasyStore description verification failed: fixed notices and final promos are not in v2 order.');
  }
  const actualImageRows = images(product);
  const actualImages = actualImageRows.map(imageUrl).filter(Boolean);
  const actualTitles = actualImageRows.map((row) => clean(row?.title));
  const expectedTitles = galleryUrls.map(plannedImageTitle);
  if (actualImages.length !== galleryUrls.length || expectedTitles.some((title, index) => actualTitles[index] !== title)) {
    throw new Error('EasyStore gallery verification failed: replacement gallery or fixed final store promo is missing.');
  }
  const commerceMismatch = variants(product).find((variant) => {
    const price = Number(variant.price || 0);
    return Number(variant.compare_at_price || 0) <= price || clean(variant.inventory_management) !== 'easystore';
  });
  if (commerceMismatch) throw new Error(`EasyStore commerce verification failed for ${sku(commerceMismatch.sku)}.`);
  if (product.taxable !== false) throw new Error('EasyStore product taxable checkbox verification failed.');
  const plannedSeoDescription = easyStoreSeoDescription(snapshot);
  const seoUiRequired = clean(product.metafields_global_description_tag) !== plannedSeoDescription;
  await fs.writeFile(outputFile, JSON.stringify(product, null, 2));
  console.log(JSON.stringify({
    ok: true,
    productId,
    title: clean(product.title),
    bodyLength: actualBody.length,
    imageCount: actualImages.length,
    seoUiRequired,
    plannedSeoDescriptionLength: Array.from(plannedSeoDescription).length
  }, null, 2));
}

async function syncGroup(queueFile, productId, outputFile) {
  const queue = JSON.parse(await fs.readFile(queueFile, 'utf8'));
  const snapshot = queue?.data?.payload || queue?.payload || queue;
  const expected = Array.isArray(snapshot.variantGroupVariants) ? snapshot.variantGroupVariants : [];
  if (snapshot.workflowVersion && snapshot.workflowVersion !== 'youzi-four-channel-listing-v3') {
    throw new Error(`Refusing workflow ${snapshot.workflowVersion}.`);
  }
  if (expected.length < 2 || !clean(snapshot.variantGroupAttributeName)) {
    throw new Error('V3 grouped snapshot is incomplete.');
  }

  const galleryUrls = easyStoreGroupGallery(snapshot, expected);
  if (!galleryUrls.length) throw new Error('EasyStore V3 image plan is empty.');

  await request(`/products/${encodeURIComponent(productId)}.json`, {
    method: 'PUT',
    body: {
      product: {
        title: snapshot.title,
        description: snapshot.description,
        body_html: snapshot.bodyHtml,
        inventory_management: 'easystore',
        taxable: false,
        shipping_required: true,
        metafields_global_title_tag: Array.from(clean(snapshot.title)).slice(0, 70).join(''),
        metafields_global_description_tag: easyStoreSeoDescription(snapshot),
        published_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
        images: galleryUrls.map((url) => ({ url }))
      }
    }
  });

  let product = await getProduct(productId);
  let remoteVariants = variants(product);
  const existingSkus = new Set(remoteVariants.map((row) => sku(row.sku)));
  const existingValues = new Set(remoteVariants.map(variantValue).map((value) => value.toLowerCase()).filter(Boolean));
  const missingValues = expected
    .filter((row) => !existingSkus.has(sku(row.sku)))
    .map((row) => clean(row.attributeValue))
    .filter((value) => value && !existingValues.has(value.toLowerCase()));

  if (missingValues.length) {
    await request(`/products/${encodeURIComponent(productId)}/options.json`, {
      method: 'POST',
      body: { option_type: snapshot.variantGroupAttributeName, option_values: missingValues }
    });
    product = await getProduct(productId);
    remoteVariants = variants(product);
  }

  const unused = remoteVariants.slice();
  const mapped = expected.map((row) => {
    const targetSku = sku(row.sku);
    const targetValue = clean(row.attributeValue).toLowerCase();
    let index = unused.findIndex((variant) => sku(variant.sku) === targetSku);
    if (index < 0) index = unused.findIndex((variant) => variantValue(variant).toLowerCase() === targetValue);
    if (index < 0) throw new Error(`EasyStore did not create variant ${row.attributeValue} (${targetSku}).`);
    const remote = unused.splice(index, 1)[0];
    const id = clean(remote.id || remote.variant_id || remote.variantId);
    if (!id) throw new Error(`Variant ${targetSku} has no id.`);
    return { id, row };
  });

  const expectedSkus = new Set(expected.map((row) => sku(row.sku)));
  const unexpected = remoteVariants.map((row) => sku(row.sku)).filter((value) => value && !expectedSkus.has(value));
  if (unexpected.length) throw new Error(`Unexpected EasyStore SKUs: ${unexpected.join(', ')}`);

  product = await getProduct(productId);
  const remoteImages = images(product);
  const imageIdBySource = new Map();
  const imageIdByTitle = new Map();
  for (const row of remoteImages) {
    const id = imageId(row);
    const url = imageUrl(row);
    if (id && url) imageIdBySource.set(url, id);
    if (id && clean(row?.title)) imageIdByTitle.set(clean(row.title), id);
  }

  const updates = mapped.map(({ id, row }) => {
    const update = { id, ...variantTemplate(snapshot, row) };
    const plannedImageIndex = galleryUrls.indexOf(clean(row.imageUrl));
    const plannedImageId = plannedImageIndex >= 0 ? imageId(remoteImages[plannedImageIndex]) : '';
    const exactImageId = imageIdBySource.get(clean(row.imageUrl))
      || imageIdByTitle.get(plannedImageTitle(row.imageUrl))
      || plannedImageId;
    if (exactImageId) update.image_id = Number(exactImageId);
    return update;
  });
  const currentById = new Map(remoteVariants.map((row) => [clean(row.id || row.variant_id || row.variantId), row]));
  const coreAlreadyMatches = updates.every((update) => variantCoreMatches(currentById.get(clean(update.id)), update));
  if (!coreAlreadyMatches) {
    await request(`/products/${encodeURIComponent(productId)}/variants.json`, {
      method: 'PUT',
      body: { variants: updates }
    });
  }

  const after = await getProduct(productId);
  const afterVariants = variants(after);
  const failedImageBindings = updates.filter((update) => {
    const actual = afterVariants.find((row) => sku(row.sku) === sku(update.sku));
    return clean(actual?.image_id || actual?.imageId) !== clean(update.image_id);
  });
  if (failedImageBindings.length) {
    throw new Error(`EASYSTORE_VARIANT_IMAGE_UI_REQUIRED: select the planned parent-gallery image for each SKU in the EasyStore admin UI, save, then rerun verification. Missing: ${failedImageBindings.map((row) => row.sku).join(', ')}`);
  }
  const afterImages = images(after);
  if (afterImages.length !== galleryUrls.length || galleryUrls.at(-1) !== storePromoImageUrl) {
    throw new Error('EasyStore gallery verification failed: fixed final store promo is missing.');
  }
  const receipt = {
    productId: clean(after.id || after.product_id || productId),
    title: clean(after.title || after.name),
    published: Boolean(after.published_at || after.published === true || clean(after.status).toLowerCase() === 'published'),
    variants: afterVariants.map((row) => ({
      id: clean(row.id || row.variant_id),
      sku: sku(row.sku),
      name: variantValue(row),
      stock: Number(row.inventory_quantity ?? row.stock ?? 0),
      price: Number(row.price ?? 0),
      imageId: clean(row.image_id || row.imageId)
    })),
    images: images(after).map((row) => ({ id: imageId(row), url: imageUrl(row) }))
  };
  await fs.writeFile(outputFile, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ ok: true, productId: receipt.productId, variantCount: receipt.variants.length, imageCount: receipt.images.length, skus: receipt.variants.map((row) => row.sku) }, null, 2));
}

async function searchSku(targetSku) {
  const payload = await request(`/products.json?${new URLSearchParams({ skus: sku(targetSku), limit: '100' }).toString()}`);
  const matches = [];
  for (const product of products(payload)) {
    const matchedVariants = variants(product).filter((variant) => sku(variant.sku) === sku(targetSku));
    if (!matchedVariants.length) continue;
    matches.push({
      productId: clean(product.id || product.product_id || product.productId),
      title: clean(product.title || product.name),
      published: Boolean(product.published_at || product.published === true || clean(product.status).toLowerCase() === 'published'),
      status: clean(product.status),
      variants: matchedVariants.map((variant) => ({
        id: clean(variant.id || variant.variant_id || variant.variantId),
        sku: sku(variant.sku),
        name: variantValue(variant),
        imageId: clean(variant.image_id || variant.imageId),
        price: Number(variant.price ?? 0),
        stock: Number(variant.inventory_quantity ?? variant.stock ?? 0)
      })),
      images: images(product).map((row) => ({ id: imageId(row), url: imageUrl(row) }))
    });
  }
  console.log(JSON.stringify({ ok: true, sku: sku(targetSku), matches }, null, 2));
}

async function setVariantImage(productId, variantId, targetSku, targetImageId) {
  const numericImageId = Number(targetImageId);
  if (![productId, variantId, targetSku].every((value) => clean(value)) || !Number.isInteger(numericImageId) || numericImageId <= 0) {
    throw new Error('set-variant-image requires productId, variantId, sku and a positive integer imageId.');
  }
  await request(`/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}.json`, {
    method: 'PATCH',
    body: { variant: { image_id: numericImageId } }
  });
  const product = await getProduct(productId);
  const variant = variants(product).find((row) => sku(row.sku) === sku(targetSku));
  const actualImageId = Number(variant?.image_id || variant?.imageId || 0);
  if (actualImageId !== numericImageId) {
    throw new Error(`EasyStore variant image verification failed for ${sku(targetSku)}: expected ${numericImageId}, got ${actualImageId}.`);
  }
  console.log(JSON.stringify({ ok: true, productId, variantId, sku: sku(targetSku), imageId: actualImageId }, null, 2));
}

async function adminSetVariantImage(productId, variantId, targetSku, targetImageId) {
  const numericImageId = Number(targetImageId);
  await adminRequest(`admin/v2/store/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`, {
    method: 'PATCH',
    body: { image_id: numericImageId }
  });
  const product = await getProduct(productId);
  const variant = variants(product).find((row) => sku(row.sku) === sku(targetSku));
  const actualImageId = Number(variant?.image_id || variant?.imageId || 0);
  if (actualImageId !== numericImageId) throw new Error(`Admin image verification failed: ${actualImageId}.`);
  console.log(JSON.stringify({ ok: true, productId, variantId, sku: sku(targetSku), imageId: actualImageId }, null, 2));
}

const [command, ...args] = process.argv.slice(2);
if (command === 'get-product') {
  const [productId, outputFile] = args;
  const product = await getProduct(productId);
  await fs.writeFile(outputFile, JSON.stringify(product, null, 2));
  console.log(JSON.stringify({ ok: true, productId, variantCount: variants(product).length, imageCount: images(product).length }, null, 2));
} else if (command === 'sync-group') {
  await syncGroup(args[0], args[1], args[2]);
} else if (command === 'rename-option-value') {
  await renameOptionValue(args[0], args[1], args[2], args[3]);
} else if (command === 'sync-product-content') {
  await syncProductContent(args[0], args[1], args[2]);
} else if (command === 'canonicalize-description') {
  await canonicalizeDescription(args[0], args[1]);
} else if (command === 'search-sku') {
  await searchSku(args[0]);
} else if (command === 'set-variant-image') {
  await setVariantImage(args[0], args[1], args[2], args[3]);
} else if (command === 'admin-set-variant-image') {
  await adminSetVariantImage(args[0], args[1], args[2], args[3]);
} else {
  throw new Error('Usage: easystore-api-product-tool.mjs <get-product productId outputFile|sync-group queueFile productId outputFile|rename-option-value productId optionType oldValue newValue|sync-product-content queueFile productId outputFile|canonicalize-description productId outputFile|search-sku sku|set-variant-image productId variantId sku imageId>');
}
