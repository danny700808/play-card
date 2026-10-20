import unittest
import copy
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
from shipping_payments import easystore_payment, unknown_payment, momo_payment, coupang_payment
from shipping_core import normalize_momo, Workbench, datetime, TZ


class PaymentTests(unittest.TestCase):
    def order(self, **changes):
        return dict(financial_status="paid", currency_code="TWD",
                    total_paid_amount="1234.50", **changes)

    def test_explicit_paid_value_preserves_decimal_and_zero(self):
        self.assertEqual(easystore_payment(self.order())["paidAmount"], "1234.50")
        row = self.order()
        row["total_paid_amount"] = 0
        self.assertEqual(easystore_payment(row)["paidAmount"], "0")

    def test_never_falls_back_to_total_or_items(self):
        for value in (None, "", True, "NaN", "Infinity", "-1", "1e3", "1,234", "1.234"):
            row = self.order()
            row.update(total_paid_amount=value, total_price=1999, total_amount=1999,
                       line_items=[{"price": 1999, "quantity": 1}])
            self.assertIsNone(easystore_payment(row)["paidAmount"])

    def test_payment_changes_are_not_misreported(self):
        for state in ("pending", "unpaid", "partially_paid", "partially_refunded", "refunded", ""):
            row = self.order()
            row["financial_status"] = state
            self.assertIsNone(easystore_payment(row)["paidAmount"])
        for changes in ({"is_cancelled": True}, {"cancelled_at": "today"},
                        {"refunds": [{"amount": "50"}]}, {"currency_code": ""}):
            row = self.order()
            row.update(changes)
            self.assertIsNone(easystore_payment(row)["paidAmount"])

    def test_captured_transactions_include_discount_and_freight_once(self):
        row = dict(id=1, financial_status="paid", currency_code="TWD",
            subtotal_price="32750", total_discount="2000", total_shipping_fee="60",
            settlement_amount="28258", transactions=[
                dict(id=10, status="success", test=False, paid_at="today", currency="TWD", amount="30810"),
                dict(id=11, status="failure", test=False, amount="32750")])
        self.assertEqual(easystore_payment(row)["paidAmount"], "30810")
        row["transactions"].append(row["transactions"][0])
        self.assertIsNone(easystore_payment(row)["paidAmount"])

    def test_cod_is_receivable_not_collected_cash(self):
        row = dict(id=1, financial_status="unpaid", cod_type=1, currency_code="TWD",
                   total_amount_include_transaction="3036", subtotal_price="3300")
        result = easystore_payment(row)
        self.assertIsNone(result["paidAmount"])
        self.assertEqual(result["payableAmount"], "3036")
        self.assertEqual(result["paidAmountStatus"], "pending_collection")

    def test_refund_test_transaction_and_wrong_currency_do_not_confirm(self):
        tx = dict(id=1, status="success", test=False, paid_at="today", currency="TWD", amount="100")
        row = dict(id=1, financial_status="paid", currency_code="TWD", transactions=[tx])
        for change in ({"test": True}, {"currency": "USD"}, {"kind": "refund"}, {"paid_at": None}):
            self.assertIsNone(easystore_payment({**row, "transactions": [{**tx, **change}]})["paidAmount"])
        self.assertIsNone(easystore_payment({**row, "total_refund_amount": "10"})["paidAmount"])


def money(units):
    return {"currencyCode": "TWD", "units": units, "nanos": 0}


