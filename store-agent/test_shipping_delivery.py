import copy
import json
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from shipping_delivery import DeliveryBridge
from shipping_core import Workbench, normalize_es


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.token = 'a' * 43
        (self.root / 'delivery-bridge.json').write_text(json.dumps({'token': self.token, 'extensionId': 'a'*32}))
        self.bridge = DeliveryBridge(self.root)
        self.order = {'key': 'EasyStore:123', 'externalId': '123', 'orderNo': 'SHOPEE1'}
        self.result = {**self.order, 'deliveryMethod': '新竹物流',
                       'evidenceUrl': 'https://admin.easystore.co/channels/shopee/taiwan/orders/456'}

    def begin(self, pool, timeout=1):
        self.bridge.poll()
        task = pool.submit(self.bridge.read, [self.order], timeout)
        end = time.monotonic()+1
        job = None
        while not job and time.monotonic()<end:
            job = self.bridge.poll()['job']
            if not job:
                time.sleep(.001)
        self.assertIsNotNone(job)
        return task, job

    def test_live_lookup_and_single_use_receipt(self):
        with ThreadPoolExecutor() as pool:
            task, job = self.begin(pool)
            self.assertEqual(job['orders'], [self.order])
            self.assertIsNone(self.bridge.poll()['job'])
            body = {'id': job['id'], 'results': [self.result]}
            self.bridge.submit(body)
            result, error = task.result()
            self.assertEqual(result[self.order['key']]['deliveryMethod'], '新竹物流')
            self.assertEqual(error, '')
            with self.assertRaises(ValueError):
                self.bridge.submit(body)

    def test_order_id_number_and_source_must_all_match(self):
        with ThreadPoolExecutor() as pool:
            task, job = self.begin(pool)
            for change in ({'externalId': '999'}, {'orderNo': 'OTHER'}, {'key':'EasyStore:999'},
                           {'evidenceUrl': 'https://evil.test/orders/456'},
                           {'deliveryMethod': 'Shipping Fee'}, {'deliveryMethod': '<script>'}):
                with self.assertRaises(ValueError):
                    self.bridge.submit({'id': job['id'], 'results': [{**self.result, **change}]})
            self.bridge.submit({'id': job['id'], 'results': [], 'error': 'login'})
            self.assertEqual(task.result(), ({}, 'login'))

    def test_offline_timeout_and_stale_replies_are_explicit(self):
        self.assertEqual(self.bridge.read([self.order]), ({}, 'offline'))
        with ThreadPoolExecutor() as pool:
            task, job = self.begin(pool, .02)
            self.assertEqual(task.result(), ({}, 'timeout'))
            with self.assertRaises(ValueError):
                self.bridge.submit({'id': job['id'], 'results': [self.result]})

    def test_pair_token_is_not_a_shipping_session(self):
        self.assertFalse(self.bridge.authorized('', self.bridge.origin()))
        self.assertFalse(self.bridge.authorized(self.token, 'https://evil.test'))
        self.assertTrue(self.bridge.authorized(self.token, self.bridge.origin()))

    def test_every_refresh_rereads_even_if_cached_and_api_wins(self):
        (self.root/'config.json').write_text('{}')
        work = Workbench(self.root/'config.json', self.root/'data')
        raw = {'id':123, 'name':'SHOPEE1', 'source_name':'shopee-taiwan', 'updated_at':'version1'}
        key = 'EasyStore:123'
        rows = [normalize_es(raw)]
        observations = {}
        with patch.object(work.delivery_bridge, 'read', return_value=({key:self.result},'')) as read:
            work.enrich_es_delivery(rows,{key:raw},observations)
            self.assertEqual(rows[0]['deliveryMethod'],'新竹物流')
            work.enrich_es_delivery([normalize_es(raw)],{key:raw},observations)
            self.assertEqual(read.call_count,2)
            self.assertEqual(read.call_args.args[0],[self.order])
        formal = copy.deepcopy(raw)
        formal['shipping_fees']=[{'name':'蝦皮店到店'}]
        with patch.object(work.delivery_bridge,'read',return_value=({},'')) as read:
            rows = work.enrich_es_delivery([normalize_es(formal)],{key:formal},observations)
            self.assertEqual(rows[0]['deliveryMethod'],'蝦皮店到店')
            self.assertEqual(read.call_args.args[0],[])
        with patch.object(work.delivery_bridge,'read',return_value=({},'login')):
            rows=work.enrich_es_delivery([normalize_es(raw)],{key:raw},observations)
            self.assertEqual(rows[0]['deliveryMethod'],'新竹物流')
            self.assertIn('重新登入',rows[0]['deliveryMethodNote'])
            raw['updated_at']='version2'
            rows=work.enrich_es_delivery([normalize_es(raw)],{key:raw},observations)
            self.assertEqual(rows[0]['deliveryMethod'],'')


if __name__ == '__main__':
    unittest.main()
