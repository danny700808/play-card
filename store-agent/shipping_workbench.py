"""Loopback-only shipping UI, using the existing store agent's config.
Run: python shipping_workbench.py --config path/to/config.json
"""
import argparse
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import secrets
from urllib.parse import parse_qs, urlparse

from shipping_core import Workbench, ShippingError

STATIC = Path(__file__).parent / "shipping-ui"


def make_handler(workbench, port):
    session = secrets.token_urlsafe(32)
    origin = f"http://127.0.0.1:{port}"

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
            try:
                cookies = SimpleCookie(self.headers.get("Cookie", ""))
                return secrets.compare_digest(cookies.get("youzi_shipping").value, session)
            except (AttributeError, KeyError):
                return False

        def do_GET(self):
            if not self.host_ok():
                return self.send({"error": "Invalid host"}, status=403)
            parsed = urlparse(self.path)
            if parsed.path == "/":
                return self.send((STATIC / "index.html").read_bytes(), "text/html",
                    extra={"Set-Cookie": f"youzi_shipping={session}; HttpOnly; SameSite=Strict; Path=/",
                           "Content-Security-Policy": "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; frame-src 'self'; frame-ancestors 'none'"})
            if parsed.path in ("/app.js", "/style.css"):
                return self.send((STATIC / parsed.path[1:]).read_bytes(),
                                 "text/javascript" if parsed.path.endswith(".js") else "text/css")
            if not self.authenticated():
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
                            "img-src https: data:; frame-ancestors 'self'"
                            if mime == "text/html" else "frame-ancestors 'self'"),
                        "Content-Disposition": "inline"})
                except ShippingError as e:
                    return self.send({"error": str(e)}, status=409)
            self.send({"error": "Not found"}, status=404)

        def do_POST(self):
            # No CORS and exact Origin/Host prevent other sites from issuing shipping actions.
            if not self.host_ok() or self.headers.get("Origin") != origin or not self.authenticated():
                return self.send({"error": "請從店內出貨工作台操作。"}, status=403)
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                return self.send({"error": "JSON required"}, status=415)
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length < 0 or length > 32768:
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
                if self.path == "/api/print-event":
                    workbench.document(body["key"])
                    workbench.event(body["key"], "print-dialog-requested")
                    return self.send({"ok": True})
                return self.send({"error": "Not found"}, status=404)
            except ShippingError as e:
                self.send({"error": str(e)}, status=409)
            except (ValueError, KeyError, TypeError):
                self.send({"error": "請求資料不完整。"}, status=400)
            except Exception:
                self.send({"error": "平台連線失敗，請稍後重新讀取訂單。"}, status=502)

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default=str(Path(__file__).parent / "config.json"))
    parser.add_argument("--data-dir", default=str(Path(__file__).parent / "shipping-data"))
    parser.add_argument("--port", type=int, default=18765)
    args = parser.parse_args()
    workbench = Workbench(args.config, args.data_dir)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(workbench, args.port))
    print(f"Shipping workbench: http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
