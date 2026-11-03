"""No live platforms or printers: ambiguous shipment recovery regression tests."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests
from shipping_core import Workbench, ShippingError, normalize_cp
from test_shipping_workbench import cp


class ReconcileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.config = root / 'config.json'
        self.config.write_text(json.dumps({'coupang': {'vendor_id': 'TEST'}}))
        self.w = Workbench(self.config, root / 'data')
        self.pending = normalize_cp(cp())
        self.ready = normalize_cp(cp('DEPARTURE', 'ORIGINAL'))
        self.key = self.pending['key']
        self.options = {'carrier': 'TWL_HCT', 'outboundShippingPlaceCode': '123'}
        self.fp = self.w.fingerprint(self.pending, self.options)
        self.pdf = Mock(headers={'Content-Type': 'application/pdf'}, content=b'%PDF-1.7\noriginal')
        self.elapsed = 0
        self.clock = Mock()
        self.clock.monotonic.side_effect = lambda: self.elapsed
        self.clock.sleep.side_effect = self.advance
        clock_patch = patch('shipping_core.time', self.clock)
        clock_patch.start()
        self.addCleanup(clock_patch.stop)
        network = patch('shipping_core.requests.request', side_effect=AssertionError('live network prohibited'))
        network.start()
        self.addCleanup(network.stop)

    def advance(self, seconds):
        self.elapsed += seconds

    def run_flow(self, reads, first=None):
        if first is None:
            first = requests.ReadTimeout('simulated')
        with patch.object(self.w, 'fresh_cp', side_effect=copy.deepcopy(reads)) as read, \
             patch.object(self.w, '_cp_request', side_effect=[first, self.pdf]) as request:
            result = self.w.process(self.key, self.options, self.fp)
        self.assertEqual([c.args[0] for c in request.call_args_list], ['arrangeShipment', 'downloadInvoices'])
        self.assertEqual(request.call_args.kwargs, {'binary': True})
        self.assertEqual(request.call_args.args[1]['invoicePrintDtoList'][0]['invoiceNumber'], 'ORIGINAL')
        self.assertTrue(result['ready'])
        self.assertTrue(self.w.document_matches(self.w.rows[self.key], self.w.job(self.key)))
        self.assertEqual(self.w.snapshot()['orders'][0]['printCount'], 0)
        self.assertEqual(self.w.document(self.key)[0], self.pdf.content)
        return read

    def test_timeout_recovers_original_in_same_process(self):
        read = self.run_flow([self.pending, self.ready])
        self.assertEqual(read.call_count, 2)
        self.assertEqual(read.call_args.kwargs, {'timeout': 3})

    def test_acknowledgement_then_timeout_still_finishes_same_operation(self):
        accept = normalize_cp(cp('ACCEPT'))
        self.fp = self.w.fingerprint(accept, self.options)
        ack = Mock(status_code=200)
        ack.json.return_value = {'data': {'responseList': [
            {'shipmentBoxId': accept['packageId'], 'succeed': True}]}}
        self.w.config['coupang'].update(access_key='test', secret_key='test')
        with patch('shipping_core.requests.patch', return_value=ack) as request:
            self.run_flow([accept, self.pending, self.pending, self.ready])
        self.assertEqual(request.call_count, 1)

    def test_delayed_status_and_transient_read_timeout(self):
        self.run_flow([self.pending, requests.ReadTimeout(), self.pending, self.pending, self.ready])
        self.assertEqual(self.elapsed, 6)

    def test_missing_or_rejected_receipt_still_only_queries(self):
        self.run_flow([self.pending, self.ready], {self.pending['packageId']: {'success': False}})

    def test_deadline_keeps_reservation_even_after_restart(self):
        def slow_read(key, **kwargs):
            if kwargs:
                self.advance(2 * kwargs['timeout'])
            return copy.deepcopy(self.pending)
        with patch.object(self.w, 'fresh_cp', side_effect=slow_read) as read, \
             patch.object(self.w, '_cp_request', side_effect=requests.ReadTimeout()) as request:
            with self.assertRaisesRegex(ShippingError, '限時查詢'):
                self.w.process(self.key, self.options, self.fp)
        self.assertLessEqual(self.elapsed, 20)
        self.assertEqual(request.call_count, 1)
        self.assertEqual(self.w.job(self.key)['state'], 'uncertain')
        other = Workbench(self.config, self.w.data_dir)
        with self.assertRaises(ShippingError):
            other.reserve_creation(self.key)
        with patch.object(other, 'fresh_cp', side_effect=[copy.deepcopy(self.pending), copy.deepcopy(self.ready)]), \
             patch.object(other, '_cp_request', return_value=self.pdf) as request:
            self.assertTrue(other.process(self.key, self.options, self.fp)['ready'])
        self.assertEqual([c.args[0] for c in request.call_args_list], ['downloadInvoices'])

    def test_cancelled_changed_or_wrong_order_never_downloads(self):
        cancelled = cp('DEPARTURE', 'ORIGINAL')
        cancelled['orderItems'][0]['holdCountForCancel'] = 1
        changes = [normalize_cp(cancelled)]
        for field, value in [('address', 'changed'), ('recipient', 'other'), ('phone', 'other'),
                             ('externalId', 'other'), ('packageId', 'other'), ('orderNo', 'other'),
                             ('carrierCode', 'TWL_FM'), ('status', 'CANCELLED')]:
            changes.append({**self.ready, field: value})
        item_changed = copy.deepcopy(self.ready)
        item_changed['items'][0]['quantity'] = 2
        changes.append(item_changed)
        for changed in changes:
            with self.subTest(changed=changed):
                self.w.save_job(self.key, state='new')
                with patch.object(self.w, 'fresh_cp', side_effect=[copy.deepcopy(self.pending), changed]), \
                     patch.object(self.w, '_cp_request', side_effect=requests.ReadTimeout()) as request:
                    with self.assertRaisesRegex(ShippingError, '取消、資料或物流異動'):
                        self.w.process(self.key, self.options, self.fp)
                self.assertEqual(request.call_count, 1)
                self.assertEqual(self.w.job(self.key)['state'], 'uncertain')
                self.assertFalse(list(self.w.data_dir.glob('*.pdf')))

    def test_read_response_after_deadline_is_not_accepted(self):
        def late_read(key, **kwargs):
            if kwargs:
                self.advance(21)
                return self.ready
            return copy.deepcopy(self.pending)
        with patch.object(self.w, 'fresh_cp', side_effect=late_read), \
             patch.object(self.w, '_cp_request', side_effect=requests.ReadTimeout()) as request:
            with self.assertRaisesRegex(ShippingError, '限時查詢'):
                self.w.process(self.key, self.options, self.fp)
        self.assertEqual(request.call_count, 1)

    def test_query_budget_does_not_change_normal_config(self):
        with patch('shipping_core.source.coupang_request', return_value={'data': cp()}) as request:
            self.w.fresh_cp(self.key, timeout=2)
        self.assertEqual(request.call_args.args[1], 'GET')
        self.assertEqual(request.call_args.args[0]['request_timeout_seconds'], 2)
        self.assertNotIn('request_timeout_seconds', self.w.config['coupang'])

    def test_arranged_download_failure_never_reissues_shipment(self):
        with patch.object(self.w, 'fresh_cp', side_effect=[copy.deepcopy(self.pending), self.ready]), \
             patch.object(self.w, '_cp_request', side_effect=[requests.ReadTimeout(), requests.ReadTimeout()]) as request:
            with self.assertRaisesRegex(ShippingError, '原單號已保留'):
                self.w.process(self.key, self.options, self.fp)
        self.assertEqual(self.w.job(self.key)['state'], 'download-failed')
        self.assertEqual(self.w.job(self.key)['tracking'], 'ORIGINAL')
        with self.assertRaises(ShippingError):
            self.w.reserve_creation(self.key)


if __name__ == '__main__':
    unittest.main()
