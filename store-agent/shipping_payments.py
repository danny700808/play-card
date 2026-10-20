"""Buyer payments, never catalog prices or seller settlement proceeds.

See PAYMENT_SOURCES.md for contracts and live seller-screen reconciliation.
Amounts are decimal strings. COD receivables are NOT paidAmount.
"""
from decimal import Decimal, InvalidOperation
import json
import re


def unknown_payment(note=None):
    return {"paidAmount": None, "paidCurrency": "", "paidAmountStatus": "unknown",
            "paidAmountNote": note or "尚未取得可確認的實付金額，請核對平台付款明細。"}


def review_payment(note):
    return {**unknown_payment(note), "paidAmountStatus": "review"}


def decimal_amount(raw):
    if isinstance(raw, bool) or not isinstance(raw, (str, int, float, Decimal)):
        raise ValueError("Missing money")
    value = str(raw)
    if not re.fullmatch(r"\d{1,12}(?:\.\d{1,2})?", value):
        raise ValueError("Invalid money")
    try:
        amount = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError("Invalid money") from exc
    if not amount.is_finite() or amount < 0:
        raise ValueError("Invalid money")
    return amount


def confirmed(amount, currency, note, source, scope, scope_key):
    amount = decimal_amount(amount)
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
        raise ValueError("Invalid currency")
    return {"paidAmount": format(amount, "f"), "paidCurrency": currency,
            "paidAmountStatus": "confirmed", "paidAmountNote": note,
            "paidAmountSource": source, "paidAmountScope": scope,
            "paidScopeKey": scope_key}


def easystore_payment(order):
    state = order.get("financial_status")
    if (order.get("is_cancelled") or order.get("cancelled_at") or order.get("refunds")
            or state in ("partially_refunded", "refunded")
            or order.get("total_refund_amount") not in (None, "", 0, "0", "0.0", "0.00")):
        return review_payment("訂單有取消／退款紀錄；須核對退款後淨額，不沿用退款前付款。")
    currency = order.get("currency_code") or order.get("currency")
    key = "EasyStore:" + str(order.get("id", ""))
    try:
        transactions = order.get("transactions") or []
        if state == "unpaid" and order.get("cod_type") == 1 and not transactions:
            # Reconciled to Shopee buyer total, but NOT collected cash.
            amount = decimal_amount(order.get("total_amount_include_transaction"))
            if currency != "TWD":
                return unknown_payment()
            return {**unknown_payment(), "paidAmountStatus": "pending_collection",
                    "paidCurrency": currency, "payableAmount": format(amount, "f"),
                    "paidAmountNote": "貨到付款，尚未收款。此為折扣及運費後待收金額，非已收款；整筆訂單只計一次。",
                    "paidAmountSource": "EasyStore.cod_receivable",
                    "paidAmountScope": "order", "paidScopeKey": key}
        if state != "paid":
            return unknown_payment()
        # Captured transactions already contain discounts/freight/credits.
        successful = [t for t in transactions if t.get("status") == "success"]
        if successful:
            seen, amount = set(), Decimal(0)
            for t in successful:
                ident = t.get("id")
                if (not ident or ident in seen or t.get("test") is not False
                        or t.get("currency") != currency or not t.get("paid_at")
                        or t.get("kind", "sale") not in ("sale", "capture")
                        or t.get("type", "payment") not in ("payment", "sale", "capture")):
                    return review_payment("付款紀錄不完整或重複，請核對平台付款明細。")
                seen.add(ident)
                amount += decimal_amount(t.get("amount"))
            explicit = order.get("total_paid_amount")
            if explicit is not None and decimal_amount(explicit) != amount:
                return review_payment("付款紀錄與已付總額不一致，請核對平台付款明細。")
            return confirmed(amount, currency,
                "EasyStore 成功付款紀錄合計（蝦皮使用 Shopee Payment）；已含折扣與運費效果，不扣賣家手續費。整筆訂單只計一次。",
                "EasyStore.transactions.success", "order", key)
        return confirmed(order.get("total_paid_amount"), currency,
            "EasyStore 回傳的訂單已付款總額；整筆訂單只計一次。",
            "EasyStore.total_paid_amount", "order", key)
    except (ValueError, TypeError, AttributeError):
        return unknown_payment()


