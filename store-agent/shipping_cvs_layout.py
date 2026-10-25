"""Validate a single MOMO CVS label and centre it at 1:1 on 100 x 150 mm.

Only the verified portrait A4, upper-left single-label layout is accepted.
Other quadrants must be blank, except FamilyMart's thin cross-cut guides.
PDF content is translated, never scaled or rasterized. Originals stay intact.
"""
import io
from collections import Counter

from PIL import Image, ImageChops, ImageDraw
import pypdfium2 as pdfium
from pypdf import PdfReader, PdfWriter, Transformation
from pypdf.generic import RectangleObject
import zxingcpp

PROFILE = "momo-cvs-v1"
PT_PER_MM = 72 / 25.4
PAPER = (100 * PT_PER_MM, 150 * PT_PER_MM)


class LayoutError(ValueError):
    pass


def render(content, scale=2):
    with pdfium.PdfDocument(content) as pdf:
        if len(pdf) != 1:
            raise LayoutError("超商貨運單必須只有一頁，已停止裁切。")
        page = pdf[0]
        bitmap = page.render(scale=scale)
        image = bitmap.to_pil().convert("RGB")
        bitmap.close()
        page.close()
        return image


def barcode_signature(content):
    # Compare every decoded symbol, including repeated codes, without logging it.
    with render(content, 300 / 72) as image:
        return Counter((str(code.format), code.bytes) for code in zxingcpp.read_barcodes(image))


def label_bounds(image, method):
    """Return safe ink bounds in the upper-left quarter, in raster pixels."""
    width, height = image.size
    half_x, half_y = width // 2, height // 2
    with Image.new("RGB", image.size, "white") as white:
        difference = ImageChops.difference(image, white)
    channels = difference.split()
    maximum = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
    ink = maximum.point(lambda value: 255 if value else 0)
    maximum.close()
    for channel in channels:
        channel.close()
    difference.close()
    outside = ink.copy()
    draw = ImageDraw.Draw(outside)
    draw.rectangle((0, 0, half_x - 1, half_y - 1), fill=0)
    if method == "family":
        # FamilyMart extends a dashed vertical guide down the blank lower half.
        # This narrow corridor must be near the A4 centre, never an arbitrary crop.
        tolerance = max(2, round(width * 1.5 / 595.275))
        draw.rectangle((half_x - tolerance, 0, half_x + tolerance, height), fill=0)
        remaining = outside.getbbox()
        if remaining:
            left, top, right, bottom = remaining
            # The only remaining marks may be the thin horizontal cutting guide.
            if not (height * .47 <= top <= height * .51 and
                    bottom - top <= max(3, height * 2 / 841.89) and
                    right - left >= width * .20):
                outside.close(); ink.close()
                raise LayoutError("全家原單其他區域仍有內容，不能直接裁成四分之一。")
            draw.rectangle((0, top, width, bottom - 1), fill=0)
            ImageDraw.Draw(ink).rectangle((0, top, width, bottom - 1), fill=0)
        ImageDraw.Draw(ink).rectangle((half_x - tolerance, 0, half_x + tolerance, height), fill=0)
    if outside.getbbox():
        outside.close(); ink.close()
        raise LayoutError("超商原單其他區域仍有內容，已停止裁切以免遺漏。")
    outside.close()
    quarter = ink.crop((0, 0, half_x, half_y))
    bounds = quarter.getbbox()
    quarter.close(); ink.close()
    if not bounds:
        raise LayoutError("超商原單的標籤區域是空白。")
    if bounds[2] >= half_x - 3 or bounds[3] >= half_y - 3:
        raise LayoutError("標籤內容靠近裁切邊界，需核對原單版型。")
    return bounds


def normalize_cvs_pdf(content, method):
    if method not in ("seven", "family"):
        raise LayoutError("尚未確認超商貨運單的物流方式。")
    reader = PdfReader(io.BytesIO(content), strict=True)
    if reader.is_encrypted or len(reader.pages) != 1:
        raise LayoutError("超商貨運單必須先解密且只有一頁。")
    page = reader.pages[0]
    if page.rotation or float(page.get("/UserUnit", 1)) != 1:
        raise LayoutError("超商貨運單含未支援的旋轉、註記或尺寸設定。")
    # The verified FamilyMart source has two hidden 1pt metadata widgets.
    # They are not printable content. Reject every other annotation shape.
    annotations = page.get("/Annots", [])
    for reference in annotations:
        annotation = reference.get_object()
        if not (method == "family" and annotation.get("/Subtype") == "/Widget"
                and annotation.get("/FT") == "/Tx" and int(annotation.get("/F", 0)) == 2
                and list(annotation.get("/Rect", [])) == [0, 0, 1, 1]
                and not any(key in annotation for key in ("/AP", "/A", "/AA"))):
            raise LayoutError("超商貨運單含未支援的註記，需核對原單。")
    if annotations:
        del page["/Annots"]
    box = tuple(float(v) for v in page.mediabox)
    if abs(box[0]) > .01 or abs(box[1]) > .01 or tuple(page.cropbox) != tuple(page.mediabox):
        raise LayoutError("超商原單已被裁切，需先核對原始版型。")
    width, height = box[2:]
    before = barcode_signature(content)
    if not before:
        raise LayoutError("原單條碼未通過辨識，已停止準備列印。")
    if all(abs(actual - wanted) < .1 for actual, wanted in zip((width, height), PAPER)):
        return content, {"profile": PROFILE, "pages": 1, "paperMm": [100, 150],
                         "scale": 1, "barcodeCount": sum(before.values()), "alreadyNormalized": True}
    if abs(width - 595.2756) > 1 or abs(height - 841.8898) > 1:
        raise LayoutError("這張超商原單不是已驗證的 A4 直式版型。")
    with render(content) as image:
        bounds = label_bounds(image, method)
        # Use renderer's actual dimensions to avoid rounding out a border.
        sx, sy = image.width / width, image.height / height
        left, top, right, bottom = (bounds[0] / sx, bounds[1] / sy,
                                    bounds[2] / sx, bounds[3] / sy)
    pad = 2 * PT_PER_MM
    left, right = max(0, left - pad), min(width / 2, right + pad)
    top, bottom = max(0, top - pad), min(height / 2, bottom + pad)
    crop_width, crop_height = right - left, bottom - top
    if crop_width > PAPER[0] or crop_height > PAPER[1]:
        raise LayoutError("標籤在原尺寸下超過 100 × 150 mm，不能縮小條碼強行列印。")
    low_y, high_y = height - bottom, height - top
    page.cropbox = RectangleObject((left, low_y, right, high_y))
    writer = PdfWriter()
    target = writer.add_blank_page(width=PAPER[0], height=PAPER[1])
    target.merge_transformed_page(page, Transformation().translate(
        tx=(PAPER[0] - crop_width) / 2 - left,
        ty=(PAPER[1] - crop_height) / 2 - low_y))
    output = io.BytesIO(); writer.write(output)
    result = output.getvalue()
    if barcode_signature(result) != before:
        raise LayoutError("裁切後條碼與原單不一致，未提供列印檔。")
    return result, {"profile": PROFILE, "pages": 1, "paperMm": [100, 150], "scale": 1,
                    "barcodeCount": sum(before.values()), "alreadyNormalized": False,
                    "cropPt": [left, top, right, bottom]}
