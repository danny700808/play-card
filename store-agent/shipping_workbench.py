"""Loopback-only shipping UI, using the existing store agent's config.
Run: python shipping_workbench.py --config path/to/config.json
"""
import argparse
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import hashlib
import hmac
from pathlib import Path
import secrets
import time
import os
import base64
from urllib.parse import parse_qs, urlparse, urlencode

from shipping_core import Workbench, ShippingError

STATIC = Path(__file__).parent / "shipping-ui"


def make_handler(workbench, port):
    session = secrets.token_urlsafe(32)
    origin = f"http://127.0.0.1:{port}"
    portal = "https://danny700808.github.io"

    def document_ticket(key, kind, expires):
        return hmac.new(session.encode(), json.dumps([key, kind, expires]).encode(),
                        hashlib.sha256).hexdigest()

    def document_link(key, kind):
        expires = int(time.time()) + 3600
        return "/api/document?" + urlencode({"key": key, "kind": kind, "expires": expires,
                                              "ticket": document_ticket(key, kind, expires)})

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass  # Do not put order/customer identifiers into server access logs.

        def send(self, data, mime="application/json", status=200, extra=None):
            if isinstance(data, (dict, list)):
                data = json.dumps(data, ensure_ascii=False).encode()
            if isinstance(data, str):
                data = data.encode()
            self.send_response(status)
            self.send_header("Content-Type", mime + (";charset=utf-8" if mime.startswith("text/") else ""))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def host_ok(self):
            return self.headers.get("Host") == f"127.0.0.1:{port}"

        def authenticated(self):
            if secrets.compare_digest(self.headers.get("X-Youzi-Session", ""), session):
                return True
            try:
                cookies = SimpleCookie(self.headers.get("Cookie", ""))
                return secrets.compare_digest(cookies.get("youzi_shipping").value, session)
            except (AttributeError, KeyError):
                return False

        def document_authenticated(self, parsed):
            if parsed.path != "/api/document":
                return False
            args = parse_qs(parsed.query)
            try:
                key, kind = args["key"][0], args.get("kind", ["label"])[0]
                expires = int(args["expires"][0])
                return expires >= int(time.time()) and secrets.compare_digest(
                    args["ticket"][0], document_ticket(key, kind, expires))
            except (KeyError, ValueError, IndexError):
                return False

        def do_GET(self):
            if not self.host_ok():
                return self.send({"error": "Invalid host"}, status=403)
            parsed = urlparse(self.path)
            if parsed.path == "/api/delivery-bridge/poll":
                return self.delivery_request()
            if parsed.path == "/":
                return self.send((STATIC / "index.html").read_text(encoding="utf-8").replace("__SESSION__", session), "text/html",
                    extra={"Set-Cookie": f"youzi_shipping={session}; HttpOnly; SameSite=Strict; Path=/",
                           "Content-Security-Policy": f"default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; frame-src 'self'; frame-ancestors 'self' {portal}"})
            if parsed.path in ("/app.js", "/model.js", "/style.css"):
                return self.send((STATIC / parsed.path[1:]).read_bytes(),
                                 "text/javascript" if parsed.path.endswith(".js") else "text/css")
            if not self.authenticated() and not self.document_authenticated(parsed):
                return self.send({"error": "請從店內出貨工作台首頁開啟。"}, status=401)
            if parsed.path == "/api/orders":
                return self.send(workbench.snapshot())
            if parsed.path == "/api/document":
                key = parse_qs(parsed.query).get("key", [""])[0]
                try:
                    kind = parse_qs(parsed.query).get("kind", ["label"])[0]
                    content, mime = workbench.document(key, kind)
                    return self.send(content, mime, extra={
                        "Content-Security-Policy": (
                            "sandbox allow-scripts allow-modals; default-src 'none'; "
                            "script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
                            f"img-src https: data:; frame-ancestors 'self' {portal}"
                            if mime == "text/html" else f"frame-ancestors 'self' {portal}"),
                        "Content-Disposition": "inline"})
                except ShippingError as e:
                    return self.send({"error": str(e)}, status=409)
            self.send({"error": "Not found"}, status=404)

        def do_POST(self):
            if self.path == "/api/delivery-bridge/result":
                return self.delivery_request(post=True)
            # No CORS and exact Origin/Host prevent other sites from issuing shipping actions.
            if not self.host_ok() or self.headers.get("Origin") != origin or not self.authenticated():
                return self.send({"error": "請從店內出貨工作台操作。"}, status=403)
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                return self.send({"error": "JSON required"}, status=415)
            try:
                length = int(self.headers.get("Content-Length", "0"))
                maximum = 11_000_000 if self.path == "/api/provide-document" else 32768
                if length < 0 or length > maximum:
                    return self.send({"error": "Request too large"}, status=413)
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError()
                if self.path == "/api/refresh":
                    return self.send(workbench.refresh(body.get("days", 3)))
                if self.path == "/api/preview":
                    return self.send(workbench.preview(body["key"], body.get("options") or {}))
                if self.path == "/api/process":
                    return self.send(workbench.process(body["key"], body.get("options") or {},
                                                       body.get("fingerprint", "")))
                if self.path == "/api/handling":
                    if body.get("action") not in ("printed", "shipped", "processed", "reopen"):
                        raise ValueError()
                    return self.send(workbench.mark_handled(body["key"], body["action"], "店內確認"))
                if self.path == "/api/provide-document":
                    content = base64.b64decode(body["base64"], validate=True)
                    return self.send(workbench.provide_document(body["key"], content, body["binding"]))
                if self.path == "/api/document-link":
                    workbench.document(body["key"])
                    links = {kind: document_link(body["key"], kind) for kind in ("label", "combined")}
                    for kind in ("preview", "print"):
                        try:
                            workbench.document(body["key"], kind)
                            links[kind] = document_link(body["key"], kind)
                        except ShippingError:
                            pass
                    return self.send(links)
                if self.path == "/api/print-event":
                    workbench.document(body["key"])
                    workbench.mark_handled(body["key"], "print_requested")
                    return self.send({"ok": True})
                return self.send({"error": "Not found"}, status=404)
            except ShippingError as e:
                self.send({"error": str(e)}, status=409)
            except (ValueError, KeyError, TypeError):
                self.send({"error": "請求資料不完整。"}, status=400)
            except Exception:
                self.send({"error": "平台連線失敗，請稍後重新讀取訂單。"}, status=502)

        def do_OPTIONS(self):
            bridge = workbench.delivery_bridge
            if (self.host_ok() and self.path in ("/api/delivery-bridge/poll", "/api/delivery-bridge/result")
                    and bridge.origin() and self.headers.get("Origin") == bridge.origin()):
                return self.send({}, extra={"Access-Control-Allow-Origin": bridge.origin(),
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, X-Youzi-Delivery",
                    "Access-Control-Allow-Private-Network": "true"})
            return self.send({"error": "Forbidden"}, status=403)

        def delivery_request(self, post=False):
            bridge = workbench.delivery_bridge
            if not self.host_ok() or not bridge.authorized(
                    self.headers.get("X-Youzi-Delivery"), self.headers.get("Origin")):
                return self.send({"error": "Forbidden"}, status=403)
            headers = {"Access-Control-Allow-Origin": bridge.origin()}
            if not post:
                return self.send(bridge.poll(), extra=headers)
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 100000 or self.headers.get("Content-Type", "").split(';')[0] != 'application/json':
                    raise ValueError()
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError()
                return self.send(bridge.submit(body), extra=headers)
            except (ValueError, TypeError, KeyError):
                return self.send({"error": "Invalid or expired delivery result"}, status=400, extra=headers)

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(Path(__file__).parent / "config.json"))
    parser.add_argument("--data-dir", default=str(Path(__file__).parent / "shipping-data"))
    parser.add_argument("--port", type=int, default=18765)
    parser.add_argument("--remote-config", default=str(Path(os.environ.get("LOCALAPPDATA", ".")) / "YouziShipping/remote-config.json"))
    args = parser.parse_args()
    workbench = Workbench(args.config, args.data_dir)
    if Path(args.remote_config).is_file():
        from shipping_remote import RemoteRelay
        RemoteRelay(workbench, args.remote_config).start()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(workbench, args.port))
    print(f"Shipping workbench: http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
