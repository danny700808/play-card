import unittest
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from momo_price_sync import sync_targets, MODIFY

class Tests(unittest.TestCase):
    def run_case(self, responses, price=900, mapping=True):
        self.calls=[]
        def post(url, token, body):
            self.calls.append((url, body))
            return responses.pop(0)
        source=SimpleNamespace(momo_post=post,momo_query_all=lambda cfg: [])
        target=dict(productId='p',sku='1380212-2',targetPrice=price,platformMappings={'goodsCode':'g','goodsdtCode':'001'} if mapping else {})
        return sync_targets({'momo':{'momo_token':'test'}},[target],SimpleNamespace(write=lambda _:None),source,lambda:datetime(2026,9,11,13,tzinfo=timezone(timedelta(hours=8))))
    def query(self, price=880, market=1200, sku='1380212-2'):
        return {'result':[{'goodsCode':'g','success':True,'listGoodsdt':[{'goodsdtCode':'00001','salePrice':price,'custPrice':market,'entpGoodsNo':sku}]}]}
    def ok(self):
        return {'success':True,'listItem':[{'goodsCode':'g','goodsdtCode':'00001','success':True}]}
    def test_success_preserves_market_and_verifies(self):
        r=self.run_case([self.query(),self.ok(),self.query(900)])
        self.assertEqual(r['success'],1)
        self.assertEqual(self.calls[1],(MODIFY,{'listItem':[dict(goodsCode='g',goodsdtCode='001',salePrice=900,custPrice=1200,applyDate='2026-09-11')]}))
    def test_same_does_not_write(self):
        self.assertEqual(self.run_case([self.query(900)])['items'][0]['status'],'same')
        self.assertEqual(len(self.calls),1)
    def test_per_item_failure_despite_top_level_success(self):
        r=self.run_case([self.query(),{'success':True,'listItem':[{'goodsCode':'g','goodsdtCode':'001','success':False,'errorMessage':'拒絕'}]}])
        self.assertEqual(r['errors'],1)
    def test_missing_result_fails(self):
        self.assertEqual(self.run_case([self.query(),{'success':True}])['errors'],1)
    def test_unverified_price_fails(self):
        self.assertEqual(self.run_case([self.query(),self.ok(),self.query()])['errors'],1)
    def test_invalid_price_never_calls(self):
        for value in [0,-1,0.5,True,'nan']:
            self.assertEqual(self.run_case([],value)['errors'],1)
            self.assertEqual(self.calls,[])
    def test_missing_market_never_writes(self):
        self.assertEqual(self.run_case([self.query(market=None)])['errors'],1)
        self.assertEqual(len(self.calls),1)
    def test_wrong_sku_never_writes(self):
        self.assertEqual(self.run_case([self.query(sku='other')])['errors'],1)
        self.assertEqual(len(self.calls),1)
    def test_missing_mapping_never_writes(self):
        self.assertEqual(self.run_case([],mapping=False)['errors'],1)
        self.assertEqual(self.calls,[])

if __name__=='__main__': unittest.main()
