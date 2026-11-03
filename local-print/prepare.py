"""Private local worker. PDF/password arrive locally; no network requests."""
import copy
import io
import json
import hashlib
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "deps"))
sys.path.insert(0, str(ROOT / "deps_v2"))
import pypdfium2 as pdfium
import zxingcpp
from pypdf import PdfReader, PdfWriter, Transformation
from momo_split import convert, MM
from shipping_cvs_layout import normalize_cvs_pdf, barcode_signature
from packing_footer import validate as validate_footer, compose as compose_footer


def codes(image):
    return Counter((str(item.format), item.text) for item in zxingcpp.read_barcodes(image))


def reference_codes(image):
    # Antialiased narrow bars may only decode after thresholding. Include
    # those codes in the reference so we never choose a black/white rendering
    # that reproduces only the subset decoded from the grey image.
    bw = image.convert('L').point(lambda x: 0 if x < 128 else 255)
    return codes(image) | codes(bw)


def large_coupang_label(page, channel):
    # Verified HCT single-label export: one raster image stored on an oversized
    # 1263.78 x 1795.28 pt PDF canvas. Do not apply this to arbitrary A4 forms.
    if channel != "酷澎":
        return False
    sizes = sorted((float(page.mediabox.width), float(page.mediabox.height)))
    return (abs(sizes[0] - 1263.78) < 1 and abs(sizes[1] - 1795.28) < 1
            and len(page.images) == 1
            and list(page.cropbox) == list(page.mediabox))


def shopee_hct_a5(page, channel):
    if channel != '蝦皮' or page.rotation:
        return False
    width, height = float(page.mediabox.width), float(page.mediabox.height)
    text = ''.join((page.extract_text() or '').split())
    return (abs(width / MM - 148) < .2 and abs(height / MM - 210) < .2
            and list(page.cropbox) == list(page.mediabox)
            and len(page.images) == 2
            and all(marker in text for marker in ('HCT', '蝦皮購物', '宅配', '收貨人', '寄件人'))
            and re.search(r'\d{6}[A-Z0-9]{8}', text) is not None)


def shopee_store_home_a6_bounds(page, channel, pdf_page):
    # This official A6 template has a label smaller than its paper canvas.
    # Keep its native bar widths: translate all ink onto the stock, no resize.
    if channel != '蝦皮' or page.rotation or list(page.cropbox) != list(page.mediabox):
        return None
    width, height = float(page.mediabox.width), float(page.mediabox.height)
    text = ''.join((page.extract_text() or '').split())
    if not (abs(width/MM-105)<.2 and abs(height/MM-148)<.2 and
            all(marker in text for marker in ('店到家宅配','門市交寄','蝦皮訂單編號')) and
            re.search(r'\d{6}[A-Z0-9]{8}',text)):
        return None
    bitmap=pdf_page.render(scale=300/72)
    try:
        bounds=bitmap.to_pil().convert('L').point(lambda p:255 if p<250 else 0).getbbox()
    finally:
        bitmap.close()
    if not bounds:
        raise ValueError('店到家宅配原單沒有可列印內容。')
    x0,y0,x1,y1=(v*72/300 for v in bounds)
    if x1-x0>96*MM or y1-y0>146*MM:
        raise ValueError('店到家宅配內容超出原尺寸標籤範圍，未送印。')
    return x0,height-y1,x1,height-y0


def decrypt_bytes(source, password):
    import pypdfium2.raw as raw
    with pdfium.PdfDocument(source, password=password or None) as pdf:
        output = io.BytesIO()
        pdf.save(output, flags=raw.FPDF_REMOVE_SECURITY)
        return output.getvalue()


def identity(content):
    values = sorted((fmt, value.hex(), count) for (fmt, value), count in barcode_signature(content).items())
    if not values:
        raise ValueError('原單條碼無法核對，未送印。')
    return hashlib.sha256(json.dumps(values).encode()).hexdigest()


