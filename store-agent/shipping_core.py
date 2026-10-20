"""Shipping workbench: read platform orders and retain official courier documents.

This module never changes inventory/prices. No shipment mutation runs during sync.
Coupang contracts: developers.coupang.com/zh-TW/api/shipments/
  for-taiwan-onlyarrange-shipment-for-directly-integrated-courier
  for-taiwan-onlydownload-invoice-for-direct-integrated-courier
"""
from __future__ import annotations

import hashlib
import base64
import importlib.util
import json
import sqlite3
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from shipping_images import match_product_image
from shipping_payments import easystore_payment, coupang_payment, momo_payment

TZ = timezone(timedelta(hours=8))
CARRIERS = {"TWL_HCT": "新竹物流", "TWL_KERRY": "嘉里大榮",
            "TWL_FM": "全家", "TWL_711": "7-11"}
spec = importlib.util.spec_from_file_location("shipping_order_source",
                                            Path(__file__).parent / "lib/order_source.py")
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


class ShippingError(Exception):
    pass


def text(v):
    return "" if v is None else str(v).strip()


def now():
    return datetime.now(TZ).isoformat(timespec="seconds")


def safe_image(v):
    return text(v) if urlparse(text(v)).scheme == "https" else ""


def channel(source_name):
    value = text(source_name).lower()
    if value in ("shopee", "shopee-taiwan"):
        return "蝦皮"
    if value in ("line", "line-shopping", "line-shopping-taiwan"):
        return "LINE"
    if value in ("sf", "web", "online-store", "online_store", "storefront"):
        return "官網"
    return "來源待確認"


def normalize_es(o):
    address = o.get("shipping_address") or o.get("pickup_address") or {}
    cancelled = bool(o.get("is_cancelled") or o.get("cancelled_at"))
    items = []
    for i in o.get("line_items") or []:
        if i.get("is_deleted"):
            continue
        q = int(i.get("quantity") or 0)
        remaining = i.get("fulfillable_quantity")
        items.append({"id": text(i["id"]), "sku": text(i.get("sku")),
                      "name": text(i.get("product_name") or i.get("title")),
                      "variant": text(i.get("variant_name")), "quantity": q,
                      "remaining": int(remaining) if remaining is not None else None,
                      "image": safe_image(i.get("image_url")), "imageSource": "訂單規格圖片",
                      "properties": i.get("properties") or []})
    fs = [f for f in o.get("fulfillments") or [] if not f.get("cancelled_at")]
    status = text(o.get("fulfillment_status"))
    stage = ("cancelled" if cancelled else
             "pending" if status == "unfulfilled" else
             "partial" if status in ("partial", "partially_fulfilled") else
             "shipped" if status == "fulfilled" else "review")
    return {**easystore_payment(o), "key": "EasyStore:" + text(o["id"]), "platform": "EasyStore",
            "channel": channel(o.get("source_name")), "sourceName": text(o.get("source_name")),
            "orderNo": text(o.get("name") or o.get("order_number") or o.get("number")),
            "internalOrderNo": text(o.get("order_number")),
            "externalId": text(o["id"]), "packageId": "", "date": text(o.get("created_at")),
            "stage": stage, "status": status, "platformPrinted": False, "payment": text(o.get("financial_status")),
            "recipient": " ".join(filter(None, [text(address.get("first_name") or address.get("receiver_first_name")),
                                               text(address.get("last_name") or address.get("receiver_last_name"))])),
            "phone": text(address.get("receiver_phone") or address.get("phone")),
            "pickupStore": text(address.get("name")) if not o.get("shipping_address") else "",
            "address": "".join(text(address.get(k))
                for k in ("zip", "province", "city", "address1", "address2")),
            "note": "\n".join(filter(None, [text(o.get("note")), text(o.get("remark"))])),
            "carrier": "、".join(text(f.get("name")) for f in o.get("shipping_fees") or []),
            "tracking": "、".join(text(f.get("tracking_number")) for f in fs
                               if f.get("tracking_number")),
            "items": items, "canCreate": False, "canDownload": False,
            "blockReason": "尚待接通 EasyStore／蝦皮正式貨運單服務；讀取訂單不會申請出貨。"}


def cp_carrier(o):
    value = text(o.get("deliveryCompanyCode") or o.get("deliveryCompanyName"))
    mapping = {"新竹物流": "TWL_HCT", "新竹貨運": "TWL_HCT", "HCT": "TWL_HCT",
               "嘉里大榮": "TWL_KERRY", "嘉里": "TWL_KERRY", "KERRY": "TWL_KERRY",
               "全家": "TWL_FM", "FamilyMart": "TWL_FM",
               "7-11": "TWL_711", "7-ELEVEN": "TWL_711"}
    return value if value in CARRIERS else mapping.get(value, "")


