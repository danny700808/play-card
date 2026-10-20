"""Conservative buyer-payment contract for the packing desk.

Never substitute subtotal, order total, settlement or unit-price sums for cash
actually paid. Platform adapters without a verified payment source stay unknown.
EasyStore source definition:
https://developers.easystore.co/docs/theme/liquid-reference/liquid-order
The API may omit total_paid_amount even though the Liquid order exposes it.
"""
from decimal import Decimal, InvalidOperation
import re


def unknown_payment():
    return {"paidAmount": None, "paidCurrency": "", "paidAmountStatus": "unknown",
            "paidAmountNote": "尚未取得可確認的實付金額，請核對平台付款明細。"}


def easystore_payment(order):
    result = unknown_payment()
    # A refunded/partial/unpaid/cancelled order requires payment-detail review.
    # Do not infer collected money from a fulfillment status or an order total.
    if (order.get("financial_status") != "paid" or order.get("is_cancelled")
            or order.get("cancelled_at") or order.get("refunds")):
        return result
    raw = order.get("total_paid_amount")
    currency = order.get("currency_code") or order.get("currency")
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
        return result
    if isinstance(raw, bool) or not isinstance(raw, (str, int, float, Decimal)):
        return result
    value = str(raw)
    if not re.fullmatch(r"\d{1,12}(?:\.\d{1,2})?", value):
        return result
    try:
        amount = Decimal(value)
    except InvalidOperation:
        return result
    if not amount.is_finite() or amount < 0:
        return result
    return {"paidAmount": format(amount, "f"), "paidCurrency": currency,
            "paidAmountStatus": "confirmed",
            "paidAmountNote": "EasyStore 回傳的訂單已付款總額；退款或付款異動請核對平台明細。"}
