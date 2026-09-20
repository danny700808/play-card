// Preserve the designated tail when enforcing the platform gallery limit.
export function selectCoupangGalleryUrls(values, limit = 10) {
  const urls = [...new Set((values || []).map(value => String(value || '').trim())
    .filter(value => /^https:\/\//.test(value)))];
  if (urls.length <= limit) return urls;
  const tail = urls.findLast(value => value.includes('product-listing-store-promo')) || urls.at(-1);
  return [...urls.filter(value => value !== tail).slice(0, limit - 1), tail];
}
