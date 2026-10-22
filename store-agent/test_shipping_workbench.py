import copy
import base64
import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from shipping_core import Workbench, ShippingError, normalize_es, normalize_cp, normalize_momo, channel, TZ


def cp(status="INSTRUCT", invoice=""):
    return {"shipmentBoxId": 9007199254740993, "orderId": 12345, "status": status,
            "invoiceNumber": invoice, "deliveryCompanyName": "新竹物流",
            "receiver": {"name": "測試收件人", "addr1": "測試地址"},
            "orderItems": [{"vendorItemId": 22, "shippingCount": 3, "cancelCount": 0,
                           "holdCountForCancel": 0, "sellerProductName": "測試商品",
                           "externalVendorSkuCode": "SKU-1"}]}


class ShippingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        path = Path(self.tmp.name)
        (path / "config.json").write_text(json.dumps({"coupang": {"vendor_id": "TEST"}}))
        self.w = Workbench(path / "config.json", path / "data")
        self.row = normalize_cp(cp())
        self.key = self.row["key"]
        self.options = {"carrier": "TWL_HCT", "outboundShippingPlaceCode": "123"}

    def tearDown(self):
        self.tmp.cleanup()

    def test_source_is_explicit(self):
        self.assertEqual(channel("shopee-taiwan"), "蝦皮")
        self.assertEqual(channel("line-shopping"), "LINE")
        self.assertEqual(channel(""), "來源待確認")
        self.assertEqual(channel("some-new-platform"), "來源待確認")

    def test_es_real_delivery_name_preserves_saved_document_bindings(self):
        raw = {"id": 1, "shipping_fees": [{"name": "Shipping Fee"}],
               "fulfillments": [{"tracking_company": "蝦皮店到店", "tracking_number": "T1"},
                                {"tracking_company": "已取消物流", "cancelled_at": "2026-10-20"}]}
        row = normalize_es(raw)
        self.assertEqual(row["deliveryMethod"], "蝦皮店到店")
        self.assertEqual(row["carrier"], "Shipping Fee")
        before = self.w.document_binding(row)
        row["deliveryMethod"] = "蝦皮店到店 - 隔日到貨"
        self.assertEqual(self.w.document_binding(row), before)
        raw["fulfillments"] = []
        self.assertEqual(normalize_es(raw)["deliveryMethod"], "")
        raw["shipping_fees"] = [{"name": "賣家自行配送"}]
        self.assertEqual(normalize_es(raw)["deliveryMethod"], "賣家自行配送")

    def test_large_package_id_stays_string(self):
        self.assertEqual(self.row["packageId"], "9007199254740993")

    def test_screen_delivery_requires_fresh_matching_evidence_and_never_overrides_api(self):
        raw = {"id": 123, "name": "ORDER", "source_name": "shopee-taiwan", "updated_at": "v1"}
        row = normalize_es(raw)
        evidence = {"orderNo": "ORDER", "sourceUpdatedAt": "v1",
                    "binding": self.w.handling_binding(row), "deliveryMethod": "蝦皮店到店",
                    "source": "EasyStore 蝦皮通路後台", "verifiedAt": datetime.now(TZ).isoformat()}
        self.w.apply_delivery_observation(row, raw, evidence)
        self.assertEqual(row["deliveryMethod"], "蝦皮店到店")
        for change in ({"orderNo": "OTHER"}, {"binding": "changed"}, {"sourceUpdatedAt": "v0"},
                       {"verifiedAt": (datetime.now(TZ)-timedelta(hours=25)).isoformat()},
                       {"verifiedAt": (datetime.now(TZ)+timedelta(hours=1)).isoformat()},
                       {"verifiedAt": "invalid"}, {"source": "guess"}):
            actual = normalize_es(raw)
            self.w.apply_delivery_observation(actual, raw, {**evidence, **change})
            self.assertEqual(actual["deliveryMethod"], "")
        row["deliveryMethod"] = "店到家宅配"
        self.w.apply_delivery_observation(row, raw, evidence)
        self.assertEqual(row["deliveryMethod"], "店到家宅配")

    def test_cancellation_hold_blocks_shipment(self):
        raw = cp()
        raw["orderItems"][0]["holdCountForCancel"] = 1
        row = normalize_cp(raw)
        self.assertFalse(row["canCreate"])
        self.assertEqual(row["items"][0]["quantity"], 2)
        self.assertEqual(row["stage"], "review")

    def test_unknown_status_not_ready(self):
        self.assertFalse(normalize_cp(cp("NEW_STATUS"))["canCreate"])
        self.assertTrue(normalize_cp(cp("ACCEPT"))["canCreate"])

    def test_es_partial_remaining(self):
        row = normalize_es({"id": 1, "source_name": "shopee-taiwan",
            "fulfillment_status": "partial", "line_items": [
                {"id": 2, "quantity": 5, "fulfillable_quantity": 2, "image_url": "javascript:alert(1)"}]})
        self.assertEqual(row["stage"], "partial")
        self.assertEqual(row["items"][0]["remaining"], 2)
        self.assertEqual(row["items"][0]["image"], "")

    def test_storefront_pickup_recipient_and_platform_number(self):
        row=normalize_es({"id":1,"source_name":"sf","name":"EXTERNAL-1","order_number":"#10",
            "pickup_address":{"receiver_first_name":"測試","receiver_last_name":"人",
                              "receiver_phone":"0900000000","name":"測試門市"}})
        self.assertEqual(row["orderNo"],"EXTERNAL-1")
        self.assertEqual(row["channel"],"官網")
        self.assertEqual(row["recipient"],"測試 人")
        self.assertEqual(row["pickupStore"],"測試門市")

    def test_zero_quantity_cannot_create(self):
        raw=cp();raw["orderItems"][0]["shippingCount"]=0
        self.assertFalse(normalize_cp(raw)["canCreate"])
        row=normalize_momo({"orderNo":"123","listItem":[{"orderSeq":"001",
            "quantity":0,"deliveryType":"第三方物流","itemStatus":"出貨通知(已付款)"}]})[0]
        self.assertFalse(row["canCreate"])

    def test_momo_group_includes_freight_seq_but_not_packing_item(self):
        common = {"itemStatus":"出貨通知(已付款)", "shipStatus":"供應商已列印宅配單",
                  "deliveryType":"第三方物流", "deliveryCompany":"第三方物流-新竹貨運"}
        row = normalize_momo({"orderNo":"123", "listItem":[
            dict(common,orderSeq="001",goodsType="一般",quantity=2),
            dict(common,orderSeq="002",goodsType="運費",quantity=1)]})[0]
        self.assertEqual(row["orderSeqs"], ["001","002"])
        self.assertEqual(len(row["items"]), 1)
        self.assertTrue(row["canDownload"])

    def test_momo_changed_address_blocks(self):
        row = normalize_momo({"orderNo":"123", "listItem":[
            {"orderSeq":"001","goodsType":"一般","quantity":1,"deliveryType":"第三方物流",
             "itemStatus":"出貨通知(已付款)", "changedAddress":"新地址"}]})[0]
        self.assertFalse(row["canCreate"])

    def test_momo_cvs_generated_is_acquired_and_never_new_shipment(self):
        for carrier in ("7-11店到店", "全家店到店"):
            with self.subTest(carrier=carrier):
                row=normalize_momo({"orderNo":"123","listItem":[{
                    "orderSeq":"001","quantity":1,"deliveryType":"超商取貨",
                    "deliveryCompany":carrier,"itemStatus":"出貨通知(已付款)",
                    "shipStatus":"已產生超取出貨單","deliveryNo":"TRACK-1"}]})[0]
                self.assertEqual(row["stage"],"label")
                self.assertFalse(row["canCreate"])
                self.assertTrue(row["canDownload"])
                self.w.rows[row["key"]]=row
                snapshot=self.w.snapshot()["orders"][0]
                self.assertEqual(snapshot["handlingAction"],"acquired")
                self.assertTrue(snapshot["handled"])
                self.assertEqual(snapshot["printCount"],0)
                (self.w.data_dir/"existing.pdf").write_bytes(b"%PDF-1.7\noriginal")
                self.w.save_job(row["key"],state="ready",document="existing.pdf",
                    mime="application/pdf",tracking="TRACK-1",binding=self.w.document_binding(row))
                with patch.object(self.w,"fresh_momo",return_value=row),patch.object(self.w,"momo_request") as call:
                    fp=self.w.preview(row["key"],{})["fingerprint"]
                    self.assertTrue(self.w.process(row["key"],{},fp)["reused"])
                    call.assert_not_called()

    def test_momo_unknown_status_with_tracking_cannot_create_again(self):
        row=normalize_momo({"orderNo":"123","listItem":[{
            "orderSeq":"001","quantity":1,"deliveryType":"超商取貨",
            "deliveryCompany":"7-11店到店","itemStatus":"出貨通知(已付款)",
            "shipStatus":"未知狀態","deliveryNo":"TRACK-1"}]})[0]
        self.assertFalse(row["canCreate"])
        with patch.object(self.w,"fresh_momo",return_value=row),patch.object(self.w,"momo_request") as call:
            with self.assertRaises(ShippingError):
                self.w.preview(row["key"],{})
            call.assert_not_called()

    def test_momo_cvs_changed_address_and_cancelled_block_cached_document(self):
        raw={"orderNo":"123","listItem":[{
            "orderSeq":"001","quantity":1,"deliveryType":"超商取貨",
            "deliveryCompany":"7-11店到店","itemStatus":"出貨通知(已付款)",
            "shipStatus":"已產生超取出貨單","deliveryNo":"TRACK-1"}]}
        row=normalize_momo(raw)[0]
        self.w.rows[row["key"]]=row
        (self.w.data_dir/"existing.pdf").write_bytes(b"%PDF-1.7\noriginal")
        self.w.save_job(row["key"],state="ready",document="existing.pdf",
            mime="application/pdf",binding=self.w.document_binding(row))
        for changes in ({"changedAddress":"待確認的新地址"},{"itemStatus":"客戶取消"},{"deliveryNo":"TRACK-2"}):
            changed=copy.deepcopy(raw);changed["listItem"][0].update(changes)
            actual=normalize_momo(changed)[0]
            self.w.rows[row["key"]]=actual
            self.assertFalse(self.w.snapshot()["orders"][0]["documentReady"])
            with self.assertRaises(ShippingError):
                self.w.document(row["key"])

    def test_read_snapshot_never_calls_platform_mutation(self):
        self.w.rows[self.key]=self.row
        with patch.object(self.w, "_cp_request") as call:
            self.w.snapshot()
            call.assert_not_called()

    def test_recent_orders_include_three_taiwan_calendar_days(self):
        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 10, 20, 0, 15, tzinfo=TZ)
        for options in ({}, {"days": 30}):
            with self.subTest(options=options), \
                 patch("shipping_core.datetime", Clock), \
                 patch.object(self.w, "read_es", return_value=[]) as es, \
                 patch.object(self.w, "read_momo", return_value=[]) as momo, \
                 patch.object(self.w, "read_cp", return_value=[]) as cp_read:
                snapshot = self.w.refresh(**options)
                self.assertEqual(snapshot["days"], 3)
                for reader in (es, momo, cp_read):
                    start, end = reader.call_args.args
                    self.assertEqual(start.isoformat(), "2026-10-18T00:00:00+08:00")
                    self.assertEqual(end.isoformat(), "2026-10-20T00:15:00+08:00")

    def test_changed_address_invalidates_review(self):
        with patch.object(self.w, "fresh_cp", return_value=self.row):
            preview=self.w.preview(self.key,self.options)
        changed=copy.deepcopy(self.row);changed["address"]="改過的地址"
        with patch.object(self.w,"fresh_cp",return_value=changed), patch.object(self.w,"_cp_request") as call:
            with self.assertRaises(ShippingError):
                self.w.process(self.key,self.options,preview["fingerprint"])
            call.assert_not_called()

    def test_timeout_never_retries_creation(self):
        with patch.object(self.w,"fresh_cp",return_value=self.row), patch.object(self.w,"_cp_request",side_effect=TimeoutError) as call:
            fingerprint=self.w.preview(self.key,self.options)["fingerprint"]
            with self.assertRaises(ShippingError):
                self.w.process(self.key,self.options,fingerprint)
            with self.assertRaises(ShippingError):
                self.w.process(self.key,self.options,fingerprint)
            self.assertEqual(call.call_count,1)
            self.assertEqual(self.w.job(self.key)["state"],"uncertain")

    def test_reservation_survives_other_instance(self):
        self.w.reserve_creation(self.key)
        other=Workbench(Path(self.tmp.name)/"config.json",Path(self.tmp.name)/"data")
        with self.assertRaises(ShippingError):
            other.reserve_creation(self.key)

    def test_existing_tracking_downloads_without_arrange(self):
        row=normalize_cp(cp("DEPARTURE","TRACK-1"))
        class Response:
            headers={"Content-Type":"application/pdf"}
            content=b"%PDF-1.7\nsample"
        with patch.object(self.w,"fresh_cp",return_value=row),patch.object(self.w,"_cp_request",return_value=Response()) as call:
            fp=self.w.preview(self.key,{})["fingerprint"]
            result=self.w.process(self.key,{},fp)
            self.assertTrue(result["ready"])
            self.assertEqual(call.call_args.args[0],"downloadInvoices")
            again=self.w.process(self.key,{},fp)
            self.assertTrue(again["reused"])
            self.assertEqual(call.call_count,1)

    def test_invalid_document_not_ready(self):
        row=normalize_cp(cp("DEPARTURE","TRACK-1"))
        class Response:
            headers={"Content-Type":"application/json"}
            content=b'{"error":"not ready"}'
        with patch.object(self.w,"fresh_cp",return_value=row),patch.object(self.w,"_cp_request",return_value=Response()):
            fp=self.w.preview(self.key,{})["fingerprint"]
            with self.assertRaises(ShippingError):
                self.w.process(self.key,{},fp)
        self.assertEqual(self.w.job(self.key)["state"],"download-failed")

    def test_old_label_blocked_when_address_changes_or_platform_read_fails(self):
        row=normalize_cp(cp("DEPARTURE","TRACK-1"))
        self.w.rows[self.key]=row
        (self.w.data_dir/"label.pdf").write_bytes(b"%PDF-1.7\nlabel")
        self.w.save_job(self.key,state="ready",document="label.pdf",mime="application/pdf",
                        binding=self.w.document_binding(row))
        self.assertTrue(self.w.document(self.key)[0].startswith(b"%PDF"))
        row["address"]="異動地址"
        self.assertFalse(self.w.snapshot()["orders"][0]["documentReady"])
        with self.assertRaises(ShippingError):
            self.w.document(self.key)
        row["address"]="測試地址"
        self.w.errors["Coupang"]="連線失敗"
        with self.assertRaises(ShippingError):
            self.w.document(self.key)

    def test_momo_reprint_preserves_original_and_combined_documents(self):
        row=normalize_momo({"orderNo":"123","listItem":[{"orderSeq":"001","quantity":1,
            "deliveryType":"第三方物流","itemStatus":"出貨通知","shipStatus":"供應商已列印宅配單"}]})[0]
        label=b"%PDF-1.7\noriginal-label"
        combined=b"%PDF-1.7\noriginal-combined"
        receipt={"printLabel":base64.b64encode(label).decode(),
                 "printAll":base64.b64encode(combined).decode()}
        with patch.object(self.w,"fresh_momo",return_value=row),patch.object(self.w,"momo_request",
             return_value={"orderPrintLabelResList":[receipt]}) as call:
            fp=self.w.preview(row["key"],{})["fingerprint"]
            self.w.process(row["key"],{},fp)
            self.assertEqual(call.call_args.args[0],"OrderShippingThirdPartyPrintLabel")
        self.assertEqual(self.w.document(row["key"])[0],label)
        self.assertEqual(self.w.document(row["key"],"combined")[0],combined)
        with self.assertRaises(ShippingError):
            self.w.document(row["key"],"../../config.json")


if __name__ == "__main__":
    unittest.main()
