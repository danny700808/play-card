import copy
import io
import tempfile
from pathlib import Path
import sys
import unittest
from pypdf import PdfReader
from shipping_core import normalize_es, Workbench
from unittest.mock import patch
from shipping_postal import build

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'local-print'))
from prepare import prepare


def order():
    return {'id':123,'source_name':'sf','name':'TEST123','fulfillment_status':'unfulfilled',
            'shipping_address':{'first_name':'測試收件人','phone':'0912345678',
                'zip':'420','province':'台中市','city':'豐原區','address1':'測試路100號'},
            'shipping_fees':[{'name':'運費','shipping_id':10,'zone_id':20,'store_app_id':None}],
            'line_items':[{'id':456,'sku':'2500325','product_name':'二胡護琴配件',
                           'variant_name':'黑色','quantity':2}]}


class PostalTests(unittest.TestCase):
    def test_reprint_reuses_stored_pdf_and_persists_handling(self):
        import json
        row=normalize_es(order())
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'config.json').write_text('{}')
            work=Workbench(root/'config.json',root/'data');work.rows[row['key']]=row
            with patch.object(work,'fresh_es',return_value=copy.deepcopy(row)):
                preview=work.preview(row['key'])
                first=work.process(row['key'],{},preview['fingerprint'])
                original=work.document(row['key'])[0]
                second=work.process(row['key'],{},preview['fingerprint'])
                self.assertFalse(first['reused']);self.assertTrue(second['reused'])
                self.assertEqual(original,work.document(row['key'])[0])
            self.assertFalse(work.snapshot()['orders'][0]['handled'])
            work.mark_handled(row['key'],'print_requested','副機送印')
            reopened=Workbench(root/'config.json',root/'data');reopened.rows[row['key']]=row
            result=reopened.snapshot()['orders'][0]
            self.assertTrue(result['handled']);self.assertEqual(result['printCount'],1)
            self.assertTrue(result['stale'])
            with patch.object(reopened,'read_es',return_value=[]), patch.object(reopened,'read_momo',return_value=[]), patch.object(reopened,'read_cp',return_value=[]), patch.object(reopened,'refresh_images'):
                reopened.refresh()
            self.assertEqual(original,reopened.document(row['key'])[0])

    def test_checkout_method_is_preserved(self):
        raw=order(); row=normalize_es(raw)
        self.assertEqual(row['shippingMethod'],'postal'); self.assertTrue(row['canCreate'])
        for subtype,method in [('UNIMARTC2C','seven'),('FAMIC2C','family')]:
            import json
            raw=order();raw['shipping_address']=None
            raw['pickup_address']={'service_provider':'ecpaylogistics-tw','json':json.dumps({'LogisticsSubType':subtype,'CVSStoreID':'123456'})}
            row=normalize_es(raw)
            self.assertEqual(row['shippingMethod'],method)
            self.assertNotEqual(row.get('documentType'),'postal-address-v1')
        raw=order();raw['shipping_fees'][0]['store_app_id']='other-shipping-app'
        self.assertNotEqual(normalize_es(raw).get('shippingMethod'),'postal')
        raw=order();raw['shipping_fees'][0]['name']='新竹貨運'
        self.assertNotEqual(normalize_es(raw).get('shippingMethod'),'postal')
        raw=order();raw['shipping_address']=None;raw['pickup_address']={'location_id':12}
        self.assertEqual(normalize_es(raw)['shippingMethod'],'pickup')

    def test_postal_layout_and_local_print_preparation(self):
        row=normalize_es(order());raw=build(row);pdf=PdfReader(io.BytesIO(raw))
        self.assertEqual(len(pdf.pages),1)
        for content in ('測試收件人','0912345678','二胡護琴配件','0952-010-015','420 台中市豐原區圓環東路347號'):
            self.assertIn(content,pdf.pages[0].extract_text())
        self.assertAlmostEqual(float(pdf.pages[0].mediabox.width)*25.4/72,100,places=3)
        with tempfile.TemporaryDirectory() as directory:
            job=Path(directory);(job/'source.pdf').write_bytes(raw)
            options=dict(print_profile='postal-address-v1',shipping_method='postal',order_key=row['key'],order_no=row['orderNo'],
                packing_footer={'version':'packing-footer-v1','orderNo':row['orderNo'],'items':[{'name':'二胡護琴配件','sku':'2500325','quantity':2}]})
            result=prepare(job,'官網','',**options)
            self.assertEqual(result['barcodeCount'],0)
            self.assertEqual(result['paperMm'],[100,150])
            self.assertEqual((job/'labels.pdf').read_bytes(),raw)
            with self.assertRaises(ValueError):prepare(job,'MOMO','',**options)
            with self.assertRaises(ValueError):prepare(job,'官網','',**{**options,'order_key':'EasyStore:999'})
            with self.assertRaises(ValueError):prepare(job,'官網','',**{**options,'tracking':'INVENTED'})
            normal=job/'ordinary';normal.mkdir();(normal/'source.pdf').write_bytes(raw)
            with self.assertRaises(ValueError):prepare(normal,'官網','') # Ordinary courier label still requires a barcode.

    def test_invalid_or_changed_order_cannot_create_postal_label(self):
        row=normalize_es(order())
        for changes in ({'phone':''},{'address':''},{'stage':'shipped'},{'tracking':'TRACK'},{'shippingMethod':'seven'}):
            with self.assertRaises(ValueError):build({**row,**changes})
        long=copy.deepcopy(row);long['items']=long['items']*40
        pdf=PdfReader(io.BytesIO(build(long)))
        self.assertGreater(len(pdf.pages),1)
        self.assertEqual(''.join(p.extract_text() for p in pdf.pages).count('二胡護琴配件'),40)


if __name__=='__main__':unittest.main()

