from datetime import date
import unittest
from shipping_momo_deadlines import lookup


class DeadlineLookupTests(unittest.TestCase):
    def test_only_official_exact_dates_and_no_fabricated_time(self):
        calls=[]
        def query(lo,hi):
            calls.append((lo,hi))
            return {k for k,v in {'A':date(2026,11,19),'B':date(2026,11,21)}.items() if lo<=v<=hi}
        result=lookup({'A','B','C'},date(2026,11,17),date(2026,12,16),query,'2026-11-19T12:00:00+08:00')
        self.assertEqual(result['A']['shippingDeadlineText'],'2026-11-19')
        self.assertEqual(result['A']['shippingDeadlinePrecision'],'date')
        self.assertNotIn('C',result)
        self.assertLess(len(calls),25)

    def test_ignored_filter_is_not_a_deadline(self):
        result=lookup({'A'},date(2026,11,17),date(2026,11,20),lambda lo,hi:{'A'},'2026-11-19T12:00:00+08:00')
        self.assertEqual(result,{})

    def test_inconsistent_or_partial_queries_fail_closed(self):
        calls=[]
        def query(lo,hi):
            calls.append(1)
            return {'A'} if len(calls)==1 else set()
        with self.assertRaises(ValueError):lookup({'A'},date(2026,11,17),date(2026,11,20),query,'2026-11-19T12:00:00+08:00')
        with self.assertRaises(ValueError):lookup({'A'},date(2026,11,17),date(2026,11,20),lambda lo,hi:{'A'},'2026-11-19T12:00:00+08:00',max_queries=1)


if __name__=='__main__':unittest.main()