class PlatformPayments(unittest.TestCase):
    def momo(self):
        return {"orderNo": "123", "listItem": [
            {"orderSeq": "001", "goodsType": "一般", "quantity": 3, "orderAmount": 285,
             "itemStatus": "出貨確認", "deliveryNo": "A"},
            {"orderSeq": "002", "goodsType": "一般", "quantity": 7, "orderAmount": 665,
             "itemStatus": "出貨確認", "deliveryNo": "A"},
            {"orderSeq": "003", "goodsType": "運費", "quantity": 1, "orderAmount": 60,
             "itemStatus": "出貨確認", "deliveryNo": ""}]}

    def test_momo_freight_only_group_is_included_without_changing_print_key(self):
        row = normalize_momo(self.momo())[0]
        self.assertEqual(row["paidAmount"], "1010")
        self.assertEqual(row["paidAmountScope"], "order")
        self.assertEqual(row["orderSeqs"], ["001", "002"])
        self.assertEqual(len(row["items"]), 2)

    def test_momo_split_never_loses_or_double_counts_freight(self):
        raw = self.momo()
        raw["listItem"][1]["deliveryNo"] = "B"
        rows = normalize_momo(raw)
        self.assertTrue(all(r["paidAmountStatus"] == "review" for r in rows))
        raw["listItem"][2]["deliveryNo"] = "A"
        rows = normalize_momo(raw)
        self.assertEqual([r["paidAmount"] for r in rows], ["345", "665"])
        self.assertEqual(len(set(r["paidScopeKey"] for r in rows)), 2)
        self.assertTrue(all(r["paidAmountScope"] == "parcel" for r in rows))

    def test_momo_missing_refunded_or_duplicate_line_never_understates_total(self):
        for mode in ("missing", "refund", "duplicate"):
            raw = self.momo()
            if mode == "missing": raw["listItem"][1]["orderAmount"] = None
            if mode == "refund": raw["listItem"][1]["itemStatus"] = "退款完成"
            if mode == "duplicate": raw["listItem"].append(copy.deepcopy(raw["listItem"][0]))
            self.assertIsNone(momo_payment(raw, raw["listItem"])["paidAmount"])

    def cp(self):
        return dict(orderId=1, shipmentBoxId=2, paidAt="today", splitShipping=False, isCod=False,
            shippingPrice=money(60), remotePrice=money(20), codDeliveryFee=money(0),
            orderItems=[dict(orderPrice=money(1000), discountPrice=money(150),
                instantCouponDiscount=money(50), downloadableCouponDiscount=money(70),
                coupangDiscount=money(30))],
            extraProperties={"invoiceAmountInfo": '{"currency":"TWD","invoiceAmountToBuyer":960}'})

    def test_cp_all_discounts_once_and_buyer_invoice_remains_separate(self):
        result = coupang_payment(self.cp(), claims_checked=True)
        self.assertEqual(result["paidAmount"], "930")
        self.assertEqual(result["invoiceBuyerAmount"], "960")

    def test_cp_uncertain_refunds_split_and_missing_money_are_not_zero(self):
        self.assertIsNone(coupang_payment(self.cp())["paidAmount"])
        for kwargs in ({"has_claim": True}, {"duplicate_order": True}):
            self.assertIsNone(coupang_payment(self.cp(), claims_checked=True, **kwargs)["paidAmount"])
        for changes in ({"splitShipping": True}, {"shippingPrice": None}, {"isCod": True}):
            self.assertIsNone(coupang_payment({**self.cp(), **changes}, claims_checked=True)["paidAmount"])
        raw = self.cp()
        raw["orderItems"][0]["coupangDiscount"] = money(31)
        self.assertIsNone(coupang_payment(raw, claims_checked=True)["paidAmount"])

    def test_read_cp_requires_complete_claim_query_and_only_reads_platform(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "config.json").write_text(json.dumps({"coupang":{"vendor_id":"TEST"}}))
            w = Workbench(root / "config.json", root / "data")
            raw = {**self.cp(), "status":"DELIVERING"}
            with patch("shipping_core.source.coupang_request", return_value={}) as request, \
                 patch("shipping_core.source.coupang_orders_from_payload", return_value=([raw], "")), \
                 patch("shipping_core.source.fetch_coupang_return_rows") as claims:
                for response, expected in (( ([], True, []), "confirmed"),
                                           (([], False, ["failed"]), "unknown"),
                                           (([{"訂單ID":"1"}], True, []), "review")):
                    claims.return_value = response
                    result = w.read_cp(datetime.now(TZ), datetime.now(TZ))
                    self.assertEqual(result[0]["paidAmountStatus"], expected)
                self.assertTrue(all(c.args[1] == "GET" for c in request.call_args_list))


if __name__ == "__main__":
    unittest.main()
