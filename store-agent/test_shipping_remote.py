import unittest
import tempfile
from pathlib import Path
from unittest.mock import Mock
from shipping_core import ShippingError, now, Workbench
from shipping_remote import execute, packing_snapshot


class RemoteBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.w = Mock()
        self.row = {"key":"Coupang:123","date":now(),"items":[], "payment":"secret-price",
                    "documentKinds":["label"],"config":{"token":"never-public"}}
        self.w.snapshot.return_value = {"orders":[self.row],"errors":{},"updated":now(),"days":3}

    def test_no_administration_or_old_order(self):
        for command in ("shell","config","provide-document"):
            with self.assertRaises(ShippingError):
                execute(self.w,command,{"key":"Coupang:123"})
        with self.assertRaises(ShippingError):
            execute(self.w,"handling",{"key":"Coupang:999","action":"printed"})
        self.w.mark_handled.assert_not_called()

    def test_snapshot_strips_unrelated_fields_and_old_orders(self):
        self.w.snapshot.return_value["orders"].append({"key":"old","date":"2020-01-01","items":[]})
        result=packing_snapshot(self.w)
        self.assertEqual(len(result["orders"]),1)
        self.assertNotIn("config",result["orders"][0])
        self.assertNotIn("payment",result["orders"][0])

    def test_reprint_reuses_document_without_creating_shipment(self):
        self.w.document.return_value=(b"%PDF-test","application/pdf")
        result,files=execute(self.w,"document-link",{"key":"Coupang:123"})
        self.assertEqual(files["label"]["mime"],"application/pdf")
        self.w.process.assert_not_called()
        self.w.mark_handled.assert_not_called()

    def test_confirmation_and_refresh_are_scoped(self):
        execute(self.w,"handling",{"key":"Coupang:123","action":"printed"})
        self.w.mark_handled.assert_called_once_with("Coupang:123","printed","包貨窗口")
        execute(self.w,"refresh",{"days":30})
        self.w.refresh.assert_called_once_with(3)


class ProvidedPdfTests(unittest.TestCase):
    def test_pdf_is_bound_to_exact_order_contents(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/"config.json").write_text("{}")
            w=Workbench(root/"config.json",root/"data")
            row={"key":"EasyStore:123","platform":"EasyStore","stage":"pending","items":[],
                 "recipient":"test","address":"test","tracking":"","carrier":""}
            w.rows[row["key"]]=row
            binding=w.document_binding(row)
            with self.assertRaises(ShippingError):
                w.provide_document(row["key"],b"<html>bad</html>",binding)
            with self.assertRaises(ShippingError):
                w.provide_document(row["key"],b"%PDF-test","wrong-binding")
            w.provide_document(row["key"],b"%PDF-test",binding)
            self.assertEqual(w.document(row["key"]),(b"%PDF-test","application/pdf"))
            row["address"]="changed"
            with self.assertRaises(ShippingError):
                w.document(row["key"])


if __name__=="__main__":
    unittest.main()
