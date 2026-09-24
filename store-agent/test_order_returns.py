import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('order_source', Path(__file__).parent/'lib/order_source.py')
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)

class ReturnParserTests(unittest.TestCase):
    def parse(self, release, status='RETURNS_COMPLETED', cancel_count=1):
        record={'receiptId':'R1','orderId':'O1','createdAt':'2026-09-24T10:00:00+08:00','receiptStatus':status,
                'returnItems':[{'vendorItemId':'V1','releaseStatus':release,'cancelCount':cancel_count,'purchaseCount':2}]}
        with patch.object(source,'coupang_request',return_value={'code':200,'data':[record]}) as call:
            rows, complete, errors=source.fetch_coupang_return_rows({'vendor_id':'TEST'},'2026-09-20+08:00','2026-09-24+08:00',2,50)
        self.assertTrue(complete);self.assertFalse(errors);self.assertEqual(len(rows),1)
        self.assertEqual([c.args[3].get('status') for c in call.call_args_list],['RU','UC','CC','PR',None])
        self.assertEqual(call.call_args_list[-1].args[3]['cancelType'],'CANCEL')
        return rows[0]
    def test_shipped_item_not_cancelled_before_shipment(self):
        for release in ['Y','A']:
            r=self.parse(release);self.assertTrue(r['曾確認出貨']);self.assertFalse(r['取消已確認']);self.assertEqual(r['取消數量'],'1');self.assertEqual(r['數量'],'2')
    def test_unshipped_completed_only(self):
        for release in ['N','S']:
            r=self.parse(release);self.assertTrue(r['確定未出貨']);self.assertTrue(r['取消已確認'])
            r=self.parse(release,'RELEASE_STOP_UNCHECKED');self.assertFalse(r['取消已確認'])
    def test_unknown_is_not_unshipped(self):
        r=self.parse('');self.assertFalse(r['確定未出貨']);self.assertFalse(r['取消已確認'])
    def test_claim_date_never_becomes_order_date(self):
        r=self.parse('Y');self.assertEqual(r['訂單時間'],'');self.assertEqual(r['訂單時間來源'],'missing');self.assertEqual(r['取消事件ID'],'R1')
    def test_no_guessed_quantity(self):
        self.assertEqual(self.parse('N',cancel_count=None)['取消數量'],'')
    def test_query_failure_marks_incomplete(self):
        with patch.object(source,'coupang_request',side_effect=RuntimeError('simulated')):
            rows,complete,errors=source.fetch_coupang_return_rows({'vendor_id':'TEST'},'2026-09-20','2026-09-24',2,50)
        self.assertFalse(complete);self.assertEqual(len(errors),5);self.assertEqual(rows,[])

if __name__=='__main__':unittest.main()
