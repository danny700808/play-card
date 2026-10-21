"""Coupang acknowledgement tests: all mutation endpoints are mocked."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from shipping_core import Workbench, ShippingError, normalize_cp
from test_shipping_workbench import cp


class AcknowledgementTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        (self.path / 'config.json').write_text(json.dumps({'coupang': {
            'vendor_id': 'TEST', 'access_key': 'test', 'secret_key': 'test'}}))
        self.w = Workbench(self.path / 'config.json', self.path / 'data')
        self.accept = normalize_cp(cp('ACCEPT'))
        self.ready = normalize_cp(cp())
        self.key = self.accept['key']
        self.options = {'carrier': 'TWL_HCT', 'outboundShippingPlaceCode': '123'}
        self.receipt = Mock(status_code=200)
        self.receipt.json.return_value = {'data': {'responseList': [{
            'shipmentBoxId': int(self.accept['packageId']), 'succeed': True}]}}

    def fingerprint(self):
        with patch.object(self.w, 'fresh_cp', return_value=copy.deepcopy(self.accept)):
            return self.w.preview(self.key, self.options)['fingerprint']

    def test_accept_acknowledges_refetches_then_arranges_and_downloads(self):
        fp = self.fingerprint()
        document = Mock(headers={'Content-Type': 'application/pdf'}, content=b'%PDF-1.7\nlabel')
        arranged = {self.accept['packageId']: {'success': True, 'invoiceNumber': 'TRACK-1'}}
        with patch.object(self.w, 'fresh_cp', side_effect=[copy.deepcopy(self.accept), copy.deepcopy(self.ready)]) as read, \
             patch('shipping_core.requests.patch', return_value=self.receipt) as ack, \
             patch.object(self.w, '_cp_request', side_effect=[arranged, document]) as ship:
            self.assertTrue(self.w.process(self.key, self.options, fp)['ready'])
        self.assertEqual(read.call_count, 2)
        self.assertEqual(ack.call_count, 1)
        self.assertEqual(ack.call_args.kwargs['json'], {'vendorId': 'TEST', 'shipmentBoxIds': [9007199254740993]})
        self.assertFalse(ack.call_args.kwargs['allow_redirects'])
        self.assertEqual([c.args[0] for c in ship.call_args_list], ['arrangeShipment', 'downloadInvoices'])
        self.assertEqual(self.w.job(self.key)['state'], 'ready')

    def test_changed_address_after_ack_stops_before_arrange(self):
        changed = copy.deepcopy(self.ready)
        changed['address'] = '買家剛修改的地址'
        fp = self.fingerprint()
        with patch.object(self.w, 'fresh_cp', side_effect=[copy.deepcopy(self.accept), changed]), \
             patch('shipping_core.requests.patch', return_value=self.receipt), \
             patch.object(self.w, '_cp_request') as ship:
            with self.assertRaisesRegex(ShippingError, '收件資料或商品已變更'):
                self.w.process(self.key, self.options, fp)
        ship.assert_not_called()
        self.assertEqual(self.w.job(self.key)['state'], 'acknowledged')

    def test_ack_timeout_is_durable_and_never_arranges_or_repeats(self):
        fp = self.fingerprint()
        with patch.object(self.w, 'fresh_cp', return_value=copy.deepcopy(self.accept)), \
             patch('shipping_core.requests.patch', side_effect=TimeoutError) as ack, \
             patch.object(self.w, '_cp_request') as ship:
            with self.assertRaises(ShippingError):
                self.w.process(self.key, self.options, fp)
            with self.assertRaises(ShippingError):
                self.w.process(self.key, self.options, fp)
        self.assertEqual(ack.call_count, 1)
        ship.assert_not_called()
        other = Workbench(self.path / 'config.json', self.path / 'data')
        with self.assertRaises(ShippingError):
            other.reserve_creation(self.key)
        self.assertEqual(other.job(self.key)['state'], 'ack-uncertain')

    def test_wrong_parcel_or_partial_failure_never_arranges(self):
        for response in ([{'shipmentBoxId': 1, 'succeed': True}],
                         [{'shipmentBoxId': 9007199254740993, 'succeed': False}]):
            self.w.save_job(self.key, state='new')
            self.receipt.json.return_value = {'data': {'responseList': response}}
            with patch.object(self.w, 'fresh_cp', return_value=copy.deepcopy(self.accept)), \
                 patch('shipping_core.requests.patch', return_value=self.receipt), \
                 patch.object(self.w, '_cp_request') as ship:
                fp = self.w.preview(self.key, self.options)['fingerprint']
                with self.assertRaises(ShippingError):
                    self.w.process(self.key, self.options, fp)
            ship.assert_not_called()

    def test_instruct_reconciles_uncertain_ack_without_sending_ack_again(self):
        self.w.save_job(self.key, state='ack-uncertain')
        with patch.object(self.w, 'fresh_cp', return_value=copy.deepcopy(self.ready)), \
             patch('shipping_core.requests.patch') as ack, \
             patch.object(self.w, '_cp_request', side_effect=TimeoutError) as ship:
            fp = self.w.preview(self.key, self.options)['fingerprint']
            with self.assertRaises(ShippingError):
                self.w.process(self.key, self.options, fp)
        ack.assert_not_called()
        self.assertEqual(ship.call_args.args[0], 'arrangeShipment')
        self.assertEqual(self.w.job(self.key)['state'], 'uncertain')

    def test_cancelled_item_blocks_ack(self):
        raw = cp('ACCEPT')
        raw['orderItems'][0]['holdCountForCancel'] = 1
        with patch.object(self.w, 'fresh_cp', return_value=normalize_cp(raw)), \
             patch('shipping_core.requests.patch') as ack:
            with self.assertRaises(ShippingError):
                self.w.preview(self.key, self.options)
        ack.assert_not_called()

    def test_only_one_usable_outbound_on_complete_list_is_auto_selected(self):
        place = {'usable': True, 'outboundShippingPlaceCode': 123}
        with patch('shipping_core.source.coupang_request', return_value={
            'content': [place], 'pagination': {'totalPages': 1}}):
            self.assertEqual(self.w.cp_single_outbound(), '123')
        for content, pages in (([], 1), ([place, place], 1), ([place], 2), ([{**place, 'usable': False}], 1)):
            with patch('shipping_core.source.coupang_request', return_value={
                'content': content, 'pagination': {'totalPages': pages}}):
                with self.assertRaises(ShippingError):
                    self.w.cp_single_outbound()

    def test_auto_address_is_bound_to_preview_and_used_by_process(self):
        with patch.object(self.w, 'fresh_cp', return_value=copy.deepcopy(self.ready)), \
             patch.object(self.w, 'cp_single_outbound', side_effect=['123', '456']), \
             patch.object(self.w, '_cp_request') as ship:
            fp = self.w.preview(self.key, {})['fingerprint']
            with self.assertRaisesRegex(ShippingError, '已變更'):
                self.w.process(self.key, {}, fp)
        ship.assert_not_called()


if __name__ == '__main__':
    unittest.main()
