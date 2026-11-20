import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from datetime import datetime, timedelta

from shipping_core import Workbench, normalize_es, ShippingError, TZ
from shipping_active_queue import visible, pending, expired
from shipping_remote import packing_snapshot


class ActiveQueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = self.root/'config.json'
        self.config.write_text(json.dumps({'easystore':{'store_url':'https://shop.test','access_token':'test'},
                                           'momo':{'momo_token':'test'}}))
        self.work = Workbench(self.config, self.root/'data')
        self.row = normalize_es({'id':1,'name':'OLD-PENDING','source_name':'shopee-taiwan',
            'created_at':(datetime.now(TZ)-timedelta(days=10)).isoformat(),'fulfillment_status':'unfulfilled',
            'line_items':[{'id':1,'quantity':1,'sku':'123','product_name':'商品'}]})
        self.work.rows = {self.row['key']:self.row}

    def test_recent_done_expires_at_24_hours_but_old_pending_and_acquired_remain(self):
        now=datetime.now(TZ)
        for hours, expected in [(23.99,True),(24,False),(25,False)]:
            record={'action':'printed','updated':(now-timedelta(hours=hours)).isoformat()}
            self.assertEqual(visible(self.row,record,now),expected)
        self.assertTrue(visible(self.row,None,now))
        self.assertTrue(pending(self.row,{'action':'acquired'}))
        self.assertFalse(visible({**self.row,'stage':'shipped'},None,now))
        self.assertFalse(visible({**self.row,'stage':'cancelled'},None,now))

    def test_date_only_expires_next_midnight_and_unknown_is_not_guessed(self):
        row={**self.row,'shippingDeadlineAt':'2026-11-20T00:00:00+08:00',
             'shippingDeadlineSource':'平台','shippingDeadlinePrecision':'date'}
        self.assertFalse(expired(row,datetime(2026,11,20,23,59,tzinfo=TZ)))
        self.assertTrue(expired(row,datetime(2026,11,21,tzinfo=TZ)))
        row.update(shippingDeadlineAt='2026-11-20T19:00:00+08:00',shippingDeadlinePrecision='minute')
        self.assertTrue(expired(row,datetime(2026,11,20,19,tzinfo=TZ)))
        self.assertFalse(expired(self.row))

    def test_expired_unhandled_stays_in_exception_queue_and_admin_resolution_is_durable(self):
        self.row.update(shippingDeadlineAt=(datetime.now(TZ)-timedelta(hours=2)).isoformat(),
                        shippingDeadlinePrecision='minute',shippingDeadlineSource='平台')
        self.assertEqual(len(self.work.snapshot()['orders']),1)
        self.assertEqual(self.work.queue_rows([self.row],pending_only=True),[])
        self.work.mark_handled(self.row['key'],'processed','包貨窗口')
        self.assertEqual(self.work.snapshot()['orders'],[])
        changed=copy.deepcopy(self.row);changed['tracking']='NEW-TRACK'
        restarted=Workbench(self.config,self.root/'data');restarted.rows[changed['key']]=changed
        self.assertEqual(restarted.snapshot()['orders'],[])
        with restarted.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM packing_dismissals').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM handling').fetchone()[0],1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],0)

    def test_recent_completion_is_retained_locally_without_rechecking_it(self):
        self.work.mark_handled(self.row['key'],'printed')
        with patch.object(self.work,'read_es',return_value=[]) as es, \
             patch.object(self.work,'read_momo',return_value=[]), \
             patch.object(self.work,'read_cp',return_value=[]),patch.object(self.work,'refresh_images'):
            self.work.refresh()
        self.assertEqual(self.work.refresh_pending['EasyStore'],[])
        self.assertEqual(len(self.work.snapshot()['orders']),1)
        with patch('shipping_core.source.es_request') as images:
            self.work.refresh_images();images.assert_not_called()

    def test_cursor_advances_only_on_success_and_old_pending_survives_restart(self):
        with patch.object(self.work,'read_es',return_value=[self.row]) as es, \
             patch.object(self.work,'read_momo',return_value=[]), \
             patch.object(self.work,'read_cp',return_value=[]),patch.object(self.work,'refresh_images'):
            self.work.refresh();first=es.call_args.args[0]
            cursor=self.work.refresh_cursors['EasyStore']
            self.work.refresh();second=es.call_args.args[0]
            self.assertGreater(second,first)
            self.assertEqual(self.work.refresh_pending['EasyStore'][0]['key'],self.row['key'])
            cursor=self.work.refresh_cursors['EasyStore']
            es.side_effect=ShippingError('offline');self.work.refresh()
            self.assertEqual(self.work.refresh_cursors['EasyStore'],cursor)
            self.assertTrue(self.work.snapshot()['orders'][0]['stale'])
        restarted=Workbench(self.config,self.root/'data')
        self.assertIn(self.row['key'],restarted.rows)
        self.assertEqual(packing_snapshot(restarted)['orders'][0]['key'],self.row['key'])

    def test_individual_es_read_targets_pending_only_and_keeps_old_order(self):
        self.work.refresh_pending={'EasyStore':[self.row]}
        raw={'id':1,'name':'OLD-PENDING','fulfillment_status':'unfulfilled','line_items':[]}
        def request(method,url,token,**kwargs):
            return {'orders':[]} if url.endswith('orders.json') else {'order':raw}
        with patch('shipping_core.source.es_request',side_effect=request) as api, \
             patch.object(self.work,'enrich_es_delivery',side_effect=lambda rows,*args:rows):
            rows=self.work.read_es(datetime.now(TZ),datetime.now(TZ))
        self.assertEqual([r['key'] for r in rows],[self.row['key']])
        self.assertEqual(api.call_count,2)
        self.assertTrue(api.call_args.args[1].endswith('/orders/1.json'))

    def test_expired_discovery_cannot_restart_background_deadline_reads(self):
        self.row.update(shippingDeadlineAt=(datetime.now(TZ)-timedelta(days=1)).isoformat(),
                        shippingDeadlinePrecision='minute',shippingDeadlineSource='平台')
        raw=copy.deepcopy(self.row);raw.pop('shippingDeadlineAt')
        with patch.object(self.work,'read_es',return_value=[self.row]), \
             patch.object(self.work,'read_momo',return_value=[]), \
             patch.object(self.work,'read_cp',return_value=[]),patch.object(self.work,'refresh_images'):
            self.work.refresh()
        selected=self.work.queue_candidates([raw])
        self.assertTrue(expired(selected[0]))
        self.assertEqual(self.work.queue_rows(selected,pending_only=True),[])

    def test_momo_old_pending_uses_exact_order_query_and_rejects_other_orders(self):
        raw={'orderNo':'66111900000001','listItem':[{'orderSeq':'001','goodsType':'商品',
             'goodsName':'商品','quantity':1,'itemStatus':'出貨通知','deliveryType':'第三方物流'}]}
        with patch.object(self.work,'momo_request',return_value={'data':[raw]}) as api:
            rows=self.work.momo_order_rows(raw['orderNo'])
            self.assertEqual(rows[0]['orderNo'],raw['orderNo'])
            self.assertEqual(api.call_args.args[1]['listOrderNo'],[raw['orderNo']])
            api.return_value={'data':[{**raw,'orderNo':'66111900000002'}]}
            with self.assertRaises(ShippingError):self.work.momo_order_rows(raw['orderNo'])

    def test_expired_completion_cannot_reappear_or_erase_print_receipts(self):
        self.work.mark_handled(self.row['key'],'printed')
        self.work.save_job(self.row['key'],state='ready',document='saved.pdf')
        with self.work.connect() as db:
            db.execute('UPDATE handling SET updated=?',((datetime.now(TZ)-timedelta(hours=25)).isoformat(),))
        self.assertEqual(self.work.queue_candidates([self.row]),[])
        with self.work.lock:self.work.save_queue()
        self.assertEqual(self.work.rows,{})
        self.assertEqual(self.work.job(self.row['key'])['state'],'ready')

    def test_expired_cached_label_reads_exact_order_on_demand_without_shipping(self):
        self.row.update(shippingDeadlineAt='2020-01-01T19:00:00+08:00',
                        shippingDeadlinePrecision='minute',shippingDeadlineSource='平台')
        with patch.object(self.work,'fresh_es',return_value=copy.deepcopy(self.row)) as read:
            self.work.revalidate_queued_document(self.row['key']);read.assert_called_once_with(self.row['key'])
            read.return_value['address']='changed'
            with self.assertRaises(ShippingError):self.work.revalidate_queued_document(self.row['key'])
        self.assertEqual(self.work.job(self.row['key']),{})

    def test_on_demand_read_preserves_known_deadline_when_api_omits_it(self):
        self.row.update(shippingDeadlineAt='2020-01-01T19:00:00+08:00',
                        shippingDeadlinePrecision='minute',shippingDeadlineSource='平台')
        fresh=copy.deepcopy(self.row);fresh.pop('shippingDeadlineAt')
        self.assertTrue(expired(self.work.preserve_queue_deadline(fresh)))


if __name__=='__main__':unittest.main()
