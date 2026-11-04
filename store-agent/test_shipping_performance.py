"""Performance changes must preserve claim checks and shipment safety."""
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from shipping_core import Workbench, ShippingError, datetime, TZ
from shipping_remote import RemoteRelay


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.work = Mock(data_dir=self.root)
        self.work.snapshot.return_value = {"orders": [], "updated": "test"}
        from shipping_remote import ENDPOINT
        config = self.root / "remote.json"
        config.write_text(json.dumps({"endpoint": ENDPOINT, "agentKey": "a" * 43}))
        self.relay = RemoteRelay(self.work, config)
        self.addCleanup(self.relay.session.close)
        self.relay.last_refresh = time.monotonic() - 301
        self.relay.last_cleanup = time.monotonic()

    def test_waiting_job_precedes_refresh_and_has_no_post_completion_sleep(self):
        calls = []
        def call(action, **payload):
            calls.append(action)
            if action == 'agentPoll':
                self.work.refresh.assert_not_called()
                return {'job': {'id': 'test', 'claim': 'c', 'command': 'print-event', 'body': {}}}
            if action == 'agentComplete':
                self.relay.stop.set()
            return {}
        self.relay.call = call
        with patch('shipping_remote.execute', return_value=({'ok': True}, None)) as execute:
            self.relay.run()
        execute.assert_called_once()
        self.assertEqual(calls, ['agentPoll', 'agentComplete'])
        self.assertFalse(self.relay.outbox.exists())
        self.assertTrue(self.relay.last_snapshot)

    def test_failed_completion_keeps_outbox_for_retry(self):
        payload = {'jobId': 'test', 'snapshot': {'orders': []}, 'result': {'ok': True}}
        self.relay.outbox.write_text(json.dumps(payload))
        self.relay.call = Mock(side_effect=RuntimeError('network'))
        with self.assertRaises(RuntimeError):
            self.relay.deliver_outbox()
        self.assertTrue(self.relay.outbox.exists())
        self.assertEqual(self.relay.last_snapshot, '')
        self.relay.call = Mock(return_value={'ok': True})
        self.relay.deliver_outbox()
        self.relay.call.assert_called_once_with('agentComplete', **payload)
        self.assertFalse(self.relay.outbox.exists())

    def test_user_refresh_resets_periodic_refresh_deadline(self):
        def call(action, **payload):
            if action == 'agentPoll':
                return {'job': {'id': 'test', 'claim': 'c', 'command': 'refresh', 'body': {}}}
            if action == 'agentComplete':
                self.relay.stop.set()
            return {}
        self.relay.call = call
        with patch('shipping_remote.execute', return_value=({'orders': []}, None)):
            self.relay.run()
        self.assertLess(time.monotonic() - self.relay.last_refresh, 1)
        self.work.refresh.assert_not_called()

    def test_due_refresh_runs_when_idle(self):
        self.relay.call = Mock(return_value={'job': None})
        self.relay.stop = Mock()
        self.relay.stop.is_set.side_effect = [False, True]
        self.relay.run()
        self.work.refresh.assert_called_once_with(3)
        self.assertEqual(self.relay.call.call_args_list[0].args, ('agentPoll',))
        self.relay.stop.wait.assert_called_once_with(1.5)

    def test_continuous_work_cannot_starve_refresh(self):
        self.relay.last_refresh = time.monotonic() - 331
        self.relay.stop = Mock()
        self.relay.stop.is_set.side_effect = [False, True]
        def call(action, **payload):
            if action == 'agentPoll':
                self.work.refresh.assert_called_once_with(3)
            return {'job': None}
        self.relay.call = call
        self.relay.run()


class CoupangReadTests(unittest.TestCase):
    def test_bounded_parallel_reads_preserve_precedence_pagination_and_claim_checks(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'config.json').write_text(json.dumps({'coupang': {'vendor_id': 'TEST'}}))
            work = Workbench(root/'config.json', root/'data')
            gate = threading.Barrier(2)
            lock = threading.Lock()
            active = 0
            peak = 0
            finished = []
            pages = []
            statuses = ['ACCEPT', 'INSTRUCT', 'DEPARTURE', 'DELIVERING', 'FINAL_DELIVERY', 'NONE_TRACKING']
            def request(cfg, method, path, params):
                nonlocal active, peak
                self.assertEqual(method, 'GET')
                status = params['status']
                with lock:
                    active += 1
                    peak = max(peak, active)
                    pages.append((status, params.get('nextToken')))
                if status in statuses[:2] and not params.get('nextToken'):
                    gate.wait(timeout=3)
                time.sleep(.005)
                with lock:
                    active -= 1
                    if status != 'ACCEPT' or params.get('nextToken'):
                        finished.append(status)
                return {'status': status, 'second': bool(params.get('nextToken'))}
            def extract(payload):
                return ([{'shipmentBoxId': 123, 'orderId': 456, 'status': payload['status']}],
                        'page2' if payload['status'] == 'ACCEPT' and not payload['second'] else '')
            def claims(*args):
                self.assertCountEqual(finished, statuses)
                return [], False, ['incomplete']
            with patch('shipping_core.source.coupang_request', side_effect=request), \
                 patch('shipping_core.source.coupang_orders_from_payload', side_effect=extract), \
                 patch('shipping_core.source.fetch_coupang_return_rows', side_effect=claims), \
                 patch('shipping_core.normalize_cp', side_effect=lambda row, **kw: {**row, **kw}):
                rows = work.read_cp(datetime.now(TZ), datetime.now(TZ))
            self.assertEqual(peak, 2)
            self.assertEqual(rows[0]['status'], 'NONE_TRACKING')
            self.assertFalse(rows[0]['claims_checked'])
            self.assertIn(('ACCEPT', 'page2'), pages)

    def test_failed_status_does_not_return_partial_success(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'config.json').write_text(json.dumps({'coupang': {'vendor_id': 'TEST'}}))
            work = Workbench(root/'config.json', root/'data')
            with patch('shipping_core.source.coupang_request', side_effect=ShippingError('read failed')), \
                 patch('shipping_core.source.fetch_coupang_return_rows') as claims:
                with self.assertRaises(ShippingError):
                    work.read_cp(datetime.now(TZ), datetime.now(TZ))
                claims.assert_not_called()


if __name__ == '__main__':
    unittest.main()
