import unittest
from shipping_payments import easystore_payment, unknown_payment


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
            self.assertEqual(easystore_payment(row), unknown_payment())

    def test_payment_changes_are_not_misreported(self):
        for state in ("pending", "unpaid", "partially_paid", "partially_refunded", "refunded", ""):
            row = self.order()
            row["financial_status"] = state
            self.assertEqual(easystore_payment(row), unknown_payment())
        for changes in ({"is_cancelled": True}, {"cancelled_at": "today"},
                        {"refunds": [{"amount": "50"}]}, {"currency_code": ""}):
            row = self.order()
            row.update(changes)
            self.assertEqual(easystore_payment(row), unknown_payment())


if __name__ == "__main__":
    unittest.main()
