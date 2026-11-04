"""100 x 150 mm local label composition. No shipping or printing side effects."""
import copy
import io
import re
from pathlib import Path

import pypdfium2 as pdfium
from pypdf import PdfReader, PdfWriter, Transformation
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

MM = 72 / 25.4
VERSION = 'packing-footer-v1'
FONT = 'YouziPacking'


def clean(value, limit):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError('商品資料格式不正確，尚未送印。')
    return ' '.join(value.split())


def validate(data):
    if not isinstance(data, dict) or data.get('version') != VERSION:
        raise ValueError('商品標籤版型不符，請更新包貨頁。')
    order = clean(data.get('orderNo', ''), 100)
    if not order:
        raise ValueError('缺少訂單編號，尚未送印。')
    raw = data.get('items')
    if not isinstance(raw, list) or not 1 <= len(raw) <= 200:
        raise ValueError('尚未取得完整商品資料，尚未送印。')
    grouped = {}
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError('商品資料格式不正確。')
        raw_sku = item.get('sku')
        name, sku = clean(item.get('name', ''), 1000), clean('' if raw_sku is None else raw_sku, 100)
        quantity = item.get('quantity')
        if not name or type(quantity) is not int or not 1 <= quantity <= 9999:
            raise ValueError('品名或數量不完整，尚未送印。')
        key = (name, sku)
        grouped[key] = grouped.get(key, 0) + quantity
    amount = data.get('paidAmount')
    confirmed = (data.get('paidAmountStatus') == 'confirmed' and data.get('paidCurrency') == 'TWD'
                 and isinstance(amount, (str, int, float)) and not isinstance(amount, bool)
                 and re.fullmatch(r'\d{1,12}(?:\.\d{1,2})?', str(amount)))
    # Do not substitute payable/COD, list prices, or invoice amount for real paid total.
    number = str(amount).rstrip('0').rstrip('.') if confirmed and '.' in str(amount) else str(amount) if confirmed else '待確認'
    return {'version': VERSION, 'orderNo': order,
            'items': [{'name': name, 'sku': sku, 'quantity': qty} for (name, sku), qty in grouped.items()],
            'customerNumber': number}


def font():
    if FONT not in pdfmetrics.getRegisteredFontNames():
        path = Path('C:/Windows/Fonts/msjh.ttc')
        if not path.is_file():
            raise ValueError('未找到標籤中文字型，尚未送印。')
        pdfmetrics.registerFont(TTFont(FONT, str(path), subfontIndex=0))


def wrap(text, width, size):
    lines, line = [], ''
    for char in text:
        if line and pdfmetrics.stringWidth(line + char, FONT, size) > width:
            lines.append(line.rstrip())
            line = char.lstrip()
        else:
            line += char
    if line:
        lines.append(line.rstrip())
    return lines


def footer_pdf(data):
    """Fit every character, SKU and quantity, or fail. Never truncate items."""
    font()
    usable_h = 14.5 * MM
    chosen = None
    for size in (8.5, 8, 7.5, 7):
        for columns in (1, 2, 3):
            col_w = (94 * MM - (columns - 1) * 2 * MM) / columns
            rows = []
            for item in data['items']:
                sku = f"{item['sku']} × {item['quantity']}" if item['sku'] else f"數量：{item['quantity']}"
                if pdfmetrics.stringWidth(sku, FONT, size) > col_w:
                    break
                rows.append(wrap(item['name'], col_w, size) + [sku])
            else:
                # Row-major packing: all columns in a row have the same height.
                row_heights = [max(len(v) for v in rows[i:i+columns]) * size * 1.12 + .7
                               for i in range(0, len(rows), columns)]
                if sum(row_heights) <= usable_h:
                    chosen = size, columns, col_w, rows, row_heights
                    break
        if chosen:
            break
    if not chosen:
        raise ValueError('商品文字超過底部 2 公分可讀範圍；尚未送印。請先精簡商品顯示名稱，不能遺漏商品或縮成看不清的小字。')
    size, columns, col_w, rows, heights = chosen
    output = io.BytesIO()
    c = canvas.Canvas(output, pagesize=(100 * MM, 150 * MM))
    c.setFont(FONT, size)
    top = 18.7 * MM
    for start in range(0, len(rows), columns):
        for col, lines in enumerate(rows[start:start+columns]):
            x, y = 3 * MM + col * (col_w + 2 * MM), top - size
            for line in lines:
                c.drawString(x, y, line)
                y -= size * 1.12
        top -= heights[start // columns]
    c.setFont(FONT, 9)
    c.drawRightString(97 * MM, 1.8 * MM, '客人號碼- ' + data['customerNumber'])
    c.showPage()
    c.save()
    return output.getvalue(), {'fontPt': size, 'columns': columns, 'itemCount': len(rows)}


def compose(content, data):
    """Trim only empty outside margin, then uniformly center in the upper area.

    Keep 2 mm of quiet space around ALL detected ink. The source stays untouched;
    prepare.py verifies every original barcode again on actual 203 dpi print pixels.
    """
    overlay, details = footer_pdf(data)
    reader, writer = PdfReader(io.BytesIO(content)), PdfWriter()
    scales = []
    with pdfium.PdfDocument(content) as document:
        for index, page in enumerate(reader.pages):
            bitmap = document[index].render(scale=300/72)
            try:
                bbox = bitmap.to_pil().convert('L').point(lambda p: 255 if p < 250 else 0).getbbox()
            finally:
                bitmap.close()
            if not bbox:
                raise ValueError('原單沒有可列印內容，尚未送印。')
            w, h = float(page.mediabox.width), float(page.mediabox.height)
            x0, top, x1, bottom = (v * 72 / 300 for v in bbox)
            # White padding may extend outside the original canvas; never crop ink.
            x0, x1 = x0 - 2*MM, x1 + 2*MM
            y0, y1 = h - bottom - 2*MM, h - top + 2*MM
            scale = min(1, 96*MM/(x1-x0), 126*MM/(y1-y0))
            dx = (100*MM - (x1-x0)*scale)/2 - x0*scale
            dy = 22*MM + (126*MM - (y1-y0)*scale)/2 - y0*scale
            target = writer.add_blank_page(100*MM, 150*MM)
            target.merge_transformed_page(copy.copy(page), Transformation().scale(scale).translate(dx, dy))
            if index == 0:
                target.merge_page(PdfReader(io.BytesIO(overlay)).pages[0])
            scales.append(round(scale, 6))
    result = io.BytesIO()
    writer.write(result)
    return result.getvalue(), {'layoutVersion': VERSION, 'footerMm': 20, 'paperMm': [100,150],
                               'layoutScales': scales, 'footer': details}
