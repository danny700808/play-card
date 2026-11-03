"""Split the verified MOMO A4 top-left/top-right layout into vector 100x150 mm pages.

Never submits an order or prints. Password is read from stdin, not command arguments.
Unknown layouts fail closed instead of being silently cropped.
"""
import argparse
import copy
import io
import json
import re
import sys
from pathlib import Path

import numpy as np
import pypdfium2 as pdfium
import zxingcpp
from pypdf import PdfReader, PdfWriter, Transformation
from pypdf.generic import RectangleObject

MM = 72 / 25.4


def decoded_codes(page):
    bitmap = page.render(scale=3)
    try:
        return zxingcpp.read_barcodes(bitmap.to_pil())
    finally:
        bitmap.close()


def seven_eleven_identity(page, text):
    # Some newer MOMO PDFs have an invalid Chinese font character map. Use
    # the two independently decoded official QR payloads in that case.
    if not re.search(r'7B[EF]-momo', text):
        return False
    values = [c.text for c in decoded_codes(page) if str(c.format) == 'QR Code']
    small = [v for v in values if re.fullmatch(r'7B[EF]001G\d{9}', v)]
    if len(values) != 2 or len(small) != 1 or small[0] not in text:
        return False
    try:
        large = json.loads(next(v for v in values if v != small[0]))
        item = large['Utility'][0]['Ordinary'][0]
        return (item['Device'] == 'POS' and item['code1'].endswith(small[0][:3])
                and item['code2'].startswith(small[0][6:14]))
    except (ValueError, KeyError, IndexError, StopIteration, TypeError):
        return False


def locate_family_panel(page):
    """Reviewed FamilyMart A4 export: one label plus two dashed cut guides.

    Require the QR payload and all three matching Code128 values, precise
    label geometry, and no other ink outside the label except cut guides.
    """
    width, height = page.get_size()
    if abs(width / MM - 210) > 2 or abs(height / MM - 297) > 2:
        return None
    codes = decoded_codes(page)
    qrs = [c.text for c in codes if str(c.format) == 'QR Code' and c.text.startswith('A3||')]
    if len(qrs) != 1:
        return None
    fields = qrs[0].split('||')
    if (len(fields) < 13 or not re.fullmatch(r'1[A-Z0-9]{4}', fields[8])
            or not re.fullmatch(r'\d{9}', fields[11])
            or not re.fullmatch(r'\d{16}', fields[12])):
        return None
    expected = {('QR Code', qrs[0]), *(('Code 128', fields[i]) for i in (8, 11, 12))}
    if len(codes) != 4 or {(str(c.format), c.text) for c in codes} != expected:
        raise ValueError('MOMO 全家單條碼不完整，未送印。')
    bitmap = page.render(scale=2)
    try:
        ink = np.asarray(bitmap.to_pil().convert('RGB')).min(axis=2) < 180
    finally:
        bitmap.close()
    allowed = np.zeros_like(ink)
    allowed[62:816, 130:588] = True  # Entire label with a small white border.
    allowed[56:1598, 592:597] = True  # Vertical dashed cut guide.
    allowed[822:829, 122:1062] = True  # Horizontal dashed cut guide.
    if (ink & ~allowed).any():
        raise ValueError('MOMO 全家單出現額外內容或版型變更，未送印。')
    # Validate the remote guide segments are dashed, not extra printed data.
    for segment in (ink[840:1598, 592:597].any(axis=1),
                    ink[822:829, 610:1062].any(axis=0)):
        edges = np.diff(np.r_[False, segment, False].astype(int))
        lengths = np.where(edges == -1)[0] - np.where(edges == 1)[0]
        if len(lengths) < 30 or lengths.max() > 7 or not .2 < segment.mean() < .7:
            raise ValueError('MOMO 全家單裁切線格式不符，未送印。')
    ys, xs = np.where(ink[62:816, 130:588])
    if len(xs) < 1000:
        raise ValueError('MOMO 全家單內容不完整，未送印。')
    x0, x1 = (xs.min()+130)/2, (xs.max()+131)/2
    top, bottom = (ys.min()+62)/2, (ys.max()+63)/2
    if not (68 <= x0 <= 72 and 289 <= x1 <= 293 and
            34 <= top <= 39 and 401 <= bottom <= 407):
        raise ValueError('MOMO 全家單標籤尺寸已變更，未送印。')
    # Stay inside the guides. The output canvas supplies further quiet space.
    return [(x0-2, height-bottom-2, x1+2, height-top+2)]


