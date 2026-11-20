import base64
import hashlib
import importlib.util
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from pypdf import PdfReader
from packing_footer import validate, footer_pdf, VERSION


def data(**changes):
    return {'version': VERSION, 'orderNo': 'TEST-ORDER', 'items': [
        {'name': '效果器 / 水藍色', 'sku': '204-4749-17', 'quantity': 1}],
        'paidAmountStatus': 'confirmed', 'paidCurrency': 'TWD', 'paidAmount': '2070', **changes}


class FooterTests(unittest.TestCase):
    def test_invoice_reminder_only_on_shopee_and_official_store(self):
        for channel in ('蝦皮', '官網', 'MOMO', '酷澎', 'LINE', ''):
            with self.subTest(channel=channel):
                normalized = validate(data(), channel)
                pdf, _ = footer_pdf(normalized)
                text = PdfReader(io.BytesIO(pdf)).pages[0].extract_text()
                expected = '客人號碼 需要開票- 2070' if channel in ('蝦皮', '官網') else '客人號碼- 2070'
                self.assertEqual(text.count(expected), 1)
                self.assertEqual('需要開票' in text, channel in ('蝦皮', '官網'))
        pdf, _ = footer_pdf(validate(data(paidAmountStatus='review'), '蝦皮'))
        self.assertIn('客人號碼 需要開票- 待確認', PdfReader(io.BytesIO(pdf)).pages[0].extract_text())

    def test_missing_sku_prints_full_name_variant_and_quantity(self):
        for sku in ('', None, '   '):
            raw = data(items=[{'name': '木箱鼓 / P02', 'sku': '134-0106', 'quantity': 1},
                              {'name': '木箱鼓專用袋 / P02專用袋', 'sku': sku, 'quantity': 2}])
            normalized = validate(raw)
            self.assertEqual(len(normalized['items']), 2)
            pdf, _ = footer_pdf(normalized)
            text = PdfReader(io.BytesIO(pdf)).pages[0].extract_text()
            self.assertIn('134-0106 × 1', text)
            self.assertIn('木箱鼓專用袋 / P02專用袋', text)
            self.assertIn('數量：2', text)
            self.assertNotIn('未提供', text)
            self.assertNotIn('None', text)
        self.assertEqual(validate(data(items=[{'name':'配件', 'quantity':1}]))['items'][0]['sku'], '')

    def test_missing_sku_never_relaxes_name_or_quantity_validation(self):
        for changes in ({'name':''}, {'quantity':0}, {'quantity':None}, {'quantity':True}):
            with self.assertRaises(ValueError):
                validate(data(items=[{'name':'配件', 'sku':'', 'quantity':1, **changes}]))

    def test_total_once_no_heading_or_unit_price(self):
        raw = data()
        raw['items'] *= 2
        normalized = validate(raw)
        self.assertEqual(normalized['items'][0]['quantity'], 2)
        pdf, _ = footer_pdf(normalized)
        text = PdfReader(io.BytesIO(pdf)).pages[0].extract_text()
        self.assertIn('效果器 / 水藍色', text)
        self.assertIn('204-4749-17 × 2', text)
        self.assertEqual(text.count('客人號碼- 2070'), 1)
        self.assertNotIn('揀貨明細', text)
        self.assertNotIn('價格', text)

    def test_unconfirmed_money_is_never_invented(self):
        for status in ('pending_collection', 'review', 'unknown'):
            self.assertEqual(validate(data(paidAmountStatus=status))['customerNumber'], '待確認')
        self.assertEqual(validate(data(paidAmount='0'))['customerNumber'], '0')
        self.assertEqual(validate(data(paidAmount='2070.50'))['customerNumber'], '2070.5')
        self.assertEqual(validate(data(paidAmount=True))['customerNumber'], '待確認')

    def test_six_items_all_fit_and_large_order_fails_without_truncation(self):
        raw = data(items=[{'name': f'效果器 {i} / 藍色', 'sku': f'204-4749-{i}', 'quantity': i+1} for i in range(6)])
        pdf, details = footer_pdf(validate(raw))
        text = PdfReader(io.BytesIO(pdf)).pages[0].extract_text()
        self.assertEqual(details['itemCount'], 6)
        self.assertGreaterEqual(details['fontPt'], 7)
        for i in range(6):
            self.assertIn(f'204-4749-{i} × {i+1}', text)
        raw['items'] = [{'name': '長商品名稱'*30+str(i), 'sku': str(i), 'quantity': 1} for i in range(30)]
        with self.assertRaisesRegex(ValueError, '2 公分'):
            footer_pdf(validate(raw))


