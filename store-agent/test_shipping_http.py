"""Verify local HTTP access boundaries without any real platform calls."""
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
from shipping_core import Workbench
from shipping_workbench import make_handler


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

    def test_other_website_cannot_submit_even_with_cookie(self):
        _,h,_=self.request()
        headers={"Cookie":h["Set-Cookie"].split(";")[0],"Origin":"https://example.com",
                 "Content-Type":"application/json"}
        self.assertEqual(self.request("/api/process","POST",headers,"{}")[0],403)

    def test_dns_rebinding_host_rejected(self):
        self.assertEqual(self.request(headers={"Host":"evil.example"})[0],403)

    def test_private_files_are_not_served(self):
        _,h,_=self.request()
        for path in ("/config.json","/../shipping_core.py","/shipping.sqlite3"):
            self.assertEqual(self.request(path,headers={"Cookie":h["Set-Cookie"].split(";")[0]})[0],404)


if __name__=="__main__":
    unittest.main()