def locate_cvs_panel(page, text):
    """Verified MOMO 7-Eleven A4 single-label export; preserve original size.

    Match both document identity and geometry. Never reuse the two-panel crop
    or discard additional content when the platform changes its layout.
    """
    compact = ''.join(text.split())
    markers = ('統一超商', '交貨便服務代碼', '7BE-momo購物網',
               '本單尺寸10cmx14cm請勿調整尺寸')
    if not all(marker in compact for marker in markers) and not seven_eleven_identity(page, compact):
        return None
    width, height = page.get_size()
    if abs(width / MM - 210) > 2 or abs(height / MM - 297) > 2:
        raise ValueError('MOMO 超商單版面尺寸已變更，請先確認原單。')
    bitmap = page.render(scale=2)
    try:
        ink = np.asarray(bitmap.to_pil().convert('RGB')).min(axis=2) < 180
    finally:
        bitmap.close()
    ys, xs = np.where(ink)
    if len(xs) < 1000:
        raise ValueError('MOMO 超商單內容不完整，未送印。')
    x0, top, x1, bottom = xs.min()/2, ys.min()/2, (xs.max()+1)/2, (ys.max()+1)/2
    # Reviewed source occupies x=36..282 and y=36..393 pt (top origin).
    # All visible content, including cut guides, must stay in that one panel.
    if not (30 <= x0 <= 45 and 30 <= top <= 45 and
            275 <= x1 <= 290 and 385 <= bottom <= 405):
        raise ValueError('MOMO 超商單出現額外內容或版型變更，未送印。')
    pad = 2 * MM
    return [(x0-pad, height-bottom-pad, x1+pad, height-top+pad)]


def locate_panels(page):
    width, height = page.get_size()
    if abs(width / MM - 210) > 2 or abs(height / MM - 297) > 2:
        raise ValueError("Expected portrait A4; this layout needs separate review.")
    bitmap = page.render(scale=2)
    image = bitmap.to_pil().convert("RGB")
    ink = np.asarray(image).min(axis=2) < 180
    bitmap.close()
    h, w = ink.shape
    cutoff = int(h * 0.55)
    if ink[cutoff:].sum() > 10:
        raise ValueError("Content exists below the supported two-panel area; no output created.")
    # The two panels are not necessarily centred exactly on the A4 midpoint.
    # Find a genuinely empty vertical gutter in the middle 20% of the page.
    occupied = ink[:cutoff].any(axis=0)
    candidates = []
    start = None
    for col in range(int(w * .4), int(w * .6) + 1):
        if not occupied[col] and start is None:
            start = col
        if occupied[col] and start is not None:
            if col - start >= 2 * MM * 2:
                candidates.append((start, col))
            start = None
    if not candidates:
        raise ValueError("No clear centre divider; manual layout review required.")
    left, right = min(candidates, key=lambda pair: abs(sum(pair) / 2 - w / 2))
    split = (left + right) // 2
    boxes = []
    for start, end in ((0, split), (split, w)):
        ys, xs = np.where(ink[:cutoff, start:end])
        if len(xs) < 1000:
            raise ValueError("A label panel is missing or nearly empty.")
        # Preserve all observed marks, plus 2 mm around them for quiet space.
        pad = 2 * MM
        x0 = max(start / 2, (xs.min() + start) / 2 - pad)
        x1 = min(end / 2, (xs.max() + start + 1) / 2 + pad)
        top = max(0, ys.min() / 2 - pad)
        bottom = min(cutoff / 2, (ys.max() + 1) / 2 + pad)
        boxes.append((x0, height - bottom, x1, height - top))
    return boxes


