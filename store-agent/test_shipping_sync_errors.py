import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from shipping_core import Workbench, normalize_cp, normalize_es, source, sync_error_message


class SyncErrorTests(unittest.TestCase):
    config = {"access_key": "TEST_ACCESS", "secret_key": "TEST_SECRET", "vendor_id": "TEST_VENDOR"}

    def request_error(self, status, payload, invalid_json=False):
        response = Mock(status_code=status, text="PRIVATE response text")
        response.json.side_effect = ValueError("PRIVATE json") if invalid_json else None
        response.json.return_value = payload
        with patch.object(source.requests, "request", return_value=response) as request:
            with self.assertRaises(source.CoupangAPIError) as caught:
                source.coupang_request(self.config, "GET", "/test")
            self.assertEqual(request.call_count, 1)
        return caught.exception

    def test_expired_key_has_safe_actionable_message(self):
        error = self.request_error(401, {"code": "ERROR", "message": "Hmac key is expired.",
                                        "details": "TEST_SECRET PRIVATE customer"})
        self.assertIsInstance(error, RuntimeError)
        self.assertEqual(error.reason, "key_expired")
        message = sync_error_message("Coupang", error)
        self.assertIn("API 金鑰已過期", message)
        self.assertIn("主機更新授權", message)
        for value in (str(error), repr(vars(error)), message):
            self.assertNotIn("TEST_SECRET", value)
            self.assertNotIn("PRIVATE", value)

    def test_other_auth_errors_are_not_mislabeled_expired(self):
        for status, message in ((401, "Invalid signature"), (403, "Hmac key is expired.")):
            with self.subTest(status=status):
                error = self.request_error(status, {"message": message})
                self.assertEqual(error.reason, "request_failed")
                self.assertIn("授權遭拒", sync_error_message("Coupang", error))
                self.assertNotIn("已過期", sync_error_message("Coupang", error))

    def test_rate_limit_and_non_json_do_not_expose_responses(self):
        error = self.request_error(429, {"message": "PRIVATE"})
        self.assertIn("限制查詢次數", sync_error_message("Coupang", error))
        for status in (200, 502):
            error = self.request_error(status, None, invalid_json=True)
            self.assertEqual(error.reason, "invalid_response")
            self.assertNotIn("PRIVATE", str(error))

    def test_successful_order_response_is_unchanged(self):
        payload = {"code": 200, "data": [{"shipmentBoxId": 12}]}
        response = Mock(status_code=200, text="json")
        response.json.return_value = payload
        with patch.object(source.requests, "request", return_value=response):
            self.assertIs(source.coupang_request(self.config, "GET", "/test"), payload)

    def test_refresh_blocks_stale_coupang_only_and_clears_error_after_recovery(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = root / "config.json"
            config.write_text('{}')
            workbench = Workbench(config, root / "data")
            cp = normalize_cp({"shipmentBoxId": 12, "orderId": 34, "status": "INSTRUCT",
                               "deliveryCompanyCode": "TWL_HCT", "orderItems": [
                                   {"vendorItemId": 56, "shippingCount": 1}]})
            es = normalize_es({"id": 78, "source_name": "sf", "fulfillment_status": "unfulfilled"})
            workbench.rows = {cp["key"]: cp}
            expired = source.CoupangAPIError(401, "key_expired")
            with patch.object(workbench, "read_es", return_value=[es]), \
                 patch.object(workbench, "read_momo", return_value=[]), \
                 patch.object(workbench, "refresh_images"), \
                 patch.object(workbench, "read_cp", side_effect=expired) as read_cp:
                snapshot = workbench.refresh()
                rows = {row["key"]: row for row in snapshot["orders"]}
                self.assertTrue(rows[cp["key"]]["stale"])
                self.assertFalse(rows[cp["key"]]["canCreate"])
                self.assertFalse(rows[cp["key"]]["canDownload"])
                self.assertFalse(rows[es["key"]]["stale"])
                self.assertIn("已過期", snapshot["errors"]["Coupang"])
                read_cp.side_effect = None
                read_cp.return_value = [cp]
                recovered = workbench.refresh()
                self.assertEqual(recovered["errors"], {})
                recovered_cp = next(row for row in recovered["orders"] if row["key"] == cp["key"])
                self.assertFalse(recovered_cp["stale"])
                self.assertTrue(recovered_cp["canCreate"])
            with workbench.connect() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM events').fetchone()[0], 0)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
