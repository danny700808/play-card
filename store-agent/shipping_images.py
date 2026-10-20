"""Exact-SKU image lookup. Never guess another variant from a product name."""
from urllib.parse import urlparse


def image_url(value):
    value = str(value or "").strip()
    return value if urlparse(value).scheme == "https" else ""


def match_product_image(payload, sku):
    matches = []
    for product in payload.get("products") or []:
        for variant in product.get("variants") or []:
            if str(variant.get("sku") or "").strip().upper() != sku.strip().upper():
                continue
            images = product.get("images") or []
            variant_image = image_url(variant.get("image_url"))
            image_id = str(variant.get("image_id") or "")
            if not variant_image and image_id not in ("", "0"):
                variant_image = next((image_url(i.get("url")) for i in images
                                      if str(i.get("id")) == image_id), "")
            main = next((image_url(i.get("url")) for i in sorted(
                images, key=lambda i: int(i.get("position") or 999))
                if image_url(i.get("url"))), "")
            matches.append({"image": variant_image or main,
                            "imageSource": "規格圖" if variant_image else "商品主圖" if main else "",
                            "imageProductId": str(product.get("id") or "")})
    # Duplicate SKU assignments are ambiguous even when the names look alike.
    return matches[0] if len(matches) == 1 else {}
