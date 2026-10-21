"""Verify local HTTP access boundaries without any real platform calls."""
import http.client
import json
import re
import tempfile
import threading
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
from shipping_core import Workbench
from shipping_workbench import make_handler
from unittest.mock import patch


class HttpBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        root=Path(cls.tmp.name)
        (root/"config.json").write_text("{}")
        cls.workbench=Workbench(root/"config.json",root/"data")
        cls.server=ThreadingHTTPServer(("127.0.0.1",0),lambda *args:None)
        cls.port=cls.server.server_port
        cls.server.RequestHandlerClass=make_handler(cls.workbench,cls.port)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()
        cls.tmp.cleanup()

    def request(self,path="/",method="GET",headers=None,body=None):
        c=http.client.HTTPConnection("127.0.0.1",self.port)
        c.request(method,path,body=body,headers=headers or {})
        r=c.getresponse();status=r.status;head=dict(r.getheaders());payload=r.read()
        c.close()
        return status,head,payload

    def test_api_requires_local_session(self):
        self.assertEqual(self.request("/api/orders")[0],401)
        _,h,_=self.request()
        cookie=h["Set-Cookie"].split(";")[0]
        self.assertEqual(self.request("/api/orders",headers={"Cookie":cookie})[0],200)

    def test_delivery_token_is_narrow_and_origin_checked(self):
        bridge=self.workbench.delivery_bridge
        bridge.path.write_text(json.dumps({'token':'t'*43,'extensionId':'a'*32}))
        self.addCleanup(bridge.path.unlink)
        headers={'X-Youzi-Delivery':'t'*43,'Origin':bridge.origin(),'Content-Type':'application/json'}
        self.assertEqual(self.request('/api/delivery-bridge/poll',headers=headers)[0],200)
        self.assertEqual(self.request('/api/orders',headers=headers)[0],401)
        self.assertEqual(self.request('/api/process','POST',headers,'{}')[0],403)
        self.assertEqual(self.request('/api/delivery-bridge/result','POST',headers,'{}')[0],400)
        self.assertEqual(self.request('/api/delivery-bridge/poll',headers={**headers,'Origin':'https://evil.test'})[0],403)

    def test_other_website_cannot_submit_even_with_cookie(self):
        _,h,_=self.request()
        headers={"Cookie":h["Set-Cookie"].split(";")[0],"Origin":"https://example.com",
                 "Content-Type":"application/json"}
        self.assertEqual(self.request("/api/process","POST",headers,"{}")[0],403)

    def test_embedded_session_works_without_third_party_cookie(self):
        _,headers,html=self.request()
        token=re.search(rb'name="youzi-session" content="([^"]+)"',html).group(1).decode()
        self.assertEqual(self.request("/api/orders",headers={"X-Youzi-Session":token})[0],200)
        self.assertIn("frame-ancestors 'self' https://danny700808.github.io",headers["Content-Security-Policy"])
        foreign={"X-Youzi-Session":token,"Origin":"https://danny700808.github.io","Content-Type":"application/json"}
        self.assertEqual(self.request("/api/handling","POST",foreign,"{}")[0],403)

    def test_document_ticket_is_limited_to_specific_document(self):
        _,_,html=self.request()
        token=re.search(rb'name="youzi-session" content="([^"]+)"',html).group(1).decode()
        headers={"X-Youzi-Session":token,"Origin":f"http://127.0.0.1:{self.port}","Content-Type":"application/json"}
        with patch.object(self.workbench,"document",return_value=(b"%PDF-test","application/pdf")):
            status,_,body=self.request("/api/document-link","POST",headers,json.dumps({"key":"test-order"}))
            self.assertEqual(status,200)
            url=json.loads(body)["label"]
            self.assertEqual(self.request(url)[0],200)
            self.assertEqual(self.request(url.replace("test-order","other-order"))[0],401)
            self.assertEqual(self.request(url.replace("kind=label","kind=combined"))[0],401)

    def test_dns_rebinding_host_rejected(self):
        self.assertEqual(self.request(headers={"Host":"evil.example"})[0],403)

    def test_private_files_are_not_served(self):
        _,h,_=self.request()
        for path in ("/config.json","/../shipping_core.py","/shipping.sqlite3"):
            self.assertEqual(self.request(path,headers={"Cookie":h["Set-Cookie"].split(";")[0]})[0],404)


if __name__=="__main__":
    unittest.main()
