"""Render and verify an official Shopee PDF in memory. Never prepares or prints."""
import base64
import io
import json
import re
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / 'deps'))
import pypdfium2 as pdfium
import zxingcpp
from pypdf import PdfReader


def bound_code(text, value):
    return re.search(r'(?<![A-Za-z0-9])' + re.escape(value) + r'(?![A-Za-z0-9])', text) is not None


def resolve_tracking(text, values, order_no, expected=''):
    # A first acquisition has no tracking number in the packing-page snapshot.
    # Accept only supported barcode identifiers also present verbatim in the
    # official PDF. Never infer a number solely from order text or a QR payload.
    if not expected:
        candidates = {value for value in values if value != order_no
                      and re.fullmatch(r'(?:\d{10,20}|TW\d{12}[A-Z0-9])', value)
                      and bound_code(text, value)}
        if len(candidates) != 1:
            raise ValueError('not_ready')
        expected = candidates.pop()
    if not bound_code(text, expected) or not any(bound_code(value, expected) for value in values):
        raise ValueError('order_changed')
    return expected


def render_preview(raw, order_no, tracking):
    if not re.fullmatch(r'[A-Z0-9]{12,24}', order_no) or not re.fullmatch(r'[A-Za-z0-9-]{0,40}', tracking):
        raise ValueError('order_changed')
    if not 20 < len(raw) <= 15 * 1024 * 1024 or not raw.startswith(b'%PDF-'):
        raise ValueError('unsupported')
    reader = PdfReader(io.BytesIO(raw))
    if reader.is_encrypted or len(reader.pages) != 1:
        raise ValueError('unsupported')
    text = reader.pages[0].extract_text() or ''
    if not re.search(r'(?<![A-Z0-9])' + re.escape(order_no) + r'(?![A-Z0-9])', text):
        raise ValueError('order_changed')
    with pdfium.PdfDocument(raw) as document:
        page = document[0]
        width, height = page.get_size()
        if min(width, height) < 100 or max(width, height) > 850:
            raise ValueError('unsupported')
        bitmap = page.render(scale=203/72)
        try:
            decoded = zxingcpp.read_barcodes(bitmap.to_pil())
            values = {code.text for code in decoded}
        finally:
            bitmap.close()
        tracking = resolve_tracking(text, values, order_no, tracking)
        bitmap = page.render(scale=min(2, 1400/max(width, height)))
        try:
            image = bitmap.to_pil()
            output = io.BytesIO()
            image.save(output, format='PNG')
        finally:
            bitmap.close()
            page.close()
    png = output.getvalue()
    if len(png) > 8 * 1024 * 1024:
        raise ValueError('unsupported')
    return {'tracking': tracking, 'previewDataUrl': 'data:image/png;base64,'+base64.b64encode(png).decode(), 'barcodeCount': len(decoded)}


if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
    try:
        request = json.load(sys.stdin)
        raw = base64.b64decode(request['pdfBase64'], validate=True)
        print(json.dumps(render_preview(raw, request['orderNo'], request.get('tracking', ''))))
    except Exception as error:
        code = str(error) if str(error) in ('order_changed', 'unsupported', 'not_ready') else 'failed'
        print(json.dumps({'code': code}))
        raise SystemExit(1)
