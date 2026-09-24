# -*- coding: utf-8 -*-
"""
三平台最近成交商品匯出工具（只讀取，不修改資料）

放置位置：
  原本庫存同步資料夾/Sale/export_today_new_sales_all.py

執行方式：
  由根目錄 BAT 呼叫：python Sale\\export_today_new_sales_all.py

功能：
1. 讀取上一層 config.json 的 EasyStore / momo / Coupang API 設定。
2. 抓取「前 3 個完整日期 + 今天執行當下」的成交/訂單商品明細。
3. 輸出到 Sale 資料夾，並分頁分類：全部、EasyStore、MOMO、Coupang、執行摘要。
4. 用 Sale/sale_seen_orders_all.json 記錄已輸出的訂單商品。
5. 第二次執行時，只輸出新的成交商品，不重複顯示已看過的商品。

安全性：
- 只用 API 讀取訂單。
- 不修改庫存、不修改商品、不修改訂單。
"""

import argparse
import hashlib
import hmac
import json
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, date, time as dtime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode, urljoin

import requests
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

TAIWAN_TZ = timezone(timedelta(hours=8))
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
SEEN_FILE = SCRIPT_DIR / "sale_seen_orders_all.json"
COUPANG_HOST = "https://api-gateway.coupang.com"

HEADERS = [
    "平台", "訂單時間", "訂單編號", "訂單ID", "商品編號/SKU", "商品名稱", "規格名稱",
    "數量", "單價", "小計", "幣別", "訂單總額", "付款狀態", "訂單狀態", "買家/顧客", "備註", "去重Key"
]


def normalize(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value)).strip()
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    return text.strip()


def stamp():
    return datetime.now(TAIWAN_TZ).strftime("%Y%m%d_%H%M%S")


def load_config():
    cfg_path = ROOT_DIR / "config.json"
    if not cfg_path.exists():
        raise FileNotFoundError("找不到 config.json。請確認 Sale 資料夾是在原本庫存同步資料夾裡面。")
    with open(cfg_path, "r", encoding="utf-8") as f:
        return json.load(f)


def parse_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text:
            return None
        text = text.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except Exception:
            dt = None
            for fmt in (
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M",
                "%Y-%m-%d", "%Y/%m/%d", "%Y%m%d%H%M%S", "%Y%m%d"
            ):
                try:
                    dt = datetime.strptime(str(value).strip(), fmt)
                    break
                except Exception:
                    pass
            if dt is None:
                return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TAIWAN_TZ)
    return dt.astimezone(TAIWAN_TZ)


def first_value(obj, keys, default=""):
    if not isinstance(obj, dict):
        return default
    for key in keys:
        val = obj.get(key)
        if val not in (None, ""):
            return val
    return default


def deep_get(obj, *keys, default=""):
    cur = obj
    for key in keys:
        if isinstance(cur, dict):
            cur = cur.get(key)
        else:
            return default
    return default if cur is None else cur


def money_value(obj):
    if obj in (None, ""):
        return ""
    if isinstance(obj, (int, float, str)):
        return normalize(obj)
    if isinstance(obj, dict):
        units = obj.get("units")
        nanos = obj.get("nanos", 0) or 0
        if units is not None:
            try:
                val = float(units) + float(nanos) / 1000000000
                if val.is_integer():
                    return str(int(val))
                return str(val)
            except Exception:
                return normalize(units)
        for k in ("amount", "price", "value", "total"):
            if obj.get(k) not in (None, ""):
                return normalize(obj.get(k))
    return ""


def currency_value(*objs):
    for obj in objs:
        if isinstance(obj, dict) and obj.get("currencyCode"):
            return normalize(obj.get("currencyCode"))
        if isinstance(obj, dict) and obj.get("currency"):
            return normalize(obj.get("currency"))
    return ""


