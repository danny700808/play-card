import base64
import io
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from pypdf import PdfReader
from reportlab.pdfgen import canvas
from packing_footer import validate as footer
from packing_sheet import validate, build_pdf, prepend, MM


def fixture(n):
    items = [dict(name=f'國樂鼓棒 / 黑檀木 樂器配件 商品{i+1}', sku=f'238-0103-{i+1}',
                  variant=f'黑檀木{26+i}X1.5', quantity=i+1, imageBase64='') for i in range(n)]
    raw = dict(version='packing-footer-v1', orderNo='TEST-ORDER', items=[
        dict(name=i['name']+' / '+i['variant'], sku=i['sku'], quantity=i['quantity']) for i in items])
    sheet = dict(version='packing-sheet-v1', orderNo='TEST-ORDER', channel='蝦皮', items=items)
    return sheet, footer(raw, '蝦皮')


class PackingSheetTests(unittest.TestCase):
    def test_one_three_four_items_and_no_missing_recipient_placeholder(self):
        for n, pages in [(1,1),(3,1),(4,2),(7,3)]:
            sheet, f = fixture(n)
            content, count = build_pdf(validate(sheet, f))
            pdf = PdfReader(io.BytesIO(content))
            self.assertEqual((count, len(pdf.pages)), (pages, pages))
            text = ''.join(p.extract_text() for p in pdf.pages)
            self.assertNotIn('收件人：', text)
            for item in sheet['items']:
                self.assertIn(item['sku'], text)
                self.assertIn(f"數量：{item['quantity']} 件", text)
            for page in pdf.pages:
                self.assertAlmostEqual(float(page.mediabox.width)/MM, 100, places=2)
                self.assertAlmostEqual(float(page.mediabox.height)/MM, 150, places=2)

    def test_mismatch_and_invalid_images_stop_before_shipping(self):
        sheet, f = fixture(3)
        sheet['orderNo'] = 'OTHER'
        with self.assertRaisesRegex(ValueError, '訂單不一致'): validate(sheet, f)
        sheet['orderNo'] = f['orderNo']; sheet['items'][0]['quantity'] = 9
        with self.assertRaisesRegex(ValueError, '商品與貨運單不一致'): validate(sheet, f)
        sheet, f = fixture(3); sheet['items'][0]['imageBase64'] = 'not a photo'
        with self.assertRaisesRegex(ValueError, '照片無法讀取'): validate(sheet, f)

    def test_photos_are_accepted_but_long_details_never_silently_truncated(self):
        sheet, f = fixture(3)
        image = io.BytesIO(); Image.new('RGB', (400, 300), 'gray').save(image, format='JPEG')
        sheet['items'][0]['imageBase64'] = base64.b64encode(image.getvalue()).decode()
        build_pdf(validate(sheet, f))
        data = validate(sheet, f); data['items'][0]['name'] = '長文字'*300
        with self.assertRaisesRegex(ValueError, '文字過長'): build_pdf(data)

    def test_bundle_prepends_picking_pages_and_preserves_shipping_pixels_and_order(self):
        with tempfile.TemporaryDirectory() as directory:
            job = Path(directory)
            c = canvas.Canvas(str(job/'labels.pdf'), pagesize=(100*MM,150*MM))
            for i in range(2):
                c.drawString(20,100,f'SHIPPING-{i+1}'); c.showPage()
                (job/f'label-{i+1}-print.png').write_bytes(f'verified-shipping-{i+1}'.encode())
            c.save()
            sheet, f = fixture(4)
            result = prepend(job, dict(pages=2, barcodeCount=6), validate(sheet, f))
            self.assertEqual((result['pages'],result['packingPages'],result['shippingPages']), (4,2,2))
            self.assertEqual(result['barcodeCount'], 6)
            pdf = PdfReader(job/'labels.pdf')
            self.assertIn('238-0103-1', pdf.pages[0].extract_text())
            self.assertIn('238-0103-4', pdf.pages[1].extract_text())
            for i in range(2):
                self.assertIn(f'SHIPPING-{i+1}', pdf.pages[i+2].extract_text())
                self.assertEqual((job/f'label-{i+3}-print.png').read_bytes(), f'verified-shipping-{i+1}'.encode())


if __name__ == '__main__': unittest.main()
