"""A queued platform gets its full browser-read budget, without overlapping jobs."""
import tempfile
import unittest
import json
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from shipping_delivery import DeliveryBridge


class DeadlineQueueTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.bridge = DeliveryBridge(self.directory.name)

    def test_shopee_queue_wait_cannot_consume_momo_browser_read_budget(self):
        # Shopee holds the shared browser for 40 seconds. MOMO needs another
        # 30 seconds to navigate its official E001 page and read the table.
        clock = [100.0]
        class Lock:
            released = False
            def acquire(self, timeout):
                clock[0] += 40
                return True
            def release(self): self.released = True
        lock = Lock(); self.bridge.read_lock = lock
        expected = {'MOMO:66111900000001:001': {'shippingDeadlineText':'2026/11/20'}}
        def browser_read(orders, timeout, kind):
            self.assertEqual(kind, 'momo')
            return (expected, '') if timeout >= 30 else ({}, 'timeout')
        with patch('shipping_delivery.time.monotonic', side_effect=lambda: clock[0]), \
             patch.object(self.bridge, '_read', side_effect=browser_read):
            result = self.bridge.read([{'key':'MOMO:66111900000001:001'}], timeout=55, kind='momo')
        self.assertEqual(result, (expected, ''))
        self.assertTrue(lock.released)

    def test_busy_queue_remains_bounded_and_does_not_replace_active_job(self):
        self.bridge.pending = {'id':'existing'}
        with patch.object(self.bridge, 'read_lock') as lock, patch.object(self.bridge, '_read') as read:
            lock.acquire.return_value = False
            self.assertEqual(self.bridge.read([{'key':'MOMO:1:1'}], timeout=2, kind='momo'), ({}, 'timeout'))
            lock.acquire.assert_called_once_with(timeout=2)
            read.assert_not_called(); lock.release.assert_not_called()
        self.assertEqual(self.bridge.pending, {'id':'existing'})

    def test_browser_failure_releases_queue_for_next_platform(self):
        with patch.object(self.bridge, '_read', side_effect=ValueError('invalid evidence')):
            with self.assertRaises(ValueError): self.bridge.read([{}], timeout=.01)
        self.assertTrue(self.bridge.read_lock.acquire(blocking=False))
        self.bridge.read_lock.release()

    def test_queued_momo_result_can_finish_after_original_combined_deadline(self):
        (Path(self.directory.name)/'delivery-bridge.json').write_text(json.dumps(
            {'token':'a'*43,'extensionId':'a'*32}))
        self.bridge.poll('1.1.0')
        shopee = {'key':'EasyStore:123','externalId':'123','orderNo':'SHOPEE1'}
        momo = {'key':'MOMO:66111900000001:001','externalId':'66111900000001','orderNo':'66111900000001'}
        def claim():
            until = time.monotonic()+2
            while time.monotonic()<until:
                job=self.bridge.poll('1.1.0')['job']
                if job: return job
                time.sleep(.001)
            self.fail('Browser did not receive a queued job')
        with ThreadPoolExecutor() as pool:
            first=pool.submit(self.bridge.read,[shopee],2)
            first_job=claim()
            second=pool.submit(self.bridge.read,[momo],1,'momo')
            time.sleep(.7)
            self.bridge.submit({'id':first_job['id'],'results':[],'error':'missing'})
            self.assertEqual(first.result(),({},'missing'))
            second_job=claim()
            self.assertEqual(second_job['kind'],'momo')
            time.sleep(.5)
            self.bridge.submit({'id':second_job['id'],'results':[{**momo,
                'shippingDeadlineText':'2026/11/20','evidenceUrl':'https://3p.momo.com.tw/order/all'}]})
            found,error=second.result()
            self.assertEqual(found[momo['key']]['shippingDeadlineText'],'2026/11/20')
            self.assertEqual(error,'')
        self.assertIsNone(self.bridge.pending)


if __name__ == '__main__': unittest.main()
