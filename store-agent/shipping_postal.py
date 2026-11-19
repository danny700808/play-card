"""Postal address labels only. No tracking/barcode or platform shipment mutation."""
import hashlib
import io
import json
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader, PdfWriter

MM = 72/25.4
PROFILE = 'postal-address-v1'
FONT = 'YouziPostal'
SENDER = ('柚子樂器／黃銘廷', '420 台中市豐原區圓環東路347號', '0952-010-015')


def clean(value):
    return ' '.join(str(value or '').split())


def build(row):
    if not row.get('key','').startswith('EasyStore:') or row.get('channel') not in ('官網','LINE'):
        raise ValueError('郵局標籤來源不符。')
    if row.get('shippingMethod') != 'postal' or row.get('tracking') or row.get('stage') != 'pending':
        raise ValueError('此訂單不能建立郵局寄件標籤。')
    for field in ('recipient','phone','address','orderNo'):
        if not clean(row.get(field)):
            raise ValueError('郵局標籤缺少收件人、電話、地址或訂單編號。')
    if not row.get('items'):
        raise ValueError('郵局標籤缺少商品明細。')
    if FONT not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(FONT, str(Path('C:/Windows/Fonts/msjh.ttc')), subfontIndex=0))
    def wrap(value, size):
        result, line = [], ''
        for char in clean(value):
            if line and pdfmetrics.stringWidth(line+char, FONT, size) > 90*MM:
                result.append(line); line = ''
            line += char
        return result+[line] if line else result
    rows = [('郵局寄件標籤', 15), ('收件人：'+clean(row['recipient']), 14),
            ('電話：'+clean(row['phone']), 11), (clean(row['address']), 12),
            ('寄件人：'+SENDER[0], 10), (SENDER[1], 10), ('電話：'+SENDER[2], 10),
            ('訂單：'+clean(row['orderNo']), 9), ('商品明細', 10)]
    for item in row['items']:
        if not item.get('name') or type(item.get('quantity')) is not int or item['quantity'] < 1:
            raise ValueError('郵局標籤商品資料不完整。')
        label = ' '.join(filter(None, [clean(item['name']), clean(item.get('variant')),
                                     clean(item.get('sku')), '× '+str(item['quantity'])]))
        rows.append((label, 9))
    footer = '郵件條碼由郵局交寄時提供'
    # Never truncate. Continue items on additional 100x150 labels when necessary.
    output = io.BytesIO(); c = canvas.Canvas(output, pagesize=(100*MM,150*MM), invariant=1)
    y = 142*MM
    for value, size in rows:
        for line in wrap(value, size):
            if y-size*1.35 < 14*MM:
                c.setFont(FONT, 8); c.drawString(5*MM, 6*MM, footer); c.showPage()
                c.setFont(FONT, 9); c.drawString(5*MM, 142*MM, '商品續頁 · '+clean(row['orderNo'])); y=135*MM
            c.setFont(FONT, size); c.drawString(5*MM, y, line); y -= size*1.35
        y -= 2*MM
    c.setFont(FONT, 8); c.drawString(5*MM, 6*MM, footer); c.save()
    writer = PdfWriter(); writer.append(PdfReader(io.BytesIO(output.getvalue())))
    binding = hashlib.sha256(json.dumps({k:row.get(k) for k in ('key','orderNo','recipient','phone','address','items')},
        ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    writer.add_metadata({'/YouziProfile':PROFILE, '/YouziOrderKey':row['key'],
                         '/YouziOrderNo':row['orderNo'], '/YouziPostalBinding':binding})
    result=io.BytesIO(); writer.write(result); return result.getvalue()
