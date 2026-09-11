# -*- coding: utf-8 -*-
"""柚子樂器店內 Windows 平台同步代理。

用途：
- 從店內固定 IP 讀取 EasyStore / MOMO / Coupang 訂單。
- 將訂單交給 Firebase Function 寫入 Firestore 並扣中央庫存。
- 只將本次變動的 SKU 更新回三個平台。
- 監聽網頁在 opsPlatformSyncRequests 建立的「立即同步」要求。

本程式正常執行時不顯示視窗；所有結果寫入 logs/。
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import hmac
import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import quote

import requests
from momo_price_sync import sync_targets as sync_momo_price_targets
from openpyxl import Workbook, load_workbook

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"
LOG_DIR = ROOT / "logs"
CACHE_DIR = ROOT / "cache"
TEMP_DIR = ROOT / "temp"
LOCK_PATH = CACHE_DIR / "agent_run.lock"
TAIWAN_TZ = timezone(timedelta(hours=8))
VERSION = "2026.09.11-store-agent-momo-price-v1"

for folder in (LOG_DIR, CACHE_DIR, TEMP_DIR):
    folder.mkdir(parents=True, exist_ok=True)


def now_tw() -> datetime:
    return datetime.now(TAIWAN_TZ)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def clean(value: Any) -> str:
    return str(value if value is not None else "").strip()


def number(value: Any, default: float = 0.0) -> float:
    if value is None or clean(value) == "":
        return default
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return default


def integer(value: Any, default: int = 0) -> int:
    return int(round(number(value, default)))


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8-sig") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise RuntimeError(f"設定檔格式錯誤：{path}")
    return data


def atomic_write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)


class RunLogger:
    def __init__(self, prefix: str = "sync") -> None:
        stamp = now_tw().strftime("%Y%m%d_%H%M%S")
        self.path = LOG_DIR / f"{prefix}_{stamp}.log"
        self._handle = self.path.open("a", encoding="utf-8", buffering=1)
        self._lock = threading.Lock()

    def write(self, message: str) -> None:
        line = f"[{now_tw().strftime('%Y-%m-%d %H:%M:%S')}] {message}"
        with self._lock:
            self._handle.write(line + "\n")
        print(line, flush=True)

    def close(self) -> None:
        with contextlib.suppress(Exception):
            self._handle.close()


class SingleRunLock:
    def __init__(self, path: Path, stale_seconds: int = 7200) -> None:
        self.path = path
        self.stale_seconds = stale_seconds
        self.acquired = False

    def __enter__(self) -> "SingleRunLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            age = time.time() - self.path.stat().st_mtime
            if age > self.stale_seconds:
                with contextlib.suppress(Exception):
                    self.path.unlink()
        try:
            fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"pid={os.getpid()}\nstarted={utc_now_iso()}\n".encode("utf-8"))
            os.close(fd)
            self.acquired = True
        except FileExistsError as exc:
            raise RuntimeError("同步程式已經在執行，這次不重複啟動。") from exc
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.acquired:
            with contextlib.suppress(Exception):
                self.path.unlink()


def dynamic_import(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"無法載入程式：{path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ORDER_SOURCE = dynamic_import("youzi_order_source", ROOT / "lib" / "order_source.py")
INVENTORY_SOURCE = dynamic_import("youzi_inventory_source", ROOT / "lib" / "inventory_source.py")


def parse_order_time(value: Any) -> str:
    """只接受平台的原始時間，絕不可用本次同步時間冒充客人下單時間。"""
    text = clean(value)
    if not text:
        return ""
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M"):
        try:
            dt = datetime.strptime(text, fmt).replace(tzinfo=TAIWAN_TZ)
            return dt.isoformat()
        except ValueError:
            pass
    try:
        normalized = text.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=TAIWAN_TZ)
        return dt.isoformat()
    except ValueError:
        return ""


def convert_order_row(row: Dict[str, Any]) -> Dict[str, Any]:
    qty = max(0, integer(row.get("數量"), 0))
    unit_price = max(0.0, number(row.get("單價"), 0.0))
    subtotal = number(row.get("小計"), unit_price * qty)
    if subtotal <= 0 and unit_price > 0 and qty > 0:
        subtotal = unit_price * qty
    external_order_id = clean(row.get("訂單ID") or row.get("訂單編號"))
    external_order_no = clean(row.get("訂單編號") or row.get("訂單ID"))
    dedupe = clean(row.get("去重Key"))
    if not dedupe:
        dedupe = "|".join([
            clean(row.get("平台")), external_order_id, clean(row.get("商品編號/SKU")),
            str(qty), str(unit_price)
        ])
    # 原程式去重 Key 的前三段是「平台｜訂單｜明細 ID」；只取穩定明細 ID，
    # 避免日後價格或數量異動時被誤判成另一筆新銷售。
    dedupe_parts = dedupe.split("|")
    external_line_id = clean(dedupe_parts[2]) if len(dedupe_parts) >= 3 else dedupe
    if not external_line_id:
        external_line_id = clean(row.get("商品編號/SKU")) or dedupe
    ordered_at = parse_order_time(row.get("訂單時間"))
    return {
        "platform": clean(row.get("平台")),
        "externalOrderId": external_order_id,
        "externalOrderNo": external_order_no,
        "externalLineId": external_line_id,
        "orderedAt": ordered_at,
        "orderDateSource": clean(row.get("訂單時間來源")) or "missing",
        "orderTimeEstimated": clean(row.get("訂單時間來源")).lower() in ("missing", "momo-order-number-inferred"),
        "statusUpdatedAt": parse_order_time(row.get("狀態更新時間")) if clean(row.get("狀態更新時間")) else "",
        "shippedAt": parse_order_time(row.get("出貨時間")) if clean(row.get("出貨時間")) else "",
        "completedAt": parse_order_time(row.get("完成時間")) if clean(row.get("完成時間")) else "",
        "refundedAt": parse_order_time(row.get("退款時間")) if clean(row.get("退款時間")) else "",
        "sku": clean(row.get("商品編號/SKU")),
        "productName": clean(row.get("商品名稱")),
        "variantName": clean(row.get("規格名稱")),
        "quantity": qty,
        "unitPrice": unit_price,
        "grossAmount": max(0.0, subtotal),
        "currency": clean(row.get("幣別")) or "TWD",
        "orderStatus": clean(row.get("訂單狀態")),
        "paymentStatus": clean(row.get("付款狀態")),
        "customerName": clean(row.get("買家/顧客")),
        "note": clean(row.get("備註")),
        "platformIds": {},
    }


def fetch_orders(config: Dict[str, Any], logger: RunLogger) -> Tuple[List[Dict[str, Any]], Dict[str, Any], str, str]:
    agent_cfg = config.get("agent", {})
    # 至少回查 7 天，讓已抓到後才取消／未付款的訂單仍有機會被自動更正；上限維持 30 天。
    days = max(7, min(30, integer(agent_cfg.get("lookback_days"), 7)))
    end_dt = now_tw()
    start_dt = datetime.combine((end_dt - timedelta(days=days)).date(), datetime.min.time(), tzinfo=TAIWAN_TZ)
    fetchers = [
        ("EasyStore", ORDER_SOURCE.fetch_easystore_rows),
        ("MOMO", ORDER_SOURCE.fetch_momo_rows),
        ("Coupang", ORDER_SOURCE.fetch_coupang_rows),
    ]
    lines: List[Dict[str, Any]] = []
    platform_fetch: Dict[str, Any] = {}
    for platform, function in fetchers:
        logger.write(f"開始讀取 {platform} 訂單。")
        try:
            rows, summary = function(config, start_dt, end_dt)
            converted = [convert_order_row(row) for row in rows]
            lines.extend(converted)
            raw_status = clean(summary.get("狀態")).upper()
            # 退貨清單失敗時，仍保留已讀到的訂單，但不允許雲端把缺席資料判為取消。
            status = "success" if raw_status.startswith("OK") else ("skipped" if raw_status == "SKIPPED" else "error")
            platform_fetch[platform] = {
                "status": status,
                "orders": integer(summary.get("讀到訂單"), 0),
                "lines": len(converted),
                "error": clean(summary.get("訊息")) if status == "error" else "",
                "complete": bool(summary.get("complete", raw_status == "OK")),
                "returnsComplete": bool(summary.get("returnsComplete", False)) if platform == "Coupang" else True,
            }
            logger.write(f"{platform}：{status}，讀到 {len(converted)} 筆商品明細。")
        except Exception as exc:  # noqa: BLE001
            platform_fetch[platform] = {"status": "error", "orders": 0, "lines": 0, "error": clean(exc)}
            logger.write(f"{platform} 訂單讀取失敗：{exc}")
    # 本機先去重；雲端仍會再次用穩定 ID 去重。
    unique: Dict[str, Dict[str, Any]] = {}
    for line in lines:
        key = "|".join([
            clean(line.get("platform")), clean(line.get("externalOrderId")), clean(line.get("externalLineId"))
        ])
        unique[key] = line
    return list(unique.values()), platform_fetch, start_dt.isoformat(), end_dt.isoformat()


def json_bytes(payload: Dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")


def call_bridge(config: Dict[str, Any], payload: Dict[str, Any], logger: RunLogger) -> Dict[str, Any]:
    agent_cfg = config.get("agent", {})
    bridge_url = clean(agent_cfg.get("bridge_url"))
    secret = clean((config.get("coupang") or {}).get("secret_key"))
    if not bridge_url:
        raise RuntimeError("config.json 缺少 agent.bridge_url")
    if not secret:
        raise RuntimeError("config.json 缺少 Coupang secret_key，無法驗證店內同步程式。")
    body = json_bytes(payload)
    timestamp = str(int(time.time()))
    signature = hmac.new(secret.encode("utf-8"), timestamp.encode("utf-8") + b"." + body, hashlib.sha256).hexdigest()
    logger.write(f"將 {len(payload.get('lines') or [])} 筆訂單明細送入 Firestore 中央系統。")
    response = requests.post(
        bridge_url,
        data=body,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "X-Youzi-Timestamp": timestamp,
            "X-Youzi-Signature": signature,
            "User-Agent": f"YouziStoreWindowsAgent/{VERSION}",
        },
        timeout=540,
    )
    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError(f"Firebase Bridge HTTP {response.status_code} 回傳不是 JSON：{response.text[:500]}") from exc
    if response.status_code < 200 or response.status_code >= 300 or not data.get("ok"):
        raise RuntimeError(f"Firebase Bridge 失敗：{data.get('message') or response.text[:500]}")
    return data


# -----------------------------
# Firestore REST：只用於手動同步要求、庫存佇列、代理狀態與補充同步結果。
# -----------------------------

def fs_encode(value: Any) -> Dict[str, Any]:
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int) and not isinstance(value, bool):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, datetime):
        return {"timestampValue": value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")}
    if isinstance(value, list):
        return {"arrayValue": {"values": [fs_encode(item) for item in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {str(key): fs_encode(item) for key, item in value.items()}}}
    return {"stringValue": str(value)}


def fs_decode(value: Dict[str, Any]) -> Any:
    if not isinstance(value, dict):
        return None
    if "nullValue" in value:
        return None
    if "stringValue" in value:
        return value["stringValue"]
    if "booleanValue" in value:
        return bool(value["booleanValue"])
    if "integerValue" in value:
        return int(value["integerValue"])
    if "doubleValue" in value:
        return float(value["doubleValue"])
    if "timestampValue" in value:
        return value["timestampValue"]
    if "arrayValue" in value:
        return [fs_decode(item) for item in value.get("arrayValue", {}).get("values", [])]
    if "mapValue" in value:
        return {key: fs_decode(item) for key, item in value.get("mapValue", {}).get("fields", {}).items()}
    return None


class FirestoreRest:
    def __init__(self, project_id: str, logger: Optional[RunLogger] = None) -> None:
        if not project_id:
            raise RuntimeError("config.json 缺少 agent.project_id")
        self.project_id = project_id
        self.base = f"https://firestore.googleapis.com/v1/projects/{quote(project_id)}/databases/(default)/documents"
        self.logger = logger

    def _check(self, response: requests.Response, label: str) -> Any:
        if response.status_code < 200 or response.status_code >= 300:
            raise RuntimeError(f"{label} HTTP {response.status_code}：{response.text[:800]}")
        if not response.text.strip():
            return {}
        return response.json()

    def run_query_equal(self, collection: str, field: str, value: Any, limit: int = 100) -> List[Tuple[str, Dict[str, Any]]]:
        url = self.base + ":runQuery"
        payload = {
            "structuredQuery": {
                "from": [{"collectionId": collection}],
                "where": {
                    "fieldFilter": {
                        "field": {"fieldPath": field},
                        "op": "EQUAL",
                        "value": fs_encode(value),
                    }
                },
                "limit": max(1, min(1000, int(limit))),
            }
        }
        data = self._check(requests.post(url, json=payload, timeout=60), f"Firestore 查詢 {collection}")
        rows: List[Tuple[str, Dict[str, Any]]] = []
        for item in data:
            document = item.get("document") or {}
            name = clean(document.get("name"))
            if not name:
                continue
            doc_id = name.rsplit("/", 1)[-1]
            decoded = {key: fs_decode(raw) for key, raw in (document.get("fields") or {}).items()}
            rows.append((doc_id, decoded))
        return rows

    def get_document(self, path: str) -> Dict[str, Any]:
        response = requests.get(f"{self.base}/{path}", timeout=60)
        if response.status_code == 404:
            return {}
        document = self._check(response, f"Firestore 讀取 {path}")
        return {key: fs_decode(raw) for key, raw in (document.get("fields") or {}).items()}

    def patch_document(self, path: str, fields: Dict[str, Any]) -> None:
        if not fields:
            return
        params = [("updateMask.fieldPaths", key) for key in fields.keys()]
        payload = {"fields": {key: fs_encode(value) for key, value in fields.items()}}
        response = requests.patch(f"{self.base}/{path}", params=params, json=payload, timeout=60)
        self._check(response, f"Firestore 更新 {path}")

    def set_document(self, path: str, fields: Dict[str, Any]) -> None:
        # PATCH without update mask creates or replaces only the supplied document fields.
        payload = {"fields": {key: fs_encode(value) for key, value in fields.items()}}
        response = requests.patch(f"{self.base}/{path}", json=payload, timeout=60)
        self._check(response, f"Firestore 寫入 {path}")


# -----------------------------
# 庫存更新：Firestore 回傳目標庫存 -> 暫存 Excel -> 沿用原本三平台程式。
# 暫存 Excel 不是主資料，只是把既有穩定平台更新程式接上 Firestore。
# -----------------------------

def merge_targets(*groups: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: Dict[str, Dict[str, Any]] = {}
    for group in groups:
        for item in group or []:
            sku = clean(item.get("sku")).upper()
            if not sku:
                continue
            merged[sku] = {
                "productId": clean(item.get("productId")),
                "sku": sku,
                "targetStock": max(0, integer(item.get("targetStock"), 0)),
                "productName": clean(item.get("productName")),
                "queueId": clean(item.get("queueId")),
            }
    return list(merged.values())


def create_inventory_excel(path: Path, targets: List[Dict[str, Any]]) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Firestore差異庫存"
    headers = ["code", "withoutWarehouseStocks", "name", "easyStoreSync", "momoSync", "coupangSync"]
    ws.append(headers)
    for target in targets:
        ws.append([
            target["sku"], target["targetStock"], target.get("productName", ""), "YES", "YES", "YES"
        ])
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)


def build_inventory_temp_config(config: Dict[str, Any], run_dir: Path, excel_path: Path) -> Path:
    cfg = json.loads(json.dumps(config))
    cfg["excel_file"] = str(excel_path)
    cfg["sheet_name"] = "Firestore差異庫存"
    cfg["excel_code_column"] = "code"
    cfg["excel_stock_column"] = "withoutWarehouseStocks"
    cfg["cache_file"] = str(CACHE_DIR / ".inventory_sync_cache.json")
    cfg["output_dir"] = str(run_dir / "results")
    cfg["use_excel_snapshot_diff"] = False
    cfg["snapshot_excel_file"] = str(run_dir / "unused_snapshot.xlsx")
    cfg["auto_update_previous_excel_after_apply"] = False
    cfg["google_sheet_sync"] = {**(cfg.get("google_sheet_sync") or {}), "enabled": False}
    path = run_dir / "inventory_config.json"
    atomic_write_json(path, cfg)
    return path


def parse_inventory_result(result_file: Path, targets: List[Dict[str, Any]]) -> Dict[str, Any]:
    wb = load_workbook(result_file, read_only=True, data_only=True)
    ws = wb.active
    headers = {clean(cell.value): index for index, cell in enumerate(ws[1], start=1) if clean(cell.value)}
    by_sku: Dict[str, Dict[str, Any]] = {}
    success_statuses = {"SUCCESS", "SKIPPED_SAME_STOCK"}
    platforms = {
        "EasyStore": ("easyStoreStatus", "easyStoreErrorMessage"),
        "MOMO": ("momoStatus", "momoErrorMessage"),
        "Coupang": ("coupangStatus", "coupangErrorMessage"),
    }
    code_col = headers.get("code")
    if not code_col:
        raise RuntimeError("庫存同步結果找不到 code 欄位。")
    for row in ws.iter_rows(min_row=2, values_only=True):
        sku = clean(row[code_col - 1]).upper() if code_col - 1 < len(row) else ""
        if not sku:
            continue
        item_result: Dict[str, Any] = {"sku": sku, "platforms": {}, "success": True}
        for platform, (status_name, message_name) in platforms.items():
            status_col = headers.get(status_name)
            message_col = headers.get(message_name)
            status = clean(row[status_col - 1]) if status_col and status_col - 1 < len(row) else "NOT_RUN"
            message = clean(row[message_col - 1]) if message_col and message_col - 1 < len(row) else ""
            enabled_key = {"EasyStore": "easystore", "MOMO": "momo", "Coupang": "coupang"}[platform]
            # 若平台在 config 停用，由呼叫端稍後視為 skipped。
            ok = status in success_statuses
            item_result["platforms"][platform] = {"status": status or "NOT_RUN", "message": message, "success": ok}
            if not ok:
                item_result["success"] = False
        by_sku[sku] = item_result
    wb.close()
    summary = {
        "targets": len(targets),
        "success": 0,
        "errors": 0,
        "items": [],
        "resultFile": str(result_file),
    }
    for target in targets:
        result = by_sku.get(target["sku"], {"sku": target["sku"], "platforms": {}, "success": False})
        result.update({"productId": target.get("productId", ""), "targetStock": target.get("targetStock", 0), "queueId": target.get("queueId", "")})
        if result.get("success"):
            summary["success"] += 1
        else:
            summary["errors"] += 1
        summary["items"].append(result)
    return summary


def run_inventory_sync(config: Dict[str, Any], targets: List[Dict[str, Any]], logger: RunLogger) -> Dict[str, Any]:
    if not targets:
        return {"targets": 0, "success": 0, "errors": 0, "items": [], "skipped": True}
    run_dir = TEMP_DIR / now_tw().strftime("run_%Y%m%d_%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)
    excel_path = run_dir / "firestore_inventory_targets.xlsx"
    create_inventory_excel(excel_path, targets)
    temp_config = build_inventory_temp_config(config, run_dir, excel_path)
    source = ROOT / "lib" / "inventory_source.py"
    logger.write(f"開始將 {len(targets)} 個變動 SKU 同步回三平台。")
    python_runner = ROOT / ".venv" / "Scripts" / "python.exe"
    executable = str(python_runner) if python_runner.exists() else sys.executable
    process = subprocess.run(
        [executable, str(source), "--config", str(temp_config), "--platform", "all", "--apply"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=3600,
        creationflags=0x08000000 if os.name == "nt" else 0,
    )
    if process.stdout:
        for line in process.stdout.splitlines():
            logger.write("庫存程式｜" + line)
    if process.stderr:
        for line in process.stderr.splitlines():
            logger.write("庫存錯誤｜" + line)
    result_files = sorted((run_dir / "results").glob("*_ALL_RESULT_apply_*.xlsx"), key=lambda path: path.stat().st_mtime)
    if not result_files:
        raise RuntimeError(f"庫存同步沒有產生結果檔；程式結束代碼 {process.returncode}。")
    summary = parse_inventory_result(result_files[-1], targets)
    summary["processReturnCode"] = process.returncode
    if process.returncode != 0:
        summary["processError"] = (process.stderr or process.stdout or "庫存程式執行失敗")[-1200:]
    logger.write(f"庫存同步完成：成功 {summary['success']} 個，異常 {summary['errors']} 個。")
    return summary


def get_pending_requests(fs: FirestoreRest) -> List[Tuple[str, Dict[str, Any]]]:
    return fs.run_query_equal("opsPlatformSyncRequests", "status", "pending", limit=20)


def get_pending_queue(fs: FirestoreRest) -> List[Dict[str, Any]]:
    rows = fs.run_query_equal("opsPlatformInventoryQueue", "status", "pending", limit=500)
    output = []
    for doc_id, data in rows:
        product_id = clean(data.get("productId") or doc_id)
        product = fs.get_document(f"opsInternalProducts/{product_id}") if product_id else {}
        # 佇列可能早於新訂單建立，所以以 Firestore 商品目前庫存為最終準則。
        sku = clean(product.get("internalSku") or product.get("sku") or product.get("code") or data.get("sku"))
        target = product.get("currentStock") if clean(product.get("currentStock")) != "" else data.get("targetStock")
        output.append({
            "queueId": doc_id,
            "productId": product_id,
            "sku": sku,
            "targetStock": integer(target, 0),
            "productName": clean(product.get("internalName") or product.get("originalName") or product.get("name") or data.get("productName")),
        })
    return output


def requested_price_product_ids(request_rows: List[Tuple[str, Dict[str, Any]]]) -> List[str]:
    """只把網頁明確要求改價的商品交給後端，避免每次訂單同步掃描整個商品目錄。"""
    product_ids: List[str] = []
    for _, request in request_rows:
        if clean(request.get("reason")) != "platform-price-change":
            continue
        raw_ids = request.get("productIds") if isinstance(request.get("productIds"), list) else []
        product_ids.extend(clean(value) for value in raw_ids if clean(value))
    return list(dict.fromkeys(product_ids))


def claim_requests(fs: FirestoreRest, requests_rows: List[Tuple[str, Dict[str, Any]]]) -> None:
    for request_id, _ in requests_rows:
        fs.patch_document(f"opsPlatformSyncRequests/{request_id}", {
            "status": "running",
            "claimedAt": utc_now_iso(),
            "claimedBy": socket.gethostname(),
            "agentVersion": VERSION,
        })


def finish_requests(fs: FirestoreRest, request_rows: List[Tuple[str, Dict[str, Any]]], status: str, run_id: str = "", error: str = "") -> None:
    for request_id, _ in request_rows:
        fields: Dict[str, Any] = {
            "status": status,
            "error": error[:1000],
            "agentVersion": VERSION,
        }
        if status != "pending":
            fields["runId"] = run_id
            fields["finishedAt"] = utc_now_iso()
        fs.patch_document(f"opsPlatformSyncRequests/{request_id}", fields)


def update_queue_results(fs: FirestoreRest, inventory_summary: Dict[str, Any], run_id: str) -> None:
    for item in inventory_summary.get("items") or []:
        queue_id = clean(item.get("queueId"))
        if not queue_id:
            continue
        fs.patch_document(f"opsPlatformInventoryQueue/{queue_id}", {
            # 失敗時保留 pending，下一次排程會自動重試。
            "status": "completed" if item.get("success") else "pending",
            "lastAttemptStatus": "success" if item.get("success") else "error",
            "processedAt": utc_now_iso() if item.get("success") else None,
            "lastAttemptAt": utc_now_iso(),
            "runId": run_id,
            "targetStock": integer(item.get("targetStock"), 0),
            "results": item.get("platforms") or {},
            "agentVersion": VERSION,
        })


def update_run_inventory_summary(fs: FirestoreRest, run_id: str, inventory_summary: Dict[str, Any]) -> None:
    if not run_id:
        return
    path = f"opsPlatformSyncRuns/{run_id}"
    existing = fs.get_document(path)
    summary = existing.get("summary") if isinstance(existing.get("summary"), dict) else {}
    summary["inventorySync"] = {
        "targets": integer(inventory_summary.get("targets"), 0),
        "success": integer(inventory_summary.get("success"), 0),
        "errors": integer(inventory_summary.get("errors"), 0),
        "completedAt": utc_now_iso(),
        "executionMode": "store-windows-agent",
    }
    final_status = clean(existing.get("status")) or "completed"
    if inventory_summary.get("errors"):
        final_status = "completed-with-errors"
    fs.patch_document(path, {
        "summary": summary,
        "status": final_status,
        "localInventoryFinishedAt": utc_now_iso(),
        "agentVersion": VERSION,
    })


def update_run_price_summary(fs: FirestoreRest, run_id: str, price_summary: Dict[str, Any]) -> None:
    if not run_id:
        return
    fs.patch_document(f"opsPlatformSyncRuns/{run_id}", {
        "coupangPriceAgent": price_summary,
        "coupangPriceAgentUpdatedAt": utc_now_iso(),
        "agentVersion": VERSION,
    })


def _target_vendor_item_ids(target: Dict[str, Any]) -> List[str]:
    mapping = target.get("platformMappings") if isinstance(target.get("platformMappings"), dict) else {}
    raw = mapping.get("vendorItemIds") or mapping.get("vendorItemId") or []
    if not isinstance(raw, list):
        raw = [raw]
    return list(dict.fromkeys(clean(value) for value in raw if clean(value)))


def sync_coupang_price_targets(config: Dict[str, Any], targets: List[Dict[str, Any]], logger: RunLogger) -> Dict[str, Any]:
    """由店內固定 IP 改價；非 10 元倍數會保留資料但絕不呼叫 Coupang API。"""
    output: Dict[str, Any] = {"targets": len(targets), "success": 0, "errors": 0, "skipped": 0, "items": []}
    cfg = dict(config.get("coupang") or {})
    for target in targets:
        sku = clean(target.get("sku"))
        target_price = integer(target.get("targetPrice"), -1)
        item: Dict[str, Any] = {"productId": clean(target.get("productId")), "sku": sku, "platform": "Coupang", "targetPrice": target_price}
        if not sku or target_price < 0:
            item.update({"status": "error", "message": "缺少 SKU 或目標售價"})
            output["errors"] += 1
        elif target_price % 10 != 0:
            item.update({"status": "manual-required", "message": "酷澎台灣售價必須是 10 元倍數，未送出 API"})
            output["skipped"] += 1
        else:
            try:
                vendor_item_ids = _target_vendor_item_ids(target)
                if not vendor_item_ids:
                    resolved = INVENTORY_SOURCE.coupang_resolve_items(cfg, sku)
                    vendor_item_ids = list(dict.fromkeys(clean(row.get("vendorItemId")) for row in resolved if clean(row.get("vendorItemId"))))
                if not vendor_item_ids:
                    raise RuntimeError("找不到對應的 Coupang vendorItemId")
                messages = []
                for vendor_item_id in vendor_item_ids:
                    result = INVENTORY_SOURCE.coupang_update_price(cfg, vendor_item_id, target_price)
                    messages.append(f"{vendor_item_id}:{clean(result.get('message') or result.get('code') or '已送出')}")
                    time.sleep(0.15)
                item.update({"status": "success", "message": "；".join(messages)[:700], "vendorItemIds": vendor_item_ids})
                output["success"] += 1
            except Exception as exc:  # noqa: BLE001
                item.update({"status": "error", "message": clean(exc)[:700]})
                output["errors"] += 1
        output["items"].append(item)
        logger.write(f"Coupang 改價 {sku or '未知 SKU'}：{item.get('status')}｜{item.get('message', '')}")
    return output


def report_price_results(config: Dict[str, Any], run_id: str, results: List[Dict[str, Any]], logger: RunLogger) -> None:
    if not results:
        return
    response = call_bridge(config, {
        "trigger": "local-agent-coupang-price-report",
        "priceReportOnly": True,
        "priceRunId": run_id,
        "priceResults": results,
        "agent": {"version": VERSION, "computerName": socket.gethostname(), "fixedIpMode": True},
    }, logger)
    logger.write(f"Coupang 改價結果已回報中央系統：{clean(response.get('status') or 'ok')}")


def write_heartbeat(fs: FirestoreRest, status: str, extra: Optional[Dict[str, Any]] = None) -> None:
    payload = {
        "online": True,
        "status": status,
        "computerName": socket.gethostname(),
        "computerLabel": "柚子樂器店內電腦",
        "lastHeartbeatAt": utc_now_iso(),
        "agentVersion": VERSION,
        "schedule": ["14:00", "20:30"],
    }
    payload.update(extra or {})
    fs.set_document("opsSettings/platformLocalAgent", payload)


def notify_failure(title: str, message: str) -> None:
    # Windows 右下角短暫通知；失敗也不阻擋同步程式。
    if os.name != "nt":
        return
    safe_title = title.replace("'", "''")[:80]
    safe_message = message.replace("'", "''").replace("\r", " ").replace("\n", " ")[:300]
    script = (
        "Add-Type -AssemblyName System.Windows.Forms;"
        "$n=New-Object System.Windows.Forms.NotifyIcon;"
        "$n.Icon=[System.Drawing.SystemIcons]::Warning;"
        f"$n.BalloonTipTitle='{safe_title}';"
        f"$n.BalloonTipText='{safe_message}';"
        "$n.Visible=$true;$n.ShowBalloonTip(8000);Start-Sleep -Seconds 9;$n.Dispose();"
    )
    with contextlib.suppress(Exception):
        subprocess.Popen(["powershell.exe", "-NoProfile", "-WindowStyle", "Hidden", "-Command", script], creationflags=0x08000000)


def perform_sync(trigger: str, linked_requests: Optional[List[Tuple[str, Dict[str, Any]]]] = None) -> Dict[str, Any]:
    logger = RunLogger("platform_sync")
    config = load_json(CONFIG_PATH)
    agent_cfg = config.get("agent", {})
    fs = FirestoreRest(clean(agent_cfg.get("project_id")), logger)
    request_rows = linked_requests or []
    try:
        with SingleRunLock(LOCK_PATH):
            logger.write(f"開始同步，觸發方式：{trigger}")
            write_heartbeat(fs, "running", {"currentTrigger": trigger, "lastRunStartedAt": utc_now_iso()})
            if request_rows:
                claim_requests(fs, request_rows)
            lines, platform_fetch, query_from, query_to = fetch_orders(config, logger)
            bridge_payload = {
                "trigger": trigger,
                "queryFrom": query_from,
                "queryTo": query_to,
                "platformFetch": platform_fetch,
                "lines": lines,
                "priceProductIds": requested_price_product_ids(request_rows),
                "agent": {
                    "version": VERSION,
                    "computerName": socket.gethostname(),
                    "fixedIpMode": True,
                },
            }
            bridge_result = call_bridge(config, bridge_payload, logger)
            run_id = clean(bridge_result.get("runId"))
            bridge_targets = bridge_result.get("inventoryTargets") or []
            queue_targets = get_pending_queue(fs)
            targets = merge_targets(bridge_targets, queue_targets)
            if agent_cfg.get("enable_inventory_sync", True):
                inventory_summary = run_inventory_sync(config, targets, logger)
            else:
                inventory_summary = {"targets": len(targets), "success": 0, "errors": 0, "items": [], "skipped": True}
            update_queue_results(fs, inventory_summary, run_id)
            update_run_inventory_summary(fs, run_id, inventory_summary)
            price_summary = sync_coupang_price_targets(config, bridge_result.get("priceTargets") or [], logger)
            momo_summary = sync_momo_price_targets(config, bridge_result.get("momoPriceTargets") or [], logger, INVENTORY_SOURCE)
            price_summary["momo"] = momo_summary
            price_summary["items"].extend(momo_summary["items"])
            price_summary["errors"] += momo_summary["errors"]
            update_run_price_summary(fs, run_id, price_summary)
            # 後端收到結果後才會將該商品標為已完成，避免下次同步重複改同一個價格。
            report_price_results(config, run_id, price_summary.get("items") or [], logger)
            overall_status = "completed-with-errors" if (
                inventory_summary.get("errors") or price_summary.get("errors") or any(info.get("status") == "error" for info in platform_fetch.values())
            ) else "completed"
            finish_requests(fs, request_rows, overall_status, run_id)
            write_heartbeat(fs, "idle", {
                "lastRunFinishedAt": utc_now_iso(),
                "lastRunId": run_id,
                "lastRunStatus": overall_status,
                "lastError": "",
            })
            result = {
                "ok": overall_status == "completed",
                "status": overall_status,
                "runId": run_id,
                "orderLines": len(lines),
                "inventory": inventory_summary,
                "coupangPrice": price_summary,
                "log": str(logger.path),
            }
            atomic_write_json(CACHE_DIR / "last_run.json", result)
            logger.write(f"全部完成：{overall_status}，Run ID={run_id or '未取得'}。")
            return result
    except Exception as exc:  # noqa: BLE001
        message = clean(exc)
        busy = "已經在執行" in message or "同步正在執行" in message
        if busy:
            logger.write("目前已有另一個同步工作，這次先略過；網頁要求會保留等待下一輪。")
            with contextlib.suppress(Exception):
                finish_requests(fs, request_rows, "pending", error="")
            return {"ok": True, "status": "skipped-busy", "log": str(logger.path)}
        logger.write("同步失敗：" + message)
        logger.write(traceback.format_exc())
        with contextlib.suppress(Exception):
            finish_requests(fs, request_rows, "failed", error=message)
        with contextlib.suppress(Exception):
            write_heartbeat(fs, "error", {"lastRunFinishedAt": utc_now_iso(), "lastRunStatus": "failed", "lastError": message[:1000]})
        atomic_write_json(CACHE_DIR / "last_run.json", {"ok": False, "status": "failed", "error": message, "log": str(logger.path)})
        if agent_cfg.get("notify_on_failure", True):
            notify_failure("柚子樂器平台同步失敗", message)
        raise
    finally:
        logger.close()


def watch_loop(skip_startup_sync=False) -> None:
    # 用本機通訊埠避免同一台電腦同時啟動兩個背景監聽程式。
    singleton = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        singleton.bind(("127.0.0.1", 49577))
        singleton.listen(1)
    except OSError:
        return
    config = load_json(CONFIG_PATH)
    agent_cfg = config.get("agent", {})
    fs = FirestoreRest(clean(agent_cfg.get("project_id")))
    poll_seconds = max(10, integer(agent_cfg.get("poll_seconds"), 20))
    heartbeat_seconds = max(30, integer(agent_cfg.get("heartbeat_seconds"), 60))
    last_heartbeat = 0.0
    if agent_cfg.get("run_on_start", True) and not skip_startup_sync:
        try:
            perform_sync("windows-startup")
        except Exception:
            pass
    while True:
        try:
            now = time.time()
            if now - last_heartbeat >= heartbeat_seconds:
                write_heartbeat(fs, "idle")
                last_heartbeat = now
            pending = get_pending_requests(fs)
            if pending:
                # 一次同步即可處理同一時間累積的所有按鈕要求。
                try:
                    perform_sync("web-manual", pending)
                except Exception:
                    pass
        except Exception as exc:  # noqa: BLE001
            # 監聽迴圈本身不能因暫時斷線退出。
            error_path = LOG_DIR / "watch_errors.log"
            with error_path.open("a", encoding="utf-8") as handle:
                handle.write(f"[{now_tw().strftime('%Y-%m-%d %H:%M:%S')}] {exc}\n")
        time.sleep(poll_seconds)


def main() -> int:
    parser = argparse.ArgumentParser(description="柚子樂器店內 Windows 平台同步代理")
    sub = parser.add_subparsers(dest="command")
    once = sub.add_parser("once", help="立即同步一次")
    once.add_argument("--trigger", default="windows-manual")
    watcher = sub.add_parser("watch", help="背景監聽網頁手動同步要求")
    watcher.add_argument("--skip-startup-sync", action="store_true")
    sub.add_parser("test-config", help="只檢查檔案與設定，不呼叫平台 API")
    args = parser.parse_args()

    if args.command == "watch":
        watch_loop(args.skip_startup_sync)
        return 0
    if args.command == "test-config":
        config = load_json(CONFIG_PATH)
        required = [
            ("EasyStore Token", clean((config.get("easystore") or {}).get("access_token"))),
            ("MOMO Token", clean((config.get("momo") or {}).get("momo_token"))),
            ("Coupang Vendor ID", clean((config.get("coupang") or {}).get("vendor_id"))),
            ("Coupang Access Key", clean((config.get("coupang") or {}).get("access_key"))),
            ("Coupang Secret Key", clean((config.get("coupang") or {}).get("secret_key"))),
            ("Firebase Bridge", clean((config.get("agent") or {}).get("bridge_url"))),
        ]
        missing = [name for name, value in required if not value]
        if missing:
            print("缺少設定：" + "、".join(missing))
            return 2
        print("設定檢查完成：必要欄位皆已存在。")
        print("此步驟沒有呼叫平台 API，也沒有修改庫存。")
        return 0
    trigger = getattr(args, "trigger", "windows-manual")
    perform_sync(trigger)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as error:  # noqa: BLE001
        print(f"同步失敗：{error}", file=sys.stderr)
        raise SystemExit(1)