def extract_orders(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("orders", "data", "items", "results", "result", "list", "listOrder"):
            if isinstance(payload.get(key), list):
                return payload[key]
        data = payload.get("data")
        if isinstance(data, dict):
            for key in ("orders", "items", "results", "result", "list", "listOrder"):
                if isinstance(data.get(key), list):
                    return data[key]
    return []


def extract_line_items(order):
    if not isinstance(order, dict):
        return []
    for key in ("line_items", "items", "products", "order_items", "variants", "orderItems", "listGoods", "goods", "details", "listItem"):
        val = order.get(key)
        if isinstance(val, list):
            return val
    return []


def load_seen():
    if not SEEN_FILE.exists():
        return {"seen_keys": [], "history": []}
    try:
        with open(SEEN_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"seen_keys": [], "history": []}
        data.setdefault("seen_keys", [])
        data.setdefault("history", [])
        return data
    except Exception:
        return {"seen_keys": [], "history": []}


def save_seen(data):
    SCRIPT_DIR.mkdir(parents=True, exist_ok=True)
    with open(SEEN_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def make_seen_key(platform, order_id, line_id, sku, qty, price, index):
    return "|".join([normalize(platform), normalize(order_id), normalize(line_id) or str(index), normalize(sku), normalize(qty), normalize(price)])


# -----------------------------
# EasyStore
# -----------------------------

def es_request(method, url, token, timeout=60, **kwargs):
    headers = kwargs.pop("headers", {})
    headers["EasyStore-Access-Token"] = token
    headers["Accept"] = "application/json"
    headers["Content-Type"] = "application/json"
    res = requests.request(method, url, headers=headers, timeout=timeout, **kwargs)
    if res.status_code < 200 or res.status_code >= 300:
        raise RuntimeError(f"EasyStore HTTP {res.status_code}: {res.text[:1000]}")
    if not res.text.strip():
        return {}
    try:
        return res.json()
    except Exception:
        raise RuntimeError(f"EasyStore 回傳不是 JSON：{res.text[:1000]}")


def fetch_easystore_rows(root_cfg, start_dt, end_dt):
    es_cfg = root_cfg.get("easystore", {})
    summary = {"平台": "EasyStore", "狀態": "未執行", "讀到訂單": 0, "輸出明細": 0, "訊息": ""}
    if not es_cfg.get("enabled", True):
        summary.update({"狀態": "SKIPPED", "訊息": "config easystore.enabled=false"})
        return [], summary
    missing = [k for k in ("store_url", "access_token") if not normalize(es_cfg.get(k))]
    if missing:
        summary.update({"狀態": "ERROR", "訊息": "EasyStore config 尚未填：" + ", ".join(missing)})
        return [], summary

    store_url = es_cfg["store_url"].rstrip("/") + "/"
    token = es_cfg["access_token"]
    api_path = es_cfg.get("api_base_path", "/api/3.0").strip("/") + "/"
    timeout = int(es_cfg.get("request_timeout_seconds", 60))
    max_pages = int(es_cfg.get("max_order_pages", 50))
    limit = int(es_cfg.get("order_page_limit", 100))
    url = urljoin(store_url, api_path + "orders.json")

    orders = []
    seen_order_marker = set()
    try:
        for page in range(1, max_pages + 1):
            params = {"page": page, "limit": limit, "created_at_min": start_dt.isoformat(), "created_at_max": end_dt.isoformat()}
            payload = es_request("GET", url, token, timeout=timeout, params=params)
            got = extract_orders(payload)
            if not got:
                break
            added = 0
            for order in got:
                oid = normalize(first_value(order, ["id", "order_id", "number", "order_number", "name"]))
                marker = oid or json.dumps(order, ensure_ascii=False, sort_keys=True)[:300]
                if marker in seen_order_marker:
                    continue
                seen_order_marker.add(marker)
                raw_dt = first_value(order, ["created_at", "created_on", "createdAt", "order_date", "date", "updated_at"])
                dt = parse_datetime(raw_dt)
                if dt is None or (start_dt <= dt <= end_dt):
                    orders.append(order)
                    added += 1
            print(f"EasyStore 訂單讀取：第 {page} 頁，取得 {len(got)} 筆，符合/新增 {added} 筆")
            if len(got) < limit or added == 0:
                break
            time.sleep(0.15)
    except Exception as e:
        summary.update({"狀態": "ERROR", "訊息": str(e)[:800]})
        return [], summary

    rows = []
    for order in orders:
        order_id = first_value(order, ["id", "order_id", "number", "order_number", "name"])
        order_no = first_value(order, ["number", "order_number", "name", "ref", "reference"])
        created_raw = first_value(order, ["created_at", "created_on", "createdAt", "order_date", "date"])
        created_dt = parse_datetime(created_raw)
        created_text = created_dt.strftime("%Y-%m-%d %H:%M:%S") if created_dt else normalize(created_raw)
        order_status = first_value(order, ["status", "order_status", "fulfillment_status"])
        payment_status = first_value(order, ["financial_status", "payment_status", "paid_status"])
        currency = first_value(order, ["currency", "currency_code"])
        order_total = money_value(first_value(order, ["total", "total_price", "grand_total", "amount", "subtotal_price"]))
        customer_name = " ".join(x for x in [normalize(deep_get(order, "customer", "first_name")), normalize(deep_get(order, "customer", "last_name"))] if x).strip()
        if not customer_name:
            customer_name = normalize(first_value(order, ["customer_name", "buyer_name", "name"]))
        items = extract_line_items(order)
        for idx, item in enumerate(items or [{}], start=1):
            product = item.get("product") if isinstance(item.get("product"), dict) else {}
            variant = item.get("variant") if isinstance(item.get("variant"), dict) else {}
            sku = first_value(item, ["sku", "code", "product_sku", "variant_sku"]) or first_value(variant, ["sku", "code"]) or first_value(product, ["sku", "code"])
            product_name = first_value(item, ["title", "name", "product_title", "product_name"]) or first_value(product, ["title", "name"])
            variant_name = first_value(item, ["variant_title", "variant_name", "option", "option_name"]) or first_value(variant, ["title", "name"])
            qty = first_value(item, ["quantity", "qty", "fulfillable_quantity"])
            price = money_value(first_value(item, ["price", "unit_price", "selling_price", "final_price", "discounted_price"]))
            subtotal = money_value(first_value(item, ["subtotal", "total", "line_price", "total_price", "discounted_total"]))
            if not normalize(subtotal):
                try:
                    subtotal = str(float(normalize(price)) * float(normalize(qty)))
                except Exception:
                    subtotal = ""
            key = make_seen_key("EasyStore", order_id or order_no, first_value(item, ["id", "line_item_id", "item_id", "variant_id", "product_id"]), sku, qty, price, idx)
            rows.append({
                "平台": "EasyStore", "訂單時間": created_text, "訂單編號": normalize(order_no or order_id), "訂單ID": normalize(order_id),
                "商品編號/SKU": normalize(sku), "商品名稱": normalize(product_name), "規格名稱": normalize(variant_name),
                "數量": normalize(qty), "單價": normalize(price), "小計": normalize(subtotal), "幣別": normalize(currency),
                "訂單總額": normalize(order_total), "付款狀態": normalize(payment_status), "訂單狀態": normalize(order_status),
                "買家/顧客": customer_name, "備註": "" if items else "此訂單未讀到商品明細欄位", "去重Key": key,
                # created_at 是 EasyStore 的訂單成立時間；updated_at 只能當狀態更新時間。
                "訂單時間來源": "easystore-created-at",
                "履行狀態": normalize(order.get("fulfillment_status")),
                "取消已確認": bool(order.get("cancelled_at") or order.get("is_cancelled")),
                "曾確認出貨": order.get("fulfillment_status") in ("fulfilled", "partial", "partially_fulfilled") or any(f.get("status") in ("success", "fulfilled", "shipped", "in_transit", "delivered", "customer_picked_up") for f in order.get("fulfillments", []) if isinstance(f, dict)),
                "確定未出貨": order.get("fulfillment_status") == "unfulfilled" or (bool(order.get("cancelled_at") or order.get("is_cancelled")) and isinstance(order.get("fulfillments"), list) and not order["fulfillments"]),
                "出貨時間": normalize(first_value(order, ["shipped_at", "fulfilled_at", "fulfillment_at", "shipment_at"])),
                "完成時間": normalize(first_value(order, ["completed_at", "closed_at", "delivered_at"])),
                "退款時間": normalize(first_value(order, ["refunded_at", "refund_at"])),
                "狀態更新時間": normalize(first_value(order, ["updated_at", "updatedAt", "modified_at"]))
            })
    summary.update({"狀態": "OK", "讀到訂單": len(orders), "輸出明細": len(rows), "訊息": url})
    return rows, summary


# -----------------------------
# Coupang
# -----------------------------

def coupang_datetime():
    return datetime.utcnow().strftime("%y%m%dT%H%M%SZ")


def coupang_auth(method, path, query, access_key, secret_key):
    signed_date = coupang_datetime()
    message = signed_date + method.upper() + path + (query or "")
    signature = hmac.new(secret_key.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"CEA algorithm=HmacSHA256, access-key={access_key}, signed-date={signed_date}, signature={signature}"


def coupang_request(cfg, method, path, query_params=None, body=None):
    access_key = cfg["access_key"]
    secret_key = cfg["secret_key"]
    timeout = int(cfg.get("request_timeout_seconds", 60))
    query = urlencode(query_params or {}, doseq=True)
    url = COUPANG_HOST + path + (("?" + query) if query else "")
    headers = {
        "Authorization": coupang_auth(method, path, query, access_key, secret_key),
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json",
        "X-EXTENDED-TIMEOUT": "90000",
        "X-MARKET": "TW",
        "X-Requested-By": cfg.get("vendor_id", ""),
    }
    res = requests.request(method.upper(), url, headers=headers, json=body, timeout=timeout)
    try:
        data = res.json() if res.text.strip() else {}
    except Exception:
        raise RuntimeError(f"Coupang HTTP {res.status_code}，回應不是 JSON：{res.text[:1200]}")
    if res.status_code >= 400:
        raise RuntimeError(f"Coupang HTTP {res.status_code}: {data}")
    return data


def coupang_orders_from_payload(payload):
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return data, payload.get("nextToken") or payload.get("nextPageToken") or ""
        if isinstance(data, dict):
            for k in ("orders", "items", "results"):
                if isinstance(data.get(k), list):
                    return data[k], data.get("nextToken") or payload.get("nextToken") or ""
        for k in ("orders", "items", "results"):
            if isinstance(payload.get(k), list):
                return payload[k], payload.get("nextToken") or ""
    if isinstance(payload, list):
        return payload, ""
    return [], ""


def coupang_return_rows_from_payload(payload):
    """Coupang 退貨查詢 API 的回傳格式會依版本有 data / items 差異。"""
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return data, payload.get("nextToken") or payload.get("nextPageToken") or ""
        if isinstance(data, dict):
            for key in ("returnRequests", "returns", "items", "results"):
                if isinstance(data.get(key), list):
                    return data[key], data.get("nextToken") or payload.get("nextToken") or ""
        for key in ("returnRequests", "returns", "items", "results"):
            if isinstance(payload.get(key), list):
                return payload[key], payload.get("nextToken") or ""
    if isinstance(payload, list):
        return payload, ""
    return [], ""


def extract_return_items(record):
    if not isinstance(record, dict):
        return []
    for key in ("returnItems", "orderItems", "items", "returnItemList", "details"):
        if isinstance(record.get(key), list):
            return record[key]
    return [record]


def fetch_coupang_return_rows(cfg, start_text, end_text, max_pages, max_per_page):
    """Read cancellations separately from returns; retain receipt and item shipment states."""
    path = f"/v2/providers/openapi/apis/api/v6/vendors/{cfg['vendor_id']}/returnRequests"
    records, errors = {}, []
    complete = True
    queries = [{"cancelType": "RETURN", "status": state} for state in ("RU", "UC", "CC", "PR")]
    queries.append({"cancelType": "CANCEL"})
    for query in queries:
        next_token = ""
        for page in range(1, max_pages + 1):
            params = {"createdAtFrom": start_text[:10], "createdAtTo": end_text[:10], "maxPerPage": max_per_page, **query}
            if next_token:
                params["nextToken"] = next_token
            try:
                payload = coupang_request(cfg, "GET", path, params)
                if isinstance(payload, dict) and str(payload.get("code", "200")) not in ("200", "SUCCESS"):
                    raise RuntimeError("Coupang claims query returned a non-success code")
                got, next_token = coupang_return_rows_from_payload(payload)
            except Exception as exc:
                errors.append(str(exc)[:500]); complete = False; break
            for record in got:
                rid = normalize(record.get("receiptId") or record.get("returnRequestId") or record.get("id"))
                records[rid or json.dumps(record, sort_keys=True)] = record
            if not got or not next_token:
                break
            if page == max_pages:
                complete = False; errors.append("Return/cancel pagination incomplete")
            time.sleep(0.2)
    rows = []
    for record in records.values():
        order_id = normalize(first_value(record, ["orderId", "orderNumber", "orderNo"]))
        # createdAt is the claim date, NEVER the original order date.
        order_at = first_value(record, ["orderedAt", "orderDate"])
        order_dt = parse_datetime(order_at)
        order_text = order_dt.strftime("%Y-%m-%d %H:%M:%S") if order_dt else normalize(order_at)
        receipt = normalize(first_value(record, ["receiptId", "returnRequestId", "id"]))
        receipt_status = normalize(record.get("receiptStatus")).upper()
        for index, item in enumerate(extract_return_items(record), start=1):
            item = item if isinstance(item, dict) else {}
            release = normalize(item.get("releaseStatus") or record.get("releaseStatus")).upper()
            shipped = release in ("Y", "A")
            vendor_item_id = first_value(item, ["vendorItemId", "vendoritemid"])
            sku = first_value(item, ["externalVendorSkuCode", "externalVendorSku", "sellerProductItemCode"])
            qty = first_value(item, ["purchaseCount", "quantity", "shippingCount"])
            cancel_qty = first_value(item, ["cancelCount", "returnCount"])
            rows.append({
                "平台": "Coupang", "訂單時間": order_text, "訂單編號": order_id, "訂單ID": order_id,
                "商品編號/SKU": normalize(sku), "商品名稱": normalize(first_value(item,["sellerProductName","vendorItemName"])), "規格名稱": "",
                "數量": normalize(qty), "單價": "", "小計": "", "幣別": "TWD", "訂單總額": "", "付款狀態": "",
                "訂單狀態": receipt_status or "RETURN_STATUS_UNKNOWN", "買家/顧客": "", "備註": "",
                "去重Key": make_seen_key("Coupang", order_id, vendor_item_id, sku, qty, "", index),
                "訂單時間來源": "coupang-ordered-at" if order_text else "missing",
                "出貨時間": normalize(first_value(item,["shippedAt","releaseAt"]) or first_value(record,["shippedAt","departureAt"])) if shipped else "",
                "狀態更新時間": normalize(first_value(record,["modifiedAt","createdAt"])),
                "出貨標記": release, "曾確認出貨": shipped, "退貨狀態": receipt_status,
                "取消事件ID": receipt, "取消數量": normalize(cancel_qty),
                "取消已確認": receipt_status == "RETURNS_COMPLETED" and release in ("N", "S"),
                "確定未出貨": release in ("N", "S"),
            })
    return rows, complete, errors


def coupang_day_query_range(start_dt, end_dt):
    """Coupang「按天分頁」API 使用 yyyy-MM-dd+08:00，不帶 T、時間、秒數。

    注意：只要不送 searchType=timeFrame，就是按天分頁模式，最多可查 31 天。
    這裡一次查「前三天完整 + 今天」的日期範圍，再用程式把超過執行當下的資料濾掉。
    """
    return start_dt.strftime("%Y-%m-%d+08:00"), end_dt.strftime("%Y-%m-%d+08:00")

def fetch_coupang_rows(root_cfg, start_dt, end_dt):
    """Coupang 訂單查詢：使用官方「查詢訂單陣列（按天分頁）」。

    修正重點：
    - 不送 searchType=timeFrame，避免變成「分鐘模式」而要求 T00:00+08:00。
    - createdAtFrom / createdAtTo 固定用 yyyy-MM-dd+08:00。
    - 每個 status 分頁查詢 nextToken，最後合併成同一張 Excel。
    - 查到的資料再用 paidAt / orderedAt 過濾到「前三天完整 + 今天執行當下」。
    """
    cfg = root_cfg.get("coupang", {})
    summary = {"平台": "Coupang", "狀態": "未執行", "讀到訂單": 0, "輸出明細": 0, "訊息": ""}
    if not cfg.get("enabled", True):
        summary.update({"狀態": "SKIPPED", "訊息": "config coupang.enabled=false"})
        return [], summary
    missing = [k for k in ("vendor_id", "access_key", "secret_key") if not normalize(cfg.get(k))]
    if missing:
        summary.update({"狀態": "ERROR", "訊息": "Coupang config 尚未填：" + ", ".join(missing)})
        return [], summary

    vendor_id = cfg["vendor_id"]
    path = f"/v2/providers/openapi/apis/api/v5/vendors/{vendor_id}/ordersheets"
    statuses = cfg.get("sale_order_statuses") or ["ACCEPT", "INSTRUCT", "DEPARTURE", "DELIVERING", "FINAL_DELIVERY", "NONE_TRACKING"]
    max_pages = int(cfg.get("sale_order_max_pages", 30))
    max_per_page = min(int(cfg.get("sale_order_max_per_page", 50)), 50)

    start_text, end_text = coupang_day_query_range(start_dt, end_dt)
    all_orders = []
    seen_order = set()
    errors = []
    order_complete = True

    for status in statuses:
        next_token = ""
        for page in range(1, max_pages + 1):
            params = {
                "createdAtFrom": start_text,
                "createdAtTo": end_text,
                "status": status,
                "isCod": "",
                "maxPerPage": max_per_page,
            }
            if next_token:
                params["nextToken"] = next_token
            try:
                payload = coupang_request(cfg, "GET", path, params)
                orders, next_token = coupang_orders_from_payload(payload)
            except Exception as e:
                errors.append(f"{status}: {str(e)[:420]}")
                order_complete = False
                break
            if not orders:
                print(f"Coupang 訂單讀取：狀態 {status} 第 {page} 頁，0 筆")
                break
            added = 0
            for order in orders:
                oid = normalize(first_value(order, ["shipmentBoxId", "orderId", "id"]))
                marker = oid or json.dumps(order, ensure_ascii=False, sort_keys=True)[:300]
                if marker in seen_order:
                    continue
                seen_order.add(marker)
                all_orders.append(order)
                added += 1
            print(f"Coupang 訂單讀取：狀態 {status} 第 {page} 頁，取得 {len(orders)} 筆，新增 {added} 筆")
            if not next_token:
                break
            if page == max_pages:
                order_complete = False
                errors.append(f"{status}: 訂單資料超過設定的最大頁數，未完整讀取")
            time.sleep(0.2)

    rows = []
    filtered_orders = []
    for order in all_orders:
        # paidAt 是付款完成時間，不是客人下單時間；今天頁面只能用 orderedAt 判定。
        created_raw = first_value(order, ["orderedAt", "createdAt", "order_date"])
        created_dt = parse_datetime(created_raw)
        if created_dt is not None and not (start_dt <= created_dt <= end_dt):
            continue
        filtered_orders.append(order)

    for order in filtered_orders:
        order_id = first_value(order, ["orderId", "id"])
        shipment_box_id = first_value(order, ["shipmentBoxId"])
        order_no = normalize(order_id or shipment_box_id)
        created_raw = first_value(order, ["orderedAt", "createdAt", "order_date"])
        created_dt = parse_datetime(created_raw)
        created_text = created_dt.strftime("%Y-%m-%d %H:%M:%S") if created_dt else normalize(created_raw)
        status = first_value(order, ["status", "order_status"])
        buyer = normalize(deep_get(order, "orderer", "name") or deep_get(order, "receiver", "name"))
        items = order.get("orderItems") if isinstance(order.get("orderItems"), list) else extract_line_items(order)
        order_total_sum = 0.0
        line_temp = []
        for idx, item in enumerate(items or [{}], start=1):
            vendor_item_id = first_value(item, ["vendorItemId", "vendoritemid"])
            sku = first_value(item, ["externalVendorSkuCode", "externalVendorSku", "externalVendorSKU", "sellerProductItemCode", "sellerProductCode", "vendorItemId"])
            product_name = first_value(item, ["sellerProductName", "vendorItemName", "productName", "name"])
            variant_name = first_value(item, ["sellerProductItemName", "vendorItemPackageName", "itemName", "optionName"])
            qty = first_value(item, ["shippingCount", "quantity", "qty"])
            price = money_value(first_value(item, ["salesPrice", "salePrice", "price", "unitPrice"]))
            subtotal = money_value(first_value(item, ["orderPrice", "totalPrice", "subtotal", "amount"]))
            if not normalize(subtotal):
                try:
                    subtotal = str(float(normalize(price)) * float(normalize(qty)))
                except Exception:
                    subtotal = ""
            currency = currency_value(first_value(item, ["salesPrice", "orderPrice", "price"]))
            try:
                if subtotal != "":
                    order_total_sum += float(subtotal)
            except Exception:
                pass
            key = make_seen_key("Coupang", order_id or shipment_box_id, vendor_item_id, sku, qty, price, idx)
            line_temp.append({
                "平台": "Coupang", "訂單時間": created_text, "訂單編號": order_no, "訂單ID": normalize(order_id or shipment_box_id),
                "商品編號/SKU": normalize(sku), "商品名稱": normalize(product_name), "規格名稱": normalize(variant_name),
                "數量": normalize(qty), "單價": normalize(price), "小計": normalize(subtotal), "幣別": normalize(currency),
                "訂單總額": "", "付款狀態": normalize(first_value(order, ["status"])), "訂單狀態": normalize(status),
                "買家/顧客": buyer, "備註": "" if items else "此訂單未讀到商品明細欄位", "去重Key": key,
                "訂單時間來源": "coupang-ordered-at" if created_text else "missing",
                "出貨時間": normalize(first_value(order, ["shippedAt", "departureAt", "shipmentAt"])),
                "完成時間": normalize(first_value(order, ["deliveredAt", "completedAt", "finalDeliveryAt"])),
                "退款時間": normalize(first_value(order, ["refundedAt", "returnedAt", "refundCompletedAt"])),
                "狀態更新時間": normalize(first_value(order, ["modifiedAt", "updatedAt", "statusChangedAt"]))
            })
        total_text = str(int(order_total_sum)) if order_total_sum and order_total_sum.is_integer() else (str(order_total_sum) if order_total_sum else "")
        for r in line_temp:
            r["訂單總額"] = total_text
            rows.append(r)

    return_rows, returns_complete, return_errors = fetch_coupang_return_rows(cfg, start_text, end_text, max_pages, max_per_page)
    rows.extend(return_rows)
    msg = f"{path}；按天分頁 createdAtFrom={start_text}, createdAtTo={end_text}；未送 searchType=timeFrame；退貨={len(return_rows)} 筆"
    if errors:
        msg += "；讀取錯誤：" + " / ".join(errors[:4])
    if return_errors:
        msg += "；退貨讀取錯誤：" + " / ".join(return_errors[:2])
    summary.update({
        "狀態": "OK_WITH_ERRORS" if errors or return_errors else "OK",
        "讀到訂單": len(filtered_orders), "輸出明細": len(rows), "訊息": msg[:1200],
        "complete": order_complete and not errors,
        "returnsComplete": returns_complete and not return_errors,
    })
    return rows, summary

# -----------------------------
# momo
# -----------------------------

def momo_headers(token):
    clean_token = token.replace("Bearer ", "").strip()
    return {
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    }


def fetch_momo_rows(root_cfg, start_dt, end_dt):
    """MOMO 訂單查詢：依官方 OrderQuery 文件固定查詢訂單。

    使用文件確認的端點與欄位：
    - URL: https://api3p.momo.com.tw/VendorApi/OrderQuery
    - queryDateType: OrderDate
    - deliveryType: All
    - storeDeliveryType: All
    - orderStatus: All
    - fromDate / toDate 使用 yyyy-MM-dd（官方支援，最大區間 30 日）

    這裡只查訂單，不掃商品、不改庫存、不改訂單。
    """
    cfg = root_cfg.get("momo", {})
    summary = {"平台": "MOMO", "狀態": "未執行", "讀到訂單": 0, "輸出明細": 0, "訊息": ""}
    if not cfg.get("enabled", True):
        summary.update({"狀態": "SKIPPED", "訊息": "config momo.enabled=false"})
        return [], summary
    token = normalize(cfg.get("momo_token"))
    if not token:
        summary.update({"狀態": "ERROR", "訊息": "momo config 尚未填 momo_token"})
        return [], summary

    endpoint = normalize(cfg.get("order_query_url") or cfg.get("momo_order_query_url") or root_cfg.get("order_query_url") or root_cfg.get("momo_order_query_url"))
    if not endpoint:
        endpoint = "https://api3p.momo.com.tw/VendorApi/OrderQuery"

    timeout = int(cfg.get("sale_request_timeout_seconds", cfg.get("request_timeout_seconds", 20)))
    timeout = min(max(timeout, 5), 30)
    max_per_page = int(cfg.get("sale_order_max_per_page", 100))
    if max_per_page < 100:
        max_per_page = 100
    if max_per_page > 10000:
        max_per_page = 10000
    max_pages = int(cfg.get("sale_order_max_pages", 30))
    max_pages = min(max(max_pages, 1), 30)

    body_base = {
        "queryDateType": normalize(cfg.get("sale_query_date_type")) or "OrderDate",
        "fromDate": start_dt.strftime("%Y-%m-%d"),
        "toDate": end_dt.strftime("%Y-%m-%d"),
        "deliveryType": normalize(cfg.get("sale_delivery_type")) or "All",
        "storeDeliveryType": normalize(cfg.get("sale_store_delivery_type")) or "All",
        "orderStatus": normalize(cfg.get("sale_order_status")) or "All",
    }

    all_orders = []
    last_error = ""
    total_orders = None
    try:
        for page in range(1, max_pages + 1):
            body = dict(body_base)
            body["pageIndex"] = page
            body["maxPerPage"] = max_per_page
            print(f"MOMO 訂單讀取：OrderQuery 第 {page} 頁，{body_base['fromDate']} ~ {body_base['toDate']}")
            res = requests.post(endpoint, headers=momo_headers(token), json=body, timeout=timeout)
            try:
                data = res.json()
            except Exception:
                raise RuntimeError(f"HTTP {res.status_code} 非 JSON：{(res.text or '')[:500]}")
            if res.status_code >= 400:
                raise RuntimeError(f"HTTP {res.status_code}: {str(data)[:500]}")
            if isinstance(data, dict) and normalize(data.get("errorMessage")):
                raise RuntimeError(normalize(data.get("errorMessage"))[:500])

            if isinstance(data, dict) and data.get("totalOrders") not in (None, ""):
                try:
                    total_orders = int(data.get("totalOrders"))
                except Exception:
                    total_orders = data.get("totalOrders")

            orders = extract_orders(data)
            if not orders:
                break
            all_orders.extend(orders)
            print(f"MOMO 訂單讀取：第 {page} 頁取得 {len(orders)} 筆訂單")
            if len(orders) < max_per_page:
                break
            time.sleep(0.15)
    except Exception as e:
        last_error = str(e)[:1000]
        summary.update({
            "狀態": "ERROR",
            "訊息": f"MOMO OrderQuery 失敗：{last_error}；送出欄位={json.dumps(body_base, ensure_ascii=False)}"
        })
        return [], summary

    rows = []
    for order in all_orders:
        order_id = first_value(order, ["orderNo", "orderCode", "orderId", "id", "ordNo", "orderNumber"])
        # MOMO OrderQuery 的主要商品明細在 listItem。
        items = extract_line_items(order)
        if not items and any(k in order for k in ("goodsNo", "goodsCode", "goodsdtCode", "entpGoodsNo", "goodsName")):
            items = [order]
        for idx, item in enumerate(items or [{}], start=1):
            # 訂單成立時間必須優先使用 orderDate。舊版把 lastProcDate 放在前面，
            # 會讓「以前的訂單今天被更新狀態」誤顯示成今天的新訂單。
            raw_dt = first_value(item, ["orderDate", "createdAt", "orderTime"]) or first_value(order, ["orderDate", "orderTime", "createdAt", "date"])
            status_updated_raw = first_value(item, ["lastProcDate", "modifyDate", "updateDate", "planShipDate", "shipDate"]) or first_value(order, ["lastProcDate", "updatedAt", "modifyDate"])
            dt = parse_datetime(raw_dt)
            # 有真正訂單成立時間才依查詢區間過濾；沒有時保留資料，但不再拿狀態更新時間冒充成交日。
            if dt is not None and not (start_dt <= dt <= end_dt):
                continue
            created_text = dt.strftime("%Y-%m-%d %H:%M:%S") if dt else normalize(raw_dt)

            goods_no = first_value(item, ["goodsNo", "goodsCode", "productCode"])
            goodsdt = first_value(item, ["goodsdtCode"])
            entp = first_value(item, ["entpGoodsNo", "sku"])
            sku = entp or (f"{goods_no}-{goodsdt}" if goods_no and goodsdt else goods_no or goodsdt)
            name = first_value(item, ["goodsName", "productName", "name"])
            variant_parts = [normalize(first_value(item, ["goodsInfo1", "goodsdtInfo", "optionName", "specName"])), normalize(first_value(item, ["goodsInfo2"]))]
            variant = " / ".join([x for x in variant_parts if x])
            qty = first_value(item, ["quantity", "qty", "orderQty", "salesQty", "goodsQty", "orderQuantity"])
            subtotal = money_value(first_value(item, ["orderAmount", "totalPrice", "subtotal", "amount", "goodsAmount", "goodsAmt", "orderAmt", "saleAmount"]))
            price = money_value(first_value(item, ["price", "salePrice", "unitPrice", "sellPrice", "goodsPrice", "orderPrice"]))
            try:
                if not normalize(subtotal) and normalize(price) and normalize(qty):
                    subtotal = str(float(normalize(price)) * float(normalize(qty)))
                if not normalize(price) and normalize(qty) and float(normalize(qty)) != 0 and normalize(subtotal):
                    price_val = float(normalize(subtotal)) / float(normalize(qty))
                    price = str(int(price_val)) if price_val.is_integer() else str(price_val)
            except Exception:
                pass

            order_status = first_value(item, ["itemStatus", "shipStatus", "orderStatus", "status", "procStatus"]) or first_value(order, ["orderStatus", "status", "procStatus"])
            payment_status = first_value(item, ["paymentStatus", "payStatus", "paymentYn", "payYn"]) or first_value(order, ["paymentStatus", "payStatus", "paymentYn", "payYn"])
            buyer = first_value(item, ["customerName", "receiverName"]) or first_value(order, ["customerName", "buyerName", "memberName"])
            memo = first_value(item, ["customerDeliveryMessage", "storeReturnMessage", "returnReason", "cancelReason"]) or first_value(order, ["cancelReason", "returnReason"])
            line_id = first_value(item, ["orderSeq", "orderDtlNo", "lineId", "goodsdtCode", "goodsNo"])
            key = make_seen_key("MOMO", order_id, line_id, sku, qty, price, idx)
            rows.append({
                "平台": "MOMO", "訂單時間": created_text, "訂單編號": normalize(order_id), "訂單ID": normalize(order_id),
                "商品編號/SKU": normalize(sku), "商品名稱": normalize(name), "規格名稱": normalize(variant),
                "數量": normalize(qty), "單價": normalize(price), "小計": normalize(subtotal), "幣別": "TWD",
                "訂單總額": "", "付款狀態": normalize(payment_status), "訂單狀態": normalize(order_status), "買家/顧客": normalize(buyer),
                "備註": normalize(memo), "去重Key": key,
                "訂單時間來源": "momo-api-order-date" if created_text else "momo-order-number-inferred",
                "配送狀態": normalize(first_value(item,["shipStatus"]) or order.get("shipStatus")),
                "取消已確認": normalize(order_status) in ("客戶取消", "買家取消", "賣家取消", "系統確認訂單已取消", "已取消", "取消完成"),
                "確定未出貨": normalize(order_status) in ("客戶取消", "買家取消", "賣家取消", "系統確認訂單已取消", "已取消", "取消完成") and not normalize(first_value(item,["shipDate","shippingDate","outboundDate"]) or first_value(order,["shipDate","shippingDate"])),
                "出貨時間": normalize(first_value(item, ["shipDate", "shippingDate", "outboundDate"]) or first_value(order, ["shipDate", "shippingDate"])),
                "完成時間": normalize(first_value(item, ["deliveryCompleteDate", "finishDate", "completeDate"]) or first_value(order, ["deliveryCompleteDate", "finishDate", "completeDate"])),
                "退款時間": normalize(first_value(item, ["refundDate", "returnCompleteDate"]) or first_value(order, ["refundDate", "returnCompleteDate"])),
                "狀態更新時間": normalize(status_updated_raw)
            })

    # 訂單總額：同一訂單加總小計
    totals = defaultdict(float)
    for r in rows:
        try:
            if normalize(r.get("小計")):
                totals[r["訂單編號"]] += float(normalize(r.get("小計")))
        except Exception:
            pass
    for r in rows:
        total = totals.get(r["訂單編號"])
        if total:
            r["訂單總額"] = str(int(total)) if float(total).is_integer() else str(total)

    msg = f"{endpoint}；OrderQuery 固定欄位；totalOrders={total_orders if total_orders is not None else ''}；查詢={body_base['fromDate']}~{body_base['toDate']}"
    summary.update({"狀態": "OK", "讀到訂單": len(all_orders), "輸出明細": len(rows), "訊息": msg[:1200]})
    return rows, summary

# -----------------------------
# Excel output
# -----------------------------

OUTPUT_HEADERS = [
    "平台", "訂單時間", "商品編號/SKU", "數量", "商品名稱", "規格名稱",
    "單價", "單價x0.87", "小計", "訂單編號", "訂單ID", "付款狀態", "訂單狀態", "買家/顧客", "備註"
]

PLATFORM_ORDER = {"EasyStore": 1, "MOMO": 2, "Coupang": 3}
DATE_FILLS = [
    "FCE4D6",  # light peach / pink
    "DDEBF7",  # light blue
    "E2F0D9",  # light green
    "FFF2CC",  # light yellow
    "EADCF8",  # light purple
    "D9EAD3",  # soft green
]

# 只要訂單已取消、作廢、退款/退貨、restocked，或數量/小計明顯為 0，
# 就視為沒有實際成交，不寫入任何成交表與庫存清點表。
CANCELLED_ORDER_KEYWORDS = (
    "取消", "客戶取消", "買家取消", "賣家取消", "已取消", "取消完成",
    "作廢", "已作廢", "無效", "未成立", "交易失敗", "付款失敗",
    "退款", "已退款", "退貨", "已退貨", "退訂",
    "cancel", "canceled", "cancelled", "cancellation", "void", "voided",
    "refund", "refunded", "return", "returned", "restocked", "failed", "failure", "expired",
)


def _to_float(value):
    text = normalize(value).replace(",", "")
    if not text:
        return None
    try:
        return float(text)
    except Exception:
        return None


def _number_or_text(value):
    num = _to_float(value)
    if num is None:
        return normalize(value)
    if float(num).is_integer():
        return int(num)
    return num


def _row_datetime(row):
    dt = parse_datetime(row.get("訂單時間"))
    if dt is None:
        return datetime.min.replace(tzinfo=TAIWAN_TZ)
    return dt


def _row_date_text(row):
    dt = parse_datetime(row.get("訂單時間"))
    if dt is None:
        text = normalize(row.get("訂單時間"))
        return text[:10] if len(text) >= 10 else ""
    return dt.strftime("%Y-%m-%d")


def _is_momo_freight(row):
    """排除 MOMO 運費/配送費明細，只保留真正商品。"""
    if normalize(row.get("平台")).upper() != "MOMO":
        return False
    fields = [row.get("商品編號/SKU"), row.get("商品名稱"), row.get("規格名稱"), row.get("備註")]
    text = " ".join(normalize(x).lower() for x in fields)
    freight_keywords = [
        "運費", "物流費", "配送費", "宅配費", "超取費", "shipping", "freight", "delivery fee"
    ]
    return any(k in text for k in freight_keywords)


def _is_zero_transaction(row):
    """數量與小計都是 0 時，視為沒有實際成交。"""
    qty = _to_float(row.get("數量"))
    subtotal = _to_float(row.get("小計"))
    if qty is not None and qty <= 0:
        if subtotal is None or subtotal <= 0:
            return True
    return False


def _is_cancelled_order(row):
    """排除取消/作廢/退款/退貨/restocked 等沒有實際成交的訂單明細。"""
    status_fields = [
        row.get("付款狀態"), row.get("訂單狀態"), row.get("備註")
    ]
    status_text = " ".join(normalize(x).lower() for x in status_fields if normalize(x))
    if any(keyword in status_text for keyword in CANCELLED_ORDER_KEYWORDS):
        return True
    return _is_zero_transaction(row)


def prepare_output_rows(rows):
    filtered = [r for r in rows if not _is_momo_freight(r) and not _is_cancelled_order(r)]
    filtered.sort(key=lambda r: (
        _row_date_text(r),
        PLATFORM_ORDER.get(normalize(r.get("平台")), 99),
        _row_datetime(r),
        normalize(r.get("訂單編號")),
        normalize(r.get("商品編號/SKU")),
    ))
    return filtered


def _date_range_texts(start_dt=None, end_dt=None):
    """回傳查詢區間內每一天的 YYYY-MM-DD；沒有區間時回傳空清單。"""
    if start_dt is None or end_dt is None:
        return []
    try:
        start_date = start_dt.astimezone(TAIWAN_TZ).date() if isinstance(start_dt, datetime) else start_dt
        end_date = end_dt.astimezone(TAIWAN_TZ).date() if isinstance(end_dt, datetime) else end_dt
    except Exception:
        return []

    dates = []
    current = start_date
    while current <= end_date:
        dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return dates


def build_inventory_groups(rows, start_dt=None, end_dt=None):
    """建立庫存清點清單：依日期分組，同一天相同商品只顯示一次，並加總銷售數量。"""
    grouped = defaultdict(dict)

    # prepare_output_rows 已經會排除 MOMO 運費、取消/退款/未成交訂單，並依日期與平台排序。
    # 庫存清點表只在「同一天」內合併完全相同商品；不同日期賣到同商品仍會分日期顯示。
    for row in prepare_output_rows(rows):
        sku = normalize(row.get("商品編號/SKU"))
        variant = normalize(row.get("規格名稱"))
        name = normalize(row.get("商品名稱"))
        if not (sku or variant or name):
            continue

        date_key = _row_date_text(row) or "未取得日期"
        item_key = (sku, variant, name)
        qty = _number_or_text(row.get("數量", ""))

        if item_key not in grouped[date_key]:
            grouped[date_key][item_key] = [
                sku,
                "",  # 清點數量保留空白，方便列印後手寫盤點。
                qty,
                variant,
                name,
            ]
            continue

        # 同一天同商品重複出現時，只留一列，銷售數量加總。
        current_qty = grouped[date_key][item_key][2]
        current_num = _to_float(current_qty)
        qty_num = _to_float(qty)
        if current_num is not None and qty_num is not None:
            total_qty = current_num + qty_num
            grouped[date_key][item_key][2] = int(total_qty) if float(total_qty).is_integer() else total_qty
        elif not normalize(current_qty):
            grouped[date_key][item_key][2] = qty
        elif normalize(qty) and normalize(qty) != normalize(current_qty):
            grouped[date_key][item_key][2] = f"{current_qty} + {qty}"

    ordered_dates = _date_range_texts(start_dt, end_dt)
    for date_key in sorted(grouped.keys()):
        if date_key not in ordered_dates:
            ordered_dates.append(date_key)

    if not ordered_dates:
        ordered_dates = sorted(grouped.keys())

    return [(date_key, list(grouped.get(date_key, {}).values())) for date_key in ordered_dates]


def write_sheet(wb, title, rows):
    ws = wb.create_sheet(title)
    rows = prepare_output_rows(rows)

    ws.append(OUTPUT_HEADERS)

    date_to_fill = {}
    for row in rows:
        date_key = _row_date_text(row)
        if date_key not in date_to_fill:
            date_to_fill[date_key] = DATE_FILLS[len(date_to_fill) % len(DATE_FILLS)]

        ws.append([
            row.get("平台", ""),
            row.get("訂單時間", ""),
            row.get("商品編號/SKU", ""),
            _number_or_text(row.get("數量", "")),
            row.get("商品名稱", ""),
            row.get("規格名稱", ""),
            _number_or_text(row.get("單價", "")),
            None,  # 單價x0.87，下面補公式
            _number_or_text(row.get("小計", "")),
            row.get("訂單編號", ""),
            row.get("訂單ID", ""),
            row.get("付款狀態", ""),
            row.get("訂單狀態", ""),
            row.get("買家/顧客", ""),
            row.get("備註", ""),
        ])

        excel_row = ws.max_row
        fill = PatternFill("solid", fgColor=date_to_fill.get(date_key, "FFFFFF"))
        for cell in ws[excel_row]:
            cell.fill = fill
            cell.alignment = Alignment(vertical="center", wrap_text=True)
        ws.cell(row=excel_row, column=8).value = f'=IFERROR(G{excel_row}*0.87,"")'

    header_fill = PatternFill("solid", fgColor="BDD7EE")
    for cell in ws[1]:
        cell.font = Font(bold=True)
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")

    widths = {
        "A": 12, "B": 20, "C": 22, "D": 8, "E": 42, "F": 28, "G": 12, "H": 14,
        "I": 12, "J": 20, "K": 20, "L": 14, "M": 16, "N": 18, "O": 36,
    }
    for col, width in widths.items():
        ws.column_dimensions[col].width = width

    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, min_col=4, max_col=9):
        for cell in row:
            if isinstance(cell.value, (int, float)) or (isinstance(cell.value, str) and cell.value.startswith("=IFERROR")):
                cell.number_format = '#,##0.##'

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    return ws


def write_inventory_sheet(wb, rows, start_dt=None, end_dt=None):
    """輸出最後一張「庫存清點」：依日期分段列出，同一天相同商品只顯示一次。"""
    ws = wb.create_sheet("庫存清點")

    title_fill = PatternFill("solid", fgColor="A9D18E")
    date_fill = PatternFill("solid", fgColor="C6E0B4")
    header_fill = PatternFill("solid", fgColor="E2F0D9")
    no_data_fill = PatternFill("solid", fgColor="F2F2F2")
    thin_side = Side(style="thin", color="D9D9D9")
    border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

    headers = ["商品編號/SKU", "清點數量", "銷售數量", "規格名稱", "商品名稱"]
    ws.append(["庫存清點表（依日期分開，同日同商品合併）", "", "", "", ""])
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=5)
    title_cell = ws.cell(row=1, column=1)
    title_cell.font = Font(bold=True, size=14)
    title_cell.fill = title_fill
    title_cell.alignment = Alignment(horizontal="center", vertical="center")
    for cell in ws[1]:
        cell.border = border
    ws.row_dimensions[1].height = 24

    inventory_groups = build_inventory_groups(rows, start_dt=start_dt, end_dt=end_dt)
    if not inventory_groups:
        inventory_groups = [("本次查詢區間", [])]

    for day_index, (date_key, items) in enumerate(inventory_groups, start=1):
        if ws.max_row > 1:
            ws.append(["", "", "", "", ""])

        date_row = ws.max_row + 1
        ws.append([f"{date_key}　第 {day_index} 天", "", "", "", ""])
        ws.merge_cells(start_row=date_row, start_column=1, end_row=date_row, end_column=5)
        date_cell = ws.cell(row=date_row, column=1)
        date_cell.font = Font(bold=True)
        date_cell.fill = date_fill
        date_cell.alignment = Alignment(horizontal="left", vertical="center")
        for cell in ws[date_row]:
            cell.border = border

        header_row = ws.max_row + 1
        ws.append(headers)
        for cell in ws[header_row]:
            cell.font = Font(bold=True)
            cell.fill = header_fill
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = border

        if items:
            for item in items:
                ws.append(item)
                current_row = ws.max_row
                for cell in ws[current_row]:
                    cell.alignment = Alignment(vertical="center", wrap_text=True)
                    cell.border = border
                # 清點數量欄保留空白，方便列印後手寫盤點數。
                ws.cell(row=current_row, column=2).alignment = Alignment(horizontal="center", vertical="center")
                ws.cell(row=current_row, column=3).alignment = Alignment(horizontal="center", vertical="center")
                ws.cell(row=current_row, column=3).number_format = '#,##0.##'
        else:
            empty_row = ws.max_row + 1
            ws.append(["本日沒有新的成交商品", "", "", "", ""])
            ws.merge_cells(start_row=empty_row, start_column=1, end_row=empty_row, end_column=5)
            empty_cell = ws.cell(row=empty_row, column=1)
            empty_cell.fill = no_data_fill
            empty_cell.alignment = Alignment(horizontal="center", vertical="center")
            for cell in ws[empty_row]:
                cell.border = border

    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 12
    ws.column_dimensions["C"].width = 12
    ws.column_dimensions["D"].width = 28
    ws.column_dimensions["E"].width = 48
    ws.freeze_panes = "A2"

    # A4 列印設定：橫向、寬度塞進一頁，方便直接列印盤點。
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = "9"  # A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = 0.25
    ws.page_margins.right = 0.25
    ws.page_margins.top = 0.35
    ws.page_margins.bottom = 0.35
    ws.print_title_rows = "1:1"
    return ws


def write_excel(new_rows, all_rows_count, summaries, start_dt, end_dt, out_path):
    output_rows = prepare_output_rows(new_rows)
    freight_removed = sum(1 for r in new_rows if _is_momo_freight(r))
    cancelled_removed = sum(1 for r in new_rows if not _is_momo_freight(r) and _is_cancelled_order(r))

    wb = Workbook()
    default = wb.active
    wb.remove(default)
    write_sheet(wb, "全部成交", output_rows)
    for platform in ("EasyStore", "MOMO", "Coupang"):
        write_sheet(wb, platform, [r for r in output_rows if r.get("平台") == platform])
    ws = wb.create_sheet("執行摘要")
    ws.append(["項目", "內容"])
    ws.append(["查詢範圍", f"{start_dt.strftime('%Y-%m-%d %H:%M:%S')} ～ {end_dt.strftime('%Y-%m-%d %H:%M:%S')}（台灣時間）"])
    ws.append(["執行時間", datetime.now(TAIWAN_TZ).strftime("%Y-%m-%d %H:%M:%S")])
    ws.append(["是否修改資料", "否，只讀取成交/訂單資料"])
    ws.append(["本次 API 讀到商品明細總列數", all_rows_count])
    ws.append(["MOMO 運費/配送費已排除列數", freight_removed])
    ws.append(["取消/未成交訂單已排除列數", cancelled_removed])
    ws.append(["本次輸出成交商品列數", len(output_rows)])
    ws.append(["庫存清點表", "最後一張工作表；依日期分成第 1～第 4 天列出成交商品，同一天相同商品只顯示一次，銷售數量會加總，清點數量欄保留空白"])
    ws.append(["輸出排序", "日期分組 → EasyStore → MOMO → Coupang → 訂單時間"])
    ws.append(["顏色規則", "同一天同底色，不同日期用不同淺色區分"])
    ws.append([])
    platform_summary_row = ws.max_row + 1
    ws.append(["平台", "狀態", "讀到訂單", "商品明細", "訊息"])
    for s in summaries:
        ws.append([s.get("平台"), s.get("狀態"), s.get("讀到訂單"), s.get("輸出明細"), s.get("訊息")])
    header_fill = PatternFill("solid", fgColor="D9EAF7")
    for row_idx in (1, platform_summary_row):
        for cell in ws[row_idx]:
            cell.font = Font(bold=True)
            cell.fill = header_fill
    ws.column_dimensions["A"].width = 28
    ws.column_dimensions["B"].width = 100

    # 必須放在最後，方便打開 Excel 時直接看到最後一頁就是盤點用清單。
    write_inventory_sheet(wb, new_rows, start_dt=start_dt, end_dt=end_dt)
    wb.save(out_path)

def main():
    parser = argparse.ArgumentParser(description="三平台最近成交商品匯出，只讀取不修改")
    parser.add_argument("--platform", choices=["all", "easystore", "momo", "coupang"], default="all")
    parser.add_argument("--days-back", type=int, default=3, help="往前抓幾個完整日期；預設 3，代表前三天完整日期 + 今天執行當下")
    args = parser.parse_args()

    now_dt = datetime.now(TAIWAN_TZ)
    start_date = now_dt.date() - timedelta(days=max(args.days_back, 0))
    start_dt = datetime.combine(start_date, dtime.min, tzinfo=TAIWAN_TZ)
    end_dt = now_dt

    cfg = load_config()
    SCRIPT_DIR.mkdir(parents=True, exist_ok=True)

    print("=" * 70)
    print("三平台最近成交商品匯出（只讀取，不修改庫存/商品/訂單）")
    print(f"查詢範圍：{start_dt.strftime('%Y-%m-%d %H:%M:%S')} ～ {end_dt.strftime('%Y-%m-%d %H:%M:%S')}（台灣時間）")
    print("說明：包含前 3 個完整日期 + 今天執行當下。")
    print("=" * 70)

    rows = []
    summaries = []
    fetchers = []
    if args.platform in ("all", "easystore"):
        fetchers.append(fetch_easystore_rows)
    if args.platform in ("all", "momo"):
        fetchers.append(fetch_momo_rows)
    if args.platform in ("all", "coupang"):
        fetchers.append(fetch_coupang_rows)

    for fn in fetchers:
        try:
            platform_rows, summary = fn(cfg, start_dt, end_dt)
        except Exception as e:
            platform_name = fn.__name__.replace("fetch_", "").replace("_rows", "")
            platform_name = {"easystore": "EasyStore", "momo": "MOMO", "coupang": "Coupang"}.get(platform_name, platform_name)
            platform_rows, summary = [], {"平台": platform_name, "狀態": "ERROR", "讀到訂單": 0, "輸出明細": 0, "訊息": str(e)[:1000]}
        rows.extend(platform_rows)
        summaries.append(summary)

    # 這版是「完整區間匯出」：不再用 sale_seen_orders_all.json 隱藏已輸出過的訂單。
    # sale_seen_orders_all.json 只保留做歷史參考，避免你以後需要追蹤哪些曾經被看過。
    seen = load_seen()
    seen_set = set(seen.get("seen_keys", []))
    before_seen_count = len(seen_set)
    output_rows = prepare_output_rows(rows)
    for row in output_rows:
        key = row.get("去重Key") or make_seen_key(row.get("平台"), row.get("訂單ID") or row.get("訂單編號"), "", row.get("商品編號/SKU"), row.get("數量"), row.get("單價"), 0)
        seen_set.add(key)
    newly_seen_count = len(seen_set) - before_seen_count

    out_name = f"sales_recent_orders_{start_dt.strftime('%Y%m%d')}_{end_dt.strftime('%Y%m%d_%H%M%S')}.xlsx"
    out_path = SCRIPT_DIR / out_name
    write_excel(rows, len(rows), summaries, start_dt, end_dt, out_path)

    seen["seen_keys"] = sorted(seen_set)
    seen.setdefault("history", []).append({
        "run_time": datetime.now(TAIWAN_TZ).strftime("%Y-%m-%d %H:%M:%S"),
        "date_range": f"{start_dt.strftime('%Y-%m-%d %H:%M:%S')} ~ {end_dt.strftime('%Y-%m-%d %H:%M:%S')}",
        "output_file": out_name,
        "output_rows": len(output_rows),
        "newly_seen_keys": newly_seen_count,
    })
    save_seen(seen)

    print("完成。")
    print(f"API 讀到商品明細：{len(rows)} 列")
    print(f"排除取消/未成交與 MOMO 運費後輸出：{len(output_rows)} 列")
    print(f"其中新加入歷史紀錄：{newly_seen_count} 筆 key")
    print(f"結果檔：{out_path}")
    if len(output_rows) == 0:
        print("這個時間範圍內沒有查到成交商品，或平台 API 沒有回傳資料。")
    print("提醒：此功能只讀取訂單資料，不會修改任何平台資料。")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print("\n發生錯誤：")
        print(str(e))
        sys.exit(1)