def convert(source, destination, password="", preview_dir=None):
    raw = source.read_bytes()
    reader = PdfReader(io.BytesIO(raw))
    if reader.is_encrypted and not reader.decrypt(password):
        raise ValueError("PDF password is required or incorrect.")
    rendered = pdfium.PdfDocument(raw, password=password or None)
    writer = PdfWriter()
    report = []
    page_w, page_h = 100 * MM, 150 * MM
    margin = 2 * MM
    try:
        for index, original in enumerate(reader.pages):
            if original.rotation:
                raise ValueError("Rotated source pages need separate layout review.")
            pdf_page = rendered[index]
            try:
                boxes = locate_cvs_panel(pdf_page, original.extract_text() or '')
                if boxes is None:
                    boxes = locate_family_panel(pdf_page)
                sides = ('cvs',) if boxes is not None else ('left', 'right')
                if boxes is None:
                    boxes = locate_panels(pdf_page)
            finally:
                pdf_page.close()
            for side, box in zip(sides, boxes):
                x0, y0, x1, y1 = box
                width, height = x1 - x0, y1 - y0
                scale = min(1.0, (page_w - 2 * margin) / width,
                            (page_h - 2 * margin) / height)
                if scale < 0.95:
                    raise ValueError("This label requires over 5% reduction; review before printing.")
                donor = copy.copy(original)
                donor.cropbox = RectangleObject(box)
                donor.trimbox = RectangleObject(box)
                target = writer.add_blank_page(page_w, page_h)
                tx = (page_w - width * scale) / 2 - x0 * scale
                ty = (page_h - height * scale) / 2 - y0 * scale
                if scale == 1.0:
                    # Keep the original raster phase at the XP-420B's 203 dpi.
                    # Fractional-dot translations can erase narrow barcode bars.
                    dots_per_point = 203 / 72
                    tx = round(tx * dots_per_point) / dots_per_point
                    src_height = float(original.mediabox.height)
                    top_shift = page_h - src_height - ty
                    ty = page_h - src_height - round(top_shift * dots_per_point) / dots_per_point
                transform = Transformation().scale(scale).translate(tx, ty)
                target.merge_transformed_page(donor, transform, expand=False)
                report.append({
                    "source_page": index + 1, "side": side,
                    "crop_mm": [round(v / MM, 3) for v in box],
                    "scale": round(scale, 6),
                    "output_mm": [100, 150],
                })
        if not report:
            raise ValueError("No pages.")
        if destination.exists():
            raise ValueError("Output already exists; choose a new filename.")
        destination.parent.mkdir(parents=True, exist_ok=True)
        writer.add_metadata({"/Title": "MOMO 100x150 shipping labels"})
        with destination.open("xb") as out:
            writer.write(out)
    finally:
        rendered.close()
    if preview_dir:
        preview_dir.mkdir(parents=True, exist_ok=True)
        with pdfium.PdfDocument(destination) as result:
            for i, page in enumerate(result):
                bitmap = page.render(scale=203 / 72)
                bitmap.to_pil().save(preview_dir / f"label-{i + 1}.png")
                bitmap.close()
                page.close()
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--password-stdin", action="store_true")
    parser.add_argument("--previews", type=Path)
    args = parser.parse_args()
    password = sys.stdin.readline().rstrip("\r\n") if args.password_stdin else ""
    try:
        report = convert(args.source, args.destination, password, args.previews)
        print(json.dumps({"output": str(args.destination), "pages": report}, ensure_ascii=False))
    except Exception as error:
        print(f"Conversion stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
