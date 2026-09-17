import ast
import unittest
from pathlib import Path
from types import SimpleNamespace

class QueueTests(unittest.TestCase):
    def test_bulk_current_stock_wins_without_per_product_calls(self):
        source=ast.parse(Path(__file__).with_name('youzi_sync_agent.py').read_text(encoding='utf-8'))
        node=next(n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='get_pending_queue')
        namespace={'FirestoreRest':object,'List':list,'Dict':dict,'Any':object,'clean':lambda x:str(x if x is not None else '').strip(),'integer':lambda x,d=0:int(x)}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'agent-queue','exec'),namespace)
        def unexpected(*args):raise AssertionError('unnecessary product read')
        agent=SimpleNamespace(run_query_equal=lambda *a,**k:[('p',{'productId':'p','targetStock':99,'_currentProduct':{'sku':'TEST','currentStock':0}})],get_document=unexpected)
        rows=namespace['get_pending_queue'](agent)
        self.assertEqual(rows[0]['targetStock'],0)
        self.assertEqual(rows[0]['sku'],'TEST')

if __name__=='__main__':unittest.main()