def prepare(job, channel, password, print_profile='', shipping_method='', tracking='', packing_footer=None):
    footer = validate_footer(packing_footer) if packing_footer is not None else None
    source = job / "source.pdf"
    reader = PdfReader(source)
    if reader.is_encrypted and not reader.decrypt(password):
        raise ValueError("PDF 密碼不正確，請確認本機 MOMO 密碼設定。")
    if not 1 <= len(reader.pages) <= 25:
        raise ValueError("每次只接受 1 至 25 頁原單。")
    cvs = print_profile == 'momo-cvs-v1'
    if print_profile and not cvs or cvs and (channel != 'MOMO' or shipping_method not in ('seven','family')):
        raise ValueError('列印版型與平台或物流方式不符。')
    metadata = {}
    hd_signatures = {}
    if cvs:
        content = decrypt_bytes(source, password) if reader.is_encrypted else source.read_bytes()
        normalized, details = normalize_cvs_pdf(content, shipping_method)
        if tracking:
            text = ''.join((p.extract_text() or '') for p in reader.pages)
            barcode_text = ' '.join(value.decode('utf-8', errors='replace') for _, value in barcode_signature(content))
            if tracking not in text and tracking not in barcode_text:
                raise ValueError('原單與指定物流號碼不符，未送印。')
        (job/'labels.pdf').write_bytes(normalized)
        expected_signature = Counter({(fmt,value.decode('utf-8',errors='replace')):count for (fmt,value),count in barcode_signature(content).items()})
        metadata = {'printProfile':print_profile,'shippingMethod':shipping_method,'paperMm':[100,150],
                    'labelIdentity':identity(content),'scale':1}
    original_codes = Counter()
    with pdfium.PdfDocument(source, password=password or None) as document:
        for index, page in enumerate(document):
            w, h = page.get_size()
            if max(w, h) > 1200 and not large_coupang_label(reader.pages[index], channel):
                raise ValueError("PDF 尺寸超出列印範圍。")
            # The oversized Coupang canvas uses image dimensions as points;
            # bound reference decoding memory independently of declared size.
            bitmap = page.render(scale=min(203 / 72, 2400 / max(w, h)))
            original_codes.update(reference_codes(bitmap.to_pil()))
            bitmap.close()
            page.close()
    if cvs:
        original_codes = expected_signature
        report = [details]
    elif channel == "MOMO":
        report = convert(source, job / "labels.pdf", password)
    else:
        writer = PdfWriter()
        report = []
        for index, page in enumerate(reader.pages):
            oversized = large_coupang_label(page, channel)
            hct_a5 = shopee_hct_a5(page, channel)
            donor = copy.copy(page)
            with pdfium.PdfDocument(source, password=password or None) as original:
                hd_bounds=shopee_store_home_a6_bounds(page,channel,original[index])
                if hd_bounds:
                    reference=original[index].render(scale=300/72)
                    try:
                        hd_signatures[index]=reference_codes(reference.to_pil())
                    finally:
                        reference.close()
            if hd_bounds:
                x0,y0,x1,y1=hd_bounds
                # Integer printer-dot translation avoids resampling narrow bars.
                dot=72/203
                dx=round(((100*MM-(x1-x0))/2-x0)/dot)*dot
                dy=round(((150*MM-(y1-y0))/2-y0)/dot)*dot
                target=writer.add_blank_page(100*MM,150*MM)
                target.merge_transformed_page(donor,Transformation().translate(dx,dy))
                report.append({'scale':1,'output_mm':[100,150],'layout':'shopee-store-home-a6'})
                continue
            if donor.rotation:
                donor.transfer_rotation_to_content()
            width, height = float(donor.mediabox.width), float(donor.mediabox.height)
            if width > height:
                donor.rotate(90)
                donor.transfer_rotation_to_content()
                width, height = float(donor.mediabox.width), float(donor.mediabox.height)
            # PDF point rounding can encode A6 as 105.00007 mm.
            if not (oversized or hct_a5) and (width > 105.1 * MM or height > 155.1 * MM or min(width, height) < 40 * MM):
                raise ValueError("這張原單不是已支援的標籤尺寸，請使用原單列印。")
            margin = 2 * MM if oversized or hct_a5 else 0
            scale = min(1, (100 * MM - 2 * margin) / width,
                        (150 * MM - 2 * margin) / height)
            target = writer.add_blank_page(100 * MM, 150 * MM)
            target.merge_transformed_page(donor, Transformation().scale(scale).translate(
                (100 * MM - width * scale) / 2,
                (150 * MM - height * scale) / 2))
            report.append({"scale": scale, "output_mm": [100, 150]})
        with (job / "labels.pdf").open("xb") as output:
            writer.write(output)
    footer_signatures = {}
    if footer:
        normalized = (job / 'labels.pdf').read_bytes()
        with pdfium.PdfDocument(normalized) as document:
            for i, page in enumerate(document):
                bitmap = page.render(scale=203/72)
                try:
                    footer_signatures[i] = expected_signature if cvs else hd_signatures.get(i, reference_codes(bitmap.to_pil()))
                finally:
                    bitmap.close()
        composed, layout = compose_footer(normalized, footer)
        (job / 'original-labels.pdf').write_bytes(normalized)
        (job / 'labels.pdf').write_bytes(composed)
        metadata.update(layout)
    grey_codes = Counter()
    printed_codes = Counter()
    with pdfium.PdfDocument(job / "labels.pdf") as document:
        for i, page in enumerate(document):
            bitmap = page.render(scale=203 / 72)
            image = bitmap.to_pil().convert("RGB")
            expected = footer_signatures[i] if footer else expected_signature if cvs else hd_signatures.get(i, reference_codes(image))
            if not expected:
                raise ValueError("其中一張標籤無法讀出條碼，已停止列印。")
            grey_codes.update(expected)
            selected = None
            for threshold in (128, 144, 160, 192, 64, 112, 120, 152, 96, 104, 116, 124, 136, 148, 156, 168, 176, 184, 200):
                candidate = image.convert("L").point(
                    lambda x: 0 if x < threshold else 255).convert("RGB")
                if codes(candidate) == expected:
                    selected = candidate
                    break
            if selected is None:
                raise ValueError("黑白列印的條碼檢查未通過，已停止列印。")
            selected.save(job / f"label-{i + 1}-print.png", dpi=(203, 203))
            printed_codes.update(codes(selected))
            bitmap.close()
            page.close()
    if not original_codes or original_codes != grey_codes or original_codes != printed_codes:
        raise ValueError("拆頁前後條碼不一致，已停止列印。")
    return {"pages": len(report), "barcodeCount": sum(printed_codes.values()),
            "paper": "100x150", "dpi": 203, **metadata}


if __name__ == "__main__":
    # Windows redirected pipes otherwise use the system ANSI code page while
    # bridge.py decodes UTF-8, turning Chinese failures into replacement glyphs.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        request = json.load(sys.stdin)
        result = prepare(Path(sys.argv[1]), request["channel"], request.get("password", ""),
                         request.get('printProfile',''),request.get('shippingMethod',''),request.get('tracking',''),request.get('packingFooter'))
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        raise SystemExit(1)