def normalize_cp(o, *, claims_checked=False, has_payment_claim=False, duplicate_order=False):
    items = []
    has_claim = False
    for i in o.get("orderItems") or []:
        cancelled = int(i.get("cancelCount") or 0)
        held = int(i.get("holdCountForCancel") or 0)
        has_claim |= bool(cancelled or held or i.get("canceled"))
        items.append({"id": text(i.get("vendorItemId")), "sku": text(i.get("externalVendorSkuCode")),
                      "name": text(i.get("sellerProductName") or i.get("vendorItemName")),
                      "platformName": text(i.get("vendorItemName")),
                      "variant": text(i.get("sellerProductItemName")),
                      "quantity": max(0, int(i.get("shippingCount") or 0)-cancelled-held),
                      "orderedQuantity": int(i.get("shippingCount") or 0),
                      "cancelledQuantity": cancelled, "heldQuantity": held,
                      "image": "", "imageSource": ""})
    status = text(o.get("status"))
    tracking = text(o.get("invoiceNumber"))
    carrier = cp_carrier(o)
    stage = {"ACCEPT": "pending", "INSTRUCT": "pending", "DEPARTURE": "label",
             "DELIVERING": "shipped", "FINAL_DELIVERY": "shipped",
             "NONE_TRACKING": "shipped"}.get(status, "review")
    if has_claim:
        stage = "review"
    r = o.get("receiver") or {}
    can_create = (status == "INSTRUCT" and not tracking and not has_claim and
                  bool(items) and all(i["quantity"] > 0 for i in items))
    can_download = bool(tracking and carrier and status != "ACCEPT" and not has_claim)
    reason = ""
    if status == "ACCEPT":
        reason = "尚未確認備貨；第一版僅接受酷澎「商品準備中」訂單。"
    elif has_claim:
        reason = "含取消／退款申請數量，請先核對，暫停產生貨運單。"
    elif not carrier and tracking:
        reason = "物流公司代碼尚未辨識，無法安全下載正式貨運單。"
    elif not can_create and not can_download:
        reason = "此狀態尚不能申請或下載貨運單。"
    return {**coupang_payment(o, claims_checked, has_payment_claim, duplicate_order),
            "key": "Coupang:" + text(o["shipmentBoxId"]), "platform": "Coupang",
            "channel": "酷澎", "sourceName": "Coupang", "externalId": text(o["orderId"]),
            "orderNo": text(o["orderId"]), "packageId": text(o["shipmentBoxId"]),
            "date": text(o.get("orderedAt")), "status": status, "stage": stage, "payment": "已付款",
            "recipient": text(r.get("name")), "phone": text(r.get("safeNumber")),
            "address": "".join(text(r.get(k)) for k in ("postCode", "addr1", "addr2")),
            "note": text(o.get("parcelPrintMessage")), "tracking": tracking,
            "carrier": text(o.get("deliveryCompanyName")), "carrierCode": carrier,
            "items": items, "canCreate": can_create, "canDownload": can_download,
            "blockReason": reason}


def normalize_momo(o):
    # Official print API requires all orderSeq values belonging to one courier label,
    # INCLUDING freight rows; freight must never appear as a physical packing item.
    result = []
    groups = {}
    for i in o.get("listItem") or []:
        group = (text(i.get("deliveryNo")), text(i.get("deliveryType")),
                 text(i.get("deliveryCompany")), text(i.get("outplaceSeq")),
                 text(i.get("receiverAddress")), text(i.get("itemStatus")), text(i.get("shipStatus")))
        groups.setdefault(group, []).append(i)
    physical_groups = [g for g in groups.values() if any(i.get("goodsType") != "運費" for i in g)]
    unallocated_freight = [i for g in groups.values()
                          if not any(i.get("goodsType") != "運費" for i in g) for i in g]
    for group_items in groups.values():
        i = group_items[0]
        status = text(i.get("itemStatus"))
        cancelled = status in ("系統確認訂單已取消", "客戶取消", "已取消", "取消完成")
        shipped = status in ("出貨確認", "配送結束")
        printed = text(i.get("shipStatus")) == "供應商已列印宅配單"
        stage = "cancelled" if cancelled else "shipped" if shipped else "label" if printed else "review"
        if not cancelled and not shipped and not printed and status.startswith("出貨通知"):
            stage = "pending"
        seqs = sorted(text(line["orderSeq"]) for line in group_items)
        courier = text(i.get("deliveryCompany"))
        method = "third" if text(i.get("deliveryType")) == "第三方物流" else (
            "seven" if courier.startswith("7-11") else "family" if courier.startswith("全家") else "")
        dely = {"7-11店到店":"22", "7-11倉到店":"21", "全家店到店":"29",
                "全家倉到店":"27", "全家冷凍店到店":"24", "全家冷凍倉到店":"23"}.get(courier, "")
        changed = any(text(line.get("changedAddress")) for line in group_items)
        supported = bool(method and (method == "third" or dely))
        can_create = supported and stage == "pending" and not changed
        can_download = supported and (printed or shipped) and not cancelled and not changed
        physical = [line for line in group_items if line.get("goodsType") != "運費"]
        if not physical:
            continue
        if any(int(line.get("quantity") or 0) <= 0 for line in physical):
            can_create = False
        result.append({**momo_payment(o, group_items, split=len(physical_groups) > 1,
                                     unallocated_freight=unallocated_freight),
            "key": "MOMO:" + text(o["orderNo"]) + ":" + ",".join(seqs),
            "platform": "MOMO", "channel": "MOMO", "sourceName": "MOMO",
            "orderNo": text(o["orderNo"]), "externalId": text(o["orderNo"]),
            "packageId": ",".join(seqs), "date": "", "status": status, "stage": stage,
            "shippingMethod": method, "delyGb": dely, "orderSeqs": seqs, "platformPrinted": printed,
            "payment": "", "recipient": text(i.get("receiverName")),
            "phone": "", "address": text(i.get("receiverAddress")),
            "note": text(i.get("customerDeliveryMessage")),
            "carrier": text(i.get("deliveryCompany")), "tracking": text(i.get("deliveryNo")),
            "items": [{"id": text(line["orderSeq"]), "sku": text(line.get("entpGoodsNo")),
                "name": text(line.get("goodsName")), "variant": " / ".join(filter(None,
                    [text(line.get("goodsInfo1")), text(line.get("goodsInfo2"))])),
                "quantity": int(line.get("quantity") or 0), "image": "", "imageSource": ""}
                for line in physical],
            "canCreate": can_create, "canDownload": can_download,
            "blockReason": "有更換地址資料，請先於 MOMO 核對地址狀態。" if changed else (
                "" if can_create or can_download else "此配送方式或訂單狀態暫不支援產生貨運單。")})
    return result