class HistoryTests(unittest.TestCase):
    """Exercise the HTTP handler with a fake converter/print command, no printer."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        shutil.copy2(Path(__file__).with_name('bridge.py'), self.root/'bridge.py')
        (self.root/'config.json').write_text(json.dumps({'port': 18192, 'printer': 'TEST'}))
        spec = importlib.util.spec_from_file_location('footer_bridge_test', self.root/'bridge.py')
        self.bridge = importlib.util.module_from_spec(spec)
        with patch('subprocess.run', return_value=SimpleNamespace(returncode=0, stdout='')):
            spec.loader.exec_module(self.bridge)
        self.handler = object.__new__(self.bridge.Handler)
        self.handler.reply = lambda code, value: (code, value)
        self.raw = b'%PDF-test-only-no-physical-printer'
        self.payload = {'channel': '蝦皮', 'orderNo': 'TEST-ORDER', 'packingFooter': data(),
                        'pdfBase64': base64.b64encode(self.raw).decode()}
        self.source_digest = hashlib.sha256('蝦皮'.encode()+b'\0'+self.raw).hexdigest()
        self.commands = []
        def fake_run(command, stdin=None, timeout=90):
            self.commands.append(command)
            self.assertTrue(str(command[1]).endswith('prepare.py'), 'A test tried to print!')
            folder = Path(command[2]); (folder/'label-1-print.png').write_bytes(b'test-preview')
            return SimpleNamespace(returncode=0, stdout=json.dumps({'pages':1,'barcodeCount':3,
                'paperMm':[100,150],'layoutVersion':VERSION,'labelIdentity':'SAME-LABEL'}))
        self.bridge.run = fake_run

    def tearDown(self):
        self.temp.cleanup()

    def old(self, status, digest=None, identity=None):
        folder = self.bridge.JOBS / ('1'*32);folder.mkdir()
        state = {'jobId':folder.name,'status':status,'digest':digest or self.source_digest,'pages':1}
        if identity: state['labelIdentity'] = identity
        self.bridge.save_state(folder,state)
        return folder, (folder/'status.json').read_bytes()

    def test_submitted_history_gets_new_preview_only_then_explicit_reprint(self):
        old, before = self.old('submitted')
        code, result = self.handler.prepare(self.payload)
        self.assertEqual(code,200);self.assertEqual(result['status'],'preview')
        self.assertTrue(result['alreadySubmitted']);self.assertIn('preview',result)
        self.assertEqual(self.handler.print_job({'jobId':result['jobId']})[0],409)
        self.assertEqual(len(self.commands),1)
        again = self.handler.prepare(self.payload)[1]
        self.assertEqual(again['jobId'],result['jobId']);self.assertEqual(len(self.commands),1)
        ready = self.handler.prepare({**self.payload,'reprint':True})[1]
        self.assertEqual(ready['status'],'prepared');self.assertNotEqual(ready['jobId'],result['jobId'])
        self.assertEqual((old/'status.json').read_bytes(),before)

    def test_unknown_result_blocks_even_reprint_and_changed_footer(self):
        for state in ('uncertain','submitting','preparing'):
            with self.subTest(state=state):
                old, _ = self.old(state)
                self.assertEqual(self.handler.prepare({**self.payload,'reprint':True})[0],409)
                shutil.rmtree(old)
        self.assertEqual(self.commands,[])

    def test_changed_items_invalidate_cached_layout(self):
        first = self.handler.prepare(self.payload)[1]
        changed = {**self.payload,'packingFooter':data(paidAmount='3050')}
        second = self.handler.prepare(changed)[1]
        self.assertNotEqual(first['jobId'],second['jobId'])
        self.assertEqual(second['status'],'prepared')

    def bundle(self):
        return {**self.payload, 'packingSheet':{'version':'packing-sheet-v1','orderNo':'TEST-ORDER',
            'channel':'蝦皮','items':[{'name':'效果器','variant':'水藍色','sku':'204-4749-17','quantity':1}]}}

    def test_bundle_cache_is_distinct_and_cannot_bypass_submission_history(self):
        ordinary = self.handler.prepare(self.payload)[1]
        bundle = self.handler.prepare(self.bundle())[1]
        self.assertNotEqual(ordinary['jobId'],bundle['jobId'])
        self.assertEqual(self.handler.prepare(self.bundle())[1]['jobId'],bundle['jobId'])
        folder=self.bridge.JOBS/ordinary['jobId']; state=self.bridge.read_state(folder)
        state['status']='submitted';self.bridge.save_state(folder,state)
        preview=self.handler.prepare(self.bundle())[1]
        self.assertEqual(preview['status'],'preview')
        self.assertEqual(self.handler.print_job({'jobId':preview['jobId']})[0],409)
        self.assertEqual(self.handler.prepare({**self.bundle(),'reprint':True})[1]['status'],'prepared')

    def test_bundle_rejects_mismatches_and_uncertain_original_without_printing(self):
        payload=self.bundle();payload['packingSheet']['tracking']='OTHER'
        self.assertEqual(self.handler.prepare(payload)[0],400)
        self.old('uncertain')
        self.assertEqual(self.handler.prepare({**self.bundle(),'reprint':True})[0],409)
        self.assertEqual(self.commands,[])

    def test_invoice_reminder_invalidates_old_cache_but_preserves_print_history(self):
        footer = validate(self.payload['packingFooter'])
        layout = json.dumps([VERSION, '', '', '', footer], sort_keys=True, ensure_ascii=False, separators=(',', ':'))
        digest = hashlib.sha256((self.source_digest+'\0'+layout).encode()).hexdigest()
        old, before = self.old('submitted', digest=digest)
        state = json.loads(before); state['sourceDigest'] = self.source_digest
        self.bridge.save_state(old, state)
        before = (old/'status.json').read_bytes()
        result = self.handler.prepare(self.payload)[1]
        self.assertNotEqual(result['jobId'], old.name)
        self.assertEqual(result['status'], 'preview')
        saved = json.loads((self.bridge.JOBS/result['jobId']/'packing-footer.json').read_text(encoding='utf-8'))
        self.assertTrue(saved['invoiceRequired'])
        self.assertEqual((old/'status.json').read_bytes(), before)

    def test_missing_sku_reaches_preparation_without_auto_printing(self):
        payload = {**self.payload, 'packingFooter':data(items=[{'name':'木箱鼓專用袋 / P02', 'quantity':1}])}
        code, result = self.handler.prepare(payload)
        self.assertEqual(code, 200)
        self.assertEqual(result['status'], 'prepared')
        self.assertEqual(len(self.commands), 1)

    def test_cvs_equivalent_normalized_pdf_retains_old_print_guard(self):
        self.old('submitted',digest='OTHER-PDF',identity='SAME-LABEL')
        payload = {**self.payload,'channel':'MOMO','orderNo':'123','orderKey':'MOMO:123:1',
                   'printProfile':'momo-cvs-v1','shippingMethod':'family','packingFooter':data(orderNo='123')}
        result = self.handler.prepare(payload)[1]
        self.assertEqual(result['status'],'preview')
        self.assertEqual(self.handler.prepare(payload)[1]['status'],'preview')
        self.assertEqual(self.handler.prepare({**payload,'reprint':True})[1]['status'],'prepared')


if __name__ == '__main__':
    unittest.main()

