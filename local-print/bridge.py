"""Loopback-only print bridge for the user's shipping page.

Origin + JSON/custom-header checks prevent browser CSRF. Hosts are constrained
against DNS rebinding. Only uploaded PDFs are accepted: no URL fetching or paths.
Job state is persisted before submitting to Windows to avoid accidental retries.
"""
import atexit
import base64
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from render_client import RenderClient
from packing_footer import validate as validate_footer, VERSION as FOOTER_VERSION

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8-sig"))
PORT = int(CONFIG.get("port", 18182))
JOBS = ROOT / "jobs"
JOBS.mkdir(exist_ok=True)
ORIGINS = {"https://danny700808.github.io", f"http://127.0.0.1:{PORT}"}
HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
CHANNELS = {"MOMO", "蝦皮", "酷澎", "官網"}
LOCK = threading.Lock()
MAX_BODY = 22 * 1024 * 1024
RELEASE = '2.2.0-warm-renderer'
PROFILE = 'momo-cvs-v1'
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
RENDERER = RenderClient(ROOT)
atexit.register(RENDERER.close)


def run(command, stdin=None, timeout=90):
    # Keep protected-password lookup and physical printing unchanged. Only
    # document conversion uses the serial, persistent, non-printing worker.
    if len(command) >= 2 and str(command[0]) == sys.executable:
        script = Path(command[1])
        if script.parent == ROOT and script.name in ('prepare.py', 'preview.py', 'cached_document.py'):
            payload = json.loads(stdin)
            operation = {'prepare.py':'prepare', 'preview.py':'preview',
                         'cached_document.py':'cached-document'}[script.name]
            if operation == 'prepare':
                payload = {'job': str(command[2]), 'options': payload}
            return RENDERER.call(operation, payload, timeout=timeout)
    return subprocess.run(command, input=stdin, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout,
                          creationflags=CREATE_NO_WINDOW)


secret = run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
              "-File", str(ROOT / "read_password.ps1")])
if secret.returncode:
    raise RuntimeError("Unable to read local protected PDF password.")
PASSWORD = secret.stdout.strip()
del secret


def save_state(folder, state):
    temp = folder / "status.tmp"
    temp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    os.replace(temp, folder / "status.json")


def read_state(folder):
    return json.loads((folder / "status.json").read_text(encoding="utf-8"))


def public(state):
    result = {key: state[key] for key in
            ("jobId", "status", "pages", "barcodeCount", "error", "printProfile", "paperMm",
             "layoutVersion", "alreadySubmitted", "footerMm", "footer") if key in state}
    if state.get('layoutVersion') == FOOTER_VERSION and state['status'] in ('preview','prepared','submitted'):
        image = JOBS / state['jobId'] / 'label-1-print.png'
        if image.is_file():
            result['preview'] = 'data:image/png;base64,' + base64.b64encode(image.read_bytes()).decode('ascii')
    return result


def momo_order_key_matches(order_key, order_no):
    """Accept legacy order IDs and the current main order:line-group IDs.

    The group suffix identifies rows within the SAME order; it must never
    make another order number pass. PDF/tracking and print-history guards
    remain unchanged in prepare().
    """
    match = re.fullmatch(r'MOMO:(\d{1,30})(?::\d{1,6}(?:,\d{1,6}){0,99})?', order_key)
    return bool(match and match.group(1) == order_no)