class Workbench:
    def __init__(self, config_path, data_dir):
        self.config = json.loads(Path(config_path).read_text(encoding="utf-8-sig"))
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.refresh_lock = threading.Lock()
        self.rows = {}
        self.errors = {}
        self.updated = ""
        self.days = 3
        self.images = {}
        self.db_path = self.data_dir / "shipping.sqlite3"
        with self.connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS jobs (
                order_key TEXT PRIMARY KEY, state TEXT NOT NULL, carrier TEXT,
                tracking TEXT, document TEXT, mime TEXT, error TEXT, updated TEXT)""")
            db.execute("""CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY, order_key TEXT, action TEXT, created TEXT)""")
            db.execute("""CREATE TABLE IF NOT EXISTS documents (
                order_key TEXT, kind TEXT, document TEXT, mime TEXT,
                PRIMARY KEY(order_key,kind))""")
            if "binding" not in {r["name"] for r in db.execute("PRAGMA table_info(jobs)")}:
                db.execute("ALTER TABLE jobs ADD COLUMN binding TEXT")
            db.execute("""CREATE TABLE IF NOT EXISTS handling (
                order_key TEXT PRIMARY KEY, action TEXT NOT NULL, binding TEXT NOT NULL,
                source TEXT NOT NULL, updated TEXT NOT NULL, print_count INTEGER NOT NULL DEFAULT 0)""")
            db.execute("""CREATE TABLE IF NOT EXISTS product_images (
                sku TEXT PRIMARY KEY, payload TEXT NOT NULL, updated TEXT NOT NULL)""")

    @staticmethod
    def handling_binding(row):
        payload = {k: row.get(k) for k in ("key", "address", "tracking", "carrier")}
        payload["items"] = [{k: i.get(k) for k in ("id", "sku", "variant", "quantity")}
                            for i in row["items"]]
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()

    def mark_handled(self, key, action, source_name="工作台"):
        if action not in ("acquired", "print_requested", "printed", "shipped", "processed", "reopen"):
            raise ShippingError("不支援的處理狀態。")
        with self.lock:
            row = self.rows.get(key)
            if not row:
                raise ShippingError("找不到這筆訂單，請重新讀取。")
            if action == "acquired":
                self.document(key)
            with self.connect() as db:
                old = db.execute("SELECT * FROM handling WHERE order_key=?", (key,)).fetchone()
                count = (old["print_count"] if old else 0) + (action == "print_requested")
                # A reprint must not downgrade a confirmed shipment/printed record.
                saved_action = old["action"] if (old and action in ("acquired", "print_requested")
                    and old["binding"] == self.handling_binding(row)
                    and old["action"] in ("printed", "shipped")) else action
                saved_source = old["source"] if saved_action != action else source_name
                saved_time = old["updated"] if saved_action != action else now()
                db.execute("INSERT OR REPLACE INTO handling VALUES (?,?,?,?,?,?)",
                           (key, saved_action, self.handling_binding(row), saved_source, saved_time, count))
            self.event(key, "handling-" + action)
        return {"ok": True}

    def refresh_images(self):
        with self.lock:
            skus = {i["sku"] for row in self.rows.values() for i in row["items"]
                    if i["sku"] and not i.get("image")}
        cfg = self.config.get("easystore") or {}
        if not cfg.get("access_token"):
            return
        def lookup(sku):
            with self.connect() as db:
                cached = db.execute("SELECT * FROM product_images WHERE sku=?", (sku,)).fetchone()
            if cached and cached["updated"][:10] == now()[:10]:
                return sku, json.loads(cached["payload"])
            try:
                payload = source.es_request("GET", cfg["store_url"].rstrip("/")+"/api/3.0/products.json",
                    cfg["access_token"], timeout=20, params={"skus": sku, "limit": 100})
                result = match_product_image(payload, sku)
                with self.connect() as db:
                    db.execute("INSERT OR REPLACE INTO product_images VALUES (?,?,?)",
                               (sku, json.dumps(result), now()))
                return sku, result
            except Exception:
                return sku, json.loads(cached["payload"]) if cached else {}
        with ThreadPoolExecutor(max_workers=4) as pool:
            images = dict(pool.map(lookup, sorted(skus)))
        with self.lock:
            self.images = images

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db_path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def job(self, key):
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE order_key=?", (key,)).fetchone()
            return dict(row) if row else {}

    def save_job(self, key, **values):
        old = self.job(key)
        old.update(values)
        with self.connect() as db:
            db.execute("""INSERT OR REPLACE INTO jobs
              (order_key,state,carrier,tracking,document,mime,error,updated,binding)
              VALUES (?,?,?,?,?,?,?,?,?)""",
              (key, old.get("state", "new"), old.get("carrier", ""), old.get("tracking", ""),
               old.get("document", ""), old.get("mime", ""), old.get("error", ""), now(),
               old.get("binding", "")))

    def event(self, key, action):
        with self.connect() as db:
            db.execute("INSERT INTO events(order_key,action,created) VALUES (?,?,?)", (key, action, now()))

    def reserve_creation(self, key, carrier=""):
        # A durable reservation survives crashes, including the gap after platform success.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute("SELECT state FROM jobs WHERE order_key=?", (key,)).fetchone()
            if old and old["state"] in ("sending", "uncertain", "arranged", "downloading", "ready", "download-failed"):
                raise ShippingError("已有出貨申請紀錄，請先核對平台結果；不會重複申請。")
            db.execute("""INSERT OR REPLACE INTO jobs(order_key,state,carrier,error,updated)
                          VALUES (?,'sending',?,'',?)""", (key, carrier, now()))

    def read_es(self, start, end):
        cfg = self.config["easystore"]
        rows = []
        for page in range(1, 51):
            payload = source.es_request("GET", cfg["store_url"].rstrip("/") + "/api/3.0/orders.json",
                cfg["access_token"], timeout=30,
                params={"page": page, "limit": 100, "sort": "id.asc", "created_at_min": start.isoformat(),
                        "created_at_max": end.isoformat()})
            orders = source.extract_orders(payload)
            rows.extend(normalize_es(o) for o in orders)
            if len(orders) < 100 or (payload.get("page_count") and page >= int(payload["page_count"])):
                return rows
        raise ShippingError("EasyStore 超過 50 頁，未完整讀取。")

    def read_momo(self, start, end):
        cfg = self.config["momo"]
        rows = []
        for page in range(1, 31):
            res = requests.post("https://api3p.momo.com.tw/VendorApi/OrderQuery",
                headers=source.momo_headers(cfg["momo_token"]), timeout=30,
                json={"queryDateType": "OrderDate", "fromDate": start.strftime("%Y-%m-%d"),
                      "toDate": end.strftime("%Y-%m-%d"), "deliveryType": "All",
                      "storeDeliveryType": "All", "orderStatus": "All",
                      "pageIndex": page, "maxPerPage": 100})
            res.raise_for_status()
            payload = res.json()
            if payload.get("errorMessage"):
                raise ShippingError("MOMO 訂單查詢失敗，請確認平台授權。")
            orders = source.extract_orders(payload)
            for o in orders:
                rows.extend(normalize_momo(o))
            if len(orders) < 100:
                return rows
        raise ShippingError("MOMO 超過 30 頁，未完整讀取。")

    def read_cp(self, start, end):
        cfg = self.config["coupang"]
        path = f"/v2/providers/openapi/apis/api/v5/vendors/{cfg['vendor_id']}/ordersheets"
        start_date, end_date = source.coupang_day_query_range(start, end)
        rows = {}
        for status in ("ACCEPT", "INSTRUCT", "DEPARTURE", "DELIVERING", "FINAL_DELIVERY", "NONE_TRACKING"):
            token = ""
            for _ in range(30):
                params = {"createdAtFrom": start_date, "createdAtTo": end_date,
                          "status": status, "isCod": "", "maxPerPage": 50}
                if token:
                    params["nextToken"] = token
                payload = source.coupang_request(cfg, "GET", path, params)
                orders, token = source.coupang_orders_from_payload(payload)
                for o in orders:
                    rows[text(o["shipmentBoxId"])] = o
                if not token:
                    break
            else:
                raise ShippingError("酷澎超過 30 頁，未完整讀取。")
        # Returns are a separate official API; order sheets alone can retain the
        # original payment while a refund is pending. Failure must not confirm it.
        try:
            claims, complete, _errors = source.fetch_coupang_return_rows(
                cfg, start.isoformat(), end.isoformat(), 30, 50)
        except Exception:
            claims, complete = [], False
        claimed_orders = {text(c.get("訂單ID")) for c in claims}
        order_ids = [text(o["orderId"]) for o in rows.values()]
        return [normalize_cp(o, claims_checked=complete,
                    has_payment_claim=text(o["orderId"]) in claimed_orders,
                    duplicate_order=order_ids.count(text(o["orderId"])) > 1)
                for o in rows.values()]

    def refresh(self, days=3):
        if not self.refresh_lock.acquire(blocking=False):
            # Multiple tabs share the same read, rather than receiving a partial snapshot.
            if not self.refresh_lock.acquire(timeout=150):
                raise ShippingError("訂單讀取時間較長，請稍後重新讀取。")
            self.refresh_lock.release()
            return self.snapshot()
        try:
            days = max(1, min(3, int(days)))
            end = datetime.now(TZ)
            start = (end-timedelta(days=days-1)).replace(hour=0, minute=0, second=0, microsecond=0)
            with ThreadPoolExecutor(max_workers=3) as pool:
                futures = {pool.submit(fn, start, end): name for name, fn in
                           (("EasyStore", self.read_es), ("MOMO", self.read_momo), ("Coupang", self.read_cp))}
                for future in as_completed(futures):
                    name = futures[future]
                    try:
                        rows = future.result()
                        with self.lock:
                            self.rows = {k: v for k, v in self.rows.items() if v["platform"] != name}
                            self.rows.update({r["key"]: r for r in rows})
                            self.errors.pop(name, None)
                    except Exception as e:
                        # Never emit upstream exception text: it can contain customer data/credentials.
                        with self.lock:
                            self.errors[name] = f"{name} 讀取失敗（{type(e).__name__}）；此平台資料不可用於申請出貨。"
            self.refresh_images()
            with self.lock:
                self.updated = now()
                self.days = days
            return self.snapshot()
        finally:
            self.refresh_lock.release()

    def snapshot(self):
        with self.lock:
            rows = []
            for original in self.rows.values():
                row = dict(original)
                job = self.job(row["key"])
                row["jobState"] = job.get("state", "")
                row["documentReady"] = self.document_matches(row, job)
                row["documentBinding"] = self.document_binding(original)
                with self.connect() as db:
                    row["documentKinds"] = [r["kind"] for r in db.execute(
                        "SELECT kind FROM documents WHERE order_key=?", (row["key"],))]
                row["jobError"] = job.get("error", "")
                row["stale"] = row["platform"] in self.errors
                if row["stale"]:
                    row["canCreate"] = row["canDownload"] = False
                with self.connect() as db:
                    handled = db.execute("SELECT * FROM handling WHERE order_key=?", (row["key"],)).fetchone()
                valid_handled = handled and handled["binding"] == self.handling_binding(row)
                action = handled["action"] if valid_handled else ""
                platform_done = row["stage"] in ("shipped", "cancelled") or row.get("platformPrinted", False)
                row["handled"] = action != "reopen" if action else platform_done
                row["handlingChanged"] = bool(handled and not valid_handled and not platform_done)
                row["handlingAction"] = action or ("shipped" if row["stage"] == "shipped" else
                    "cancelled" if row["stage"] == "cancelled" else "printed" if row.get("platformPrinted") else "")
                row["handlingSource"] = handled["source"] if valid_handled else "平台"
                row["handledAt"] = handled["updated"] if valid_handled else ""
                row["printCount"] = handled["print_count"] if valid_handled else 0
                row["items"] = [dict(i, **self.images.get(i["sku"], {})) if not i.get("image")
                                else dict(i) for i in row["items"]]
                rows.append(row)
            return {"orders": rows, "errors": self.errors, "updated": self.updated, "days": self.days,
                    "connectors": [
                        {"name": "酷澎", "status": "既有貨運單已驗證", "detail": "新出貨待實單驗收；現階段僅支援商品準備中，需核對物流與出貨地址。"},
                        {"name": "MOMO", "status": "既有貨運單已驗證", "detail": "新出貨待實單驗收；部分 PDF 需輸入供應商統編。"},
                        {"name": "蝦皮（經 EasyStore）", "status": "仍需至 EasyStore 確認", "detail": "已確認 EasyStore 可出貨及印蝦皮服務單；本工作台提供對應訂單入口，尚未一鍵接通。"},
                        {"name": "官網直購／LINE", "status": "已接訂單與包貨明細", "detail": "正式出貨及貨運單尚未接通；依原始來源分類，不與蝦皮匯入訂單混淆。"}]}

    def fresh_cp(self, key):
        if not key.startswith("Coupang:") or not key.split(":", 1)[1].isdigit():
            raise ShippingError("這個平台尚未接通貨運單服務。")
        cfg = self.config["coupang"]
        box = key.split(":", 1)[1]
        payload = source.coupang_request(cfg, "GET",
            f"/v2/providers/openapi/apis/api/v5/vendors/{cfg['vendor_id']}/ordersheets/{box}")
        raw = payload.get("data")
        if not isinstance(raw, dict) or text(raw.get("shipmentBoxId")) != box:
            raise ShippingError("未取得此包裹的即時訂單資料，已停止操作。")
        return normalize_cp(raw)

    def preview(self, key, options=None):
        options = options or {}
        with self.lock:
            if key.startswith("MOMO:"):
                row = self.fresh_momo(key)
                if not row["canCreate"] and not row["canDownload"]:
                    raise ShippingError(row["blockReason"])
                row["action"] = "download" if row["canDownload"] else "create"
                row["fingerprint"] = self.fingerprint(row, options)
                return row
            row = self.fresh_cp(key)
            carrier = row.get("carrierCode") or text(options.get("carrier"))
            if carrier not in CARRIERS:
                raise ShippingError("請選擇此訂單使用的物流公司。")
            row["carrierCode"] = carrier
            if not row["canCreate"] and not row["canDownload"]:
                raise ShippingError(row["blockReason"])
            row["action"] = "download" if row["tracking"] else "create"
            if row["action"] == "create":
                if carrier in ("TWL_FM", "TWL_711") and not text(options.get("returnCenterCode")):
                    raise ShippingError("超商出貨需要酷澎退貨地址代碼。")
                if carrier in ("TWL_HCT", "TWL_KERRY") and not text(options.get("outboundShippingPlaceCode")).isdigit():
                    raise ShippingError("宅配出貨需要酷澎出貨地址代碼。")
            # A second fresh read at submission must match reviewed contents and destination.
            row["fingerprint"] = self.fingerprint(row, options)
            return row

    @staticmethod
    def document_binding(row):
        return hashlib.sha256(json.dumps({k: row.get(k) for k in
            ("key", "recipient", "phone", "address", "items", "tracking", "carrier",
             "shippingMethod", "delyGb", "orderSeqs")},
            ensure_ascii=False, sort_keys=True).encode()).hexdigest()

    def document_matches(self, row, job):
        return bool(row and row.get("stage") not in ("cancelled", "review")
                    and row.get("platform") not in self.errors
                    and job.get("state") == "ready" and job.get("document")
                    and job.get("binding") == self.document_binding(row))

    @staticmethod
    def fingerprint(row, options):
        reviewed = {k: row.get(k) for k in
                    ("key", "status", "recipient", "phone", "address", "items", "carrierCode",
                     "tracking", "shippingMethod", "delyGb", "orderSeqs")}
        reviewed["options"] = {k: text(options.get(k)) for k in
                               ("carrier", "returnCenterCode", "outboundShippingPlaceCode")}
        return hashlib.sha256(json.dumps(reviewed, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def _cp_request(self, action, body, binary=False):
        cfg = self.config["coupang"]
        path = f"/v2/providers/openapi/apis/api/v1/vendors/{cfg['vendor_id']}/orders/directIntegration/{action}"
        headers = {"Authorization": source.coupang_auth("POST", path, "", cfg["access_key"], cfg["secret_key"]),
                   "Content-Type": "application/json;charset=UTF-8", "X-MARKET": "TW",
                   "X-Requested-By": cfg["vendor_id"]}
        res = requests.post("https://api-gateway.coupang.com" + path, headers=headers,
                            json=body, timeout=(10, 90), allow_redirects=False)
        if res.status_code != 200:
            raise ShippingError(f"酷澎貨運單服務回覆 HTTP {res.status_code}，未確認成功。")
        return res if binary else res.json()

    def process(self, key, options, fingerprint):
        result = self._process(key, options, fingerprint)
        self.mark_handled(key, "acquired")
        return result

    def _process(self, key, options, fingerprint):
        with self.lock:
            row = self.preview(key, options)
            if not fingerprint or row["fingerprint"] != fingerprint:
                raise ShippingError("訂單、地址或物流選項已變更，請重新核對後再送出。")
            job = self.job(key)
            if job.get("state") in ("sending", "uncertain") and not row["tracking"]:
                if row.get("action") != "download":
                    raise ShippingError("前次申請結果未確認，已阻止重複申請；請先查平台結果。")
            if row["platform"] == "MOMO":
                return self.process_momo(row, job)
            carrier = row["carrierCode"]
            tracking = row["tracking"]
            if not tracking:
                self.reserve_creation(key, carrier)
                self.event(key, "arrange-requested")
                body = {"shipmentBoxId": int(row["packageId"]), "deliveryCompanyCode": carrier}
                if carrier in ("TWL_FM", "TWL_711"):
                    body["returnCenterCode"] = text(options["returnCenterCode"])
                else:
                    body["outboundShippingPlaceCode"] = int(options["outboundShippingPlaceCode"])
                try:
                    # Official endpoint takes a list of shipment instructions.
                    payload = self._cp_request("arrangeShipment", [body])
                    receipt = payload.get(row["packageId"], {})
                    if receipt.get("success") is not True or not receipt.get("invoiceNumber"):
                        raise ShippingError("酷澎未回傳成功及正式運單號，請核對平台結果。")
                    tracking = text(receipt["invoiceNumber"])
                    self.save_job(key, state="arranged", tracking=tracking)
                    self.event(key, "arranged")
                except Exception:
                    self.save_job(key, state="uncertain", error="申請結果未確認，請先查平台；不會自動重送。")
                    raise ShippingError("申請結果未確認，已保留紀錄並停止自動重試。")
            if (self.document_matches(row, job) and job.get("tracking") == tracking and
                    job.get("carrier") == carrier and (self.data_dir / job.get("document", "_")).is_file()):
                return {"ready": True, "key": key, "reused": True}
            self.save_job(key, state="downloading", tracking=tracking, carrier=carrier, error="")
            try:
                res = self._cp_request("downloadInvoices",
                    {"deliveryCompanyCode": carrier,
                     "invoicePrintDtoList": [{"shipmentBoxId": int(row["packageId"]),
                                              "invoiceNumber": tracking}]}, binary=True)
                mime = res.headers.get("Content-Type", "").split(";")[0].lower()
                data = res.content
                if mime == "application/pdf" and data.startswith(b"%PDF-"):
                    ext = ".pdf"
                elif mime == "text/html" and b"<" in data[:1000] and len(data) > 300:
                    ext = ".html"
                else:
                    raise ShippingError("平台沒有回傳有效的 PDF／HTML 貨運單。")
                filename = hashlib.sha256((key + tracking).encode()).hexdigest() + ext
                temp = self.data_dir / (filename + ".tmp")
                temp.write_bytes(data)
                temp.replace(self.data_dir / filename)
                row.update(tracking=tracking, stage="label", canCreate=False, canDownload=True)
                self.rows[key] = row
                self.save_job(key, state="ready", document=filename, mime=mime, error="",
                              binding=self.document_binding(row))
                self.event(key, "document-downloaded")
                return {"ready": True, "key": key, "reused": False}
            except Exception:
                self.save_job(key, state="download-failed", error="單號已保留，文件下載失敗；重試只會取回文件。")
                raise ShippingError("貨運單下載失敗，原單號已保留，重試不會重新申請出貨。")

    def provide_document(self, key, content, binding):
        """Owner supplies an official PDF for a channel without a label API."""
        with self.lock:
            row = self.rows.get(key)
            if not row or row["platform"] != "EasyStore" or row["stage"] in ("cancelled", "review"):
                raise ShippingError("此訂單不能提供貨運單。")
            if row["platform"] in self.errors or binding != self.document_binding(row):
                raise ShippingError("訂單資料已異動，請重新讀取後核對。")
            if not content.startswith(b"%PDF-") or len(content) > 8_000_000:
                raise ShippingError("請選擇 8 MB 以內的平台正式 PDF 貨運單。")
            filename = "provided-" + hashlib.sha256((key + binding).encode()).hexdigest() + ".pdf"
            temporary = self.data_dir / (filename + ".tmp")
            temporary.write_bytes(content)
            temporary.replace(self.data_dir / filename)
            self.save_job(key, state="ready", document=filename, mime="application/pdf",
                          binding=binding, tracking=row.get("tracking", ""), error="")
            self.event(key, "owner-provided-official-pdf")
            self.mark_handled(key, "acquired")
            return {"ok": True}

    def document(self, key, kind="label"):
        job = self.job(key)
        if not self.document_matches(self.rows.get(key), job):
            raise ShippingError("請先重新核對並取得正式貨運單；舊文件與目前訂單尚未確認一致。")
        if kind in ("preview", "print"):
            from shipping_preview import preview_pdf, print_pdf
            if job["mime"] != "application/pdf":
                raise ShippingError("此文件請開啟原單查看。")
            fn = preview_pdf if kind == "preview" else print_pdf
            content = fn((self.data_dir / job["document"]).read_bytes(), self.data_dir, self.rows[key])
            if not content:
                raise ShippingError("此 PDF 需輸入密碼或由原單檢視器開啟。")
            return content, "image/png" if kind == "preview" else "application/pdf"
        if kind != "label":
            if kind not in ("detail", "combined"):
                raise ShippingError("文件類型不正確。")
            with self.connect() as db:
                doc = db.execute("SELECT * FROM documents WHERE order_key=? AND kind=?",
                                 (key, kind)).fetchone()
                if not doc:
                    raise ShippingError("平台未提供這種文件。")
                return (self.data_dir / doc["document"]).read_bytes(), doc["mime"]
        return (self.data_dir / job["document"]).read_bytes(), job["mime"]

    def momo_request(self, endpoint, body):
        res = requests.post("https://api3p.momo.com.tw/VendorApi/" + endpoint,
                            headers=source.momo_headers(self.config["momo"]["momo_token"]),
                            json=body, timeout=(10, 60), allow_redirects=False)
        if res.status_code != 200:
            raise ShippingError(f"MOMO 回覆 HTTP {res.status_code}。")
        payload = res.json()
        if payload.get("success") is False or payload.get("errorMessage"):
            raise ShippingError("MOMO 拒絕此請求；請核對訂單是否已異動或細項不完整。")
        return payload

    def fresh_momo(self, key):
        parts = key.split(":")
        if len(parts) != 3 or not parts[1].isdigit():
            raise ShippingError("MOMO 訂單識別不正確。")
        end = datetime.now(TZ)
        payload = self.momo_request("OrderQuery", {
            "orderNo": parts[1], "queryDateType": "OrderDate",
            "fromDate": (end-timedelta(days=self.days-1)).strftime("%Y-%m-%d"),
            "toDate": end.strftime("%Y-%m-%d"), "deliveryType": "All",
            "storeDeliveryType": "All", "orderStatus": "All", "pageIndex": 1, "maxPerPage": 100})
        for raw in source.extract_orders(payload):
            if text(raw.get("orderNo")) != parts[1]:
                continue
            for row in normalize_momo(raw):
                if row["key"] == key:
                    return row
        raise ShippingError("訂單細項或包裹已變更，請重新讀取訂單後再操作。")

    def process_momo(self, row, job):
        key = row["key"]
        # Cache is used only AFTER a fresh platform read verifies the package still exists.
        # MOMO may omit deliveryNo after printing; always ask its reprint endpoint to
        # return the current document instead of guessing whether a cached label is current.
        method = row["shippingMethod"]
        create_endpoints = {"third": "OrderShippingStatusConfirmThirdPartyDelivery",
            "seven": "OrderShippingStatusConfirmSevenStoreDelivery",
            "family": "OrderShippingStatusConfirmFamilyStoreDelivery"}
        print_endpoints = {"third": "OrderShippingThirdPartyPrintLabel",
            "seven": "OrderShippingSevenStorePrintLabel", "family": "OrderShippingFamilyStorePrintLabel"}
        if row["action"] == "create":
            self.reserve_creation(key)
            self.event(key, "arrange-requested")
            body = {"listItem": [{"newBoxYn": "1", "deliveryStatus": "Shipped", "deliveryNote": "",
                "orderList": [{"orderNo": row["orderNo"], "orderSeq": seq}
                              for seq in row["orderSeqs"]]}]}
            if row["delyGb"]:
                body["delyGb"] = row["delyGb"]
            try:
                payload = self.momo_request(create_endpoints[method], body)
                receipts = payload.get("confirmDeliveryDetailResList") or []
                if len(receipts) != 1 or receipts[0].get("success") is not True or not receipts[0].get("slipNo"):
                    raise ShippingError("MOMO 未確認此包裹已產生正式單號。")
                receipt = receipts[0]
                self.save_job(key, state="arranged", tracking=text(receipt["slipNo"]))
                self.event(key, "arranged")
            except Exception:
                self.save_job(key, state="uncertain", error="申請結果未確認，請核對 MOMO；不會自動重送。")
                raise ShippingError("MOMO 申請結果未確認，已停止自動重試。")
        else:
            part = {"orderList": [{"orderNo": row["orderNo"], "orderSeq": ",".join(row["orderSeqs"])}]}
            if row["delyGb"]:
                part["delyGb"] = row["delyGb"]
            payload = self.momo_request(print_endpoints[method], {"listItem": [part]})
            receipts = payload.get("orderPrintLabelResList") or []
            if len(receipts) != 1:
                raise ShippingError("MOMO 未回傳唯一的正式貨運單，請核對包裹。")
            receipt = receipts[0]
        try:
            encoded = receipt.get("printLabel") or receipt.get("printLable")
            if not isinstance(encoded, str):
                raise ShippingError("MOMO 貨運單資料空白。")
            # Actual official response verified as base64 PDF, not a remote arbitrary URL.
            pdf = base64.b64decode(encoded, validate=True)
            if not pdf.startswith(b"%PDF-"):
                raise ShippingError("MOMO 未回傳有效 PDF。")
            filename = hashlib.sha256((key + now()).encode()).hexdigest() + ".pdf"
            temp = self.data_dir / (filename + ".tmp")
            temp.write_bytes(pdf)
            temp.replace(self.data_dir / filename)
            auxiliary = []
            for kind, field in (("detail", "printDetail"), ("combined", "printAll")):
                encoded_extra = receipt.get(field)
                if not isinstance(encoded_extra, str) or not encoded_extra:
                    continue
                try:
                    extra_pdf = base64.b64decode(encoded_extra, validate=True)
                except (ValueError, TypeError):
                    continue
                if not extra_pdf.startswith(b"%PDF-"):
                    continue
                extra_name = filename[:-4] + "-" + kind + ".pdf"
                (self.data_dir / extra_name).write_bytes(extra_pdf)
                auxiliary.append((key, kind, extra_name, "application/pdf"))
            with self.connect() as db:
                db.execute("DELETE FROM documents WHERE order_key=?", (key,))
                db.executemany("INSERT INTO documents VALUES (?,?,?,?)", auxiliary)
            row.update(stage="label", canCreate=False, canDownload=True)
            if row["action"] == "create":
                row["tracking"] = text(receipt["slipNo"])
            self.rows[key] = row
            self.save_job(key, state="ready", document=filename, mime="application/pdf", error="",
                          tracking=row["tracking"], binding=self.document_binding(row))
            self.event(key, "document-downloaded")
            return {"ready": True, "key": key, "reused": False}
        except Exception:
            self.save_job(key, state="download-failed", error="單據尚未保存；請重新核對後取回原貨運單。")
            raise ShippingError("MOMO 文件未能保存；下次會先確認平台狀態，再取回原貨運單。")

