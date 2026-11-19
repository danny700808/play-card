"""Exercise the HTTP handler's cache path without importing credentials or printing."""
import ast
import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
import uuid
from packing_footer import validate, VERSION


class PostalCacheBindingTests(unittest.TestCase):
    def test_cached_pdf_cannot_bypass_a_different_order_key(self):
        tree=ast.parse(Path(__file__).with_name('bridge.py').read_text(encoding='utf-8'))
        handler=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Handler')
        method=next(n for n in handler.body if isinstance(n,ast.FunctionDef) and n.name=='prepare_footer')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);jobs=root/'jobs';jobs.mkdir();calls=[]
            def save(folder,state):
                (folder/'status.json').write_text(json.dumps(state),encoding='utf-8')
            def read(folder):
                return json.loads((folder/'status.json').read_text(encoding='utf-8'))
            def render(command,payload):
                options=json.loads(payload);calls.append(options['orderKey'])
                valid=options['orderKey']=='EasyStore:123'
                return SimpleNamespace(returncode=0 if valid else 1,stdout=json.dumps(
                    {'pages':1,'barcodeCount':0,'layoutVersion':'postal-address-v1','paperMm':[100,150]}
                    if valid else {'error':'PDF order binding does not match'}))
            namespace={'json':json,'hashlib':hashlib,'sys':sys,'uuid':uuid,'ROOT':root,'JOBS':jobs,
                       'FOOTER_VERSION':VERSION,'POSTAL_PROFILE':'postal-address-v1',
                       'validate_footer':validate,'PASSWORD':'','run':render,'save_state':save,
                       'read_state':read,'public':lambda s:dict(s)}
            exec(compile(ast.Module(body=[method],type_ignores=[]),str(__file__),'exec'),namespace)
            class Harness:
                prepare_footer=namespace['prepare_footer']
                def reply(self,status,value):return status,value
            service=Harness()
            payload={'orderKey':'EasyStore:123','orderNo':'TEST123','tracking':'',
                     'packingFooter':{'version':VERSION,'orderNo':'TEST123',
                         'items':[{'name':'測試商品','sku':'TEST','quantity':1}]}}
            def prepare(value):
                return service.prepare_footer(value,b'%PDF synthetic','官網','postal-address-v1','postal')
            status,first=prepare(payload);self.assertEqual(status,200)
            status,second=prepare(payload);self.assertEqual(first['jobId'],second['jobId'])
            self.assertEqual(calls,['EasyStore:123'])
            status,rejected=prepare({**payload,'orderKey':'EasyStore:999'})
            self.assertEqual(status,422)
            self.assertEqual(rejected['status'],'failed')
            self.assertEqual(calls,['EasyStore:123','EasyStore:999'])


if __name__=='__main__':unittest.main()