class Handler(BaseHTTPRequestHandler):
    server_version = "YouziLocalPrint/1"

    def log_message(self, *_):
        pass  # Never log document URLs, order keys, PDF data or passwords.

    def cors(self):
        origin = self.headers.get("Origin")
        if origin in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")

    def reply(self, status, value):
        raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def valid_host(self):
        return self.headers.get("Host") in HOSTS

    def do_OPTIONS(self):
        if not self.valid_host() or self.headers.get("Origin") not in ORIGINS:
            return self.reply(403, {"error": "Origin is not allowed."})
        self.send_response(204)
        self.cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Youzi-Print")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        if not self.valid_host():
            return self.reply(403, {"error": "Invalid host."})
        if self.path == "/health":
            return self.reply(200, {"service": "youzi-shipping-print", "version": 1, "preview": 1, "cachedDocument": 1,
                                   "printer": CONFIG["printer"], "paper": "100x150",
                                   "channels": sorted(CHANNELS), "release": RELEASE, "pid": os.getpid(),
                                   "printProfiles": [PROFILE], "packingLayouts": [FOOTER_VERSION]})
        match = re.fullmatch(r"/jobs/([a-f0-9]{32})", self.path)
        if match and self.headers.get("Origin") in ORIGINS:
            try:
                return self.reply(200, public(read_state(JOBS / match[1])))
            except FileNotFoundError:
                return self.reply(404, {"error": "Job not found."})
        return self.reply(404, {"error": "Not found."})

    def do_POST(self):
        if (not self.valid_host() or self.headers.get("Origin") not in ORIGINS or
                self.headers.get("X-Youzi-Print") != "1" or
                self.headers.get("Content-Type", "").split(";")[0] != "application/json"):
            return self.reply(403, {"error": "Request origin or headers are not allowed."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                return self.reply(413, {"error": "PDF request is too large."})
            payload = json.loads(self.rfile.read(length))
            if not LOCK.acquire(blocking=False):
                return self.reply(409, {"error": "另一份單據正在處理，請稍後再試。"})
            try:
                if self.path == "/prepare":
                    return self.prepare(payload)
                if self.path == "/preview":
                    return self.preview(payload)
                if self.path == "/cached-document":
                    return self.cached_document(payload)
                if self.path == "/print":
                    return self.print_job(payload)
                return self.reply(404, {"error": "Not found."})
            finally:
                LOCK.release()
        except (ValueError, KeyError, TypeError):
            self.reply(400, {"error": "Invalid request."})
        except Exception:
            self.reply(500, {"error": "本機處理失敗。請先檢查列印佇列，不要連續重試。"})

    def preview(self, payload):
        if payload.get('channel') != '蝦皮':
            return self.reply(400, {'code': 'unsupported'})
        try:
            result = run([sys.executable, str(ROOT / 'preview.py')],
                         json.dumps({key: payload.get(key, '') for key in
                                     ('pdfBase64', 'orderNo', 'tracking')}), timeout=45)
            detail = json.loads(result.stdout)
            return self.reply(422 if result.returncode else 200, detail)
        except Exception:
            return self.reply(422, {'code': 'failed'})

    def cached_document(self, payload):
        if payload.get('channel') != '蝦皮':
            return self.reply(400, {'code': 'unsupported'})
        try:
            result = run([sys.executable, str(ROOT / 'cached_document.py')],
                         json.dumps({key: payload.get(key, '') for key in ('orderNo', 'tracking')}), timeout=45)
            detail = json.loads(result.stdout)
            return self.reply(422 if result.returncode else 200, detail)
        except Exception:
            return self.reply(422, {'code': 'failed'})

    def prepare(self, payload):
        channel = payload["channel"]
        if channel not in CHANNELS:
            return self.reply(400, {"error": "尚未設定這個平台的列印方式。"})
        profile, method = payload.get('printProfile',''), payload.get('shippingMethod','')
        if (profile and profile != PROFILE or profile == PROFILE and
                (channel != 'MOMO' or method not in ('seven','family')) or
                channel == 'MOMO' and method in ('seven','family') and profile != PROFILE):
            return self.reply(400, {'error':'列印版型與平台或物流方式不符。'})
        for key in ('tracking','orderNo','orderKey'):
            value = payload.get(key,'')
            if not isinstance(value,str) or len(value)>100 or any(ord(c)<32 for c in value):
                return self.reply(400, {'error':'訂單識別格式不正確。'})
        if profile and payload.get('orderKey') and not momo_order_key_matches(payload['orderKey'], payload.get('orderNo','')):
            return self.reply(400, {'error':'訂單識別不一致。'})
        raw = base64.b64decode(payload["pdfBase64"], validate=True)
        if not 20 < len(raw) <= 15 * 1024 * 1024 or not raw.startswith(b"%PDF-"):
            return self.reply(400, {"error": "只接受 15 MB 以內的 PDF。"})
        if 'packingFooter' in payload:
            return self.prepare_footer(payload, raw, channel, profile, method)
        source_digest = hashlib.sha256(channel.encode() + b"\0" + raw).hexdigest()
        digest = hashlib.sha256((source_digest+'\0'+profile+'\0'+method).encode()).hexdigest() if profile else source_digest
        history = [read_state(path.parent) for path in JOBS.glob('*/status.json')]
        history.sort(key=lambda s: 0 if s['status'] in ('submitting','uncertain','preparing') else 1)
        def historical(old):
            result = public(old)
            if profile and old.get('pages') == 1:
                result.update(printProfile=profile,paperMm=[100,150])
            return self.reply(200,result)
        # A new profile must never turn a submitted/unknown legacy job into
        # permission to print again. Unknown attempts block even explicit retries.
        for old in history:
            if old.get('digest') in (digest,source_digest) or old.get('sourceDigest') == source_digest:
                if old['status'] in ('submitting','uncertain','preparing'):
                    return historical(old)
                if old['status']=='submitted' and payload.get('reprint') is not True:
                    return historical(old)
        for old in history:
            if (old.get('digest')==digest and old['status']=='prepared' and payload.get('reprint') is not True
                    and (not profile or old.get('tracking','')==payload.get('tracking',''))):
                if profile and old.get('labelIdentity'):
                    index_path = ROOT/'legacy-label-identities.json'
                    identities = json.loads(index_path.read_text(encoding='utf-8')) if index_path.exists() else {}
                    for prior in history:
                        if (prior.get('labelIdentity') or identities.get(prior['jobId'])) == old['labelIdentity']:
                            if prior['status'] in ('submitting','uncertain') or prior['status']=='submitted':
                                return historical(prior)
                return historical(old)
        folder = JOBS / uuid.uuid4().hex
        folder.mkdir()
        state = {"jobId": folder.name, "status": "preparing", "digest": digest,
                 'sourceDigest':source_digest,'printProfile':profile,'shippingMethod':method,'tracking':payload.get('tracking','')}
        save_state(folder, state)
        (folder / "source.pdf").write_bytes(raw)
        try:
            result = run([sys.executable, str(ROOT / "prepare.py"), str(folder)],
                         json.dumps({"channel": channel, "password": PASSWORD, 'printProfile':profile,
                                     'shippingMethod':method,'tracking':payload.get('tracking','')}))
            detail = json.loads(result.stdout)
            if result.returncode:
                state.update(status="failed", error=detail.get("error", "PDF 轉換失敗。"))
            else:
                state.update(status="prepared", **detail)
                if profile:
                    index_path = ROOT/'legacy-label-identities.json'
                    identities = json.loads(index_path.read_text(encoding='utf-8')) if index_path.exists() else {}
                    for old in history:
                        old_identity = old.get('labelIdentity') or identities.get(old['jobId'])
                        if old_identity != state.get('labelIdentity'):
                            continue
                        if old['status'] in ('submitting','uncertain') or (old['status']=='submitted' and payload.get('reprint') is not True):
                            state.update(status='superseded',priorJobId=old['jobId'])
                            save_state(folder,state)
                            return historical(old)
        except Exception:
            state.update(status="failed", error="PDF 轉換逾時或失敗，未送出列印。")
        save_state(folder, state)
        self.reply(200 if state["status"] == "prepared" else 422, public(state))

    def prepare_footer(self, payload, raw, channel, profile, method):
        try:
            footer = validate_footer(payload['packingFooter'])
            if footer['orderNo'] != payload.get('orderNo'):
                raise ValueError('商品資料與訂單編號不一致，尚未送印。')
        except ValueError as error:
            return self.reply(400, {'error': str(error)})
        source_digest = hashlib.sha256(channel.encode() + b'\0' + raw).hexdigest()
        layout_key = json.dumps([FOOTER_VERSION, profile, method, payload.get('tracking',''), footer],
                                sort_keys=True, ensure_ascii=False, separators=(',',':'))
        digest = hashlib.sha256((source_digest + '\0' + layout_key).encode()).hexdigest()
        history = [read_state(path.parent) for path in JOBS.glob('*/status.json')]
        same_source = [s for s in history if s.get('sourceDigest') == source_digest or s.get('digest') == source_digest]
        for old in same_source:
            if old['status'] in ('submitting','uncertain','preparing'):
                return self.reply(409, {'error':'這份原單仍在處理或送印結果不明，尚未建立新列印。'})
        submitted = [s for s in same_source if s['status'] == 'submitted']
        reprint = payload.get('reprint') is True
        cached = next((s for s in history if s.get('digest') == digest and s['status'] in ('prepared','preview')), None)
        if cached:
            # Resolve identities on EVERY access, including cached layout jobs.
            related = same_source[:]
            if profile and cached.get('labelIdentity'):
                index_path = ROOT / 'legacy-label-identities.json'
                identities = json.loads(index_path.read_text(encoding='utf-8')) if index_path.exists() else {}
                related += [s for s in history if (s.get('labelIdentity') or identities.get(s['jobId'])) == cached['labelIdentity']]
            if any(s['status'] in ('submitting','uncertain','preparing') for s in related):
                return self.reply(409, {'error':'原單送印結果尚未確認，尚未建立新列印。'})
            submitted += [s for s in related if s['status'] == 'submitted']
            if cached['status'] == 'preview' and not reprint:
                return self.reply(200, public(cached))
            if cached['status'] == 'prepared' and (reprint or not submitted):
                return self.reply(200, public(cached))
        folder = JOBS / uuid.uuid4().hex
        folder.mkdir()
        state = {'jobId': folder.name, 'status':'preparing', 'digest':digest, 'sourceDigest':source_digest,
                 'printProfile':profile, 'shippingMethod':method, 'tracking':payload.get('tracking',''),
                 'layoutVersion':FOOTER_VERSION, 'orderNo':footer['orderNo']}
        save_state(folder, state)
        (folder/'source.pdf').write_bytes(raw)
        try:
            result = run([sys.executable, str(ROOT/'prepare.py'), str(folder)], json.dumps({
                'channel':channel, 'password':PASSWORD, 'printProfile':profile, 'shippingMethod':method,
                'tracking':payload.get('tracking',''), 'packingFooter':payload['packingFooter']}))
            detail = json.loads(result.stdout)
            if result.returncode:
                state.update(status='failed', error=detail.get('error','標籤版面準備失敗，尚未送印。'))
            else:
                state.update(status='prepared', **detail)
                if profile:
                    index_path = ROOT/'legacy-label-identities.json'
                    identities = json.loads(index_path.read_text(encoding='utf-8')) if index_path.exists() else {}
                    for old in history:
                        if (old.get('labelIdentity') or identities.get(old['jobId'])) != state.get('labelIdentity'):
                            continue
                        if old['status'] in ('submitting','uncertain','preparing'):
                            state.update(status='failed', error='原單送印結果尚未確認，尚未建立新列印。')
                            break
                        if old['status'] == 'submitted':
                            submitted.append(old)
                if state['status'] == 'prepared' and submitted:
                    state['alreadySubmitted'] = True
                    if not reprint:
                        # A newly composed preview is NOT a new print permission.
                        state['status'] = 'preview'
                (folder/'packing-footer.json').write_text(json.dumps(footer, ensure_ascii=False), encoding='utf-8')
        except Exception:
            state.update(status='failed', error='標籤版面準備逾時或失敗，尚未送印。')
        save_state(folder, state)
        return self.reply(200 if state['status'] in ('prepared','preview') else 422, public(state))

    def print_job(self, payload):
        identifier = payload["jobId"]
        if not isinstance(identifier, str) or not re.fullmatch("[a-f0-9]{32}", identifier):
            return self.reply(400, {"error": "Invalid job ID."})
        folder = JOBS / identifier
        try:
            state = read_state(folder)
        except FileNotFoundError:
            return self.reply(404, {"error": "Job not found."})
        if state["status"] == "submitted":
            return self.reply(200, public(state))
        if state["status"] != "prepared":
            return self.reply(409, {"error": "此工作已送出或狀態不明，請先查看實際出紙。"})
        state["status"] = "submitting"
        save_state(folder, state)
        try:
            result = run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass",
                          "-File", str(ROOT / "print_labels.ps1"),
                          "-ImageDirectory", str(folder), "-PrinterName", CONFIG["printer"]],
                         timeout=60)
            if result.returncode:
                raise RuntimeError("Print submission failed.")
            state["status"] = "submitted"
        except Exception:
            state.update(status="uncertain", error="送印結果不明，請檢查印表機與佇列後再決定是否補印。")
        save_state(folder, state)
        self.reply(200 if state["status"] == "submitted" else 500, public(state))


class LocalPrintServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR can admit multiple listeners and route requests to
    # an old worker. The local printer bridge must have exactly one owner.
    allow_reuse_address = False

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


if __name__ == "__main__":
    warmed = RENDERER.call('warmup', {}, timeout=45)
    if warmed.returncode:
        raise RuntimeError('Local document renderer could not start.')
    LocalPrintServer(("127.0.0.1", PORT), Handler).serve_forever()
