import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from shipping_core import Workbench, normalize_cp
from shipping_images import match_product_image


class HandlingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = Path(self.tmp.name)/"config.json"
        self.config.write_text("{}")
        self.w = Workbench(self.config, Path(self.tmp.name)/"data")
        self.row = normalize_cp({"shipmentBoxId": 1, "orderId": 2, "status": "DEPARTURE",
            "invoiceNumber": "TRACK1", "orderItems": [{"vendorItemId": 3,
            "externalVendorSkuCode": "1020109", "shippingCount": 1}]})
        self.w.rows[self.row["key"]] = self.row

    def tearDown(self):
        self.tmp.cleanup()

    def row_state(self):
        return self.w.snapshot()["orders"][0]

    def test_tracking_alone_is_not_printed(self):
        self.assertFalse(self.row_state()["handled"])

    def test_confirmation_survives_restart_and_refresh(self):
        self.w.mark_handled(self.row["key"], "printed", "店內確認")
        reopened = Workbench(self.config, Path(self.tmp.name)/"data")
        reopened.rows[self.row["key"]] = self.row
        actual = reopened.snapshot()["orders"][0]
        self.assertTrue(actual["handled"])
        self.assertEqual(actual["handlingAction"], "printed")
        self.assertEqual(actual["stage"], "label")

    def test_changed_tracking_returns_to_unprocessed(self):
        self.w.mark_handled(self.row["key"], "printed")
        self.row["tracking"] = "TRACK2"
        self.assertFalse(self.row_state()["handled"])
        self.assertTrue(self.row_state()["handlingChanged"])

    def test_reprint_preserves_shipped_confirmation(self):
        self.w.mark_handled(self.row["key"], "shipped")
        self.w.mark_handled(self.row["key"], "print_requested")
        actual = self.row_state()
        self.assertEqual(actual["handlingAction"], "shipped")
        self.assertEqual(actual["printCount"], 1)

    def test_print_request_is_not_physical_print_confirmation(self):
        self.w.mark_handled(self.row["key"], "print_requested")
        self.assertEqual(self.row_state()["handlingAction"], "print_requested")
        self.w.mark_handled(self.row["key"], "printed")
        self.assertEqual(self.row_state()["handlingAction"], "printed")

    def test_platform_printed_and_manual_reopen(self):
        self.row["platformPrinted"] = True
        self.assertTrue(self.row_state()["handled"])
        self.w.mark_handled(self.row["key"], "reopen")
        self.assertFalse(self.row_state()["handled"])

    def test_failed_acquisition_never_marks_processed(self):
        with patch.object(self.w, "_process", side_effect=RuntimeError("network")):
            with self.assertRaises(RuntimeError):
                self.w.process(self.row["key"], {}, "fingerprint")
        self.assertFalse(self.row_state()["handled"])

    def test_display_image_does_not_change_document_binding(self):
        before = self.w.document_binding(self.row)
        self.w.images["1020109"] = {"image": "https://example.com/main.jpg", "imageSource": "商品主圖"}
        self.assertTrue(self.row_state()["items"][0]["image"])
        self.assertEqual(self.w.document_binding(self.row), before)


class ImageTests(unittest.TestCase):
    def product(self):
        return {"products": [{"id": 7, "variants": [{"sku": "1020109", "image_id": 2}],
            "images": [{"id": 1, "position": 1, "url": "https://example.com/main.jpg"},
                       {"id": 2, "position": 2, "url": "https://example.com/variant.jpg"}]}]}

    def test_exact_variant_image_first(self):
        self.assertEqual(match_product_image(self.product(), "1020109")["image"], "https://example.com/variant.jpg")

    def test_missing_variant_uses_labeled_main_image(self):
        payload = self.product()
        payload["products"][0]["variants"][0]["image_id"] = 0
        result = match_product_image(payload, "1020109")
        self.assertEqual(result["imageSource"], "商品主圖")
        self.assertEqual(result["image"], "https://example.com/main.jpg")

    def test_no_fuzzy_or_duplicate_sku_guessing(self):
        self.assertEqual(match_product_image(self.product(), "1020109-1"), {})
        payload = self.product()
        payload["products"] *= 2
        self.assertEqual(match_product_image(payload, "1020109"), {})


if __name__ == "__main__":
    unittest.main()
