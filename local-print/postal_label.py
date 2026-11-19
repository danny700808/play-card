"""Explicit barcode-free postal address profile; other labels still need barcodes."""
import hashlib
import re
import shutil

PROFILE = 'postal-address-v1'


def prepare_postal(job, reader, channel, tracking, order_key, order_no):
    import pypdfium2 as pdfium
    import zxingcpp
    metadata = reader.metadata or {}
    if (channel not in ('官網','LINE') or tracking or reader.is_encrypted
            or not re.fullmatch(r'EasyStore:\d{1,30}', order_key)
            or metadata.get('/YouziProfile') != PROFILE
            or metadata.get('/YouziOrderKey') != order_key
            or not order_no or metadata.get('/YouziOrderNo') != order_no
            or not re.fullmatch(r'[a-f0-9]{64}', metadata.get('/YouziPostalBinding',''))):
        raise ValueError('郵局寄件標籤與訂單不一致，未送印。')
    first = reader.pages[0].extract_text() or ''
    if not all(x in first for x in ('郵局寄件標籤','收件人：','寄件人：','柚子樂器','商品明細',order_no)):
        raise ValueError('郵局寄件資料不完整，未送印。')
    with pdfium.PdfDocument(job/'source.pdf') as pdf:
        for i, page in enumerate(pdf):
            width, height = page.get_size()
            if abs(width*25.4/72-100)>.1 or abs(height*25.4/72-150)>.1 or reader.pages[i].rotation:
                raise ValueError('郵局標籤必須為 100 × 150 mm，未送印。')
            bmp=page.render(scale=203/72)
            try:
                image=bmp.to_pil().convert('L')
                if zxingcpp.read_barcodes(image):
                    raise ValueError('郵局地址標籤不應包含郵件條碼，未送印。')
                image.point(lambda x:0 if x<160 else 255).convert('RGB').save(job/f'label-{i+1}-print.png',dpi=(203,203))
            finally:
                bmp.close()
    shutil.copyfile(job/'source.pdf',job/'labels.pdf')
    return {'pages':len(reader.pages),'barcodeCount':0,'paper':'100x150','dpi':203,
            'paperMm':[100,150],'printProfile':PROFILE,'layoutVersion':PROFILE,
            'labelIdentity':hashlib.sha256((job/'source.pdf').read_bytes()).hexdigest()}
