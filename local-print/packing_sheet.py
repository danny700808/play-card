"""Compact landscape picking sheets, followed by already-verified shipping pages."""
import base64
import io
from collections import Counter

from PIL import Image
from pypdf import PdfReader, PdfWriter
import pypdfium2 as pdfium
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from packing_footer import FONT, MM, clean, font, wrap

VERSION = 'packing-sheet-v1'


def validate(data, footer):
    if not isinstance(data, dict) or data.get('version') != VERSION or not footer:
        raise ValueError('包貨明細版型不符，尚未送印。')
    if data.get('orderNo') != footer['orderNo']:
        raise ValueError('包貨明細與貨運單訂單不一致。')
    raw = data.get('items')
    if not isinstance(raw, list) or not 1 <= len(raw) <= 120:
        raise ValueError('包貨明細商品數量不符。')
    items, actual = [], Counter()
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError('包貨明細商品格式不正確。')
        name, sku = clean(item.get('name', ''), 1000), clean(item.get('sku', ''), 100)
        variant = clean(item.get('variant', ''), 500)
        quantity = item.get('quantity')
        if not name or type(quantity) is not int or not 1 <= quantity <= 9999:
            raise ValueError('包貨明細品名或數量不完整。')
        combined = name + (' / ' + variant if variant and variant not in name else '')
        actual[(combined, sku)] += quantity
        photo = item.get('imageBase64', '')
        if not isinstance(photo, str) or len(photo) > 400000:
            raise ValueError('包貨明細圖片太大。')
        if photo:
            try:
                image = Image.open(io.BytesIO(base64.b64decode(photo, validate=True)))
                if image.format not in ('PNG', 'JPEG') or max(image.size) > 1000 or min(image.size) < 1:
                    raise ValueError()
                image.verify()
            except Exception as error:
                raise ValueError('商品照片無法讀取，尚未送印。') from error
        items.append(dict(name=name, sku=sku, variant=variant, quantity=quantity, imageBase64=photo))
    expected = Counter({(i['name'], i['sku']): i['quantity'] for i in footer['items']})
    if actual != expected:
        raise ValueError('包貨明細商品與貨運單不一致，請更新訂單。')
    return dict(version=VERSION, orderNo=footer['orderNo'], items=items,
                channel=clean(data.get('channel', ''), 20), recipient=clean(data.get('recipient', ''), 200),
                buyer=clean(data.get('buyer', ''), 200), carrier=clean(data.get('carrier', ''), 200),
                tracking=clean(data.get('tracking', ''), 100))


def build_pdf(data, photo_regions=None):
    font()
    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=(100 * MM, 150 * MM))
    c.setTitle('柚子樂器包貨明細')
    count = (len(data['items']) + 2) // 3
    for page_index in range(count):
        regions = []
        if photo_regions is not None:
            photo_regions.append(regions)
        # Landscape content on the printer's existing 100 x 150 mm stock.
        c.saveState()
        c.translate(100 * MM, 0)
        c.rotate(90)
        def line(text, x, y, size, width):
            size = min(size, size * width / max(width, pdfmetrics.stringWidth(text, FONT, size)))
            c.setFont(FONT, size)
            c.drawString(x, y, text)
        header = [f"柚子樂器 · 包貨明細（非貨運單）   {data['channel']}  {data['orderNo']}   {page_index+1}/{count}",
                  '   '.join(v for v in [f"收件人：{data['recipient']}" if data['recipient'] else '',
                                         f"買家：{data['buyer']}" if data['buyer'] else ''] if v),
                  '   '.join(v for v in [data['carrier'], f"物流單號：{data['tracking']}" if data['tracking'] else ''] if v)]
        y = 96 * MM
        for text in filter(None, header):
            line(text, 3 * MM, y, 6, 144 * MM)
            y -= 2.7 * MM
        top, bottom = 85 * MM, 8 * MM
        c.setLineWidth(.4)
        c.line(3 * MM, 87 * MM, 147 * MM, 87 * MM)
        items = data['items'][page_index*3:page_index*3+3]
        columns = len(items)
        col_w = 144 * MM / columns
        for index, item in enumerate(items):
            left = 3 * MM + col_w * index
            width = col_w - 4 * MM
            x = left + 2 * MM
            if index:
                c.line(left, bottom, left, top)
            chosen = None
            for size in ((12, 11, 10, 9) if columns == 1 else (9, 8.5, 8, 7.5)):
                lines = [(t, size + 2) for t in wrap(item['sku'] or '未提供貨號', width, size + 2)]
                lines += [(t, size + 1) for t in wrap(item['variant'], width, size + 1)]
                lines += [(t, size) for t in wrap(item['name'], width, size)]
                text_h = sum(s * 1.2 for _, s in lines) + 4 * MM
                photo_h = min((58 if columns == 1 else 48) * MM, top - bottom - text_h)
                if photo_h >= 24 * MM:
                    chosen = lines, photo_h
                    break
            if chosen is None:
                raise ValueError('商品文字過長，無法清楚排入包貨明細，尚未送印。')
            lines, photo_h = chosen
            if item['imageBase64']:
                image = ImageReader(io.BytesIO(base64.b64decode(item['imageBase64'])))
                iw, ih = image.getSize()
                scale = min(width / iw, photo_h / ih)
                c.drawImage(image, x + (width-iw*scale)/2, top - photo_h + (photo_h-ih*scale)/2,
                            width=iw*scale, height=ih*scale, mask='auto')
                regions.append((x, 100*MM-top, x+width, 100*MM-top+photo_h))
            else:
                line('尚無商品圖片', x, top-photo_h/2, 8, width)
            text_y = top-photo_h-4*MM
            for text, size in lines:
                line(text, x, text_y, size, width)
                text_y -= size*1.2
            line(f"數量：{item['quantity']} 件", x, 3.5 * MM, 13, width)
        c.restoreState()
        c.showPage()
    c.save()
    return out.getvalue(), count


def prepend(job, result, data):
    photo_regions = []
    content, count = build_pdf(data, photo_regions)
    shipping = result['pages']
    if shipping + count > 50:
        raise ValueError('整組單據超過 50 張，尚未送印。')
    writer = PdfWriter()
    writer.append(PdfReader(io.BytesIO(content)))
    writer.append(PdfReader(job/'labels.pdf'))
    combined = io.BytesIO()
    writer.write(combined)
    # Shift only fully verified shipping PNGs. Their pixels/barcodes stay intact.
    for i in range(shipping, 0, -1):
        (job/f'label-{i}-print.png').rename(job/f'label-{i+count}-print.png')
    with pdfium.PdfDocument(content) as pdf:
        for i, page in enumerate(pdf):
            bitmap = page.render(scale=203/72)
            try:
                grey = bitmap.to_pil().rotate(-90, expand=True).convert('L')
                # Solid text strokes for thermal printing; preserve photo shades
                # with dithering only inside the image areas.
                printed = grey.point(lambda p: 0 if p < 160 else 255).convert('RGB')
                for rect in photo_regions[i]:
                    box = tuple(round(p*203/72) for p in rect)
                    printed.paste(grey.crop(box).convert('1').convert('RGB'), box)
                printed.rotate(90, expand=True).save(
                    job/f'label-{i+1}-print.png', dpi=(203, 203))
            finally:
                bitmap.close()
    (job/'labels.pdf').write_bytes(combined.getvalue())
    return dict(result, pages=shipping+count, shippingPages=shipping, packingPages=count,
                packingSheetVersion=VERSION)
