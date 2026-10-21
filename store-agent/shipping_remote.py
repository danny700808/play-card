"""Outbound-only relay for the password-protected packing desk.

No listening port, platform credentials, or general command execution is exposed.
The existing Workbench remains the sole owner of shipment and print state.
"""
import base64
import json
from pathlib import Path
import re
import threading
import time

import requests
from shipping_core import ShippingError, datetime, TZ, timedelta

ENDPOINT = "https://asia-east1-youzi-c1b74.cloudfunctions.net/shippingDeskApi"
KEY = re.compile(r"^(?:(?:EasyStore|Coupang):\d{1,30}|MOMO:\d{1,30}:\d{1,6}(?:,\d{1,6}){0,99})$")


def packing_snapshot(workbench):
    payload = workbench.snapshot()
    # Operational packing fields and explicitly normalized buyer payment only.
    # Never forward raw API responses, credentials, costs or settlement totals.
    fields = (
        "key platform channel orderNo externalId date stage status recipient phone address "
        "pickupStore note carrier carrierCode deliveryMethod tracking items canCreate canDownload blockReason "
        "documentReady documentKinds stale jobError handled handlingAction handlingSource "
        "handledAt printCount handlingChanged paidAmount paidCurrency paidAmountStatus paidAmountNote "
        "payableAmount paidAmountSource paidAmountScope paidScopeKey invoiceBuyerAmount"
    ).split()
    start = (datetime.now(TZ) - timedelta(days=2)).strftime("%Y-%m-%d")
    rows = []
    for row in payload["orders"]:
        # MOMO's response omits the order date. Its OrderQuery already restricts
        # OrderDate to the requested three days; do not discard all MOMO rows.
        if row.get("date"):
            try:
                ordered = datetime.fromisoformat(row["date"].replace("Z", "+00:00"))
                if ordered.tzinfo is None:
                    ordered = ordered.replace(tzinfo=TZ)
                if ordered.astimezone(TZ).strftime("%Y-%m-%d") < start:
                    continue
            except (ValueError, TypeError):
                continue
        if not row.get("date") and row.get("platform") != "MOMO":
            continue
        rows.append({k: row[k] for k in fields if k in row})
    return {"orders": rows, "updated": payload.get("updated"), "days": 3,
            "errors": payload.get("errors", {}), "connectors": []}


def execute(workbench, command, body):
    if command == "refresh":
        workbench.refresh(3)
        return packing_snapshot(workbench), None
    key = body.get("key", "")
    if not KEY.fullmatch(key) or not any(r["key"] == key for r in packing_snapshot(workbench)["orders"]):
        raise ShippingError("此訂單不在近 3 天包貨清單內，請重新讀取。")
    if command in ("preview", "process"):
        options = body.get("options") or {}
        if any(k not in ("carrier", "outboundShippingPlaceCode", "returnCenterCode") for k in options):
            raise ShippingError("物流資料不正確。")
        if command == "preview":
            return workbench.preview(key, options), None
        return workbench.process(key, options, body.get("fingerprint", "")), None
    if command == "handling":
        if body.get("action") not in ("printed", "shipped", "processed", "reopen"):
            raise ShippingError("處理狀態不正確。")
        return workbench.mark_handled(key, body["action"], "包貨窗口"), None
    if command == "print-event":
        workbench.document(key)
        workbench.mark_handled(key, "print_requested", "包貨窗口")
        return {"ok": True}, None
    if command == "document-link":
        files = {}
        row = next(r for r in workbench.snapshot()["orders"] if r["key"] == key)
        kinds = ["label"] + (["combined"] if "combined" in row.get("documentKinds", []) else [])
        for kind in kinds:
            content, mime = workbench.document(key, kind)
            if len(content) > 10_000_000:
                raise ShippingError("貨運單超過可傳送大小，請由主機列印。")
            files[kind] = {"mime": mime, "base64": base64.b64encode(content).decode("ascii")}
        for kind in ("preview", "print"):
            try:
                content, mime = workbench.document(key, kind)
                if len(content) <= 10_000_000 and sum(len(f["base64"]) for f in files.values()) + len(content) * 4 / 3 < 25_000_000:
                    files[kind] = {"mime": mime, "base64": base64.b64encode(content).decode("ascii")}
            except ShippingError:
                pass
        return {}, files
    raise ShippingError("此入口只能處理包貨與列印。")


class RemoteRelay:
    def __init__(self, workbench, config_path):
        self.workbench = workbench
        self.config = json.loads(Path(config_path).read_text(encoding="utf-8"))
        if self.config.get("endpoint") != ENDPOINT or not re.fullmatch(r"[A-Za-z0-9_-]{43}", self.config.get("agentKey", "")):
            raise ValueError("Invalid remote relay configuration")
        self.outbox = workbench.data_dir / "remote-outbox.json"
        self.stop = threading.Event()
        self.last_refresh = 0
        self.last_snapshot = ""
        self.last_publish = 0
        self.last_cleanup = 0

    def call(self, action, **payload):
        response = requests.post(ENDPOINT, json={"action": action, **payload},
            headers={"Authorization": "Bearer " + self.config["agentKey"]},
            timeout=(10, 100), allow_redirects=False)
        response.raise_for_status()
        return response.json()

    def publish(self, force=False):
        snapshot = packing_snapshot(self.workbench)
        serialized = json.dumps(snapshot, ensure_ascii=False, sort_keys=True)
        if force or serialized != self.last_snapshot or time.monotonic() - self.last_publish > 60:
            self.call("agentSnapshot", snapshot=snapshot)
            self.last_snapshot = serialized
            self.last_publish = time.monotonic()

    def deliver_outbox(self):
        if not self.outbox.exists():
            return
        payload = json.loads(self.outbox.read_text(encoding="utf-8"))
        self.call("agentComplete", **payload)
        self.outbox.unlink()

    def run(self):
        # The outbox is retried; a completed shipping action is never executed again.
        while not self.stop.is_set():
            try:
                self.deliver_outbox()
                if time.monotonic() - self.last_refresh > 300:
                    self.workbench.refresh(3)
                    self.last_refresh = time.monotonic()
                self.publish()
                if time.monotonic() - self.last_cleanup > 3600:
                    self.call("agentCleanup")
                    self.last_cleanup = time.monotonic()
                response = self.call("agentPoll")
                job = response.get("job")
                if job:
                    output = {"jobId": job["id"], "claim": job["claim"]}
                    try:
                        result, files = execute(self.workbench, job["command"], job["body"])
                        output["result"] = result
                        if files:
                            output["files"] = files
                    except ShippingError as exc:
                        output["error"] = str(exc)
                    except Exception:
                        output["error"] = "操作未完成，請重新讀取訂單確認平台結果。"
                    output["snapshot"] = packing_snapshot(self.workbench)
                    temp = self.outbox.with_suffix(".tmp")
                    temp.write_text(json.dumps(output, ensure_ascii=False), encoding="utf-8")
                    temp.replace(self.outbox)
                    self.deliver_outbox()
                    self.publish(force=True)
                self.stop.wait(3 if job else 6)
            except Exception:
                # Do not log customer data, platform responses or bearer credentials.
                self.stop.wait(15)

    def start(self):
        thread = threading.Thread(target=self.run, name="packing-relay", daemon=True)
        thread.start()
        return thread