def momo_payment(order, group_items, split=False, unallocated_freight=()):
    """E001 客人實付金額 = sum(line orderAmount), INCLUDING freight rows.

    orderAmount is a line total with allocated discounts: never multiply by
    quantity or substitute invoiceAmount.
    """
    all_items = order.get("listItem") or []
    if not split:
        # Freight-only rows may have blank courier/status group fields. A single
        # physical parcel owns the whole order payment, without changing print keys.
        group_items = all_items
    seqs = [str(i.get("orderSeq") or "") for i in all_items]
    if not all(seqs) or len(set(seqs)) != len(seqs):
        return review_payment("MOMO 子訂單編號重複或缺少，暫不加總。")
    if any(i.get("errorMessage") for i in all_items) or order.get("errorMessage"):
        return unknown_payment("MOMO 訂單查詢有錯誤，請重新讀取。")
    if any(any(word in str(i.get("itemStatus", "")) for word in ("取消", "退貨", "退款"))
           or i.get("entpReturnDate") or i.get("recycleDate") for i in all_items):
        return review_payment("MOMO 訂單有取消／退貨紀錄，須核對退款後淨額。")
    paid_states = {"出貨通知(已付款)", "出貨確認", "配送結束"}
    if not group_items or any(i.get("itemStatus") not in paid_states for i in all_items):
        return unknown_payment("MOMO 尚未確認付款，或付款狀態需要核對。")
    try:
        if split and any(decimal_amount(i.get("orderAmount")) != 0 for i in unallocated_freight):
            return review_payment("MOMO 拆單有未分配運費，須核對各包裹分攤後再確認金額。")
        amount = sum((decimal_amount(i.get("orderAmount")) for i in group_items), Decimal(0))
        key = "MOMO:" + str(order["orderNo"])
        if split:
            key += ":" + ",".join(sorted(str(i["orderSeq"]) for i in group_items))
        result = confirmed(amount, "TWD",
            "MOMO 客人實付：子訂單金額加總，含運費列及已分攤折扣，不再乘數量。"
            + ("此為本包裹分攤金額，勿重複計入整張訂單。" if split else "整筆訂單只計一次。"),
            "MOMO.OrderQuery.listItem.orderAmount", "parcel" if split else "order", key)
        if all(i.get("invoiceAmount") is not None for i in group_items):
            result["invoiceBuyerAmount"] = format(sum(
                (decimal_amount(i["invoiceAmount"]) for i in group_items), Decimal(0)), "f")
        return result
    except (ValueError, KeyError, TypeError):
        return unknown_payment("MOMO 實付明細缺少金額，暫不加總。")


def cp_money(value):
    if not isinstance(value, dict) or value.get("currencyCode") != "TWD":
        raise ValueError("Invalid Coupang currency")
    units, nanos = value.get("units"), value.get("nanos")
    if type(units) is not int or type(nanos) is not int or not 0 <= nanos <= 999999999:
        raise ValueError("Incomplete Coupang money")
    amount = Decimal(units) + Decimal(nanos) / Decimal(1000000000)
    if amount < 0 or amount != amount.quantize(Decimal(".01")):
        raise ValueError("Invalid Coupang money")
    return amount


def coupang_payment(order, claims_checked=False, has_claim=False, duplicate_order=False):
    items = order.get("orderItems") or []
    if has_claim or any(i.get("cancelCount") or i.get("holdCountForCancel") or i.get("canceled") for i in items):
        return review_payment("酷澎有取消／退貨申請，須核對退款後淨額。")
    if not claims_checked:
        return unknown_payment("酷澎退貨／取消資料尚未核對，暫不確認實付。")
    if order.get("splitShipping") is not False or duplicate_order:
        return review_payment("酷澎拆單需核對運費與折扣分攤，避免重複計入整筆付款。")
    if not items or not order.get("paidAt"):
        return unknown_payment()
    try:
        total = Decimal(0)
        for item in items:
            discount = cp_money(item.get("discountPrice"))
            parts = sum((cp_money(item.get(k)) for k in
                ("instantCouponDiscount", "downloadableCouponDiscount", "coupangDiscount")), Decimal(0))
            if parts != discount:
                return review_payment("酷澎折扣合計不一致，請核對付款明細。")
            line = cp_money(item.get("orderPrice")) - discount
            if line < 0:
                raise ValueError("Negative paid line")
            total += line
        total += cp_money(order.get("shippingPrice")) + cp_money(order.get("remotePrice"))
        cod_fee = cp_money(order.get("codDeliveryFee"))
        # isCod means FREIGHT collect, not merchandise payment.
        if order.get("isCod") or cod_fee:
            return review_payment("酷澎含運費到付，須分開核對已付貨款及待收運費。")
        result = confirmed(total, "TWD",
            "酷澎付款明細：商品付款金額－全部優惠＋預付運費及偏遠運費；不扣賣家手續費。本包裹只計一次。",
            "Coupang.ordersheets.payment_breakdown", "parcel",
            "Coupang:" + str(order["shipmentBoxId"]))
        invoice = (order.get("extraProperties") or {}).get("invoiceAmountInfo")
        if isinstance(invoice, str):
            invoice = json.loads(invoice)
        if isinstance(invoice, dict) and invoice.get("currency") == "TWD":
            result["invoiceBuyerAmount"] = format(decimal_amount(invoice.get("invoiceAmountToBuyer")), "f")
        return result
    except (ValueError, TypeError, KeyError):
        return unknown_payment("酷澎付款明細缺漏或金額格式異常，暫不推算。")
