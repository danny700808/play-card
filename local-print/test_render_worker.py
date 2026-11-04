import copy
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from render_client import RenderClient
from render_worker import Renderer


class RenderCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.worker = Renderer(self.root)
        self.calls = []

        def prepare(folder, channel, password, **options):
            self.calls.append((channel, password, options))
            (folder/'labels.pdf').write_bytes(b'verified-pdf')
            (folder/'label-1-print.png').write_bytes(b'verified-image')
            return {'pages': 1, 'barcodeCount': 3, 'footer': {'itemCount': 1}}

        self.mock = patch.dict(sys.modules, {'prepare': SimpleNamespace(prepare=prepare)})
        self.mock.start()
        self.addCleanup(self.mock.stop)

    def request(self, options=None, raw=b'%PDF-source'):
        folder = self.root / str(len(list(self.root.iterdir())))
        folder.mkdir()
        (folder/'source.pdf').write_bytes(raw)
        (folder/'status.json').write_text('{"status":"preparing"}')
        return {'job': str(folder), 'options': options or {
            'channel': '蝦皮', 'password': '', 'tracking': 'TRACK',
            'packingFooter': {'orderNo': 'ORDER', 'paidAmount': '240',
                              'items': [{'name': '商品', 'quantity': 1}]}}}

    def test_exact_reprint_reuses_verified_pixels_not_print_permission(self):
        first = self.request()
        result = self.worker.prepare(first)
        (Path(first['job'])/'status.json').write_text('{"status":"submitted"}')
        # External file changes cannot poison the in-memory verified artifact.
        (Path(first['job'])/'label-1-print.png').write_bytes(b'changed-on-disk')
        second = self.request()
        other = self.worker.prepare(second)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(result, other)
        self.assertEqual((Path(second['job'])/'label-1-print.png').read_bytes(), b'verified-image')
        self.assertEqual(json.loads((Path(second['job'])/'status.json').read_text()), {'status':'preparing'})
        self.assertEqual(json.loads((Path(first['job'])/'status.json').read_text()), {'status':'submitted'})
        result['footer']['itemCount'] = 999
        self.assertEqual(self.worker.prepare(self.request())['footer']['itemCount'], 1)

    def test_any_binding_layout_or_source_change_forces_conversion(self):
        original = self.request()
        self.worker.prepare(original)
        changes = [{'tracking':'OTHER'}, {'channel':'MOMO'}, {'password':'different'},
                   {'printProfile':'momo-cvs-v1'}, {'shippingMethod':'family'}]
        for change in changes:
            self.worker.prepare(self.request({**original['options'], **change}))
        for key, value in [('orderNo', 'OTHER'), ('paidAmount', '241'),
                           ('items', [{'name':'配件', 'quantity':2}])]:
            changed = copy.deepcopy(original['options'])
            changed['packingFooter'][key] = value
            self.worker.prepare(self.request(changed))
        self.worker.prepare(self.request(raw=b'%PDF-different-source'))
        self.assertEqual(len(self.calls), 10)

    def test_failed_validation_is_never_cached(self):
        with patch.dict(sys.modules, {'prepare': SimpleNamespace(prepare=lambda *a, **k: (_ for _ in ()).throw(ValueError('bad barcode')))}):
            with self.assertRaisesRegex(ValueError, 'bad barcode'):
                self.worker.prepare(self.request())
        self.assertFalse(self.worker.cache)
        self.worker.prepare(self.request())
        self.assertEqual(len(self.calls), 1)

    def test_cache_has_count_and_byte_limits(self):
        self.worker.max_entries = 1
        self.worker.prepare(self.request(raw=b'A'))
        self.worker.prepare(self.request(raw=b'B'))
        self.assertEqual(len(self.worker.cache), 1)
        self.worker.prepare(self.request(raw=b'A'))
        self.assertEqual(len(self.calls), 3)
        self.worker = Renderer(self.root, max_bytes=1)
        self.worker.prepare(self.request())
        self.assertFalse(self.worker.cache)


class WorkerProcessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root/'render_worker.py').write_text('''import sys,json,time,os
for line in sys.stdin:
    request=json.loads(line)
    mode=request['payload'].get('mode','ok')
    if mode=='slow': time.sleep(5)
    identifier='wrong' if mode=='wrong' else request['id']
    print(json.dumps({'id':identifier,'ok':mode!='error','result':{'pid':os.getpid(),'mode':mode}}),flush=True)
''')
        self.client = RenderClient(self.root)
        self.addCleanup(self.client.close)

    def test_requests_reuse_process_and_report_render_errors_without_retry(self):
        first = self.client.call('preview', {})
        second = self.client.call('prepare', {'mode':'error'})
        self.assertEqual(first.returncode, 0)
        self.assertEqual(second.returncode, 1)
        self.assertEqual(json.loads(first.stdout)['pid'], json.loads(second.stdout)['pid'])

    def test_timeout_stops_old_worker_and_next_request_is_independent(self):
        first = self.client.call('preview', {})
        with self.assertRaises(RuntimeError):
            self.client.call('prepare', {'mode':'slow'}, timeout=.05)
        self.assertIsNone(self.client.process)
        next_result = self.client.call('preview', {})
        self.assertNotEqual(json.loads(first.stdout)['pid'], json.loads(next_result.stdout)['pid'])

    def test_mismatched_reply_is_rejected_and_printing_is_not_an_operation(self):
        with self.assertRaises(RuntimeError):
            self.client.call('preview', {'mode':'wrong'})
        self.assertIsNone(self.client.process)
        with self.assertRaises(ValueError):
            self.client.call('print', {})
        self.assertIsNone(self.client.process)


if __name__ == '__main__':
    unittest.main()
